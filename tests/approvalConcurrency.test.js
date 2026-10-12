const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const root = path.join(__dirname, '..');
const secret = 'stage18g-fixture-only-secret-not-for-deployment';
const copy = value => JSON.parse(JSON.stringify(value));
const normalize = sql => sql.replace(/\s+/g, ' ').trim();

// Replace only the MySQL boundary. Pending writes and row locks belong to each fake connection.
// Real controller, service, logger, routes, JWT, role guard and CSRF remain under test.
function fixture(options = {}) {
    const state = {
        types: [{ id: 30, code_prefix: 'B', letter_number_format: '{kode}/{nomor}/{bulan}/KKA/{tahun}' },
            { id: 31, code_prefix: 'B', letter_number_format: '{kode}/{nomor}/{bulan}/KKA/{tahun}' }],
        letters: [{ id: 10, type_id: 30, user_id: 6, status: 'PENDING', letter_number: 'DRAFT' },
            { id: 11, type_id: 30, user_id: 9, status: 'PENDING', letter_number: 'DRAFT' }],
        sequences: [{ id: 1, letter_type_id: 30, year: 2026, last_number: 8 }], history: [], logs: [],
        ...copy(options.state || {})
    };
    const initial = copy(state), events = [], locks = new Map(), cache = new Map();
    let connectionId = 0;
    function connection(transactional = true) {
        const id = ++connectionId, held = [], pending = [];
        let active = false;
        function lock(key, run) {
            if (!transactional || held.includes(key)) return run();
            if (locks.has(key)) { locks.get(key).push(() => lock(key, run)); return; }
            locks.set(key, []); held.push(key); run();
        }
        function unlock() {
            for (const key of held.splice(0)) {
                const waiting = locks.get(key); locks.delete(key);
                if (waiting) for (const next of waiting) setImmediate(next);
            }
        }
        function write(change) { if (transactional) pending.push(change); else change(); }
        const c = {
            beginTransaction(callback) {
                events.push([id, 'begin']); active = options.failAt !== 'begin';
                setImmediate(() => callback(options.failAt === 'begin' ? { code: 'ER_TEST' } : null));
            },
            query(sql, params, callback) {
                if (typeof params === 'function') { callback = params; params = []; }
                sql = normalize(sql); params = Array.from(params);
                events.push([id, 'query', sql, params]);
                const reply = (error, rows) => setImmediate(() => callback(error, rows));
                if (options.failAt === sql || (options.failAt === 'sequenceWrite' && /^(UPDATE|INSERT INTO) numbering_sequences/.test(sql))) {
                    return reply({ code: options.errorCode || 'ER_TEST' });
                }
                const read = () => {
                    if (sql === 'SELECT id FROM letter_types ORDER BY id LIMIT 1 FOR UPDATE') return reply(null, [{ id: 30 }]);
                    if (/^SELECT .* FROM letters WHERE id = \?/.test(sql)) {
                        return reply(null, copy(state.letters.filter(row => row.id == params[0])));
                    }
                    if (/^SELECT code_prefix, letter_number_format FROM letter_types WHERE id = \?/.test(sql)) {
                        return reply(null, copy(state.types.filter(row => row.id == params[0])));
                    }
                    if (/^SELECT .* FROM numbering_sequences/.test(sql)) return reply(null, copy(state.sequences.filter(row => row.letter_type_id == params[0] && row.year === params[1])));
                    if (sql.startsWith('SELECT letter_number FROM letters')) return reply(null, copy(state.letters.filter(row => row.type_id == params[0] && String(row.status || '').toUpperCase() === 'APPROVED' && row.year === params[1])));
                    if (sql === 'SELECT id FROM letters WHERE letter_number = ? LIMIT 1') return reply(null, copy(state.letters.filter(row => row.letter_number === params[0]).slice(0, 1)));
                    if (sql.startsWith('INSERT INTO numbering_sequences')) {
                        assert.equal(held.includes('gate'), true, 'sequence initialization needs the shared DB gate');
                        write(() => state.sequences.push({ id: 99, letter_type_id: params[0], year: params[1], last_number: params[2] }));
                    } else if (sql.startsWith('UPDATE numbering_sequences')) {
                        assert.equal(held.includes('sequence:' + state.sequences.find(row => row.id === params[1]).letter_type_id), true);
                        write(() => { state.sequences.find(row => row.id === params[1]).last_number = params[0]; });
                    } else if (sql.startsWith('UPDATE letters')) {
                        const approved = sql.includes("status = 'APPROVED'");
                        const letterId = params.at(-1);
                        write(() => {
                            const letter = state.letters.find(row => row.id == letterId);
                            if (!letter) return;
                            if (approved) Object.assign(letter, { status: 'APPROVED', letter_number: params[0], year: 2026,
                                pimpinan_note: 'Disetujui.', approver_id: params.length === 3 ? params[1] : null });
                            else Object.assign(letter, { status: 'REJECTED', rejection_reason: params[0] });
                        });
                    } else if (sql.startsWith('INSERT INTO approval_history')) {
                        write(() => state.history.push({ letter_id: params[0], actor_id: params[1], action: params[2], notes: params[3] }));
                    } else if (sql.startsWith('INSERT INTO activity_logs')) {
                        write(() => state.logs.push({ user_id: params[0], action: params[1], description: params[2], ip: params[3] }));
                    } else throw new Error('Uncharacterized SQL: ' + sql);
                    reply(null, { affectedRows: options.affectedRows ?? 1 });
                };
                if (sql === 'SELECT id FROM letter_types ORDER BY id LIMIT 1 FOR UPDATE') return lock('gate', read);
                if (sql.includes('FROM letters WHERE id = ?') && sql.endsWith('FOR UPDATE')) return lock('letter:' + params[0], read);
                if (sql.includes('FROM numbering_sequences') && sql.endsWith('FOR UPDATE')) return lock('sequence:' + params[0], read);
                read();
            },
            commit(callback) {
                events.push([id, 'commit']);
                if (options.failAt === 'commit') return setImmediate(() => callback({ code: 'ER_TEST' }));
                for (const change of pending.splice(0)) change(); active = false; unlock();
                setImmediate(() => callback(null));
            },
            rollback(callback) {
                events.push([id, 'rollback']); pending.length = 0; active = false; unlock();
                setImmediate(() => callback(options.rollbackError ? { code: 'ER_TEST' } : null));
            },
            release() { assert.equal(active, false, 'never release an open transaction'); events.push([id, 'release']); },
            destroy() { pending.length = 0; active = false; unlock(); events.push([id, 'destroy']); }
        };
        return c;
    }
    const pool = {
        getConnection(callback) {
            events.push([0, 'acquire']);
            setImmediate(() => callback(options.failAt === 'acquire' ? { code: 'ER_TEST' } : null, connection()));
        },
        query(sql, params, callback) { connection(false).query(sql, params, callback); }
    };
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [options.now || '2026-04-21T12:00:00'])); } }
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, Date: Clock, Buffer, console: { error() {} },
            process: { env: { JWT_SECRET: secret, NODE_ENV: 'development' } },
            require(name) {
                if (!name.startsWith('.')) return require(name);
                const target = path.resolve(path.dirname(file), name) + '.js';
                if (target === path.join(root, 'config/database.js')) return { callbackPool: pool };
                return load(target);
            }
        }, { filename: file });
        return module.exports;
    }
    const controller = load(path.join(root, 'controllers/pimpinanController.js'));
    function decision(action = 'approveLetter', id = 10, body = {}) {
        return new Promise(resolve => {
            let status = 200;
            controller[action]({ params: { id: String(id) }, body, user: { id: 3, role: 'pimpinan' },
                headers: { 'x-forwarded-for': '192.0.2.7' }, socket: { remoteAddress: '::1' } }, {
                status(code) { status = code; return this; }, json(value) { events.push([0, 'response']); resolve({ status, body: copy(value) }); }
            });
        });
    }
    return { state, initial, events, decision, load };
}

test('approval commits sequence, letter, approver, history and old activity message before responding', async () => {
    const f = fixture();
    assert.deepEqual(await f.decision(), { status: 200, body: { message: 'Sukses! Nomor Terbit: B/009/IV/KKA/2026' } });
    assert.equal(f.state.sequences[0].last_number, 9);
    assert.equal(f.state.letters[0].approver_id, 3);
    assert.deepEqual(f.state.history, [{ letter_id: '10', actor_id: 3, action: 'approve', notes: 'Disetujui.' }]);
    assert.deepEqual(f.state.logs, [{ user_id: 3, action: 'APPROVE_LETTER', description: 'Menyetujui surat No: B/009/IV/KKA/2026', ip: '192.0.2.7' }]);
    const queries = f.events.filter(e => e[1] === 'query');
    assert.ok(f.events.findIndex(e => e[1] === 'begin') < f.events.findIndex(e => e[1] === 'query'));
    assert.deepEqual(queries.find(e => e[2].startsWith('SELECT id, last_number FROM numbering_sequences')).slice(2),
        ['SELECT id, last_number FROM numbering_sequences WHERE letter_type_id = ? AND year = ? ORDER BY id FOR UPDATE', [30, 2026]]);
    assert.deepEqual(queries.find(e => e[2].startsWith('UPDATE numbering_sequences')).slice(2), ['UPDATE numbering_sequences SET last_number = ? WHERE id = ?', [9, 1]]);
    assert.ok(queries.findIndex(e => e[2].endsWith('ORDER BY id FOR UPDATE')) < queries.findIndex(e => e[2].startsWith('UPDATE numbering_sequences')));
    assert.ok(f.events.findIndex(e => e[1] === 'commit') < f.events.findIndex(e => e[1] === 'response'));
});

test('missing/stale sequence seeds from the old slash-numeric/year algorithm', async () => {
    for (const sequences of [[], [{ id: 1, letter_type_id: 30, year: 2026, last_number: 1 }]]) {
        const f = fixture({ state: { sequences, letters: [{ id: 10, type_id: 30, status: 'PENDING', letter_number: 'DRAFT' },
            { id: 4, type_id: 30, status: 'APPROVED', letter_number: 'B/012/III/KKA/2026', year: 2026 }] } });
        assert.equal((await f.decision()).body.message, 'Sukses! Nomor Terbit: B/013/IV/KKA/2026');
        assert.equal(f.state.sequences[0].last_number, 13);
    }
});

test('embedded numbers retain their format but an existing identical number is never reassigned', async () => {
    const f = fixture({ state: { sequences: [], types: [{ id: 30, code_prefix: 'ND', letter_number_format: 'B/ND-{nomor}/{bulan}/KKA/{tahun}/Setum' }],
        letters: [{ id: 10, type_id: 30, status: 'PENDING', letter_number: 'DRAFT' },
            { id: 4, type_id: 30, status: 'APPROVED', letter_number: 'B/ND-001/IV/KKA/2026/Setum', year: 2026 }] } });
    assert.equal((await f.decision()).body.message, 'Sukses! Nomor Terbit: B/ND-002/IV/KKA/2026/Setum');
});

test('empty prefix/format keep SRT and the existing default with three-digit padding', async () => {
    const f = fixture({ state: { sequences: [], types: [{ id: 30, code_prefix: '', letter_number_format: '' }] } });
    assert.equal((await f.decision()).body.message, 'Sukses! Nomor Terbit: 001/SRT/IV/2026');
});

test('nullable legacy status is not treated as finalized or allowed to crash an open transaction', async () => {
    const f = fixture({ state: { letters: [{ id: 10, type_id: 30, status: null, letter_number: null }] } });
    assert.equal((await f.decision()).status, 200);
    assert.equal(f.state.letters[0].status, 'APPROVED');
});

test('Roman months and current year retain every old format substitution', async () => {
    const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    for (let i = 0; i < months.length; i++) {
        const f = fixture({ now: '2027-' + String(i + 1).padStart(2, '0') + '-21T12:00:00', state: { sequences: [] } });
        assert.equal((await f.decision()).body.message, 'Sukses! Nomor Terbit: B/001/' + months[i] + '/KKA/2027');
    }
});

test('pre-existing duplicate sequence rows advance together from their highest committed number', async () => {
    const f = fixture({ state: { sequences: [{ id: 1, letter_type_id: 30, year: 2026, last_number: 8 },
        { id: 2, letter_type_id: 30, year: 2026, last_number: 12 }] } });
    assert.equal((await f.decision()).body.message, 'Sukses! Nomor Terbit: B/013/IV/KKA/2026');
    assert.deepEqual(f.state.sequences.map(s => s.last_number), [13, 13]);
});

test('zero-row final update never commits sequence/history/log writes', async () => {
    const f = fixture({ affectedRows: 0 });
    assert.equal((await f.decision()).status, 500);
    assert.deepEqual(f.state, f.initial);
});

test('missing letter keeps approval 404 and cannot create a rejection success audit entry', async () => {
    for (const action of ['approveLetter', 'rejectLetter']) {
        const f = fixture();
        assert.deepEqual(await f.decision(action, 999, { reason: 'Fixture' }), { status: 404, body: { message: 'Data surat tidak ditemukan' } });
        assert.deepEqual(f.state, f.initial);
    }
});

test('a constant occupied format fails rather than looping or assigning a duplicate', async () => {
    const f = fixture({ state: { types: [{ id: 30, code_prefix: 'B', letter_number_format: 'CONSTANT' }],
        letters: [{ id: 10, type_id: 30, status: 'PENDING', letter_number: 'DRAFT' }, { id: 4, type_id: 31, status: 'APPROVED', letter_number: 'CONSTANT' }] } });
    assert.equal((await f.decision()).status, 409);
    assert.deepEqual(f.state, f.initial);
});

for (const letter of [
    { status: 'APPROVED', letter_number: 'B/001/IV/2026' },
    { status: 'approved', letter_number: null },
    { status: 'DISPOSITION', letter_number: 'B/001/IV/2026' },
    { status: 'COMPLETED', letter_number: 'B/001/IV/2026' },
    { status: 'PENDING', letter_number: 'B/001/IV/2026' }
]) test('finalized letter cannot obtain a second number or be rejected: ' + letter.status, async () => {
    for (const action of ['approveLetter', 'rejectLetter']) {
        const f = fixture({ state: { letters: [{ id: 10, type_id: 30, ...letter }] } });
        assert.equal((await f.decision(action, 10, { reason: 'Fixture' })).status, 409);
        assert.deepEqual(f.state, f.initial);
    }
});

for (const failAt of [
    'acquire', 'begin', 'SELECT id FROM letter_types ORDER BY id LIMIT 1 FOR UPDATE',
    'SELECT type_id, status, letter_number FROM letters WHERE id = ? FOR UPDATE',
    'SELECT code_prefix, letter_number_format FROM letter_types WHERE id = ? FOR UPDATE',
    'SELECT id, last_number FROM numbering_sequences WHERE letter_type_id = ? AND year = ? ORDER BY id FOR UPDATE',
    "SELECT letter_number FROM letters WHERE type_id = ? AND status = 'APPROVED' AND YEAR(updated_at) = ?",
    'SELECT id FROM letters WHERE letter_number = ? LIMIT 1', 'sequenceWrite',
    "UPDATE letters SET status = 'APPROVED', letter_number = ?, updated_at = NOW(), pimpinan_note = 'Disetujui.', approver_id = ? WHERE id = ?",
    'INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, ?, ?)',
    'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)', 'commit'
]) test('approval failure cannot leave sequence/status/history/log partial success: ' + failAt, async () => {
    const f = fixture({ failAt });
    const response = await f.decision();
    assert.ok(response.status >= 400);
    assert.deepEqual(f.state, f.initial);
    if (!['acquire', 'begin'].includes(failAt)) assert.ok(f.events.some(e => e[1] === 'rollback'));
});

test('rollback failure destroys the connection rather than returning a broken transaction to the pool', async () => {
    const f = fixture({ failAt: 'sequenceWrite', rollbackError: true });
    assert.equal((await f.decision()).status, 500);
    assert.ok(f.events.some(e => e[1] === 'destroy'));
    assert.deepEqual(f.state, f.initial);
});

test('concurrent approvals on the same letter finalize/log only once', async () => {
    const f = fixture();
    const responses = await Promise.all([f.decision(), f.decision()]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(f.state.history.length, 1); assert.equal(f.state.logs.length, 1);
    assert.equal(f.state.sequences[0].last_number, 9);
});

test('different letters on one sequence receive distinct consecutive numbers even on first sequence creation', async () => {
    for (const sequences of [[], [{ id: 1, letter_type_id: 30, year: 2026, last_number: 8 }]]) {
        const f = fixture({ state: { sequences } });
        const responses = await Promise.all([f.decision('approveLetter', 10), f.decision('approveLetter', 11)]);
        assert.deepEqual(responses.map(r => r.status), [200, 200]);
        assert.equal(new Set(f.state.letters.map(l => l.letter_number)).size, 2);
        assert.deepEqual(f.state.letters.map(l => l.letter_number).sort(), sequences.length ?
            ['B/009/IV/KKA/2026', 'B/010/IV/KKA/2026'] : ['B/001/IV/KKA/2026', 'B/002/IV/KKA/2026']);
        assert.equal(f.state.sequences.length, 1);
        assert.equal(f.state.history.length, 2); assert.equal(f.state.logs.length, 2);
    }
});

test('different types with identical formats cannot concurrently issue the same final number', async () => {
    const f = fixture({ state: { sequences: [], letters: [{ id: 10, type_id: 30, status: 'PENDING', letter_number: 'DRAFT' },
        { id: 11, type_id: 31, status: 'PENDING', letter_number: 'DRAFT' }] } });
    const responses = await Promise.all([f.decision('approveLetter', 10), f.decision('approveLetter', 11)]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.deepEqual(f.state.letters.map(l => l.letter_number).sort(), ['B/001/IV/KKA/2026', 'B/002/IV/KKA/2026']);
});

test('failed allocation can be retried without consuming a sequence number', async () => {
    const failed = fixture({ failAt: 'INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, ?, ?)' });
    assert.equal((await failed.decision()).status, 500);
    const retry = fixture({ state: failed.state });
    assert.equal((await retry.decision()).body.message, 'Sukses! Nomor Terbit: B/009/IV/KKA/2026');
});

test('rejection preserves validation, SQL parameters and message while history/log commit atomically', async () => {
    const f = fixture();
    assert.deepEqual(await f.decision('rejectLetter', 10), { status: 400, body: { message: 'Alasan penolakan wajib diisi!' } });
    assert.deepEqual(f.events, [[0, 'response']]);
    assert.deepEqual(await f.decision('rejectLetter', 10, { reason: 'Revisi fixture' }), { status: 200, body: { message: 'Surat dikembalikan ke staff.' } });
    assert.equal(f.state.letters[0].status, 'REJECTED');
    assert.deepEqual(f.state.history, [{ letter_id: '10', actor_id: 3, action: 'reject', notes: 'Revisi fixture' }]);
    assert.deepEqual(f.state.logs, [{ user_id: 3, action: 'REJECT_LETTER', description: 'Menolak surat ID: 10', ip: '192.0.2.7' }]);
    assert.ok(f.events.some(e => e[2] === "UPDATE letters SET status = 'REJECTED', rejection_reason = ?, updated_at = NOW() WHERE id = ?" && e[3][0] === 'Revisi fixture' && e[3][1] === '10'));
});

test('other domains retain the canonical non-blocking activity logger contract', async () => {
    const f = fixture();
    const logger = f.load(path.join(root, 'services/activityLogService.js'));
    const result = logger.logActivity(6, 'LOGIN', 'Fixture login', { headers: {}, socket: { remoteAddress: '::1' } });
    assert.equal(result, undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.state.logs, [{ user_id: 6, action: 'LOGIN', description: 'Fixture login', ip: '::1' }]);
    assert.equal(f.events.some(e => ['acquire', 'begin', 'commit'].includes(e[1])), false);
});

test('other-domain activity logging errors remain non-blocking and do not create a transaction', async () => {
    const f = fixture({ failAt: 'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)' });
    const logger = f.load(path.join(root, 'services/activityLogService.js'));
    assert.equal(logger.logActivity(6, 'LOGIN', 'Fixture login', { headers: {}, socket: { remoteAddress: '::1' } }), undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.state, f.initial);
});

for (const failAt of ["UPDATE letters SET status = 'REJECTED', rejection_reason = ?, updated_at = NOW() WHERE id = ?",
    'INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, ?, ?)',
    'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)', 'commit']) {
    test('rejection rolls back all writes on ' + failAt, async () => {
        const f = fixture({ failAt });
        assert.deepEqual(await f.decision('rejectLetter', 10, { reason: 'Fixture' }), { status: 500, body: { message: 'Gagal menolak surat' } });
        assert.deepEqual(f.state, f.initial);
    });
}

test('approval racing rejection cannot leave a rejected final number or contradictory history', async () => {
    const f = fixture();
    const results = await Promise.all([f.decision(), f.decision('rejectLetter', 10, { reason: 'Fixture' })]);
    assert.equal(results[0].status, 200);
    assert.equal(f.state.letters[0].status, 'APPROVED');
    assert.equal(f.state.history.at(-1).action, 'approve');
    assert.equal(f.state.logs.at(-1).action, 'APPROVE_LETTER');
});

test('auth/role/CSRF guard precedes transaction; valid proof reaches the real approval flow', async t => {
    const f = fixture(), app = express();
    app.use(express.json(), cookieParser(), f.load(path.join(root, 'middleware/csrfMiddleware.js')).csrfProtection);
    app.get('/fixture', (req, res) => res.json({ proof: res.locals.csrfToken }));
    app.use('/api/letters', f.load(path.join(root, 'routes/pimpinanRoutes.js')).letterDecisionRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const request = async (url, cookie, proof) => fetch(base + url, { method: 'POST', redirect: 'manual',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(proof ? { 'X-CSRF-Token': proof } : {}) } });
    assert.equal((await request('/api/letters/10/approve')).status, 302);
    for (const role of ['staff', 'admin', 'pimpinan']) {
        const token = 'token=' + jwt.sign({ id: 3, role }, secret, { expiresIn: '5m' });
        const page = await fetch(base + '/fixture', { headers: { Cookie: token } });
        const { proof } = await page.json();
        const cookie = token + '; ' + page.headers.getSetCookie()[0].split(';')[0];
        assert.equal((await request('/api/letters/10/approve', cookie)).status, 403);
        assert.equal((await request('/api/letters/10/approve', cookie, 'wrong')).status, 403);
        assert.deepEqual(f.state, f.initial); assert.equal(f.events.length, 0);
        if (role !== 'pimpinan') assert.equal((await request('/api/letters/10/approve', cookie, proof)).status, 403);
        else assert.equal((await request('/api/letters/10/approve', cookie, proof)).status, 200);
    }
});
