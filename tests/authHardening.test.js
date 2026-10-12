const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer');
const { requireRole } = require('../middleware/roleMiddleware');

const root = path.join(__dirname, '..');
const fixtureSecret = 'stage18b-test-only-secret-not-for-deployment';
const fixturePassword = 'stage18b-test-only-password';
let passwordHash;
let browser;

before(async () => { passwordHash = await bcrypt.hash(fixturePassword, 10); });
after(async () => { if (browser) await browser.close(); });

// Only DB and activity-log boundaries are replaced; crypto, cookies and HTTP are real.
function loadModule(file, env, query, logActivity) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
        module, exports: module.exports, process: { env },
        require(specifier) {
            if (specifier === '../config/database') return { callbackPool: { query } };
            if (specifier === '../services/activityLogService') return { logActivity };
            if (specifier === '../config/auth') return loadModule('config/auth.js', env);
            return require(specifier);
        }
    }, { filename: file });
    return module.exports;
}

async function fixture({ role = 'staff', found = true, inactive = false, dbError = false, production = false, https = false } = {}) {
    const events = [];
    const env = { JWT_SECRET: fixtureSecret, NODE_ENV: production ? 'production' : 'development' };
    const user = { id: 7, username: 'fixture-user', full_name: 'Fixture User', role, nrp: 'FIX7',
        is_active: inactive ? 0 : 1, password_hash: passwordHash, password: 'never-return-this-fixture',
        private_extra_column: 'never-return-this-fixture-column' };
    const query = (sql, params, callback) => {
        assert.equal(sql, 'SELECT * FROM users WHERE username = ?');
        assert.deepEqual(Array.from(params), ['fixture-user']);
        events.push('query');
        callback(dbError ? new Error('Fixture DB error') : null, found ? [user] : []);
    };
    const log = (id, action, description, req) => {
        assert.equal(id, 7);
        assert.equal(action, 'LOGIN');
        assert.equal(description, 'User fixture-user berhasil login ke sistem');
        assert.equal(req.path, '/api/auth/login');
        events.push('log');
    };
    const controller = loadModule('controllers/authController.js', env, query, log);
    const { verifyToken } = loadModule('middleware/authMiddleware.js', env);
    const app = express();
    app.use(express.json(), cookieParser());
    app.use((req, res, next) => {
        if (https) Object.defineProperty(req, 'secure', { value: true });
        for (const method of ['cookie', 'json']) {
            const original = res[method];
            res[method] = function(...args) { events.push(method); return original.apply(this, args); };
        }
        next();
    });
    app.set('view engine', 'ejs');
    app.set('views', path.join(root, 'views'));
    app.get('/', controller.showLogin);
    app.post('/api/auth/login', controller.login);
    app.get('/logout', controller.logout);
    for (const allowed of ['admin', 'staff', 'pimpinan']) {
        app.get('/' + allowed + '/dashboard', verifyToken, requireRole(allowed), (req, res) => res.send('Fixture dashboard'));
    }
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    return { base, events, close: () => new Promise(resolve => server.close(resolve)),
        login: password => fetch(base + '/api/auth/login', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'fixture-user', password: password ?? fixturePassword }) }) };
}

test('login for every role exposes only the frontend allowlist, never token or password fields', async () => {
    for (const role of ['admin', 'staff', 'pimpinan']) {
        const app = await fixture({ role });
        try {
            const res = await app.login();
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { message: 'Login Berhasil', user: { role, full_name: 'Fixture User' } });
            assert.deepEqual(app.events, ['query', 'log', 'cookie', 'json']);
        } finally { await app.close(); }
    }
});

test('JWT payload and one-day lifetime match the HttpOnly SameSite=Lax cookie', async () => {
    const app = await fixture();
    try {
        const res = await app.login();
        const cookie = res.headers.get('set-cookie');
        assert.match(cookie, /; HttpOnly/);
        assert.match(cookie, /; SameSite=Lax/);
        assert.match(cookie, /; Path=\//);
        assert.match(cookie, /; Max-Age=86400/);
        assert.doesNotMatch(cookie, /; Secure/);
        const payload = jwt.verify(cookie.split(';')[0].slice('token='.length), fixtureSecret);
        assert.deepEqual({ id: payload.id, name: payload.name, role: payload.role, nrp: payload.nrp },
            { id: 7, name: 'Fixture User', role: 'staff', nrp: 'FIX7' });
        assert.equal(payload.exp - payload.iat, 86400);
    } finally { await app.close(); }
});

test('production and HTTPS login issue Secure cookies without weakening local HTTP development', async () => {
    for (const options of [{ production: true }, { https: true }]) {
        const app = await fixture(options);
        try { assert.match((await app.login()).headers.get('set-cookie'), /; Secure/); }
        finally { await app.close(); }
    }
});

for (const [name, options, password, status, message] of [
    ['wrong password', {}, 'not-the-fixture-password', 401, 'Password Salah!'],
    ['missing user', { found: false }, undefined, 401, 'Username tidak ditemukan!'],
    ['inactive user', { inactive: true }, undefined, 403, 'Akun Anda telah dinonaktifkan oleh Admin.'],
    ['database error', { dbError: true }, undefined, 500, 'Database Error']
]) {
    test(name + ' preserves its response without creating a cookie or activity log', async () => {
        const app = await fixture(options);
        try {
            const res = await app.login(password);
            assert.equal(res.status, status);
            assert.deepEqual(await res.json(), { message });
            assert.equal(res.headers.get('set-cookie'), null);
            assert.deepEqual(app.events, ['query', 'json']);
        } finally { await app.close(); }
    });
}

test('missing or blank JWT_SECRET fails during module initialization instead of accepting a fallback', () => {
    for (const JWT_SECRET of [undefined, '', '   ']) {
        for (const file of ['middleware/authMiddleware.js', 'controllers/authController.js']) {
            assert.throws(() => loadModule(file, { JWT_SECRET }), /JWT_SECRET/);
        }
    }
});

test('logout clears the token with matching cookie scope and redirects home', async () => {
    for (const production of [false, true]) {
        const app = await fixture({ production });
        try {
            const login = await app.login();
            const cookie = login.headers.get('set-cookie').split(';')[0];
            const res = await fetch(app.base + '/logout', { headers: { Cookie: cookie }, redirect: 'manual' });
            assert.equal(res.status, 302);
            assert.equal(res.headers.get('location'), '/');
            const cleared = res.headers.get('set-cookie');
            assert.match(cleared, /^token=;/);
            assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
            assert.match(cleared, /; HttpOnly/);
            assert.match(cleared, /; SameSite=Lax/);
            assert.match(cleared, /; Path=\//);
            assert.equal(cleared.includes('; Secure'), production);
            assert.doesNotMatch(cleared, /Max-Age/);
        } finally { await app.close(); }
    }
});

test('invalid and expired cookies are cleared consistently by login page and verifyToken', async () => {
    const app = await fixture();
    try {
        const expired = jwt.sign({ id: 7, role: 'staff' }, fixtureSecret, { expiresIn: -1 });
        for (const token of ['invalid-fixture-token', expired]) {
            for (const route of ['/', '/staff/dashboard']) {
                const res = await fetch(app.base + route, { headers: { Cookie: 'token=' + token }, redirect: 'manual' });
                assert.equal(res.status, route === '/' ? 200 : 302);
                assert.match(res.headers.get('set-cookie'), /; SameSite=Lax/);
                assert.match(res.headers.get('set-cookie'), /; HttpOnly/);
            }
        }
        assert.equal(app.events.includes('query'), false);
    } finally { await app.close(); }
});

test('cookie-only browser login retains role redirects and removes the legacy localStorage token', async () => {
    browser = await puppeteer.launch({ headless: true });
    for (const role of ['admin', 'staff', 'pimpinan']) {
        const app = await fixture({ role });
        const context = await browser.createBrowserContext();
        try {
            const page = await context.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => request.url().startsWith(app.base) ? request.continue() : request.abort());
            await page.evaluateOnNewDocument(() => {
                if (location.pathname === '/') localStorage.setItem('token', 'legacy-test-only-token');
            });
            await page.goto(app.base, { waitUntil: 'domcontentloaded' });
            assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
            await page.type('#username', 'fixture-user');
            await page.type('#password', fixturePassword);
            await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#btnLogin')]);
            assert.equal(new URL(page.url()).pathname, '/' + role + '/dashboard');
            assert.deepEqual(await page.evaluate(() => ({ token: localStorage.getItem('token'), role: localStorage.getItem('role'), name: localStorage.getItem('name') })),
                { token: null, role, name: 'Fixture User' });
            assert.equal(await page.evaluate(() => document.cookie.includes('token=')), false);
            await page.goto(app.base + '/logout', { waitUntil: 'domcontentloaded' });
            assert.equal(new URL(page.url()).pathname, '/');
            assert.equal((await context.cookies()).some(cookie => cookie.name === 'token'), false);
            assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
        } finally { await context.close(); await app.close(); }
    }
});
