const db = require('../config/database').callbackPool;
const { logActivityInTransaction } = require('./activityLogService');

const finalized = letter => ['APPROVED', 'DISPOSITION', 'COMPLETED'].includes(String(letter.status || '').toUpperCase()) ||
    (letter.letter_number && letter.letter_number.toUpperCase() !== 'DRAFT');
const finalizedMessage = 'Surat sudah difinalisasi dan tidak dapat diproses ulang.';

function inTransaction(errorMessage, callback, work) {
    db.getConnection((error, connection) => {
        if (error) return callback({ status: 500, message: errorMessage });
        let started = false;
        const fail = (status = 500, message = errorMessage) => {
            const respond = () => callback({ status, message });
            if (!started) { connection.release(); return respond(); }
            connection.rollback(rollbackError => {
                if (rollbackError) connection.destroy();
                else connection.release();
                respond();
            });
        };
        const query = (sql, params, next, message = errorMessage, status = 500) => {
            connection.query(sql, params, (err, result) => {
                if (err) return fail(status, message);
                next(result);
            });
        };
        const commit = result => connection.commit(err => {
            if (err) return fail();
            connection.release();
            callback(null, result);
        });
        connection.beginTransaction(err => {
            if (err) return fail();
            started = true;
            work({ connection, query, fail, commit });
        });
    });
}

function recordDecision(tx, req, action, notes, logAction, description, result) {
    tx.query('INSERT INTO approval_history (letter_id, actor_id, action, notes) VALUES (?, ?, ?, ?)',
        [req.params.id, req.user.id, action, notes], () => {
            logActivityInTransaction(tx.connection, req.user.id, logAction, description, req, err => {
                if (err) return tx.fail();
                tx.commit(result);
            });
        });
}

// Keep the active slash-numeric seed and format substitutions; do not adopt the dormant number_format.
function legacyMaximum(rows, year) {
    let maximum = 0;
    rows.forEach(row => {
        if (row.letter_number) row.letter_number.split('/').forEach(part => {
            if (/^\d+$/.test(part)) {
                const number = parseInt(part);
                if (number !== year && number > maximum) maximum = number;
            }
        });
    });
    return maximum;
}

function approveLetter(req, callback) {
    const dateNow = new Date();
    const year = dateNow.getFullYear();
    const romanMonth = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][dateNow.getMonth()];
    inTransaction('Gagal menyimpan persetujuan.', callback, tx => {
        // Existing schema has neither a unique sequence key nor a unique number. One stable parent
        // row serializes allocation across types (whose configurable formats can overlap), including
        // first sequence creation. It is a DB transaction lock, shared by all application processes.
        tx.query('SELECT id FROM letter_types ORDER BY id LIMIT 1 FOR UPDATE', [], () => {
            tx.query('SELECT type_id, status, letter_number FROM letters WHERE id = ? FOR UPDATE', [req.params.id], letters => {
                if (letters.length === 0) return tx.fail(404, 'Data surat tidak ditemukan');
                const letter = letters[0];
                if (finalized(letter)) return tx.fail(409, finalizedMessage);
                tx.query('SELECT code_prefix, letter_number_format FROM letter_types WHERE id = ? FOR UPDATE', [letter.type_id], types => {
                    if (types.length === 0) return tx.fail(500, 'Gagal mengambil tipe surat');
                    const prefix = types[0].code_prefix || 'SRT';
                    const format = types[0].letter_number_format || '{nomor}/{kode}/{bulan}/{tahun}';
                    tx.query('SELECT id, last_number FROM numbering_sequences WHERE letter_type_id = ? AND year = ? ORDER BY id FOR UPDATE',
                        [letter.type_id, year], sequences => {
                            const sqlGetAll = "SELECT letter_number FROM letters WHERE type_id = ? AND status = 'APPROVED' AND YEAR(updated_at) = ?";
                            tx.query(sqlGetAll, [letter.type_id, year], rows => {
                                // Retain persisted gaps/high-water marks; initialize from existing letters only.
                                let nextNumber = Math.max(legacyMaximum(rows, year), ...sequences.map(seq => seq.last_number || 0)) + 1;
                                const allocate = () => {
                                    const finalNumber = format.replace('{nomor}', String(nextNumber).padStart(3, '0'))
                                        .replace('{kode}', prefix).replace('{bulan}', romanMonth).replace('{tahun}', year);
                                    tx.query('SELECT id FROM letters WHERE letter_number = ? LIMIT 1', [finalNumber], matches => {
                                        if (matches.length > 0) {
                                            if (!format.includes('{nomor}')) return tx.fail(409, 'Format nomor surat tidak menghasilkan nomor unik.');
                                            nextNumber++;
                                            return allocate();
                                        }
                                        const afterSequence = () => tx.query(
                                            "UPDATE letters SET status = 'APPROVED', letter_number = ?, updated_at = NOW(), pimpinan_note = 'Disetujui.', approver_id = ? WHERE id = ?",
                                            [finalNumber, req.user.id, req.params.id], result => {
                                                if (result.affectedRows !== 1) return tx.fail();
                                                recordDecision(tx, req, 'approve', 'Disetujui.', 'APPROVE_LETTER',
                                                    `Menyetujui surat No: ${finalNumber}`, { message: `Sukses! Nomor Terbit: ${finalNumber}` });
                                            });
                                        if (sequences.length === 0) {
                                            return tx.query('INSERT INTO numbering_sequences (letter_type_id, year, last_number) VALUES (?, ?, ?)',
                                                [letter.type_id, year, nextNumber], afterSequence);
                                        }
                                        // Do not delete any pre-existing duplicate sequence rows; advance all under lock.
                                        const advance = index => {
                                            if (index === sequences.length) return afterSequence();
                                            tx.query('UPDATE numbering_sequences SET last_number = ? WHERE id = ?',
                                                [nextNumber, sequences[index].id], () => advance(index + 1));
                                        };
                                        advance(0);
                                    }, 'Gagal memproses nomor surat.');
                                };
                                allocate();
                            }, 'Gagal memproses nomor surat.');
                        }, 'Gagal memproses nomor surat.');
                }, 'Gagal mengambil tipe surat');
            }, 'Data surat tidak ditemukan', 404);
        }, 'Gagal memproses nomor surat.');
    });
}

function rejectLetter(req, callback) {
    if (!req.body.reason) return callback({ status: 400, message: 'Alasan penolakan wajib diisi!' });
    inTransaction('Gagal menolak surat', callback, tx => {
        tx.query('SELECT type_id, status, letter_number FROM letters WHERE id = ? FOR UPDATE', [req.params.id], letters => {
            if (letters.length === 0) return tx.fail(404, 'Data surat tidak ditemukan');
            if (finalized(letters[0])) return tx.fail(409, finalizedMessage);
            tx.query("UPDATE letters SET status = 'REJECTED', rejection_reason = ?, updated_at = NOW() WHERE id = ?",
                [req.body.reason, req.params.id], result => {
                    if (result.affectedRows !== 1) return tx.fail();
                    recordDecision(tx, req, 'reject', req.body.reason, 'REJECT_LETTER',
                        `Menolak surat ID: ${req.params.id}`, { message: 'Surat dikembalikan ke staff.' });
                });
        });
    });
}

module.exports = { approveLetter, rejectLetter };
