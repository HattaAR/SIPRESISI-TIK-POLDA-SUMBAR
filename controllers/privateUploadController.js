const db = require('../config/database').callbackPool;
const path = require('path');
const { uploadRoot, isSafeUploadName, resolveUploadFile } = require('../utils/privateUploadPaths');

exports.getPrivateUpload = (req, res, next) => {
    const filename = req.params.filename;
    const notFound = () => res.status(404).send('File tidak ditemukan');
    const denied = () => res.status(403).json({ message: 'Akses ditolak!' });
    if (!isSafeUploadName(filename)) return notFound();

    const sendFile = storedName => {
        const file = resolveUploadFile(storedName);
        if (!file) return notFound();
        res.type(path.extname(storedName));
        // Preserve PDF preview and ordinary Office/image responses; never execute active uploads.
        if (!['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.gif'].includes(path.extname(storedName).toLowerCase())) {
            res.attachment(storedName);
            res.type('application/octet-stream');
        }
        res.sendFile(path.relative(uploadRoot, file), {
            root: uploadRoot, dotfiles: 'deny', cacheControl: false,
            headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
        }, error => {
            if (!error) return;
            if (res.headersSent) return next(error);
            notFound();
        });
    };

    const authorizeLetters = (letters, storedName) => {
        if (req.user.role !== 'staff' || letters.some(letter => letter.user_id === req.user.id)) {
            return sendFile(storedName);
        }
        db.query('SELECT 1 FROM dispositions WHERE letter_id IN (?) AND receiver_id = ? LIMIT 1',
            [letters.map(letter => letter.id), req.user.id], (err, dispositions) => {
                if (err) return notFound();
                if (dispositions.length === 0) return denied();
                sendFile(storedName);
            });
    };

    const findTemplate = () => {
        db.query('SELECT template_path FROM letter_types WHERE template_path = ?', [filename], (err, types) => {
            if (err) return notFound();
            const type = types.find(item => item.template_path === filename);
            if (!type) return notFound();
            if (req.user.role === 'staff') return denied();
            sendFile(type.template_path);
        });
    };

    const findAttachment = () => {
        db.query('SELECT l.id, l.user_id, a.file_path FROM attachments a JOIN letters l ON a.letter_id = l.id WHERE a.file_path = ?',
            [filename], (err, rows) => {
                if (err) return notFound();
                const letters = rows.filter(letter => letter.file_path === filename);
                if (letters.length === 0) return findTemplate();
                authorizeLetters(letters, letters[0].file_path);
            });
    };

    db.query('SELECT id, user_id, pdf_path FROM letters WHERE pdf_path = ?', [filename], (err, rows) => {
        if (err) return notFound();
        // MySQL collation can be case-insensitive; authorize the exact stored filename only.
        const letters = rows.filter(letter => letter.pdf_path === filename);
        if (letters.length === 0) return findAttachment();
        authorizeLetters(letters, letters[0].pdf_path);
    });
};
