const message = 'Terlalu banyak percobaan login. Silakan coba lagi nanti.';

function createLoginRateLimiter({ windowMs = 15 * 60 * 1000, maxFailures = 10, maxEntries = 10000, now = Date.now } = {}) {
    for (const value of [windowMs, maxFailures, maxEntries]) {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('Konfigurasi login rate limit tidak valid.');
    }
    const attempts = new Map();
    let nextSweep = 0;
    const prune = time => {
        for (const [ip, entry] of attempts) {
            if (entry.expiresAt <= time && entry.pending === 0) attempts.delete(ip);
        }
        nextSweep = time + Math.min(windowMs, 60000);
    };
    const deny = (res, remainingMs) => {
        res.set('Retry-After', String(Math.max(1, Math.ceil(remainingMs / 1000))));
        return res.status(429).json({ message });
    };

    return (req, res, next) => {
        const time = now();
        if (time >= nextSweep) prune(time);
        // Express currently does not trust proxies. Never use raw X-Forwarded-For as a key.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        let entry = attempts.get(ip);
        if (entry && entry.expiresAt <= time && entry.pending === 0) {
            attempts.delete(ip); entry = undefined;
        }
        if (!entry) {
            if (attempts.size >= maxEntries) {
                prune(time);
                // Fail closed rather than evicting an active limit or growing without bounds.
                if (attempts.size >= maxEntries) return deny(res, windowMs);
            }
            entry = { failures: 0, pending: 0, expiresAt: time + windowMs };
            attempts.set(ip, entry);
        }
        if (entry.failures + entry.pending >= maxFailures) return deny(res, entry.expiresAt - time);
        entry.pending++;
        let settled = false;
        const settle = aborted => {
            if (settled) return;
            settled = true;
            entry.pending--;
            if (aborted || res.statusCode === 401 || res.statusCode === 403) entry.failures++;
            // Successful login/server errors do not consume failures or erase prior failures.
            if (entry.failures === 0 && entry.pending === 0) attempts.delete(ip);
        };
        res.once('finish', () => settle(false));
        res.once('close', () => settle(true));
        next();
    };
}

module.exports = { createLoginRateLimiter, loginRateLimiter: createLoginRateLimiter() };
