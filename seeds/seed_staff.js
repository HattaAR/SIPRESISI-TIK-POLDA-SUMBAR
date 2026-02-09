// seed_staff.js
const db = require('../config/database');
const bcrypt = require('bcryptjs');

const seedStaff = async () => {
    try {
        console.log('⏳ Sedang membuat user Staff...');

        // Password untuk staff: 'staff123'
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('staff123', salt);

        // Masukkan data Staff
        // NRP dummy: 12345678
        const query = `
            INSERT INTO users (username, password_hash, full_name, nrp, role, is_active)
            VALUES (?, ?, ?, ?, 'staff', 1)
        `;
        
        await db.query(query, ['briptu_andi', passwordHash, 'Briptu Andi Pratama', '12345678']);

        console.log('✅ User Staff BERHASIL dibuat!');
        console.log('👤 Username: briptu_andi');
        console.log('🔑 Password: staff123');
        process.exit();
        
    } catch (error) {
        // Jika error duplikat (username sudah ada), kita anggap sukses saja
        if (error.code === 'ER_DUP_ENTRY') {
            console.log('⚠️ User staff sudah ada.');
        } else {
            console.error('❌ Gagal:', error);
        }
        process.exit();
    }
};

seedStaff();