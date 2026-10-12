const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { EventEmitter } = require('node:events');
const { createLoginRateLimiter } = require('../middleware/loginRateLimiter');

const root = path.join(__dirname, '..');
const secret = 'stage18h-fixture-secret-not-for-deployment';
let passwordHash;
before(async () => { passwordHash = await bcrypt.hash('fixture-password', 10); });

function config(JWT_SECRET) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'config/auth.js'), 'utf8'), {
        module, process: { env: { JWT_SECRET } }, require
    });
    return module.exports;
}

// Real router/controller/crypto/HTTP; only the database and login-log boundary are replaced.
async function fixture({ limiterOptions, role = 'staff', found = false, dbError = false, hold = false } = {}) {
    const cache = new Map(), events = [], pending = [];
    const pool = { query(sql, params, callback) {
        assert.equal(sql, 'SELECT * FROM users WHERE username = ?');
        events.push('query');
        const complete = () => callback(dbError ? new Error('Fixture database unavailable') : null, found ? [{
            id: 7, username: params[0], full_name: 'Fixture', nrp: 'FIX', role, is_active: 1,
            password_hash: passwordHash, password: 'private-fixture-column'
        }] : []);
        if (hold) pending.push(complete); else complete();
    } };
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} }; cache.set(file, module);
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, process: { env: { JWT_SECRET: secret } },
            require(name) {
                if (name === '../config/database') return { callbackPool: pool };
                if (name === '../services/activityLogService') return { logActivity() { events.push('log'); } };
                if (name === '../middleware/loginRateLimiter') {
                    const actual = require('../middleware/loginRateLimiter');
                    return { loginRateLimiter: actual.createLoginRateLimiter(limiterOptions) };
                }
                return name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.js') : require(name);
            }
        }, { filename: file });
        return module.exports;
    }
    const app = express();
    app.use(express.json(), cookieParser());
    app.set('view engine', 'ejs'); app.set('views', path.join(root, 'views'));
    app.use(load(path.join(root, 'routes/authRoutes.js')));
    app.get('/unrelated', (req, res) => res.json({ public: true }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    return { base, events, pending, close: () => new Promise(resolve => server.close(resolve)),
        login: (body = {}, headers = {}, signal) => fetch(base + '/api/auth/login', { method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ username: 'fixture', password: 'fixture-password', ...body }) }) };
}

test('failed login threshold returns deterministic 429 before DB/log/cookie, even with rotated usernames and spoofed XFF', async () => {
    const app = await fixture({ limiterOptions: { maxFailures: 3, windowMs: 10000 } });
    try {
        for (let i = 0; i < 3; i++) assert.equal((await app.login({ username: 'fixture-' + i })).status, 401);
        const res = await app.login({ username: 'different' }, { 'X-Forwarded-For': '192.0.2.9' });
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), '10');
        assert.deepEqual(await res.json(), { message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti.' });
        assert.equal(res.headers.get('set-cookie'), null);
        assert.deepEqual(app.events, ['query', 'query', 'query']);
    } finally { await app.close(); }
});

test('expired failure window allows a fresh login attempt and does not extend on rejected requests', async () => {
    let time = 1000;
    const app = await fixture({ limiterOptions: { maxFailures: 1, windowMs: 2000, now: () => time } });
    try {
        assert.equal((await app.login()).status, 401);
        time = 2000; assert.equal((await app.login()).status, 429);
        time = 3000; assert.equal((await app.login()).status, 401);
        assert.deepEqual(app.events, ['query', 'query']);
    } finally { await app.close(); }
});

test('normal successful logins keep every role response/JWT/cookie and do not consume failure budget', async () => {
    for (const role of ['admin', 'staff', 'pimpinan']) {
        const app = await fixture({ found: true, role, limiterOptions: { maxFailures: 1 } });
        try {
            for (let i = 0; i < 3; i++) {
                const res = await app.login();
                assert.equal(res.status, 200);
                assert.deepEqual(await res.json(), { message: 'Login Berhasil', user: { role, full_name: 'Fixture' } });
                const payload = jwt.verify(res.headers.get('set-cookie').split(';')[0].slice(6), secret);
                assert.equal(payload.role, role); assert.equal(payload.exp - payload.iat, 86400);
                assert.match(res.headers.get('set-cookie'), /HttpOnly/);
                assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
                const home = await fetch(app.base + '/', { headers: { Cookie: res.headers.get('set-cookie').split(';')[0] }, redirect: 'manual' });
                assert.equal(home.headers.get('location'), '/' + role + '/dashboard');
            }
        } finally { await app.close(); }
    }
});

test('database failures do not lock out legitimate users by consuming credential-failure budget', async () => {
    const app = await fixture({ dbError: true, limiterOptions: { maxFailures: 1 } });
    try { for (let i = 0; i < 3; i++) assert.equal((await app.login()).status, 500); }
    finally { await app.close(); }
});

test('concurrent pending logins reserve slots before expensive password/DB work', async () => {
    const app = await fixture({ hold: true, limiterOptions: { maxFailures: 2 } });
    const requests = [app.login(), app.login()];
    try {
        for (let i = 0; i < 100 && app.pending.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(app.pending.length, 2);
        const overflow = await app.login({}, {}, AbortSignal.timeout(1000));
        assert.equal(overflow.status, 429);
        assert.equal(app.events.length, 2);
    } finally {
        app.pending.forEach(done => done()); await Promise.all(requests); await app.close();
    }
});

test('auth endpoints are no-store without accidentally changing unrelated router responses', async () => {
    const app = await fixture();
    try {
        for (const uri of ['/', '/logout']) {
            const r = await fetch(app.base + uri, { redirect: 'manual' });
            assert.equal(r.headers.get('cache-control'), 'no-store');
        }
        assert.equal((await app.login()).headers.get('cache-control'), 'no-store');
        assert.equal((await fetch(app.base + '/unrelated')).headers.get('cache-control'), null);
    } finally { await app.close(); }
});

test('JWT config rejects missing, short, whitespace-padded and single-character repeated secrets without echoing values', () => {
    for (const value of [undefined, '', '   ', 'rahasia_negara', 'short-fixture', ' '.repeat(32) + 'short-fixture', 'x'.repeat(64)]) {
        assert.throws(() => config(value), error => /JWT_SECRET/.test(error.message) &&
            (!value || value.trim() === '' || !error.message.includes(value)));
    }
});

test('sufficient JWT secrets retain their exact value, payload lifetime and cookie policy', () => {
    const loaded = config(secret);
    assert.equal(loaded.jwtSecret, secret);
    assert.equal(loaded.tokenLifetimeSeconds, 86400);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.getTokenCookieOptions({ secure: false }))),
        { httpOnly: true, sameSite: 'lax', secure: false, path: '/' });
});

test('successful login cannot erase earlier password failures for the same IP', async () => {
    const app = await fixture({ found: true, limiterOptions: { maxFailures: 2 } });
    try {
        assert.equal((await app.login({ password: 'incorrect-fixture' })).status, 401);
        assert.equal((await app.login()).status, 200);
        assert.equal((await app.login({ password: 'incorrect-fixture' })).status, 401);
        assert.equal((await app.login()).status, 429);
        assert.deepEqual(app.events, ['query', 'query', 'log', 'query']);
    } finally { await app.close(); }
});

function attempt(limiter, ip, result = 401, aborted = false) {
    const res = new EventEmitter();
    const headers = {};
    res.statusCode = 200;
    res.set = (name, value) => { headers[name] = value; return res; };
    res.status = value => { res.statusCode = value; return res; };
    res.json = body => { res.body = body; return res; };
    let reached = false;
    limiter({ ip, socket: { remoteAddress: ip } }, res, () => {
        reached = true; res.statusCode = result;
        if (!aborted) res.emit('finish');
        res.emit('close');
    });
    return { reached, status: res.statusCode, headers };
}

test('bounded IP store fails closed without evicting blocked clients and frees expired entries', () => {
    let time = 0;
    const limiter = createLoginRateLimiter({ maxFailures: 1, maxEntries: 2, windowMs: 1000, now: () => time });
    assert.equal(attempt(limiter, '192.0.2.1').reached, true);
    assert.equal(attempt(limiter, '192.0.2.2').reached, true);
    assert.equal(attempt(limiter, '192.0.2.3').status, 429);
    assert.equal(attempt(limiter, '192.0.2.1').status, 429);
    time = 1000;
    assert.equal(attempt(limiter, '192.0.2.3').reached, true);
    assert.equal(attempt(limiter, '192.0.2.4').reached, true);
    assert.equal(attempt(limiter, '192.0.2.5').status, 429);
});

test('closed attempts consume one slot, while finish followed by close never double-counts', () => {
    const limiter = createLoginRateLimiter({ maxFailures: 2 });
    assert.equal(attempt(limiter, '192.0.2.1').reached, true);
    assert.equal(attempt(limiter, '192.0.2.1').reached, true);
    assert.equal(attempt(limiter, '192.0.2.1').status, 429);
    assert.equal(attempt(limiter, '192.0.2.2', 200, true).reached, true);
    assert.equal(attempt(limiter, '192.0.2.2', 200, true).reached, true);
    assert.equal(attempt(limiter, '192.0.2.2').status, 429);
});

test('minimum length rejects 31-byte keys and accepts an unchanged 32-byte non-repeating key', () => {
    assert.throws(() => config('0123456789abcdef0123456789abcde'), /JWT_SECRET/);
    const value = '0123456789abcdef0123456789abcdef';
    assert.equal(config(value).jwtSecret, value);
});
