const crypto = require('node:crypto');
const { URL } = require('node:url');
const jwt = require('jsonwebtoken');
const { jwtSecret, tokenLifetimeSeconds, getTokenCookieOptions } = require('../config/auth');

const cookieName = 'csrf_token';
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const tokenPattern = /^[a-f0-9]{64}\.[a-f0-9]{64}$/;
const message = 'Token CSRF tidak valid. Muat ulang halaman dan coba lagi.';

// Signed double-submit, bound to this exact login JWT, not just the user ID.
const sign = (token, nonce) => crypto.createHmac('sha256', jwtSecret)
    .update('sipresisi:csrf:v1\0' + token + '\0' + nonce).digest('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' &&
    tokenPattern.test(left) && tokenPattern.test(right) &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
const validCookie = (proof, token) => typeof proof === 'string' && tokenPattern.test(proof) &&
    equal(proof, proof.slice(0, 64) + '.' + sign(token, proof.slice(0, 64)));

function identifiedCrossOrigin(req) {
    const site = req.get('Sec-Fetch-Site');
    if (site === 'cross-site' || site === 'same-site') return true;
    // No-referrer native forms may have an opaque Origin; the signed proof is still mandatory.
    const origin = req.get('Origin');
    const source = origin && origin !== 'null' ? origin : req.get('Referer');
    if (!source) return false;
    // Match the current Secure-cookie policy without changing Express/JWT proxy semantics.
    const protocol = getTokenCookieOptions(req).secure ? 'https' : req.protocol;
    try { return new URL(source).origin !== new URL(protocol + '://' + req.get('host')).origin; }
    catch (error) { return true; }
}

function deny(req, res) {
    if (!req.path.toLowerCase().startsWith('/api/') && req.accepts(['json', 'html']) === 'html') {
        return res.status(403).type('html').send('<p>' + message + '</p><a href="/">Kembali ke aplikasi</a>');
    }
    return res.status(403).json({ message });
}

function csrfProtection(req, res, next) {
    const route = req.path.toLowerCase().replace(/\/+$/, '') || '/';
    // Login has no authenticated page/token yet. Reject identifiable cross-origin login attempts.
    if (req.method === 'POST' && route === '/api/auth/login') {
        return identifiedCrossOrigin(req) ? deny(req, res) : next();
    }
    // Preserve existing GET logout consumers; reject identified cross-origin navigations.
    if ((req.method === 'GET' || req.method === 'HEAD') && route === '/logout') {
        if (identifiedCrossOrigin(req)) return deny(req, res);
        res.clearCookie(cookieName, getTokenCookieOptions(req));
        return next();
    }

    const token = req.cookies && req.cookies.token;
    if (!token) return next();
    let decoded;
    try { decoded = jwt.verify(token, jwtSecret); }
    catch (error) { return next(); } // Existing verifyToken owns invalid-token clearing/redirects.

    let proof = req.cookies[cookieName];
    if (unsafeMethods.has(req.method)) {
        // Multipart uses a header so denial happens BEFORE Multer consumes an upload.
        const supplied = req.get('X-CSRF-Token') ?? (req.body && req.body._csrf);
        if (identifiedCrossOrigin(req) || !validCookie(proof, token) || !equal(supplied, proof)) return deny(req, res);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
        if (!validCookie(proof, token)) {
            const nonce = crypto.randomBytes(32).toString('hex');
            proof = nonce + '.' + sign(token, nonce);
            const remainingSeconds = typeof decoded.exp === 'number'
                ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : tokenLifetimeSeconds;
            res.cookie(cookieName, proof, { ...getTokenCookieOptions(req),
                maxAge: Math.min(tokenLifetimeSeconds, remainingSeconds) * 1000 });
        }
    } else {
        return next();
    }
    res.locals.csrfToken = proof;
    res.vary('Cookie');
    next();
}

module.exports = { csrfProtection };
