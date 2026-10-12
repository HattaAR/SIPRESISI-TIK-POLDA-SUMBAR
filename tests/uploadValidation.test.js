const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const os = require('node:os');

const root = path.join(__dirname, '..');
const secret = 'stage18d-fixture-only-secret-not-for-deployment';
const wordMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
function docx() {
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{nama}</w:t></w:r></w:p></w:body></w:document>');
    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
function legacyDoc() {
    // Inert CFB signature/directory fixture, never a macro or a database record.
    const b = Buffer.alloc(1024);
    Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(b);
    b.writeUInt16LE(0xfffe, 28); b.writeUInt16LE(9, 30);
    b.writeUInt32LE(0, 48);
    Buffer.from('WordDocument\0', 'utf16le').copy(b, 512);
    b.writeUInt16LE(26, 512 + 64); b[512 + 66] = 2;
    return b;
}

// Load the real app, auth, routes and Multer. Only DB/logging/controller disk IO are replaced.
async function fixture({ dbError = false, diskError = false, realDisk = false } = {}) {
    const events = [], files = new Map(), cache = new Map();
    const tempRoot = realDisk ? fs.mkdtempSync(path.join(os.tmpdir(), 'sipresisi-upload-')) : null;
    const disk = Object.create(fs);
    disk.existsSync = p => p.endsWith(path.join('public', 'uploads')) || files.has(p);
    disk.mkdirSync = p => events.push(['mkdir', p]);
    disk.writeFileSync = (p, b) => {
        events.push(['write', p, Buffer.from(b)]);
        if (diskError) throw new Error('Fixture disk failure');
        files.set(p, Buffer.from(b));
        if (tempRoot) fs.writeFileSync(path.join(tempRoot, path.basename(p)), b);
    };
    disk.unlinkSync = p => {
        events.push(['unlink', p]); files.delete(p);
        if (tempRoot) fs.unlinkSync(path.join(tempRoot, path.basename(p)));
    };
    const pool = { query(sql, params, cb) {
        events.push(['query', sql, JSON.parse(JSON.stringify(params))]);
        cb(dbError ? new Error('Fixture database failure') : null, { insertId: 7 });
    } };
    let app;
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        function appExpress() { app = express(); app.listen = () => app; return app; }
        Object.assign(appExpress, express);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, Buffer, __dirname: path.dirname(file),
            console: { log() {}, error() {} },
            process: { env: { JWT_SECRET: secret }, cwd: () => root },
            require(name) {
                if (name === 'express') return appExpress;
                if (name === 'dotenv') return { config() {} };
                if (name === 'fs' && /(?:incomingMail|type)Controller\.js$/.test(file)) return disk;
                if (name.startsWith('.')) {
                    const target = path.resolve(path.dirname(file), name) + '.js';
                    if (target === path.join(root, 'config/database.js')) return { callbackPool: pool };
                    if (target === path.join(root, 'services/activityLogService.js')) return {
                        logActivity(...args) { events.push(['log', ...args.slice(0, 3)]); }
                    };
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
    async function request(url, file, { role = 'admin', method = 'POST', fields = {}, uploadField } = {}) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        if (file) form.set(uploadField || (url.includes('/api/types') ? 'template_file' : 'file_scan'),
            new Blob([file.bytes], { type: file.mime }), file.name);
        const headers = role ? { cookie: 'token=' + jwt.sign({ id: 42, role }, secret) } : {};
        if (role) {
            // Obtain proof from the real middleware before exercising upload validation.
            const page = await fetch('http://127.0.0.1:' + server.address().port + '/',
                { headers, redirect: 'manual' });
            const cookie = page.headers.getSetCookie().find(value => value.startsWith('csrf_token='));
            await page.arrayBuffer();
            headers.cookie += '; ' + cookie.split(';')[0];
            headers['X-CSRF-Token'] = cookie.split(';')[0].slice('csrf_token='.length);
        }
        const r = await fetch('http://127.0.0.1:' + server.address().port + url,
            { method, headers, body: form, redirect: 'manual' });
        const body = await r.text();
        return { status: r.status, headers: r.headers, body, json: () => JSON.parse(body) };
    }
    return { request, events, files, tempRoot, registered: app.router.stack.filter(layer => layer.route).map(layer => layer.route),
        loaded: Array.from(cache.keys()), close: async () => {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        if (tempRoot) {
            // Only explicit files in this test-owned directory; never touch real upload storage.
            for (const name of fs.readdirSync(tempRoot)) fs.unlinkSync(path.join(tempRoot, name));
            fs.rmdirSync(tempRoot);
        }
    } };
}

test('spoofed PDF content is rejected before disk, DB or logging', async t => {
    const f = await fixture(); t.after(f.close);
    const r = await f.request('/api/letters/incoming', { name: 'scan.pdf', mime: 'application/pdf', bytes: Buffer.from('inert not a PDF') });
    assert.equal(r.status, 400);
    assert.match(r.json().message, /File upload tidak valid/);
    assert.deepEqual(f.events, []);
    assert.equal(f.files.size, 0);
});

test('incoming accepts valid PDF, DOCX and legacy DOC with their correct extensions', async t => {
    for (const [ext, mime, bytes] of [['pdf', 'application/pdf', pdf], ['docx', wordMime, docx()], ['doc', 'application/msword', legacyDoc()]]) {
        const f = await fixture(); t.after(f.close);
        const fields = { letter_number: 'FIX', external_sender: 'Fixture', recipient: 'Fixture leader', subject: 'Fixture', letter_date: '2026-10-09' };
        const r = await f.request('/api/letters/incoming', { name: 'scan.' + ext.toUpperCase(), mime, bytes }, { fields });
        assert.equal(r.status, 200, ext);
        assert.deepEqual(r.json(), { message: 'Surat masuk berhasil diregistrasi!' });
        assert.deepEqual(f.events.map(e => e[0]), ['write', 'query', 'log']);
        assert.match(f.events[0][1], new RegExp('surat_masuk_\\d+\\.' + ext + '$'));
        assert.deepEqual(f.events[0][2], bytes);
        assert.match(f.events[1][1], /VALUES \(\?, NULL, \?, \?, \?, \?, \?, 'EXTERNAL', 'APPROVED', \?\)/);
        assert.deepEqual(f.events[1][2], [42, 'FIX', 'Fixture', 'Fixture leader', 'Fixture', '2026-10-09', path.basename(f.events[0][1])]);
        assert.deepEqual(f.events[2], ['log', 42, 'REGISTER_MAIL', 'Mendaftarkan Surat Masuk dari Fixture']);
    }
});

test('extension, MIME, content and template-purpose mismatches stop before all side effects', async t => {
    const f = await fixture(); t.after(f.close);
    const bad = [
        { name: 'scan.pdf', mime: wordMime, bytes: pdf },
        { name: 'scan.docx', mime: 'application/pdf', bytes: pdf },
        { name: 'scan.exe', mime: 'application/pdf', bytes: pdf },
        { name: 'scan.jpg', mime: 'image/jpeg', bytes: pdf },
        { name: 'scan.pdf.exe', mime: 'application/pdf', bytes: pdf },
        { name: 'scan.pdf', mime: 'application/pdf', bytes: docx() },
        { name: 'scan.docx', mime: wordMime, bytes: pdf },
        { name: 'scan.doc', mime: 'application/msword', bytes: pdf },
        { name: 'scan.docx', mime: wordMime, bytes: new PizZip().file('inert.txt', 'fixture').generate({ type: 'nodebuffer' }) },
        { name: 'scan.docx', mime: wordMime, bytes: Buffer.from('PK\x03\x04 not a ZIP') },
        { name: 'scan.pdf', mime: 'application/pdf', bytes: Buffer.alloc(0) }
    ];
    for (const url of ['/api/letters/incoming', '/api/types', '/api/types/7']) {
        for (const file of bad) {
            const r = await f.request(url, file, { method: url === '/api/types/7' ? 'PUT' : 'POST' });
            assert.equal(r.status, 400, url + ': ' + file.name);
            assert.equal(typeof r.json().message, 'string');
        }
    }
    for (const ext of ['pdf', 'doc']) {
        const r = await f.request('/api/types', { name: 'template.' + ext, mime: ext === 'pdf' ? 'application/pdf' : 'application/msword', bytes: ext === 'pdf' ? pdf : legacyDoc() });
        assert.equal(r.status, 400);
    }
    assert.deepEqual(f.events, []);
    assert.equal(f.files.size, 0);
});

test('templates remain usable by Docxtemplater; valid create/update preserve storage and SQL', async t => {
    const bytes = docx();
    const generated = new Docxtemplater(new PizZip(bytes), { paragraphLoop: true, linebreaks: true }).render({ nama: 'Fixture' });
    assert.match(generated.getZip().file('word/document.xml').asText(), /Fixture/);
    for (const method of ['POST', 'PUT']) {
        const f = await fixture(); t.after(f.close);
        const fields = { name: 'Fixture', code_prefix: 'FIX', form_schema: '[]', letter_number_format: '{nomor}' };
        const r = await f.request(method === 'POST' ? '/api/types' : '/api/types/7', { name: 'Nota Dinas.DOCX', mime: wordMime, bytes }, { method, fields });
        assert.equal(r.status, 200);
        assert.deepEqual(f.events.map(e => e[0]), ['write', 'query']);
        assert.match(f.events[0][1], /\d+-Nota_Dinas\.docx$/);
        assert.deepEqual(f.events[0][2], bytes);
        const filename = path.basename(f.events[0][1]);
        assert.deepEqual(f.events[1][2], method === 'POST' ? ['Fixture', 'FIX', '{nomor}', '[]', filename] : ['Fixture', 'FIX', '{nomor}', filename, '7']);
        assert.deepEqual(r.json(), { message: method === 'POST' ? 'Sukses!' : 'Jenis surat berhasil diperbarui!' });
    }
});

test('no-cookie/role guards precede uploads, and missing file/optional replacement keep their contract', async t => {
    const f = await fixture(); t.after(f.close);
    for (const url of ['/api/letters/incoming', '/api/types', '/api/types/7']) {
        const method = url.endsWith('/7') ? 'PUT' : 'POST';
        assert.equal((await f.request(url, null, { role: null, method })).status, 302);
        if (url.includes('/api/types')) assert.equal((await f.request(url, null, { role: 'staff', method })).status, 403);
    }
    assert.deepEqual(f.events, []);
    assert.equal((await f.request('/api/letters/incoming', null)).status, 400);
    assert.deepEqual((await f.request('/api/types', null)).json(), { message: 'Wajib upload file template .docx!' });
    assert.equal((await f.request('/api/types/7', null, { method: 'PUT', fields: { name: 'Fixture', code_prefix: 'FIX', letter_number_format: 'FORMAT' } })).status, 200);
    assert.deepEqual(f.events, [['query', 'UPDATE letter_types SET name = ?, code_prefix = ?, letter_number_format = ? WHERE id = ?', ['Fixture', 'FIX', 'FORMAT', '7']]]);
});

test('incoming DB failure retains cleanup and logging order; disk failures never query', async t => {
    for (const failure of ['dbError', 'diskError']) {
        const f = await fixture({ [failure]: true }); t.after(f.close);
        const r = await f.request('/api/letters/incoming', { name: 'scan.pdf', mime: 'application/pdf', bytes: pdf });
        assert.equal(r.status, 500);
        assert.deepEqual(f.events.map(e => e[0]), failure === 'dbError' ? ['write', 'query', 'unlink'] : ['write']);
        assert.equal(f.files.size, 0);
    }
});

test('frontend file accept agrees with the active policy, not dormant image uploads', () => {
    const entry = fs.readFileSync(path.join(root, 'views/admin/entry_surat.ejs'), 'utf8');
    assert.match(entry, /accept="\.pdf,\.doc,\.docx"/);
    assert.match(fs.readFileSync(path.join(root, 'views/admin/types.ejs'), 'utf8'), /accept="\.docx"/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'views/staff/create.ejs'), 'utf8'), /type="file"/);
});

test('50 MB limit is retained and oversized multipart gets JSON 413 without artifacts', async t => {
    const f = await fixture({ realDisk: true }); t.after(f.close);
    const r = await f.request('/api/letters/incoming', {
        name: 'oversize.pdf', mime: 'application/pdf', bytes: Buffer.alloc(50 * 1024 * 1024 + 1)
    });
    assert.equal(r.status, 413);
    assert.deepEqual(r.json(), { message: 'Ukuran file melebihi batas 50 MB.' });
    assert.deepEqual(f.events, []);
    assert.deepEqual(fs.readdirSync(f.tempRoot), []);
});

test('odd/traversal filenames stay flat, bounded and compatible with private access', async t => {
    const f = await fixture({ realDisk: true }); t.after(f.close);
    const { isSafeUploadName } = require('../utils/privateUploadPaths');
    const bytes = docx();
    for (const name of ['../outside.DOCX', '..\\outside.DOCX', 'weird:%name?.DOCX', '..hidden.DOCX', 'CON.docx', 'a'.repeat(220) + '.docx']) {
        const r = await f.request('/api/types', { name, mime: wordMime, bytes });
        assert.equal(r.status, 200, name);
        const storedPath = f.events.filter(e => e[0] === 'write').at(-1)[1];
        assert.equal(path.dirname(storedPath), path.join(root, 'public', 'uploads'));
        const filename = path.basename(storedPath);
        assert.equal(isSafeUploadName(filename), true, filename);
        assert.ok(Buffer.byteLength(filename) < 255);
        assert.deepEqual(fs.readFileSync(path.join(f.tempRoot, filename)), bytes);
    }
});

test('macro/other Office ZIPs, malicious archive paths and expansion metadata are rejected', async t => {
    const f = await fixture({ realDisk: true }); t.after(f.close);
    const macro = new PizZip(docx()).file('word/vbaProject.bin', 'inert fixture').generate({ type: 'nodebuffer' });
    const xlsx = new PizZip(docx()).file('[Content_Types].xml', '<Types>application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml</Types>').generate({ type: 'nodebuffer' });
    const traversal = new PizZip(docx()).file('../inert.txt', 'fixture').generate({ type: 'nodebuffer' });
    const expanded = Buffer.from(docx());
    const central = expanded.indexOf(Buffer.from('504b0102', 'hex'));
    expanded.writeUInt32LE(50 * 1024 * 1024 + 1, central + 24);
    for (const bytes of [macro, xlsx, traversal, expanded]) {
        const r = await f.request('/api/types', { name: 'template.docx', mime: wordMime, bytes });
        assert.equal(r.status, 400);
    }
    assert.deepEqual(f.events, []);
    assert.deepEqual(fs.readdirSync(f.tempRoot), []);
});

test('wrong multipart field is deterministic 400 before DB/disk', async t => {
    const f = await fixture(); t.after(f.close);
    const r = await f.request('/api/letters/incoming', { name: 'scan.pdf', mime: 'application/pdf', bytes: pdf }, { uploadField: 'lampiran' });
    assert.equal(r.status, 400);
    assert.deepEqual(f.events, []);
});

test('existing DOCX templates retain their bytes and generation compatibility', async t => {
    const f = await fixture(); t.after(f.close);
    const filenames = fs.readdirSync(path.join(root, 'public/uploads')).filter(name => /\.docx$/i.test(name));
    assert.ok(filenames.length > 0);
    for (const name of filenames) {
        const bytes = fs.readFileSync(path.join(root, 'public/uploads', name));
        const r = await f.request('/api/types', { name, mime: wordMime, bytes });
        assert.equal(r.status, 200, name);
        assert.deepEqual(f.events.filter(e => e[0] === 'write').at(-1)[2], bytes);
    }
});

test('template filesystem/DB errors preserve their old messages and do not log success', async t => {
    for (const method of ['POST', 'PUT']) {
        for (const failure of ['dbError', 'diskError']) {
            const f = await fixture({ [failure]: true }); t.after(f.close);
            const r = await f.request(method === 'POST' ? '/api/types' : '/api/types/7', {
                name: 'template.docx', mime: wordMime, bytes: docx()
            }, { method });
            assert.equal(r.status, 500);
            assert.deepEqual(f.events.map(e => e[0]), failure === 'dbError' ? ['write', 'query'] : ['write']);
            assert.deepEqual(r.json(), { message: method === 'POST'
                ? failure === 'dbError' ? 'Gagal menyimpan ke database' : 'Gagal menyimpan file ke server'
                : failure === 'dbError' ? 'Gagal update database' : 'Gagal menyimpan file baru' });
        }
    }
});

test('generic OLE content cannot impersonate a Word DOC without a Word stream marker', async t => {
    const f = await fixture(); t.after(f.close);
    const b = legacyDoc(); b.fill(0, 512, 512 + 26);
    Buffer.from('Workbook\0', 'utf16le').copy(b, 512);
    const r = await f.request('/api/letters/incoming', { name: 'scan.doc', mime: 'application/msword', bytes: b });
    assert.equal(r.status, 400);
    assert.deepEqual(f.events, []);
});

test('each upload is registered once and legacy upload/letter modules stay dormant', async t => {
    const f = await fixture(); t.after(f.close);
    for (const [url, method] of [['/api/types', 'post'], ['/api/types/:id', 'put'], ['/api/letters/incoming', 'post']]) {
        assert.equal(f.registered.filter(route => route.path === url && route.methods[method]).length, 1);
    }
    assert.equal(f.loaded.includes(path.join(root, 'routes/letterRoutes.js')), false);
    assert.equal(f.loaded.includes(path.join(root, 'middleware/upload.js')), false);
    assert.equal(f.events.length, 0);
});
