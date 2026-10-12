const jwtSecret = process.env.JWT_SECRET;

if (typeof jwtSecret !== 'string' || jwtSecret.trim() === '') {
    throw new Error('JWT_SECRET wajib dikonfigurasi melalui environment sebelum aplikasi dijalankan.');
}

if (require('node:buffer').Buffer.byteLength(jwtSecret.trim(), 'utf8') < 32 || /^(.)\1+$/su.test(jwtSecret.trim())) {
    throw new Error('JWT_SECRET terlalu lemah: gunakan secret acak minimal 32 byte melalui environment.');
}

const tokenLifetimeSeconds = 24 * 60 * 60;

const getTokenCookieOptions = (req) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || req.secure === true,
    path: '/'
});

module.exports = { jwtSecret, tokenLifetimeSeconds, getTokenCookieOptions };
