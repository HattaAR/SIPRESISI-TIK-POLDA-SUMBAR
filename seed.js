// seed.js
const db = require('./config/database');
const bcrypt = require('bcryptjs');

const seedUser = async () => {
    try {
        console.log('⏳ Sedang membuat user Admin...');

        // 1. Cek apakah user sudah ada (agar tidak duplikat)
        const [existingUser] = await db.query("SELECT * FROM users WHERE username = 'admin_tik'");
        if (existingUser.length > 0) {
            console.log('⚠️  User admin_tik sudah ada!');
            process.exit();
        }

        // 2. Hash Password 'password123'
        const passwordAsli = 'password123';
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(passwordAsli, salt);

        // 3. Masukkan ke Database
        const query = `
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `;
        
        await db.query(query, ['admin_tik', passwordHash, 'Administrator TIK', 'admin', 1]);

        console.log('✅ User Admin BERHASIL dibuat!');
        console.log('👤 Username: admin_tik');
        console.log('🔑 Password: password123');
        
    } catch (error) {
        console.error('❌ Gagal membuat user:', error);
    } finally {
        process.exit();
    }
};

seedUser();