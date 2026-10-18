const multer = require('multer');
const path = require('path');
const fs = require('fs');

// All uploaded assignment files land here, served statically by server.js
// at /uploads/<filename>. In production, swap this disk storage for S3/
// Cloudinary/etc - see TECHNICAL_REFERENCE.md §11.6.
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

// Matches the accept list on the student's upload zone in app.js:
// accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file type.'));
  }
  cb(null, true);
}

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB - matches the "max 10MB" hint in app.js
});
