const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const secret = 'stage18e-test-only-secret-not-for-deployment';
const passwordHash = bcrypt.hashSync('fixture-password', 10);
const mutations = [
    ['POST', '/api/users', 'admin'], ['PUT', '/api/users/7', 'admin'],
    ['PUT', '/api/users/7/status', 'admin'], ['DELETE', '/api/users/7', 'admin'],
    ['POST', '/api/types', 'admin'], ['PUT', '/api/types/7', 'admin'],
    ['PUT', '/api/types/7/schema', 'admin'], ['DELETE', '/api/types/7', 'admin'],
    ['POST', '/api/letters', 'staff'], ['POST', '/api/letters/update', 'staff'],
    ['POST', '/api/letters/7/send', 'staff'], ['DELETE', '/api/letters/7', 'staff'],
    ['POST', '/api/dispositions/7/complete', 'staff'],
    ['POST', '/api/letters/incoming', 'admin'], ['POST', '/pimpinan/disposition', 'pimpinan'],
    ['POST', '/api/letters/7/approve', 'pimpinan'], ['POST', '/api/letters/7/reject', 'pimpinan'],
    ['POST', '/staff/profile/update', 'staff'], ['POST', '/staff/profile/password', 'staff'],
    ['POST', '/pimpinan/profile/update', 'pimpinan'], ['POST', '/pimpinan/profile/password', 'pimpinan'],
    ['POST', '/staff/profile', 'staff'], ['POST', '/api/profile/update', 'staff'],
    ['POST', '/api/profile/password', 'staff']
];

// Real composition root, routes, cookie auth, role guards, upload parser and CSRF.
// Only controller/DB/disk/log boundaries are replaced: no real successful mutation.
async function fixture({ production = false } = {}) {
    const events = [], cache = new Map(), mounts = [];
    let app;
    const pool = { query(sql, params, callback) {
        events.push(['db', sql]);
        if (sql === 'SELECT * FROM users WHERE username = ?') {
            return callback(null, [{ id: 7, username: 'fixture', full_name: 'Fixture', role: params[0] === 'fixture' ? 'staff' : params[0],
                nrp: 'FIX', is_active: 1, password_hash: passwordHash }]);
        }
        callback(null, { affectedRows: 1, insertId: 7 });
    } };
    function controller(name) {
        return (req, res) => {
            events.push(['controller', name]);
            if (req.method === 'GET' || req.method === 'HEAD') {
                const user = { ...req.user, full_name: 'Fixture', job_title: 'Fixture' };
                if (name === 'getStaffCreatePage') {
                    const isEdit = req.query.edit !== undefined;
                    const data = { ...res.locals, user, title: 'Fixture Create', page: 'create', isEdit,
                        types: [{ id: 12, name: 'Fixture', code_prefix: 'FIX', template_path: 'fixture.docx',
                            form_schema: JSON.stringify([{ label: 'Nama', type: 'text', key: 'nama' }]) }],
                        letter: isEdit ? { id: 7, type_id: 12, subject: 'Fixture Subject' } : null,
                        content: isEdit ? { nama: 'Saved Fixture' } : null };
                    return res.type('html').send(ejs.render(fs.readFileSync(path.join(root, 'views/staff/create.ejs'), 'utf8'),
                        data, { filename: path.join(root, 'views/staff/create.ejs') }));
                }
                const header = ejs.render(fs.readFileSync(path.join(root, 'views/partials/header.ejs'), 'utf8'),
                    { ...res.locals, user, title: 'Fixture' });
                return res.type('html').send('<html><head><title>Fixture</title></head><body>' + header +
                    '<form action="/staff/profile/update" method="post"><input name="full_name" value="Fixture"></form></body></html>');
            }
            pool.query('FIXTURE MUTATION', [], () => {});
            events.push(['write'], ['log', 'MUTATION']);
            res.json({ handler: name, body: req.body, file: req.file && req.file.originalname });
        };
    }
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        function appExpress() {
            app = express(); app.listen = () => app;
            const use = app.use;
            app.use = function(...args) {
                mounts.push({ prefix: typeof args[0] === 'string' ? args[0] : '',
                    routers: args.filter(x => typeof x === 'function' && x.stack) });
                return use.apply(this, args);
            };
            return app;
        }
        Object.assign(appExpress, express);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, Buffer, __dirname: path.dirname(file),
            console: { log() {}, error() {} }, process: { env: { JWT_SECRET: secret, NODE_ENV: production ? 'production' : 'development' }, cwd: () => root },
            require(name) {
                if (name === 'express') return appExpress;
                if (name === 'dotenv') return { config() {} };
                if (name.startsWith('.')) {
                    const target = path.resolve(path.dirname(file), name) + '.js';
                    if (target === path.join(root, 'config/database.js')) return { callbackPool: pool };
                    if (target === path.join(root, 'services/activityLogService.js')) return {
                        logActivity(id, action) { events.push(['log', action]); }
                    };
                    if (target.includes(path.sep + 'controllers' + path.sep) && !target.endsWith('authController.js')) {
                        return new Proxy({}, { get: (_, handler) => controller(handler) });
                    }
                    return load(target);
                }
                return require(name);
            }
        }, { filename: file });
        return module.exports;
    }
    load(path.join(root, 'app.js'));
    const server = express().use(app).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const identities = new Map();
    const cookieFor = role => {
        if (!identities.has(role)) identities.set(role, 'token=' + jwt.sign({ id: 7, role, name: 'Fixture', nrp: 'FIX' }, secret, { expiresIn: '5m' }));
        return identities.get(role);
    };
    async function request(url, { role = 'staff', method = 'GET', proof, cookie, headers = {}, body } = {}) {
        const r = await fetch(base + url, { method, redirect: 'manual', headers: {
            ...(role ? { Cookie: cookie || cookieFor(role) } : {}),
            ...(proof ? { 'X-CSRF-Token': proof } : {}), ...headers
        }, body });
        return { status: r.status, headers: r.headers, body: await r.text() };
    }
    async function session(role = 'staff') {
        const r = await request('/' + role + '/dashboard', { role });
        const csrfCookie = r.headers.getSetCookie().find(c => c.startsWith('csrf_token='));
        const proof = r.body.match(/name="csrf-token" content="([^"]+)"/)?.[1];
        return { role, proof, cookie: cookieFor(role) + (csrfCookie ? '; ' + csrfCookie.split(';')[0] : ''), page: r };
    }
    const inventory = [];
    for (const layer of app.router.stack) if (layer.route) for (const method of Object.keys(layer.route.methods)) inventory.push(method.toUpperCase() + ' ' + layer.route.path);
    for (const { prefix, routers } of mounts) for (const router of routers) for (const layer of router.stack) {
        if (layer.route) for (const method of Object.keys(layer.route.methods)) {
            const url = (prefix + layer.route.path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
            inventory.push(method.toUpperCase() + ' ' + url);
        }
    }
    return { request, session, events, base, inventory, loaded: Array.from(cache.keys()),
        close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('every authenticated mutation rejects missing proof before controller, DB, disk or log', async t => {
    const f = await fixture(); t.after(f.close);
    for (const [method, url, role] of mutations) {
        f.events.length = 0;
        const r = await f.request(url, { role, method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 403, method + ' ' + url);
        assert.deepEqual(JSON.parse(r.body), { message: 'Token CSRF tidak valid. Muat ulang halaman dan coba lagi.' });
        assert.deepEqual(f.events, []);
    }
});

test('wrong, injected and other-session proofs cannot authorize a mutation', async t => {
    const f = await fixture(); t.after(f.close);
    const staff = await f.session(), admin = await f.session('admin');
    for (const input of [
        { ...staff, proof: 'wrong' }, { ...staff, cookie: staff.cookie.replace(/csrf_token=[^;]+/, 'csrf_token=forged'), proof: 'forged' },
        { role: 'staff', cookie: staff.cookie.split(';')[0] + '; ' + admin.cookie.split(';')[1].trim(), proof: admin.proof }
    ]) {
        f.events.length = 0;
        const r = await f.request('/api/letters', { ...input, method: 'POST', body: '{}' });
        assert.equal(r.status, 403); assert.deepEqual(f.events, []);
    }
});

test('valid JSON proof reaches every modular mutation; legacy safe validation keeps its response', async t => {
    const f = await fixture(); t.after(f.close);
    for (const role of ['admin', 'staff', 'pimpinan']) {
        const s = await f.session(role);
        assert.ok(s.proof);
        for (const [method, url, allowed] of mutations.filter(x => !['/staff/profile', '/api/profile/update', '/api/profile/password'].includes(x[1]))) {
            if (allowed !== role) continue;
            f.events.length = 0;
            const r = await f.request(url, { ...s, method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
            assert.equal(r.status, 200, method + ' ' + url);
            assert.equal(f.events[0][0], 'controller');
            assert.deepEqual(f.events.slice(1).map(e => e[0]), ['db', 'write', 'log']);
        }
    }
    const s = await f.session();
    for (const url of ['/api/profile/update', '/api/profile/password']) {
        f.events.length = 0;
        assert.equal((await f.request(url, { ...s, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
        assert.deepEqual(f.events, []);
    }
});

test('anonymous and invalid JWT retain auth redirects; a wrong role with valid proof retains authorization', async t => {
    const f = await fixture(); t.after(f.close);
    for (const [method, url] of mutations) {
        const r = await f.request(url, { role: null, method });
        assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/');
    }
    assert.equal((await f.request('/api/letters', { method: 'POST', cookie: 'token=invalid' })).status, 302);
    const s = await f.session(); f.events.length = 0;
    const r = await f.request('/api/types', { ...s, method: 'POST' });
    assert.equal(r.status, 403); assert.deepEqual(JSON.parse(r.body), { message: 'Akses ditolak!' });
    assert.deepEqual(f.events, []);
});

test('native form proof preserves fields, HTML failure is 403 and query-string proof is rejected', async t => {
    const f = await fixture(); t.after(f.close); const s = await f.session();
    const body = new URLSearchParams({ full_name: 'Fixture', _csrf: s.proof });
    let r = await f.request('/staff/profile/update', { ...s, proof: undefined, method: 'POST', body });
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).body.full_name, 'Fixture');
    f.events.length = 0;
    r = await f.request('/staff/profile/update', { role: 'staff', method: 'POST', headers: { Accept: 'text/html' }, body: new URLSearchParams({ full_name: 'Fixture' }) });
    assert.equal(r.status, 403); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(r.body, /Muat ulang/);
    assert.deepEqual(f.events, []);
    assert.equal((await f.request('/api/letters?_csrf=' + s.proof, { ...s, proof: undefined, method: 'POST' })).status, 403);
});

test('valid form proof works with opaque Origin caused by no-referrer; cross-site metadata still denies it', async t => {
    const f = await fixture(); t.after(f.close); const s = await f.session();
    for (const [site, status] of [['same-origin', 200], ['cross-site', 403]]) {
        const r = await f.request('/staff/profile/update', { ...s, proof: undefined, method: 'POST',
            headers: { Origin: 'null', 'Sec-Fetch-Site': site }, body: new URLSearchParams({ full_name: 'Fixture', _csrf: s.proof }) });
        assert.equal(r.status, status);
    }
});

test('production Secure cookie policy accepts the HTTPS origin behind the existing HTTP proxy boundary', async t => {
    const f = await fixture({ production: true }); t.after(f.close); const s = await f.session();
    assert.match(s.page.headers.getSetCookie().find(c => c.startsWith('csrf_token=')), /; Secure/);
    const r = await f.request('/api/letters', { ...s, method: 'POST', headers: { Origin: f.base.replace('http:', 'https:') } });
    assert.equal(r.status, 200);
});

test('multipart header is checked before upload processing and valid proof preserves the file object', async t => {
    const f = await fixture(); t.after(f.close); const s = await f.session('admin');
    const form = () => { const value = new FormData(); value.set('file_scan', new Blob([Buffer.from('%PDF-1.4\ntrailer\n%%EOF\n')], { type: 'application/pdf' }), 'fixture.pdf'); return value; };
    f.events.length = 0;
    assert.equal((await f.request('/api/letters/incoming', { role: 'admin', method: 'POST', body: form() })).status, 403);
    assert.deepEqual(f.events, []);
    const rejectedFile = new FormData();
    rejectedFile.set('file_scan', new Blob(['inert invalid file'], { type: 'text/plain' }), 'unsupported.txt');
    assert.equal((await f.request('/api/letters/incoming', { role: 'admin', method: 'POST', body: rejectedFile })).status, 403);
    assert.deepEqual(f.events, []); // Upload validation would return 400 if it ran before CSRF.
    const r = await f.request('/api/letters/incoming', { ...s, method: 'POST', body: form() });
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).file, 'fixture.pdf');
});

test('login needs no pre-auth token; GET/HEAD/download do not require proof; logout rejects identified cross-origin requests', async t => {
    const f = await fixture(); t.after(f.close);
    let r = await f.request('/api/auth/login', { role: null, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password: 'fixture-password' }) });
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).user.role, 'staff');
    for (const url of ['/staff/dashboard', '/staff/create', '/api/letters/7', '/download-surat/7']) {
        assert.equal((await f.request(url)).status, 200);
        assert.equal((await f.request(url, { method: 'HEAD' })).status, 200);
    }
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://untrusted.invalid' }, { Referer: 'https://untrusted.invalid/page' }]) {
        const denied = await f.request('/logout', { headers });
        assert.equal(denied.status, 403); assert.equal(denied.headers.get('set-cookie'), null);
    }
    for (const headers of [{}, { 'Sec-Fetch-Site': 'same-origin' }, { Referer: f.base + '/staff/dashboard' }]) {
        r = await f.request('/logout', { headers });
        assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/');
        assert.ok(r.headers.getSetCookie().some(c => /^token=;/.test(c)));
        assert.ok(r.headers.getSetCookie().some(c => /^csrf_token=;/.test(c)));
    }
});

test('signed cookie is session-bound, HttpOnly, SameSite=Lax and reused across authenticated pages', async t => {
    const f = await fixture(); t.after(f.close); const s = await f.session();
    const cookie = s.page.headers.getSetCookie().find(c => c.startsWith('csrf_token='));
    assert.match(cookie, /; HttpOnly/); assert.match(cookie, /; SameSite=Lax/); assert.match(cookie, /; Path=\//);
    const next = await f.request('/staff/dashboard', s);
    assert.equal(next.headers.get('set-cookie'), null);
    assert.equal(next.body.match(/name="csrf-token" content="([^"]+)"/)[1], s.proof);
    assert.equal(new Set(f.inventory).size, f.inventory.length);
    for (const [method, url] of mutations) assert.ok(f.inventory.some(route => route === method + ' ' + url.replace('/7', '/:id')), url);
    assert.ok(!f.loaded.some(file => /(?:letterRoutes|dashboardRoutes)\.js$/.test(file)));
});

test('browser login/logout for all roles and shared hidden-field/fetch integration retain cookie-only flow', async t => {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const f = await fixture(); t.after(f.close);
    for (const role of ['admin', 'staff', 'pimpinan']) {
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => request.url().startsWith(f.base) ? request.continue() : request.abort());
            await page.goto(f.base, { waitUntil: 'domcontentloaded' });
            await page.type('#username', role); await page.type('#password', 'fixture-password');
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#btnLogin')]);
            assert.equal(new URL(page.url()).pathname, '/' + role + '/dashboard');
            await page.waitForSelector('input[name="_csrf"]');
            assert.equal(await page.evaluate(() => document.querySelector('input[name="_csrf"]').value === document.querySelector('meta[name="csrf-token"]').content), true);
            assert.equal(await page.evaluate(() => document.cookie.includes('token=') || document.cookie.includes('csrf_token=') || localStorage.getItem('token') !== null), false);
            const target = role === 'admin' ? '/api/users' : role === 'pimpinan' ? '/api/letters/7/approve' : '/api/letters/7/send';
            const result = await page.evaluate(async url => {
                const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fixture: 'unchanged' }) });
                return { status: r.status, data: await r.json() };
            }, target);
            assert.equal(result.status, 200); assert.equal(result.data.body.fixture, 'unchanged');
            if (role === 'staff') {
                const submission = page.waitForRequest(r => r.url() === f.base + '/staff/profile/update' && r.method() === 'POST');
                const [navigation] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.evaluate(() => document.querySelector('form').requestSubmit())]);
                await submission;
                assert.equal(navigation.status(), 200);
                assert.equal(JSON.parse(await page.evaluate(() => document.body.textContent)).body.full_name, 'Fixture');
            }
            await page.goto(f.base + '/logout', { waitUntil: 'domcontentloaded' });
            assert.equal(new URL(page.url()).pathname, '/');
            assert.equal((await context.cookies()).some(c => ['token', 'csrf_token'].includes(c.name)), false);
        } finally { await context.close(); }
    }
});

test('browser create/edit form, Request headers and multipart carry proof without altering data or leaking it cross-origin', async t => {
    const browser = await require('puppeteer').launch({ headless: true }); t.after(() => browser.close());
    const f = await fixture(); t.after(f.close);
    const page = await browser.newPage();
    const foreignHeaders = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().startsWith(f.base)) return request.continue();
        if (request.url().startsWith('https://untrusted.invalid')) {
            foreignHeaders.push(request.headers());
            return request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'fixture' });
        }
        request.abort();
    });
    await page.evaluateOnNewDocument(() => { window.Swal = { fire: () => Promise.resolve({ isConfirmed: false }), showLoading() {} }; });
    for (const edit of [false, true]) {
        const s = await f.session();
        await page.setCookie(...s.cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.base, httpOnly: true, sameSite: 'Lax' })));
        await page.goto(f.base + '/staff/create' + (edit ? '?edit=7' : ''), { waitUntil: 'domcontentloaded' });
        if (!edit) await page.select('#jenisSurat', '12');
        await page.waitForSelector('input[name="nama"]');
        const mutation = page.waitForResponse(r => r.url() === f.base + (edit ? '/api/letters/update' : '/api/letters') && r.request().method() === 'POST');
        await page.evaluate(() => { document.querySelector('#perihalSurat').value = 'Fixture Subject'; document.querySelector('[name="nama"]').value = 'Fixture Value'; document.querySelector('#createLetterForm').requestSubmit(); });
        const response = await mutation;
        assert.equal(response.status(), 200);
        assert.match(response.request().headers()['x-csrf-token'], /^[a-f0-9]{64}\.[a-f0-9]{64}$/);
        const data = JSON.parse(response.request().postData());
        assert.equal(data.nama, 'Fixture Value');
        assert.equal(data.subject, 'Fixture Subject');
        if (edit) assert.equal(String(data.id), '7');
    }
    const admin = await f.session('admin');
    await page.setCookie(...admin.cookie.split('; ').map(pair => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: f.base, httpOnly: true, sameSite: 'Lax' })));
    await page.goto(f.base + '/admin/dashboard', { waitUntil: 'domcontentloaded' });
    const results = await page.evaluate(async () => {
        const request = new Request(location.origin + '/api/users/7', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Fixture': 'kept' }, body: JSON.stringify({ fixture: 'Request body' }) });
        const r = await fetch(request);
        const form = new FormData(); form.set('file_scan', new Blob(['%PDF-1.4\ntrailer\n%%EOF\n'], { type: 'application/pdf' }), 'fixture.pdf');
        const upload = await fetch('/api/letters/incoming', { method: 'POST', body: form });
        await fetch('https://untrusted.invalid/fixture', { method: 'POST', body: 'inert' });
        return { requestStatus: r.status, requestData: await r.json(), uploadStatus: upload.status, uploadData: await upload.json() };
    });
    assert.equal(results.requestStatus, 200); assert.equal(results.requestData.body.fixture, 'Request body');
    assert.equal(results.uploadStatus, 200); assert.equal(results.uploadData.file, 'fixture.pdf');
    assert.equal(foreignHeaders.length, 1); assert.equal(foreignHeaders[0]['x-csrf-token'], undefined);
});
