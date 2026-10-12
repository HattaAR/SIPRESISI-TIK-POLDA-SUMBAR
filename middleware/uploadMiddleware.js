const multer = require('multer');
const path = require('path');
const zlib = require('zlib');
const PizZip = require('pizzip');
const { isSafeUploadName } = require('../utils/privateUploadPaths');

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MIME = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const allowedExtensions = {
    file_scan: ['.pdf', '.doc', '.docx'],
    template_file: ['.docx']
};
const invalidFile = () => new Error('File upload tidak valid: ekstensi, MIME, dan isi file harus sesuai.');

const extensionFor = (file, field) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExtensions[field].includes(extension) || MIME[extension] !== file.mimetype) throw invalidFile();
    return extension;
};

// Flat, bounded filenames also remain compatible with the private-file route.
const sanitizeName = (name, extension) => {
    let stem = path.basename(name.replace(/\\/g, '/'), path.extname(name))
        .replace(/[\s/\\:%\x00-\x1f<>"|?*]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '');
    stem = Array.from(stem).slice(0, 180).join('');
    while (Buffer.byteLength(stem, 'utf8') > 180) stem = Array.from(stem).slice(0, -1).join('');
    let safeName = (stem || 'upload') + extension;
    if (!isSafeUploadName(safeName)) safeName = 'upload_' + safeName;
    if (!isSafeUploadName(safeName)) throw invalidFile();
    return safeName;
};

// Inspect ZIP metadata before inflating Word XML. Never extract archive paths to disk.
const zipEntries = buffer => {
    let end = buffer.length - 22;
    const minimum = Math.max(0, end - 65535);
    while (end >= minimum && (buffer.readUInt32LE(end) !== 0x06054b50 ||
        end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length)) end--;
    if (end < minimum || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) throw invalidFile();
    const count = buffer.readUInt16LE(end + 10);
    if (count === 0xffff || count !== buffer.readUInt16LE(end + 8)) throw invalidFile();
    let offset = buffer.readUInt32LE(end + 16);
    const directoryEnd = offset + buffer.readUInt32LE(end + 12);
    if (directoryEnd !== end) throw invalidFile();
    const entries = new Map();
    for (let i = 0; i < count; i++) {
        if (offset + 46 > directoryEnd || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalidFile();
        const nameLength = buffer.readUInt16LE(offset + 28);
        const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
        if (next > directoryEnd) throw invalidFile();
        const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        const entry = { flags: buffer.readUInt16LE(offset + 8), method: buffer.readUInt16LE(offset + 10),
            compressed: buffer.readUInt32LE(offset + 20), size: buffer.readUInt32LE(offset + 24),
            local: buffer.readUInt32LE(offset + 42) };
        if (entries.has(name) || entry.flags & 1 || /(?:^|\/)\.\.(?:\/|$)|\\|\x00/.test(name) ||
            name.startsWith('/') || /vbaProject\.bin$/i.test(name)) throw invalidFile();
        entries.set(name, entry);
        offset = next;
    }
    if (offset !== directoryEnd) throw invalidFile();
    return entries;
};

const readZipXml = (buffer, entry) => {
    if (!entry || entry.size > MAX_FILE_SIZE || ![0, 8].includes(entry.method)) throw invalidFile();
    const offset = entry.local;
    if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50 ||
        buffer.readUInt16LE(offset + 8) !== entry.method) throw invalidFile();
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    if (start + entry.compressed > buffer.length) throw invalidFile();
    const compressed = buffer.subarray(start, start + entry.compressed);
    const bytes = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_FILE_SIZE });
    if (bytes.length !== entry.size) throw invalidFile();
    return bytes.toString('utf8');
};

const hasDocxContent = buffer => {
    if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
    const entries = zipEntries(buffer);
    const zip = new PizZip(buffer);
    if (!zip.file('_rels/.rels') || !zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) return false;
    const types = readZipXml(buffer, entries.get('[Content_Types].xml'));
    const document = readZipXml(buffer, entries.get('word/document.xml'));
    return /PartName=["']\/word\/document\.xml["']/.test(types) &&
        types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') &&
        !/macroEnabled/i.test(types) && /<(?:[\w.-]+:)?document\b/.test(document) &&
        document.includes('http://schemas.openxmlformats.org/wordprocessingml/2006/main');
};

const hasDocContent = buffer => {
    if (buffer.length < 512 || !buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) ||
        buffer.readUInt16LE(28) !== 0xfffe || ![9, 12].includes(buffer.readUInt16LE(30))) return false;
    // Legacy DOC remains supported; verify a Word stream directory marker, not merely generic OLE magic.
    const marker = Buffer.from('WordDocument\0', 'utf16le');
    let offset = buffer.indexOf(marker, 512);
    while (offset !== -1) {
        if (offset % 128 === 0 && offset + 128 <= buffer.length &&
            buffer.readUInt16LE(offset + 64) === marker.length && buffer[offset + 66] === 2) return true;
        offset = buffer.indexOf(marker, offset + 1);
    }
    return false;
};

const validateFile = (file, field) => {
    const extension = extensionFor(file, field);
    const buffer = file.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_FILE_SIZE) throw invalidFile();
    const valid = extension === '.pdf'
        ? /^%PDF-(?:1\.[0-7]|2\.0)[\r\n ]/.test(buffer.subarray(0, 16).toString('ascii')) &&
            /%%EOF\s*$/.test(buffer.subarray(Math.max(0, buffer.length - 1024)).toString('ascii'))
        : extension === '.docx' ? hasDocxContent(buffer) : hasDocContent(buffer);
    if (!valid) throw invalidFile();
    file.originalname = sanitizeName(file.originalname, extension);
    file.validatedExtension = extension;
};

// Same .single(field) contract as the old active Multer instance, with validation before controllers.
const single = field => {
    if (!allowedExtensions[field]) throw new Error('Upload field tidak didukung');
    const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE },
        fileFilter(req, file, cb) {
            try { extensionFor(file, field); cb(null, true); } catch (error) { cb(invalidFile()); }
        }
    }).single(field);
    return (req, res, next) => {
        parse(req, res, error => {
            const tooLarge = error && error.code === 'LIMIT_FILE_SIZE';
            if (!error && req.file) {
                try { validateFile(req.file, field); } catch (failure) { error = invalidFile(); }
            }
            if (error) {
                delete req.file;
                return res.status(tooLarge ? 413 : 400).json({ message: tooLarge
                    ? 'Ukuran file melebihi batas 50 MB.' : invalidFile().message });
            }
            if (req.method === 'POST') req.body = req.body || {};
            next();
        });
    };
};

module.exports = { single };
