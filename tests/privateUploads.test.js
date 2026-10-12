const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const root = path.join(__dirname, '..');
const uploadRoot = path.join(root, 'public', 'uploads');
const secret = 'stage18c-test-only-secret-not-for-deployment';
const bytes = Buffer.from('%PDF-1.4\nStage 18C inert fixture\n%%EOF');

// Real app/router/auth/HTTP; only DB, logging and private-file IO are stubbed.
async function fixture({ owner = 42, receiver = false, kind = 'letter', missing = false,
    dbError = false, symlink = false, metadata = 'fixture.pdf', documentTemplate = null, realFile = false } = {}) {
    const queries = [];
    const reads = [];
    const cache = new Map();
    const disk = Object.create(fs);
    disk.realpathSync = file => {
        if (missing) throw Object.assign(new Error('Missing fixture'), { code: 'ENOENT' });
        return symlink && path.basename(file) === metadata ? path.join(root, 'outside.pdf') : file;
    };
    disk.statSync = () => ({ isFile: () => true });
    const pool = { query(sql, params, cb) {
        sql = sql.trim().replace(/\s+/g, ' ');
        queries.push({ sql, params: JSON.parse(JSON.stringify(params)) });
        if (dbError) return cb(new Error('Fixture DB unavailable'));
        if (sql.includes('FROM dispositions')) return cb(null, receiver ? [{ allowed: 1 }] : []);
        if (sql.includes('FROM attachments')) return cb(null, kind === 'attachment' ? [{ id: 7, user_id: owner, file_path: metadata }] : []);
        if (sql.includes('FROM letter_types')) return cb(null, kind === 'template' ? [{ template_path: metadata }] : []);
        if (sql.includes('FROM letters') && sql.includes('pdf_path')) return cb(null, kind === 'letter' ? [{ id: 7, user_id: owner, pdf_path: metadata }] : []);
        if (sql.includes('SELECT user_id FROM letters')) return cb(null, [{ user_id: owner }]);
        if (sql.includes('SELECT l.*, t.template_path')) return cb(null, [{ id: 7, user_id: owner,
            origin_type: documentTemplate ? 'INTERNAL' : 'EXTERNAL', template_path: documentTemplate, content_data: bytes }]);
        throw new Error('Unexpected query: ' + sql);
    } };
    function load(file) {
        file = path.resolve(file);
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} };
        cache.set(file, module);
        const customExpress = () => {
            const app = express();
            app.listen = () => app;
            fixture.app = app;
            return app;
        };
        Object.assign(customExpress, express);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, Buffer, console,
            __dirname: realFile && file.endsWith('privateUploadPaths.js')
                ? path.join(__dirname, 'fixtures', 'privateUploads', 'utils') : path.dirname(file),
            process: { env: { JWT_SECRET: secret }, cwd: () => root },
            require(specifier) {
                if (specifier === 'express') return customExpress;
                if (specifier === 'dotenv') return { config() {} };
                if (specifier === 'fs' && file.endsWith('privateUploadPaths.js')) return realFile ? fs : disk;
                if (specifier.startsWith('.')) {
                    const resolved = path.resolve(path.dirname(file), specifier) + '.js';
                    if (resolved === path.join(root, 'config', 'database.js')) return { callbackPool: pool };
                    if (resolved === path.join(root, 'services', 'activityLogService.js')) return { logActivity() { throw new Error('Read must not log'); } };
                    return load(resolved);
                }
                return require(specifier);
            }
        }, { filename: file });
        return module.exports;
    }
    load(path.join(root, 'app.js'));
    const outer = express();
    outer.use((req, res, next) => {
        if (realFile) return next();
        res.sendFile = (file, options, callback) => {
            reads.push({ file, options });
            if (!res.getHeader('Content-Type')) res.type(path.extname(file));
            res.set(options.headers);
            res.send(bytes);
            if (callback) callback();
        };
        next();
    });
    outer.use(fixture.app);
    const server = outer.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = (url, user = null, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
        const cookie = user ? 'token=' + jwt.sign(user, secret, { expiresIn: '5m' }) : undefined;
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method,
            headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } }, res => {
            const chunks = [];
            res.on('data', b => chunks.push(b));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end();
    });
    return { request, queries, reads, close: () => new Promise(resolve => server.close(resolve)) };
}

test('anonymous uploads require the existing cookie auth and never reach DB or disk', async t => {
    const f = await fixture(); t.after(f.close);
    for (const method of ['GET', 'HEAD']) {
        const r = await f.request('/uploads/fixture.pdf', null, {}, method);
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, '/');
    }
    assert.equal(f.queries.length, 0);
    assert.equal(f.reads.length, 0);
});

for (const [name, user, receiver] of [
    ['admin', { id: 99, role: 'admin' }, false],
    ['pimpinan', { id: 99, role: 'pimpinan' }, false],
    ['staff owner', { id: 42, role: 'staff' }, false],
    ['staff receiver', { id: 99, role: 'staff' }, true]
]) test(`${name} receives only a DB-linked upload with private cache headers`, async t => {
    const f = await fixture({ receiver }); t.after(f.close);
    const r = await f.request('/uploads/fixture.pdf', user);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, bytes);
    assert.match(r.headers['content-type'], /application\/pdf/);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    assert.equal(f.reads.length, 1);
    const sentPath = path.isAbsolute(f.reads[0].file) ? f.reads[0].file : path.join(uploadRoot, f.reads[0].file);
    assert.equal(sentPath, path.join(uploadRoot, 'fixture.pdf'));
    assert.equal(f.reads[0].options.root, uploadRoot);
    const q = f.queries[0];
    assert.equal(q.sql, 'SELECT id, user_id, pdf_path FROM letters WHERE pdf_path = ?');
    assert.deepEqual(q.params, ['fixture.pdf']);
    if (receiver) assert.deepEqual(f.queries[1].params, [[7], 99]);
});

test('unrelated staff and unknown roles cannot read or conditionally cache an upload', async t => {
    const f = await fixture(); t.after(f.close);
    for (const role of ['staff', 'kasubbag', 'unknown']) {
        const r = await f.request('/uploads/fixture.pdf', { id: 99, role }, { 'If-None-Match': '*' });
        assert.equal(r.status, 403);
        assert.deepEqual(JSON.parse(r.body), { message: 'Akses ditolak!' });
    }
    assert.equal(f.reads.length, 0);
});

test('attachment files use the related letter ownership/disposition policy', async t => {
    const f = await fixture({ kind: 'attachment', receiver: true }); t.after(f.close);
    const r = await f.request('/uploads/fixture.pdf', { id: 99, role: 'staff' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, bytes);
});

test('raw templates are administrative files, not arbitrary staff downloads', async t => {
    const f = await fixture({ kind: 'template', metadata: 'fixture.docx' }); t.after(f.close);
    assert.equal((await f.request('/uploads/fixture.docx', { id: 42, role: 'staff' })).status, 403);
    assert.equal(f.reads.length, 0);
    for (const role of ['admin', 'pimpinan']) assert.equal((await f.request('/uploads/fixture.docx', { id: 99, role })).status, 200);
});

test('missing/unlinked files and DB failures never fall through to public static serving', async t => {
    for (const options of [{ missing: true }, { kind: 'unlinked' }, { dbError: true }]) {
        const f = await fixture(options); t.after(f.close);
        assert.equal((await f.request('/uploads/fixture.pdf', { id: 42, role: 'admin' })).status, 404);
        assert.equal(f.reads.length, 0);
    }
});

test('traversal, separators, absolute paths, dotfiles and alternate URL spellings expose no file', async t => {
    const f = await fixture(); t.after(f.close);
    for (const url of ['/uploads/..%2fapp.js', '/uploads/..%5capp.js', '/uploads/C:%5capp.js',
        '/uploads/%252e%252e%252fapp.js', '/uploads/.env', '/uploads/fixture.pdf::$DATA',
        '/uploads/../app.js', '/%75ploads/fixture.pdf', '//uploads/fixture.pdf',
        '/css/..%2fuploads/fixture.pdf', '/css/..%5cuploads/fixture.pdf', '/surat/SURAT-9-1769136330891.pdf']) {
        const r = await f.request(url, { id: 42, role: 'admin' });
        assert.ok([400, 403, 404].includes(r.status), `${url}: ${r.status}`);
    }
    assert.equal(f.reads.length, 0);
    assert.equal((await f.request('/UPLOADS/fixture.pdf')).status, 302);
});

test('symlink escape and mismatched DB filename cannot be served', async t => {
    for (const options of [{ symlink: true }, { metadata: '../outside.pdf' }, { metadata: 'Fixture.pdf' }]) {
        const f = await fixture(options); t.after(f.close);
        assert.equal((await f.request('/uploads/fixture.pdf', { id: 42, role: 'admin' })).status, 404);
        assert.equal(f.reads.length, 0);
    }
});

test('public UI CSS and image remain anonymous and byte-identical', async t => {
    const f = await fixture(); t.after(f.close);
    for (const file of ['css/style.css', 'images/images-removebg-preview.png']) {
        const r = await f.request('/' + file);
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, fs.readFileSync(path.join(root, 'public', file)));
    }
});

test('existing document download retains auth, receiver policy, PDF bytes and headers', async t => {
    const f = await fixture({ receiver: true }); t.after(f.close);
    assert.equal((await f.request('/download-surat/7')).status, 302);
    const r = await f.request('/download-surat/7', { id: 99, role: 'staff' });
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-disposition'], 'inline; filename=Surat_Masuk.pdf');
    assert.deepEqual(r.body, bytes);
});

test('document generation cannot open a DB template path outside the upload root', async t => {
    const f = await fixture({ documentTemplate: '../../app.js' }); t.after(f.close);
    const r = await f.request('/download-surat/7', { id: 99, role: 'admin' });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.body), { message: 'Akses ditolak!' });
});

test('authorized file transfer uses real Express/disk and retains PDF preview and range behavior', async t => {
    const f = await fixture({ realFile: true }); t.after(f.close);
    const r = await f.request('/uploads/fixture.pdf', { id: 42, role: 'staff' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, fs.readFileSync(path.join(__dirname, 'fixtures/privateUploads/public/uploads/fixture.pdf')));
    assert.match(r.headers['content-type'], /application\/pdf/);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    const partial = await f.request('/uploads/fixture.pdf', { id: 42, role: 'staff' }, { Range: 'bytes=0-3' });
    assert.equal(partial.status, 206);
    assert.equal(partial.body.toString(), '%PDF');
});

test('potentially active filenames are downloaded as inert attachments, not executable HTML', async t => {
    const f = await fixture({ metadata: 'fixture.html' }); t.after(f.close);
    const r = await f.request('/uploads/fixture.html', { id: 42, role: 'admin' });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/octet-stream/);
    assert.match(r.headers['content-disposition'], /attachment; filename="fixture.html"/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
