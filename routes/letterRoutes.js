const express = require('express');
const router = express.Router();
const letterController = require('../controllers/letterController');
const authMiddleware = require('../middleware/authMiddleware');

// --- 1. SETUP MULTER (CONFIG UPLOAD) ---
const multer = require('multer');
const path = require('path');


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/'); // Simpan ke folder public/uploads
    },
    filename: (req, file, cb) => {
        // Nama file unik: timestamp-namaasli.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Filter jenis file (Hanya PDF & Gambar)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Hanya file Gambar (JPG/PNG) dan PDF yang diperbolehkan!'));
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Batas ukuran 5MB
    fileFilter: fileFilter
});

router.use(authMiddleware);

// --- 2. ROUTES ---

// Create (POST) 
router.post('/', upload.single('lampiran'), letterController.createDraft);              

router.get('/my', letterController.getMyLetters);            
router.get('/pending', letterController.getPendingLetters);  
router.get('/history', letterController.getApprovalHistory); 
router.get('/archive', letterController.getArchivedLetters); 

router.get('/:id', letterController.getLetterDetail);        


router.put('/:id', upload.single('lampiran'), letterController.updateLetter);          

router.delete('/:id', letterController.deleteLetter);        

router.post('/:id/submit', letterController.submitLetter);   
router.post('/:id/approve', letterController.approveLetter); 
router.post('/:id/reject', letterController.rejectLetter);   


router.get('/:id/download', letterController.downloadLetter); 

module.exports = router;