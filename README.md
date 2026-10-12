# SIPRESISI TIK Polda Sumbar

SIPRESISI TIK adalah aplikasi web internal untuk mendukung proses pengelolaan surat-menyurat pada Bidang TIK Polda Sumbar.

Aplikasi ini dikembangkan menggunakan Node.js, Express.js, EJS, dan MySQL dengan sistem autentikasi berbasis JWT Cookie, role-based access control, approval workflow, disposisi surat, pengelolaan template, arsip surat, serta audit aktivitas pengguna.

---

## Tentang Project

Project ini dikembangkan sebagai sistem informasi internal untuk membantu proses administrasi surat agar lebih terstruktur, terdokumentasi, dan mudah dipantau.

Sistem mendukung beberapa level pengguna dengan hak akses yang berbeda:

- Admin
- Staff
- Pimpinan

Setiap role memiliki halaman, menu, dan hak akses sesuai tanggung jawab masing-masing.

---

## Fitur Utama

- Login dan autentikasi pengguna
- Role-Based Access Control
- Dashboard berdasarkan role
- Pembuatan dan pengelolaan surat
- Draft dan pengiriman surat
- Approval dan rejection surat
- Disposisi surat
- Pengelolaan jenis surat
- Pengelolaan template DOCX
- Upload surat masuk
- Arsip surat
- Riwayat approval
- Activity log / audit trail
- Profile dan perubahan password
- Download dan generate dokumen
- Generate laporan PDF
- Private file access
- Validasi file upload

---

## Security & Hardening

Aplikasi telah melalui proses refactor dan security hardening secara bertahap.

Beberapa pengamanan yang telah diterapkan:

- JWT Cookie Authentication
- Role-based authorization
- Ownership authorization
- CSRF protection
- Stored XSS hardening
- Private file access control
- Upload extension, MIME type, dan file signature validation
- Login rate limiting
- Secure cookie configuration
- Prevention of password/token exposure
- Transactional approval process
- Transactional letter numbering
- User delete integrity protection
- Path traversal protection
- Symlink protection
- Cache control untuk endpoint autentikasi

---

## Automated Testing

Project memiliki automated test untuk beberapa fungsi kritis aplikasi.

Coverage pengujian meliputi:

- Role authorization
- Letter ownership authorization
- Authentication hardening
- CSRF protection
- Stored XSS protection
- Private upload access
- File upload validation
- User API integrity
- Approval concurrency
- Login abuse protection

### Final Verification

Pada final technical baseline:

- 162 automated tests passed
- 0 failed
- 48 active routes verified
- 148 HTTP checks passed
- Browser smoke test passed
- npm audit: 0 vulnerability
- Application startup: PASS
- MySQL connection: PASS

---

## Tech Stack

### Backend

- Node.js
- Express.js
- MySQL
- mysql2
- JWT
- bcryptjs
- Multer

### Frontend

- EJS
- HTML
- CSS
- JavaScript

### Document Processing

- docx
- docxtemplater
- pizzip
- PDFKit
- Puppeteer

### Security

- Helmet
- CORS
- CSRF Protection
- Rate Limiting
- Secure Cookie Authentication

---

## Struktur Project

```text
SIPRESISI-TIK-POLDA-SUMBAR/
│
├── config/
├── controllers/
├── middleware/
├── public/
├── routes/
├── services/
├── tests/
├── utils/
├── views/
│
├── app.js
├── package.json
├── package-lock.json
└── README.md
