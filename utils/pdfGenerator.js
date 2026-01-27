const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const fs = require("fs");
const path = require("path");

exports.generateSuratPDF = async (data) => {
    return new Promise((resolve, reject) => {
        try {
            // 1. Validasi Path Template
            if (!data.templatePath) {
                return reject(new Error("Template Word tidak ditemukan."));
            }

            const templatePath = path.resolve(__dirname, '../uploads/templates', data.templatePath);
            if (!fs.existsSync(templatePath)) {
                return reject(new Error(`File template fisik tidak ada di: ${templatePath}`));
            }
            
            // 2. Baca Template
            const content = fs.readFileSync(templatePath, "binary");
            const zip = new PizZip(content);
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });

            // 3. SIAPKAN DATA (DEBUGGING MODE)
            // Pastikan data.isi adalah object, jika tidak jadikan object kosong
            const dataIsian = (typeof data.isi === 'object' && data.isi !== null) ? data.isi : {};

            const renderData = {
                ...dataIsian, // Buka bungkusan JSON, ratakan ke root
                nomor_surat: data.nomor,
                tanggal_surat: new Date().toLocaleDateString('id-ID', { 
                    day: 'numeric', month: 'long', year: 'numeric' 
                })
            };

            // --- INTIP DATA DI TERMINAL (PENTING!) ---
            console.log("==========================================");
            console.log("🔍 DATA YANG DIKIRIM KE WORD:");
            console.log(renderData); 
            console.log("==========================================");
            // ------------------------------------------

            // 4. Render ke Word
            doc.render(renderData);

            // 5. Simpan File
            const buf = doc.getZip().generate({
                type: "nodebuffer",
                compression: "DEFLATE",
            });

            const outputFilename = `SURAT-${data.id}-${Date.now()}.docx`;
            const outputPath = path.resolve(__dirname, '../public/surat', outputFilename);

            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)){
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(outputPath, buf);
            console.log("✅ Surat Berhasil Dibuat:", outputFilename);
            resolve(outputFilename);

        } catch (error) {
            console.error("🔥 Gagal Generate Surat:", error);
            // Jika error dari docxtemplater, biasanya detailnya tersembunyi
            if (error.properties && error.properties.errors) {
                error.properties.errors.forEach(function(err) {
                    console.log("Detail Error Word:", err);
                });
            }
            reject(error);
        }
    });
};