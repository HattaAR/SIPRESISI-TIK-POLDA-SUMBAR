const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
const secret = 'stage18f-fixture-only-secret-not-for-deployment';
const conflictMessage = 'User masih digunakan oleh data bisnis atau riwayat dan tidak dapat dihapus.';
const referenceQueries = [
    'SELECT id FROM letters WHERE user_id = ? LIMIT 1 FOR UPDATE',
    'SELECT id FROM letters WHERE approver_id = ? LIMIT 1 FOR UPDATE',
    'SELECT id FROM dispositions WHERE sender_id = ? LIMIT 1 FOR UPDATE',
    'SELECT id FROM dispositions WHERE receiver_id = ? LIMIT 1 FOR UPDATE',
    'SELECT id FROM approval_history WHERE actor_id = ? LIMIT 1 FOR UPDATE',
    'SELECT id FROM activity_logs WHERE user_id = ? LIMIT 1 FOR UPDATE'
];

// Only DB/log boundaries are replaced. Routes, cookie auth, role/CSRF guards and bcrypt are real.
async function fixture(options = {}) {
    const events = [], cache = new Map();
    const connection = {
        query(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            events.push(['connectionQuery', sql, Array.from(params)]);
            if (options.failAt === sql) return callback(options.error || { code: 'ER_TEST' });
            if (sql === 'SELECT id FROM users WHERE id = ? FOR UPDATE') {
                return callback(null, options.missing ? [] : [{ id: options.resolvedId ?? 7 }]);
            }
            if (referenceQueries.includes(sql)) return callback(null, options.reference === sql ? [{ id: 12 }] : []);
            callback(null, { affectedRows: options.affectedRows ?? 1 });
        },
        beginTransaction(callback) { events.push(['begin']); callback(options.failAt === 'begin' ? { code: 'ER_TEST' } : null); },
        commit(callback) { events.push(['commit']); callback(options.failAt === 'commit' ? { code: 'ER_TEST' } : null); },
        rollback(callback) { events.push(['rollback']); callback(options.rollbackError ? { code: 'ER_TEST' } : null); },
        release() { events.push(['release']); },
        destroy() { events.push(['destroy']); }
    };
    const pool = {
        getConnection(callback) {
            events.push(['getConnection']);
            callback(options.failAt === 'acquire' ? { code: 'ER_TEST' } : null, connection);
        },
        query(sql, params, callback) {
            if (typeof params === 'function') { callback = params; params = []; }
            events.push(['poolQuery', sql, Array.from(params)]);
            if (options.dbError) return callback(options.dbError);
            if (sql.startsWith('SELECT')) {
                if (/\bstatus\b/.test(sql) && !sql.includes('is_active AS status')) return callback({ code: 'ER_BAD_FIELD_ERROR' });
                return callback(null, options.listRows ?? [{ id: 7, full_name: 'Fixture Staff', nrp: 'FIX', role: 'staff', is_active: 1, status: 1 }]);
            }
            callback(null, { affectedRows: options.affectedRows ?? 1, insertId: 7 });
        }
    };
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, Buffer, console: { error() {} },
            process: { env: { JWT_SECRET: secret, NODE_ENV: 'development' } },
            require(name) {
                if (!name.startsWith('.')) return require(name);
                const target = path.resolve(path.dirname(file), name) + '.js';
                if (target === path.join(root, 'config/database.js')) return { callbackPool: pool };
                if (target === path.join(root, 'services/activityLogService.js')) return {
                    logActivity(id, action, description) { events.push(['log', id, action, description]); }
                };
                return load(target);
            }
        }, { filename: file });
        return module.exports;
    }
    const router = load(path.join(root, 'routes/userRoutes.js'));
    const app = express();
    app.use(express.json(), express.urlencoded({ extended: true }), cookieParser());
    app.use(load(path.join(root, 'middleware/csrfMiddleware.js')).csrfProtection);
    app.get('/fixture', (req, res) => res.json({ proof: res.locals.csrfToken }));
    router.registerGetUsersApi(app);
    router.registerUserApiMutations(app);
    router.registerDeleteUserApi(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    async function session(role = 'admin', id = 1) {
        const cookie = 'token=' + jwt.sign({ id, role, name: 'Fixture' }, secret, { expiresIn: '5m' });
        const response = await fetch(base + '/fixture', { headers: { Cookie: cookie } });
        const { proof } = await response.json();
        return { cookie: cookie + '; ' + response.headers.getSetCookie()[0].split(';')[0], proof };
    }
    async function request(url, { method = 'GET', session: s, proof = s?.proof, body } = {}) {
        const response = await fetch(base + url, { method, redirect: 'manual', headers: {
            ...(s ? { Cookie: s.cookie } : {}), ...(proof ? { 'X-CSRF-Token': proof } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {})
        }, body: body ? JSON.stringify(body) : undefined });
        const text = await response.text();
        return { status: response.status, location: response.headers.get('location'),
            body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
    }
    return { events, session, request, close: async () => {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    } };
}

test('user list queries actual is_active and preserves array/status compatibility and filter order', async t => {
    const f = await fixture(); t.after(f.close);
    const response = await f.request('/api/users?role=staff&status=0', { session: await f.session('pimpinan') });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [{ id: 7, full_name: 'Fixture Staff', nrp: 'FIX', role: 'staff', is_active: 1, status: 1 }]);
    assert.deepEqual(f.events[0], ['poolQuery', 'SELECT id, full_name, nrp, role, is_active, is_active AS status FROM users WHERE role = ? AND is_active = ? ORDER BY full_name ASC', ['staff', '0']]);
    assert.equal('password_hash' in response.body[0], false);
});

test('user list empty/db-error contract remains an array, not a different envelope', async t => {
    const f = await fixture({ dbError: { code: 'ER_TEST' } }); t.after(f.close);
    assert.deepEqual(await f.request('/api/users', { session: await f.session() }), { status: 500, location: null, body: [] });
});

test('empty filtered user list succeeds with an empty array', async t => {
    const f = await fixture({ listRows: [] }); t.after(f.close);
    assert.deepEqual(await f.request('/api/users?status=0', { session: await f.session() }), { status: 200, location: null, body: [] });
    assert.deepEqual(f.events[0], ['poolQuery', 'SELECT id, full_name, nrp, role, is_active, is_active AS status FROM users WHERE is_active = ? ORDER BY full_name ASC', ['0']]);
});

for (const sql of referenceQueries) test('referenced delete returns 409 without DELETE/log/child writes: ' + sql, async t => {
    const f = await fixture({ reference: sql }); t.after(f.close);
    const response = await f.request('/api/users/7', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { message: conflictMessage });
    assert.equal(f.events.some(e => e[0] === 'log' || /^(DELETE|UPDATE|INSERT)/.test(e[1] || '')), false);
    assert.deepEqual(f.events.slice(-2), [['rollback'], ['release']]);
});

test('unreferenced delete locks/checks before DELETE, commits before the old log and response', async t => {
    const f = await fixture(); t.after(f.close);
    const response = await f.request('/api/users/7', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'User berhasil dihapus permanen' });
    assert.deepEqual(f.events, [
        ['getConnection'], ['connectionQuery', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', []], ['begin'],
        ['connectionQuery', 'SELECT id FROM users WHERE id = ? FOR UPDATE', ['7']],
        ...referenceQueries.map(sql => ['connectionQuery', sql, ['7']]),
        ['connectionQuery', 'DELETE FROM users WHERE id = ?', ['7']], ['commit'], ['release'],
        ['log', 1, 'DELETE_USER', 'Menghapus user ID: 7']
    ]);
});

for (const options of [{ missing: true }, { affectedRows: 0 }]) test('missing/zero-row delete returns 404 without success logging', async t => {
    const f = await fixture(options); t.after(f.close);
    const response = await f.request('/api/users/7', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { message: 'User tidak ditemukan' });
    assert.equal(f.events.some(e => e[0] === 'log' || e[0] === 'commit'), false);
    assert.deepEqual(f.events.slice(-2), [['rollback'], ['release']]);
    if (options.missing) assert.equal(f.events.some(e => e[1]?.startsWith('DELETE')), false);
});

for (const failAt of ['acquire', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'begin',
    'SELECT id FROM users WHERE id = ? FOR UPDATE', ...referenceQueries, 'DELETE FROM users WHERE id = ?', 'commit']) {
    test('delete DB failure fails closed and never logs success: ' + failAt, async t => {
        const f = await fixture({ failAt }); t.after(f.close);
        const response = await f.request('/api/users/7', { method: 'DELETE', session: await f.session() });
        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { message: 'Gagal hapus' });
        assert.equal(f.events.some(e => e[0] === 'log'), false);
        if (failAt !== 'acquire') assert.deepEqual(f.events.at(-1), ['release']);
    });
}

test('FK failure becomes deterministic conflict and rollback failure destroys the connection', async t => {
    const f = await fixture({ failAt: 'DELETE FROM users WHERE id = ?', error: { code: 'ER_ROW_IS_REFERENCED_2' }, rollbackError: true });
    t.after(f.close);
    const response = await f.request('/api/users/7', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { message: conflictMessage });
    assert.deepEqual(f.events.slice(-2), [['rollback'], ['destroy']]);
    assert.equal(f.events.some(e => e[0] === 'log'), false);
});

test('self-delete protection runs before acquiring any DB connection', async t => {
    const f = await fixture(); t.after(f.close);
    const response = await f.request('/api/users/1', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { message: 'Tidak bisa menghapus akun sendiri' });
    assert.deepEqual(f.events, []);
});

test('resolved database ID cannot bypass self-delete rejection through numeric string coercion', async t => {
    const f = await fixture({ resolvedId: 1 }); t.after(f.close);
    const response = await f.request('/api/users/1trailing', { method: 'DELETE', session: await f.session() });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { message: 'Tidak bisa menghapus akun sendiri' });
    assert.equal(f.events.some(e => e[0] === 'log' || /^(DELETE|UPDATE|INSERT)/.test(e[1] || '')), false);
    assert.deepEqual(f.events.slice(-2), [['rollback'], ['release']]);
});

test('User mutation anonymous/role/CSRF rejection remains before the real controller DB boundary', async t => {
    const f = await fixture(); t.after(f.close);
    for (const [method, url] of [['POST', '/api/users'], ['PUT', '/api/users/7'], ['PUT', '/api/users/7/status'], ['DELETE', '/api/users/7']]) {
        assert.equal((await f.request(url, { method })).status, 302);
        for (const role of ['staff', 'pimpinan']) assert.equal((await f.request(url, { method, session: await f.session(role) })).status, 403);
        const s = await f.session();
        assert.equal((await f.request(url, { method, session: s, proof: null })).status, 403);
        assert.equal((await f.request(url, { method, session: s, proof: 'wrong' })).status, 403);
    }
    assert.deepEqual(f.events, []);
});

test('create/update optional password preserve SQL/rounds/log/response contracts with real bcrypt and stub DB', async t => {
    const f = await fixture(); t.after(f.close); const s = await f.session();
    const body = { full_name: 'Fixture', username: 'fixture', nrp: 'FIX', role: 'staff', password: 'fixture-only-password' };
    assert.deepEqual((await f.request('/api/users', { method: 'POST', session: s, body })).body, { message: 'Sukses menambahkan user' });
    assert.equal(f.events[0][1], 'INSERT INTO users (full_name, username, nrp, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)');
    assert.deepEqual(f.events[0][2].filter((_, i) => i !== 3), ['Fixture', 'fixture', 'FIX', 'staff']);
    assert.equal(bcrypt.getRounds(f.events[0][2][3]), 10);
    assert.equal(await bcrypt.compare(body.password, f.events[0][2][3]), true);
    assert.deepEqual(f.events[1], ['log', 1, 'CREATE_USER', 'Menambahkan user baru: fixture (staff)']);
    f.events.length = 0;
    assert.deepEqual((await f.request('/api/users/7', { method: 'PUT', session: s, body })).body, { message: 'Data user & password berhasil diperbarui!' });
    assert.equal(f.events[0][1], 'UPDATE users SET full_name=?, username=?, nrp=?, role=?, password_hash=? WHERE id=?');
    assert.deepEqual(f.events[0][2].filter((_, i) => i !== 4), ['Fixture', 'fixture', 'FIX', 'staff', '7']);
    assert.equal(bcrypt.getRounds(f.events[0][2][4]), 10);
    assert.equal(await bcrypt.compare(body.password, f.events[0][2][4]), true);
    f.events.length = 0;
    assert.deepEqual((await f.request('/api/users/7', { method: 'PUT', session: s, body: { ...body, password: '  ' } })).body, { message: 'Data user berhasil diperbarui!' });
    assert.deepEqual(f.events[0], ['poolQuery', 'UPDATE users SET full_name=?, username=?, nrp=?, role=? WHERE id=?', ['Fixture', 'fixture', 'FIX', 'staff', '7']]);
    assert.deepEqual(f.events[1], ['log', 1, 'UPDATE_USER', 'Mengupdate data user ID: 7']);
});

test('toggle still allows admin/kasubbag and preserves is_active SQL, 404 and DB error', async t => {
    for (const role of ['admin', 'kasubbag']) {
        const f = await fixture(); t.after(f.close);
        const response = await f.request('/api/users/7/status', { method: 'PUT', session: await f.session(role) });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { message: 'Status akun berhasil diubah!' });
        assert.deepEqual(f.events[0], ['poolQuery', 'UPDATE users SET is_active = NOT is_active WHERE id = ?', ['7']]);
        assert.deepEqual(f.events[1], ['log', 1, 'UPDATE_USER_STATUS', 'Mengubah status aktif user ID: 7']);
    }
    for (const [options, status, message] of [[{ affectedRows: 0 }, 404, 'User tidak ditemukan'], [{ dbError: { code: 'ER_TEST' } }, 500, 'Gagal update status']]) {
        const f = await fixture(options); t.after(f.close);
        const response = await f.request('/api/users/7/status', { method: 'PUT', session: await f.session() });
        assert.equal(response.status, status); assert.deepEqual(response.body, { message });
        assert.equal(f.events.some(e => e[0] === 'log'), false);
    }
});

test('duplicate username/NRP and existing create/update errors remain unchanged', async t => {
    const body = { full_name: 'Fixture', username: 'fixture', nrp: 'FIX', role: 'staff', password: 'fixture-only' };
    for (const [method, code, status, message] of [
        ['POST', 'ER_DUP_ENTRY', 400, 'Username/NRP sudah digunakan'], ['POST', 'ER_TEST', 500, 'Error database'],
        ['PUT', 'ER_DUP_ENTRY', 500, 'Gagal update database'], ['PUT', 'ER_TEST', 500, 'Gagal update database']
    ]) {
        const f = await fixture({ dbError: { code } }); t.after(f.close);
        const response = await f.request(method === 'POST' ? '/api/users' : '/api/users/7', { method, session: await f.session(), body });
        assert.equal(response.status, status); assert.deepEqual(response.body, { message });
        assert.equal(f.events.some(e => e[0] === 'log'), false);
    }
});
