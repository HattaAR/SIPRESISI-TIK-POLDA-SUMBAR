// seed_types.js
const db = require('../config/database');

const seedTypes = async () => {
    console.log('⏳ Sedang mengisi data Jenis Surat...');

    const types = [
        {
            name: 'Surat Perintah',
            code: 'SPRINT', // Nanti jadi: SPRINT/001/TIK/2026
            template: '<h1>SURAT PERINTAH</h1><p>Dasar: ...</p>'
        },
        {
            name: 'Surat Keputusan',
            code: 'KEP',    // Nanti jadi: KEP/001/TIK/2026
            template: '<h1>KEPUTUSAN</h1><p>Menimbang: ...</p>'
        },
        {
            name: 'Nota Dinas',
            code: 'B/ND',   // Nanti jadi: B/ND-001/TIK/2026
            template: '<h1>NOTA DINAS</h1><p>Kepada: ...</p>'
        },
        {
            name: 'Surat Undangan',
            code: 'UND',    // Nanti jadi: UND/001/TIK/2026
            template: '<h1>UNDANGAN</h1><p>Mengharap kehadiran...</p>'
        }
    ];

    try {
        // Hapus data lama (opsional, agar tidak duplikat saat dijalankan ulang)
        // await db.query('TRUNCATE TABLE letter_types'); 

        for (const type of types) {
            // Cek dulu apakah sudah ada
            const [exist] = await db.query('SELECT id FROM letter_types WHERE code_prefix = ?', [type.code]);
            
            if (exist.length === 0) {
                await db.query(
                    `INSERT INTO letter_types (name, code_prefix, template_html, is_active) VALUES (?, ?, ?, 1)`,
                    [type.name, type.code, type.template]
                );
                console.log(`✅ ${type.name} berhasil ditambahkan.`);
            } else {
                console.log(`⚠️  ${type.name} sudah ada, dilewati.`);
            }
        }
        console.log('🎉 Selesai mengisi Master Data!');
        process.exit();

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

seedTypes();