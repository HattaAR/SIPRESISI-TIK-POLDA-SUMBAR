// seed_leader.js
const db = require('../config/database');
const bcrypt = require('bcryptjs');

const seedLeader = async () => {
    try {
        console.log('⏳ Sedang membuat user Pimpinan (Kabid)...');
        
        // Password: 'kabid123'
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('kabid123', salt);

        // Role: 'pimpinan'
        await db.query(`
            INSERT INTO users (username, password_hash, full_name, nrp, role, is_active)
            VALUES (?, ?, ?, ?, 'pimpinan', 1)
        `, ['kabid_tik', passwordHash, 'Kombes Pol. Budi Santoso', '98765432']);

        console.log('✅ User Pimpinan BERHASIL dibuat!');
        console.log('👤 Username: kabid_tik');
        console.log('🔑 Password: kabid123');
        process.exit();

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') console.log('⚠️ User Pimpinan sudah ada.');
        else console.error(error);
        process.exit();
    }
};

seedLeader();