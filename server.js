require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
const path = require('path');
let brevo;
try { brevo = require('sib-api-v3-sdk'); } catch (e) { brevo = null; }
let sgMail;
try { sgMail = require('@sendgrid/mail'); } catch (e) { sgMail = null; }
let nodemailer;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const multer = require('multer');
let ExcelJS;
try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
let sqlite3;
try { sqlite3 = require('sqlite3'); } catch (e) { sqlite3 = null; }

// MongoDB Models
const Admin = require('./models/Admin');
const Instructor = require('./models/Instructor');
const Batch = require('./models/Batch');
const Student = require('./models/Student');
const Tournament = require('./models/Tournament');
const StoreItem = require('./models/StoreItem');
const FeesPayment = require('./models/FeesPayment');
const Announcement = require('./models/Announcement');
const StoreOrder = require('./models/StoreOrder');
const TournamentRegistration = require('./models/TournamentRegistration');
const Exam = require('./models/Exam');
const Admission = require('./models/Admission');

// Connect to MongoDB
const connectDB = async () => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/karate';
  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('MongoDB Connected: ' + mongoURI);
    return true;
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    console.error('MongoDB is not reachable. The server will still start, but DB-backed features may fail until connectivity is fixed.');
    return false;
  }
};

async function ensureDefaultAdmin() {
  const email = String(process.env.ADMIN_EMAIL || 'karatesubhash455@gmail.com').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'karate@123').trim();
  if (!email || !password) return;
  try {
    let admin = await Admin.findOne({ email });
    if (!admin) {
      const passwordHash = await bcrypt.hash(password, 10);
      admin = new Admin({
        name: 'Admin',
        email,
        passwordHash
      });
      await admin.save();
      console.log('✅ Default admin created:', email);
    } else if (!admin.passwordHash) {
      const passwordHash = await bcrypt.hash(password, 10);
      admin.passwordHash = passwordHash;
      await admin.save();
      console.log('✅ Admin passwordHash updated:', email);
    }
  } catch (e) {
    console.error('ensureDefaultAdmin error:', e);
  }
}

async function seedMockData() {
  if (process.env.SEED_MOCK_DATA !== 'true') return;
  console.log('🌱 Seeding mock data...');
  try {
    // Seed instructors
    await Instructor.deleteMany({});
    await Instructor.create([
      { name: 'Sensei John', description: 'Head Instructor', beltLevel: 'Black Belt 5th Dan', photoUrl: '', active: true },
      { name: 'Sensei Mary', description: 'Senior Instructor', beltLevel: 'Black Belt 3rd Dan', photoUrl: '', active: true }
    ]);
    console.log('✅ Mock instructors seeded');
    // Seed batches
    await Batch.deleteMany({});
    await Batch.create([
      { name: 'Batch 1', description: 'Morning batch', timing: '6:00 AM - 8:00 AM', centre: 'Panaji', active: true },
      { name: 'Batch 2', description: 'Evening batch', timing: '6:00 PM - 8:00 PM', centre: 'Mapusa', active: true },
      { name: 'Batch Guirim', description: 'Weekend batch', timing: 'Sat & Sun 10:00 AM - 12:00 PM', centre: 'Guirim', active: true }
    ]);
    console.log('✅ Mock batches seeded');
    // Seed tournaments
    await Tournament.deleteMany({});
    await Tournament.create([
      { name: 'State Championship 2025', description: 'Annual state-level tournament', date: new Date('2025-06-15'), venue: 'Panaji Gymkhana', active: true },
      { name: 'National Qualifiers', description: 'Qualifying round for nationals', date: new Date('2025-08-20'), venue: 'Margao Sports Complex', active: true }
    ]);
    console.log('✅ Mock tournaments seeded');
    // Seed store items
    await StoreItem.deleteMany({});
    await StoreItem.create([
      { name: 'Karate Gi (White)', description: 'Standard uniform', price: 1500, imageUrl: '', category: 'uniform', stock: 50, active: true },
      { name: 'Belt (Red)', description: 'Red belt for advanced students', price: 200, imageUrl: '', category: 'accessories', stock: 30, active: true },
      { name: 'Training Gloves', description: 'Sparring gloves', price: 800, imageUrl: '', category: 'equipment', stock: 25, active: true }
    ]);
    console.log('✅ Mock store items seeded');
    // Seed announcements
    await Announcement.deleteMany({});
    await Announcement.create([
      { title: 'Welcome', message: 'Welcome to the new student portal! Please register to access your dashboard.' },
      { title: 'Exam Schedule', message: 'Upgrading exams will be held on June 30th. Please prepare accordingly.' }
    ]);
    console.log('✅ Mock announcements seeded');
    // Seed admissions
    await Admission.deleteMany({});
    await Admission.create([
      { first_name: 'John', last_name: 'Doe', email: 'john.doe@example.com', phone: '9876543210', age: 25, belt_level: 'White', address: '123 Main St', centre: 'Panaji', batch_timing: '6:00 AM - 8:00 AM', photo_url: '' },
      { first_name: 'Jane', last_name: 'Smith', email: 'jane.smith@example.com', phone: '9876543211', age: 20, belt_level: 'Yellow', address: '456 Oak Ave', centre: 'Mapusa', batch_timing: '6:00 PM - 8:00 PM', photo_url: '' }
    ]);
    console.log('✅ Mock admissions seeded');
    console.log('🌱 Mock data seeding complete');
  } catch (e) {
    console.error('seedMockData error:', e);
  }
}

function mapInstructor(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    rank: doc.beltLevel || '',
    photo_url: doc.photoUrl || '',
    active: doc.active,
    created_at: doc.createdAt
  };
}

function mapBatch(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    timing: doc.timing || '',
    centre: doc.centre || '',
    active: doc.active,
    created_at: doc.createdAt
  };
}

function mapTournament(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id),
    title: doc.name,
    location: doc.venue || '',
    date: (doc.date instanceof Date) ? doc.date.toISOString().slice(0, 10) : String(doc.date || ''),
    description: doc.description || '',
    active: doc.active,
    created_at: doc.createdAt
  };
}

function mapStoreItem(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description || '',
    price: doc.price,
    image_url: doc.imageUrl || '',
    active: doc.active,
    created_at: doc.createdAt
  };
}

function requireAdmin(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    return next();
  } catch (e) {
    return res.status(403).json({ message: 'Admin access required' });
  }
}

mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.error('MongoDB disconnected');
});

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Core middleware must be registered before routes
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/files', express.static(path.join(__dirname, 'data')));

// -------- Data directories --------
const DATA_DIR = path.join(__dirname, 'data');

const ACHIEVEMENTS_DIR = path.join(DATA_DIR, 'achievements');
function ensureAchievementsDir() {
  try { if (!fs.existsSync(ACHIEVEMENTS_DIR)) fs.mkdirSync(ACHIEVEMENTS_DIR, { recursive: true }); } catch (_) {}
}

function safeBaseName(name) {
  const base = path.basename(String(name || ''));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const achievementsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureAchievementsDir();
    cb(null, ACHIEVEMENTS_DIR);
  },
  filename: function (req, file, cb) {
    const original = safeBaseName(file.originalname || 'upload');
    const ext = path.extname(original).toLowerCase();
    const base = path.basename(original, ext);
    cb(null, `${Date.now()}_${uuidv4()}_${base}${ext}`);
  }
});

const achievementsUpload = multer({
  storage: achievementsStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = mime.startsWith('image/') || mime.startsWith('video/');
    if (!ok) return cb(new Error('Only image/video uploads are allowed'));
    cb(null, true);
  }
});

// Instructors photo upload configuration
const INSTRUCTORS_DIR = path.join(__dirname, 'uploads', 'instructors');
function ensureInstructorsDir() {
  if (!fs.existsSync(INSTRUCTORS_DIR)) {
    fs.mkdirSync(INSTRUCTORS_DIR, { recursive: true });
  }
}

const instructorsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureInstructorsDir();
    cb(null, INSTRUCTORS_DIR);
  },
  filename: function (req, file, cb) {
    const original = safeBaseName(file.originalname || 'upload');
    const ext = path.extname(original).toLowerCase();
    const base = path.basename(original, ext);
    cb(null, `${Date.now()}_${uuidv4()}_${base}${ext}`);
  }
});

const instructorsUpload = multer({
  storage: instructorsStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const mime = String(file.mimetype || '').toLowerCase();
    const ok = mime.startsWith('image/');
    if (!ok) return cb(new Error('Only image uploads are allowed for instructors'));
    cb(null, true);
  }
});

const ACHIEVEMENTS_INDEX_PATH = path.join(ACHIEVEMENTS_DIR, 'index.json');
function readAchievementsIndex() {
  try {
    ensureAchievementsDir();
    if (!fs.existsSync(ACHIEVEMENTS_INDEX_PATH)) return [];
    const raw = fs.readFileSync(ACHIEVEMENTS_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeAchievementsIndex(items) {
  try {
    ensureAchievementsDir();
    fs.writeFileSync(ACHIEVEMENTS_INDEX_PATH, JSON.stringify(items || [], null, 2));
  } catch (_) {}
}

// -------- Excel helpers for Fees Payments --------
const EXCEL_XLSX_PATH = path.join(DATA_DIR, 'fees_payments.xlsx');
const EXCEL_CSV_PATH = path.join(DATA_DIR, 'fees_payments.csv');

function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

function feesFilePublicUrl(preferCsv = false) {
  if (preferCsv) return '/files/fees_payments.csv';
  return ExcelJS ? '/files/fees_payments.xlsx' : '/files/fees_payments.csv';
}

async function writeFeesExcel(rows, forceCsv = false) {
  ensureDataDir();
  if (forceCsv || !ExcelJS) {
    // Fallback: CSV
    const headers = ['Student Name','Phone Number','Batch Name','Centre','Date of Payment','Time of Payment','Payment Status'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const dt = new Date(r.payment_datetime);
      const dateStr = dt.toLocaleDateString('en-IN');
      const timeStr = dt.toLocaleTimeString('en-IN');
      const vals = [r.full_name,r.phone,r.batch_name,r.centre,dateStr,timeStr,(r.status||'Pending Verification')].map(v => {
        const s = (v==null?'':String(v));
        return s.includes(',') ? '"'+s.replace(/"/g,'""')+'"' : s;
      });
      csvRows.push(vals.join(','));
    });
    fs.writeFileSync(EXCEL_CSV_PATH, csvRows.join('\n'));
    return EXCEL_CSV_PATH;
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fees Payments');
  ws.columns = [
    { header: 'Student Name', key: 'full_name', width: 28 },
    { header: 'Phone Number', key: 'phone', width: 16 },
    { header: 'Batch Name', key: 'batch_name', width: 18 },
    { header: 'Centre', key: 'centre', width: 16 },
    { header: 'Date of Payment', key: 'date', width: 16 },
    { header: 'Time of Payment', key: 'time', width: 16 },
    { header: 'Payment Status', key: 'status', width: 22 },
  ];
  rows.forEach(r => {
    const dt = new Date(r.payment_datetime);
    const dateStr = dt.toLocaleDateString('en-IN');
    const timeStr = dt.toLocaleTimeString('en-IN');
    ws.addRow({
      full_name: r.full_name,
      phone: r.phone,
      batch_name: r.batch_name,
      centre: r.centre,
      date: dateStr,
      time: timeStr,
      status: r.status || 'Pending Verification',
    });
  });
  await wb.xlsx.writeFile(EXCEL_XLSX_PATH);
  return EXCEL_XLSX_PATH;
}

async function refreshFeesExcel(forceCsv = false) {
  try {
    const rows = await query('SELECT * FROM fees_payments ORDER BY payment_datetime DESC');
    await writeFeesExcel(rows, forceCsv);
  } catch (e) {
    console.error('Error refreshing fees Excel:', e.message);
  }
}

// -------- Fees Payments API --------
app.get('/api/fees-payments', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM fees_payments ORDER BY payment_datetime DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/fees-payments error', err);
    res.status(500).json({ message: 'Error fetching fees payments' });
  }
});

// Resend verification link for student registrations
app.post('/api/resend-student-verification', async (req, res) => {
  try {
    const { email } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ message: 'Email is required' });

    const student = await Student.findOne({ email: e, active: true });
    if (!student) return res.status(404).json({ message: 'Student not found. Please register first.' });

    const mailOptions = {
      to: e,
      from: EMAIL_USER,
      subject: 'Your WTSKF-GOA Karate Registration Details',
      html: `
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Registration Details</h2>
          <p>Hello ${student.fullName || 'Student'},</p>
          <p>This is a confirmation that your student account exists.</p>
          <p><strong>Email:</strong> ${student.email}</p>
          <p><strong>Centre:</strong> ${student.centre || ''}</p>
          <p><strong>Batch:</strong> ${student.batch || ''}</p>
          <p>You can login from the website using your password.</p>
        </body>
        </html>
      `
    };

    sendMail(mailOptions)
      .then(() => console.log('✅ Student email re-sent to:', e))
      .catch(err => console.error('❌ Student resend email failed:', err.message));

    res.json({ success: true, message: 'Email sent. Please check your inbox.' });
  } catch (err) {
    console.error('POST /api/resend-student-verification error:', err);
    res.status(500).json({ message: 'Error sending email' });
  }
});

app.get('/api/fees-payments/excel', async (req, res) => {
  try {
    ensureDataDir();
    const forceCsv = (req.query && String(req.query.format || '').toLowerCase() === 'csv');
    const targetPath = forceCsv ? EXCEL_CSV_PATH : (ExcelJS ? EXCEL_XLSX_PATH : EXCEL_CSV_PATH);
    // Always refresh to keep file up to date
    await refreshFeesExcel(forceCsv);
    if (!fs.existsSync(targetPath)) {
      // If requested XLSX but not present (ExcelJS missing), fall back to CSV
      return res.json({ url: feesFilePublicUrl(true) });
    }
    res.json({ url: feesFilePublicUrl(forceCsv) });
  } catch (err) {
    console.error('GET /api/fees-payments/excel error', err);
    res.status(500).json({ message: 'Error preparing Excel file' });
  }
});


// App already created above

// Redis client for caching and session storage
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

redisClient.connect().catch(console.log);

// Rate limiting for API endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => req.originalUrl && req.originalUrl.startsWith('/api/health')
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.'
  }
});

// Apply rate limiting
app.use('/api/', limiter);
app.use('/api/login', authLimiter);
app.use('/api/student-register', authLimiter);

// -------- Achievements Media (Gallery) --------
// Public: list uploaded media
app.get('/api/achievements/media', async (req, res) => {
  try {
    const items = readAchievementsIndex();
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load achievements media' });
  }
});

// Public: list gallery images by category (filesystem)
app.get('/api/gallery/:category', async (req, res) => {
  try {
    const category = String(req.params.category || '').trim().toLowerCase();
    const allowed = {
      seminar: 'seminar',
      tournaments: 'tournament',
      tournament: 'tournament',
      activities: 'activities',
      more: 'more'
    };
    const folder = allowed[category];
    if (!folder) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    let dirPath = path.join(__dirname, 'gallery', folder);
    if (!fs.existsSync(dirPath)) {
      const spaced = path.join(__dirname, 'gallery', folder + ' ');
      if (fs.existsSync(spaced)) {
        dirPath = spaced;
      }
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
      .sort((a, b) => a.localeCompare(b));

    const publicFolder = path.basename(dirPath);
    const folderEncoded = encodeURIComponent(publicFolder);
    const urls = files.map((name) => `/gallery/${folderEncoded}/${encodeURIComponent(name)}`);
    res.json({ category: publicFolder, count: urls.length, urls });
  } catch (e) {
    console.error('GET /api/gallery/:category error', e);
    res.status(500).json({ message: 'Error reading gallery category' });
  }
});

// Admin: upload photo/video
app.post('/api/achievements/media', verifyToken, (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  achievementsUpload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }

    const title = String((req.body && req.body.title) || '').trim();
    const description = String((req.body && req.body.description) || '').trim();

    const isVideo = String(req.file.mimetype || '').toLowerCase().startsWith('video/');
    const item = {
      id: uuidv4(),
      type: isVideo ? 'video' : 'image',
      url: `/files/achievements/${encodeURIComponent(req.file.filename)}`,
      title: title || (isVideo ? 'Video' : 'Photo'),
      description: description || '',
      createdAt: new Date().toISOString()
    };

    const items = readAchievementsIndex();
    items.unshift(item);
    writeAchievementsIndex(items);
    return res.status(201).json(item);
  });
});

// Admin: delete media item
app.delete('/api/achievements/media/:id', verifyToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ message: 'id is required' });

  try {
    const items = readAchievementsIndex();
    const idx = items.findIndex(i => i && i.id === id);
    if (idx === -1) return res.status(404).json({ message: 'Media not found' });

    const [item] = items.splice(idx, 1);
    writeAchievementsIndex(items);

    // Best-effort file delete
    try {
      const filename = decodeURIComponent(String(item.url || '').split('/').pop() || '');
      if (filename && !filename.includes('/') && !filename.includes('\\')) {
        const filePath = path.join(ACHIEVEMENTS_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch (_) {}

    return res.json({ message: 'Deleted' });
  } catch (e) {
    console.error('DELETE /api/achievements/media error:', e);
    return res.status(500).json({ message: 'Failed to delete media' });
  }
});

// Email configuration
const EMAIL_USER = String(process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = String(process.env.EMAIL_PASS || '').replace(/\s/g, '').trim();

console.log('📧 Email configuration:');
console.log('EMAIL_USER:', EMAIL_USER || '(missing)');
console.log('EMAIL_PASS configured:', !!EMAIL_PASS);

// Brevo configuration (SMTP primary)
const BREVO_API_KEY = String(process.env.BREVO_API_KEY || '').trim();
const BREVO_SMTP_KEY = String(process.env.BREVO_SMTP_KEY || '').trim();
const BREVO_SMTP_USER = String(process.env.BREVO_SMTP_USER || 'a44e83001@smtp-brevo.com').trim();

// Configure Brevo API client (fallback)
if (brevo && BREVO_API_KEY) {
  brevo.ApiClient.instance.authentications['api-key'].apiKey = BREVO_API_KEY;
}

// Configure Brevo SMTP transporter (primary)
let brevoTransporter = null;
if (nodemailer && BREVO_SMTP_USER && BREVO_SMTP_KEY) {
  brevoTransporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: BREVO_SMTP_USER,
      pass: BREVO_SMTP_KEY
    }
  });
  console.log('✅ Brevo SMTP transporter configured');
}

// Configure Gmail SMTP transporter (alternative)
let gmailTransporter = null;
if (nodemailer && EMAIL_USER && EMAIL_PASS) {
  gmailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
  console.log('✅ Gmail SMTP transporter configured');
}

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
if (SENDGRID_API_KEY) {
  try { if (sgMail) sgMail.setApiKey(SENDGRID_API_KEY); } catch (_) {}
}

async function sendMail(mailOptions) {
  console.log('📧 sendMail CALLED with:', { to: mailOptions.to, subject: mailOptions.subject });
  console.log('📧 Transporter status:', {
    brevoTransporter: !!brevoTransporter,
    brevo: !!brevo,
    gmailTransporter: !!gmailTransporter,
    BREVO_API_KEY: !!BREVO_API_KEY,
    BREVO_SMTP_KEY: !!BREVO_SMTP_KEY,
    SENDGRID_API_KEY: !!SENDGRID_API_KEY
  });

  // 1. Try Brevo SMTP first
  if (brevoTransporter) {
    console.log('✅ Using Brevo SMTP for email to:', mailOptions.to);
    try {
      const info = await Promise.race([
        brevoTransporter.sendMail({
          from: `"WTSKF-GOA" <${mailOptions.from || EMAIL_USER || 'karatesubhash455@gmail.com'}>`,
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text || 'Please view this email in an HTML-capable client.'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Brevo SMTP timeout')), 15000))
      ]);
      console.log('✅ BREVO EMAIL SENT! MessageId:', info.messageId);
      return info;
    } catch (e) {
      console.error('❌ Brevo SMTP send error:', e.message);
      console.error('Full error:', e);
      // Continue to fallback
    }
  } else {
    console.log('❌ brevoTransporter is NULL - cannot use Brevo SMTP');
  }

  // 2. Fallback: Brevo API
  if (brevo && BREVO_API_KEY) {
    console.log('Using Brevo API for email');
    try {
      const apiInstance = new brevo.TransactionalEmailsApi();
      const sendSmtpEmail = {
        sender: { email: mailOptions.from || EMAIL_USER || 'karatesubhash455@gmail.com', name: 'WTSKF-GOA' },
        to: [{ email: mailOptions.to }],
        subject: mailOptions.subject,
        htmlContent: mailOptions.html
      };
      const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
      console.log('✅ Email sent successfully via Brevo API to:', mailOptions.to, 'MessageId:', result.messageId);
      return;
    } catch (e) {
      console.error('❌ Brevo API send error:', e.message);
      // Continue to fallback
    }
  }

  // 3. Final fallback: Gmail SMTP
  if (gmailTransporter) {
    console.log('Using Gmail SMTP for email');
    try {
      const info = await Promise.race([
        gmailTransporter.sendMail({
          from: `"WTSKF-GOA" <${mailOptions.from || EMAIL_USER}>`,
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text || 'Please view this email in an HTML-capable client.'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gmail timeout')), 10000))
      ]);
      console.log('✅ Email sent successfully via Gmail SMTP to:', mailOptions.to, 'MessageId:', info.messageId);
      return;
    } catch (e) {
      console.error('❌ Gmail SMTP send error:', e.message);
      // Continue to fallback
    }
  }
  
  // 3. Try SendGrid (fallback)
  if (SENDGRID_API_KEY && sgMail) {
    console.log('Using SendGrid for email');
    try {
      await sgMail.send(mailOptions);
      console.log('✅ Email sent successfully via SendGrid to:', mailOptions.to);
      return;
    } catch (e) {
      console.error('❌ SendGrid send error:', e);
    }
  }
  
  console.log('❌ No email service available - email NOT sent to:', mailOptions.to);
}

// Database configuration
let dbConnection = null;
let dbType = 'mysql';

// Create MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'upsc2027',
  database: process.env.DB_NAME || 'kartae',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0
});

// Alternative: Parse DATABASE_URL for cloud deployment
if (process.env.DATABASE_URL) {
  const mysql = require('mysql2/promise');
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  let protocol = '';
  try {
    protocol = new URL(rawUrl).protocol || '';
  } catch (_) {
    protocol = '';
  }
  const lowered = rawUrl.toLowerCase();
  if (!protocol && lowered) {
    if (lowered.includes('postgres://') || lowered.includes('postgresql://')) protocol = 'postgres:';
    else if (lowered.includes('mysql://')) protocol = 'mysql:';
  }

  if (protocol.startsWith('postgres')) {
    const { Pool } = require('pg');
    const cloudPool = new Pool({
      connectionString: rawUrl,
      ssl: { rejectUnauthorized: false }
    });
    module.exports.pool = cloudPool;
    module.exports.dbType = 'postgresql';
    console.log('✅ PostgreSQL database initialized at:', rawUrl);
  } else if (protocol.startsWith('mysql')) {
    const u = new URL(rawUrl);
    const cloudPool = mysql.createPool({
      host: u.hostname,
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      database: u.pathname ? u.pathname.slice(1) : '',
      port: u.port ? Number(u.port) : 3306,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0
    });
    module.exports.pool = cloudPool;
    module.exports.dbType = 'mysql';
    console.log('✅ MySQL database initialized at:', rawUrl);
  } else {
    module.exports.pool = pool;
    module.exports.dbType = 'mysql';
    console.log('✅ MySQL database initialized (default local)');
  }
} else {
  module.exports.pool = pool;
  module.exports.dbType = 'mysql';
}

// Initialize database tables
async function initializeDatabase() {
  if (module.exports.dbType === 'postgresql') {
    try {
      const client = await module.exports.pool.connect();
      try {
        const schemaPath = path.join(__dirname, 'schema_postgresql.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        // Execute full schema (CREATE TABLE IF NOT EXISTS ... and indexes)
        await client.query(schemaSql);
        // Lightweight post-migration adjustments that are safe to re-run
        try { await client.query('ALTER TABLE IF EXISTS instructors ALTER COLUMN photo_url TYPE TEXT'); } catch (_) {}
        try { await client.query('ALTER TABLE IF EXISTS admissions ALTER COLUMN photo_url TYPE TEXT'); } catch (_) {}
        try { await client.query('DROP INDEX IF EXISTS uniq_admissions_email'); } catch (_) {}
        try { await client.query('DROP INDEX IF EXISTS uniq_admissions_phone'); } catch (_) {}
        try { await client.query('ALTER TABLE IF EXISTS student_registrations DROP CONSTRAINT IF EXISTS student_registrations_email_key'); } catch (_) {}
        console.log('PostgreSQL schema ensured via schema_postgresql.sql');
        return;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('PostgreSQL initialization error:', e.message);
      console.log('⚠️ Falling back to SQLite database...');
      // Continue to SQLite fallback below
    }
  }
  
  // SQLite fallback for PostgreSQL failures or when no DATABASE_URL
  if ((module.exports.dbType === 'postgresql' && !dbConnection) || !process.env.DATABASE_URL) {
    if (sqlite3) {
      try {
        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          console.log('Created data directory:', DATA_DIR);
        }
        const sqliteDbPath = path.join(DATA_DIR, 'karate.db');
        dbConnection = new sqlite3.Database(sqliteDbPath);
        module.exports.dbType = 'sqlite';
        console.log('✅ SQLite database initialized at:', sqliteDbPath);
        
        // Create SQLite schema
        await initializeSQLiteSchema();
        return;
      } catch (sqliteErr) {
        console.error('SQLite initialization error:', sqliteErr.message);
      }
    }
  }

  async function initializeSQLiteSchema() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        timing TEXT,
        centre TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS instructors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        photo_url TEXT,
        description TEXT,
        belt_level TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS admissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        age INTEGER,
        belt_level TEXT,
        address TEXT,
        centre TEXT,
        batch_timing TEXT,
        photo_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS student_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        batch TEXT NOT NULL,
        email_verified INTEGER DEFAULT 0,
        verification_token TEXT,
        verification_sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS fees_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        batch_name TEXT NOT NULL,
        centre TEXT NOT NULL,
        payment_datetime DATETIME NOT NULL,
        status TEXT NOT NULL,
        txn_id TEXT,
        amount REAL,
        img_hash TEXT,
        screenshot_base64 TEXT,
        validation_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS store_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        image_url TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await new Promise((resolve, reject) => {
        dbConnection.run(sql, (err) => {
          if (err) {
            console.error('SQLite schema error:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    // Insert default batches
    const defaultBatches = [
      ['batch 1', 'Batch 1', '', ''],
      ['batch 2', 'Batch 2', '', ''],
      ['batch 3', 'Batch 3', '', ''],
      ['batch 4', 'Batch 4', '', ''],
      ['batch 5', 'Batch 5', '', ''],
      ['batch 6', 'Batch 6', '', ''],
      ['batch guirim', 'Batch Guirim', '', '']
    ];

    for (const [name, desc, timing, centre] of defaultBatches) {
      await new Promise((resolve) => {
        dbConnection.run(
          `INSERT OR IGNORE INTO batches (name, description, timing, centre) VALUES (?, ?, ?, ?)`,
          [name, desc, timing, centre],
          () => resolve()
        );
      });
    }

    // Insert default admin user
    await new Promise((resolve) => {
      bcrypt.hash('admin123', 10).then(hashedPassword => {
        dbConnection.run(
          `INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`,
          ['admin', 'admin@example.com', hashedPassword, 'admin'],
          () => resolve()
        );
      });
    });

    console.log('✅ SQLite schema initialized');
  }
  const connection = await module.exports.pool.getConnection();
  try {
    // Create users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS fees_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        batch_name VARCHAR(100) NOT NULL,
        centre VARCHAR(100) NOT NULL,
        payment_datetime DATETIME NOT NULL,
        status VARCHAR(50) NOT NULL,
        txn_id VARCHAR(64) NULL,
        amount DECIMAL(10,2) NULL,
        img_hash VARCHAR(64) NULL,
        screenshot_base64 LONGTEXT NULL,
        validation_json JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_txn_id (txn_id),
        UNIQUE KEY uniq_img_hash (img_hash),
        INDEX idx_phone (phone),
        INDEX idx_batch (batch_name),
        INDEX idx_centre (centre),
        INDEX idx_status (status)
      );
    `);

    // Create students table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(50),
        dob DATE,
        address TEXT,
        beltLevel VARCHAR(50),
        joinDate DATE,
        parentName VARCHAR(255),
        parentPhone VARCHAR(50),
        emergencyContact VARCHAR(255),
        medicalInfo TEXT,
        status VARCHAR(50) DEFAULT 'active',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create attendance table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        studentId INT,
        date DATE,
        status VARCHAR(50),
        notes TEXT,
        FOREIGN KEY (studentId) REFERENCES students(id)
      );
    `);

    // Create admissions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS admissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        age INT,
        belt_level VARCHAR(50),
        address TEXT,
        centre VARCHAR(255),
        batch_timing VARCHAR(255),
        photo_url LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // Admissions hardening: dedupe and unique constraints
    try {
      await connection.query(`
        SELECT 1
      `);
    } catch (e) {}

    try {
      await connection.query(`
        SELECT 1
      `);
    } catch (e) {}

    try { await connection.query('ALTER TABLE admissions MODIFY COLUMN photo_url LONGTEXT'); } catch (e) {}
    try { await connection.query('ALTER TABLE admissions DROP INDEX uniq_admissions_email'); } catch (e) {}
    try { await connection.query('ALTER TABLE admissions DROP INDEX uniq_admissions_phone'); } catch (e) {}

    // Create batches table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        timing VARCHAR(255),
        centre VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    try {
      await connection.query(`
        DELETE b1 FROM batches b1
        INNER JOIN batches b2
          ON b1.name = b2.name
         AND b1.id > b2.id
      `);
    } catch (e) {}

    try {
      await connection.query('ALTER TABLE batches ADD UNIQUE KEY uniq_batch_name (name)');
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS instructors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        \`rank\` VARCHAR(100),
        photo_url LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    try {
      await connection.query('ALTER TABLE instructors MODIFY COLUMN photo_url LONGTEXT');
    } catch (e) {
    }

    // Insert default batches
    await connection.query(`
      INSERT IGNORE INTO batches (name, description, timing, centre) VALUES
      ('Batch 1', 'Tue, Thu, Sat batch', 'Tue, Thu, Sat (4:30 PM - 6:00 PM)', 'ST.CRUZ'),
      ('Batch 2', 'Tue, Thu, Sat batch', 'Tue, Thu, Sat (6:00 PM - 8:00 PM)', 'ST.CRUZ'),
      ('Batch 3', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (4:30 PM - 6:00 PM)', 'ST.CRUZ'),
      ('Batch 4', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (6:00 PM - 8:00 PM)', 'ST.CRUZ'),
      ('Batch A1', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (6:00 PM - 8:00 PM)', 'GUIRIM')
    `);

    // Ensure student_registrations table exists (for login/register)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS student_registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        batch ENUM('batch1', 'batch2', 'batch3', 'batch4', 'batchA1') NOT NULL,
        email_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        verification_sent_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_verification_token (verification_token)
      )
    `);

    // Allow duplicates by removing unique constraint on email
    try { await connection.query('ALTER TABLE student_registrations DROP INDEX IF EXISTS uniq_student_registrations_email'); } catch (e) {}

    // Check if admin user exists
    const [rows] = await connection.query("SELECT id FROM users WHERE username = 'admin'");
    if (rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await connection.query(
        "INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
        ['admin', 'admin@example.com', hashedPassword, 'admin']
      );
    }
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  } finally {
    connection.release();
  }
}

// Initialize MongoDB connection
connectDB().catch(console.error);

// Query function supporting MySQL and PostgreSQL
async function query(sql, params) {
  if (module.exports.dbType === 'postgresql') {
    const client = await module.exports.pool.connect();
    try {
      let text = sql;
      // Normalize MySQL-specific syntax for PostgreSQL
      text = text.replace(/`/g, '"');
      text = text.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE');
      text = text.replace(/\bDATE_SUB\s*\(\s*NOW\(\)\s*,\s*INTERVAL\s+7\s+DAY\s*\)/gi, "NOW() - INTERVAL '7 days'");

      // Convert positional params: ? -> $1, $2, ...
      if (Array.isArray(params) && params.length) {
        let i = 0;
        text = text.replace(/\?/g, () => `$${++i}`);
      }

      const lowered = text.trim().toLowerCase();
      if (lowered.startsWith('insert')) {
        // Ensure we get the inserted id back similar to MySQL's insertId
        if (!/returning\s+/i.test(text)) {
          text = text.replace(/;+\s*$/,'');
          text += ' RETURNING id';
        }
        const res = await client.query(text, params || []);
        const id = res.rows && res.rows[0] ? res.rows[0].id : undefined;
        return { insertId: id, affectedRows: res.rowCount || 0 };
      }

      if (lowered.startsWith('update') || lowered.startsWith('delete')) {
        const res = await client.query(text, params || []);
        return { affectedRows: res.rowCount || 0 };
      }

      const res = await client.query(text, params || []);
      return res.rows || [];
    } catch (err) {
      console.error('Database error:', err);
      throw err;
    } finally {
      client.release();
    }
  } else if (module.exports.dbType === 'sqlite' && dbConnection) {
    // SQLite handling
    return new Promise((resolve, reject) => {
      const lowered = sql.trim().toLowerCase();
      if (lowered.startsWith('select')) {
        dbConnection.all(sql, params || [], (err, rows) => {
          if (err) {
            console.error('SQLite error:', err);
            reject(err);
          } else {
            resolve(rows || []);
          }
        });
      } else if (lowered.startsWith('insert')) {
        dbConnection.run(sql, params || [], function(err) {
          if (err) {
            console.error('SQLite error:', err);
            reject(err);
          } else {
            resolve({ insertId: this.lastID, affectedRows: this.changes });
          }
        });
      } else {
        dbConnection.run(sql, params || [], function(err) {
          if (err) {
            console.error('SQLite error:', err);
            reject(err);
          } else {
            resolve({ affectedRows: this.changes });
          }
        });
      }
    });
  } else {
    const connection = await module.exports.pool.getConnection();
    try {
      const [rows] = await connection.query(sql, params);
      return rows;
    } catch (err) {
      console.error('Database error:', err);
      throw err;
    } finally {
      connection.release();
    }
  }
}

// Caching functions for dashboard data
async function getCachedData(key, fetchFunction, ttl = 300) { // 5 minutes default TTL
  try {
    const cached = await redisClient.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const data = await fetchFunction();
    await redisClient.setEx(key, ttl, JSON.stringify(data));
    return data;
  } catch (error) {
    console.log('Cache error, fetching directly:', error.message);
    return await fetchFunction();
  }
}

// Invalidate cache when data changes
async function invalidateCache(pattern) {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    console.log('Cache invalidation error:', error.message);
  }
}

app.get('/api/instructors', async (req, res) => {
  try {
    const instructors = await Instructor.find({ active: true }).sort({ createdAt: -1 });
    res.json(instructors.map(mapInstructor));
  } catch (err) {
    console.error('GET /api/instructors error', err);
    res.status(500).json({ message: 'Error fetching instructors' });
  }
});

app.post('/api/instructors', verifyToken, requireAdmin, instructorsUpload.single('photo'), async (req, res) => {
  try {
    const { name, description, rank } = req.body;
    console.log('POST /api/instructors - body:', req.body);
    console.log('POST /api/instructors - file:', req.file);
    
    if (!name) return res.status(400).json({ message: 'Name is required' });
    
    // Handle photo: store as base64 data URL in MongoDB so it survives redeploys
    let finalPhotoUrl = '';
    if (req.file) {
      try {
        const mime = String(req.file.mimetype || 'image/jpeg');
        const buf = fs.readFileSync(req.file.path);
        finalPhotoUrl = `data:${mime};base64,${buf.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } catch (e) {
        console.error('Failed to encode instructor photo:', e);
      }
    }
    
    const instructor = new Instructor({
      name,
      description: description || '',
      beltLevel: rank || '',
      photoUrl: finalPhotoUrl
    });
    await instructor.save();
    
    console.log('Instructor created:', instructor);
    res.status(201).json(mapInstructor(instructor));
  } catch (err) {
    console.error('POST /api/instructors error', err);
    res.status(500).json({ message: 'Error creating instructor: ' + err.message });
  }
});

app.put('/api/instructors/:id', verifyToken, requireAdmin, instructorsUpload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rank, photo_url } = req.body;

    const existing = await Instructor.findById(id);
    if (!existing) return res.status(404).json({ message: 'Instructor not found' });

    let nextPhotoUrl = existing.photoUrl || '';
    if (req.file) {
      try {
        const mime = String(req.file.mimetype || 'image/jpeg');
        const buf = fs.readFileSync(req.file.path);
        nextPhotoUrl = `data:${mime};base64,${buf.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } catch (e) {
        console.error('Failed to encode instructor photo:', e);
      }
    } else if (typeof photo_url === 'string' && photo_url.trim() !== '') {
      nextPhotoUrl = photo_url.trim();
    }

    existing.name = name || existing.name;
    existing.description = description || '';
    existing.beltLevel = rank || '';
    existing.photoUrl = nextPhotoUrl;
    await existing.save();

    res.json(mapInstructor(existing));
  } catch (err) {
    console.error('PUT /api/instructors/:id error', err);
    res.status(500).json({ message: 'Error updating instructor' });
  }
});

app.delete('/api/instructors/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const instructor = await Instructor.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!instructor) return res.status(404).json({ message: 'Instructor not found' });
    res.json({ message: 'Instructor deleted' });
  } catch (err) {
    console.error('DELETE /api/instructors/:id error', err);
    res.status(500).json({ message: 'Error deleting instructor' });
  }
});

// -------- Batches (MongoDB) --------
app.get('/api/batches', async (req, res) => {
  try {
    const batches = await Batch.find({ active: true }).sort({ createdAt: -1 });
    res.json(batches.map(mapBatch));
  } catch (err) {
    console.error('GET /api/batches error', err);
    res.status(500).json({ message: 'Error fetching batches' });
  }
});

app.post('/api/batches', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, timing, centre } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    
    const batch = new Batch({
      name,
      description: description || '',
      timing: timing || '',
      centre: centre || ''
    });
    await batch.save();
    
    res.status(201).json(mapBatch(batch));
  } catch (err) {
    console.error('POST /api/batches error', err);
    res.status(500).json({ message: 'Error creating batch' });
  }
});

app.put('/api/batches/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, timing, centre } = req.body;
    
    const batch = await Batch.findByIdAndUpdate(
      id,
      { name, description: description || '', timing: timing || '', centre: centre || '' },
      { new: true }
    );
    
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    res.json(mapBatch(batch));
  } catch (err) {
    console.error('PUT /api/batches/:id error', err);
    res.status(500).json({ message: 'Error updating batch' });
  }
});

app.delete('/api/batches/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/batches/:id error', err);
    res.status(500).json({ message: 'Error deleting batch' });
  }
});

// -------- Admissions --------
app.get('/api/admissions', async (req, res) => {
  try {
    const admissions = await Admission.find({}).sort({ created_at: -1 }).lean();
    res.json(admissions);
  } catch (err) {
    console.error('GET /api/admissions error', err);
    res.status(500).json({ message: 'Error fetching admissions' });
  }
});

app.post('/api/admissions', async (req, res) => {
  console.log('Received admission request:', JSON.stringify(req.body, null, 2));
  
  try {
    const { first_name, last_name, email, phone, age, belt_level, address, centre, batch_timing, photo_url } = req.body;
    const fn = String(first_name || '').trim();
    const ln = String(last_name || '').trim();
    const em = String(email || '').trim().toLowerCase();
    const ph = String(phone || '').replace(/\D/g, '');
    const ag = age && age !== '' ? parseInt(age) : null;
    const bl = String(belt_level || '').trim();
    const ad = String(address || '').trim();
    const ce = String(centre || '').trim();
    const bt = String(batch_timing || '').trim();
    const pu = photo_url || '';
    
    console.log('Processed admission data:', {
      first_name: fn,
      last_name: ln,
      email: em,
      phone: ph,
      age: ag,
      belt_level: bl,
      address: ad,
      centre: ce,
      batch_timing: bt,
      photo_url: pu
    });
    
    const requiredFields = {
      'First Name': fn,
      'Last Name': ln,
      'Email': em,
      'Phone': ph,
      'Age': ag,
      'Belt Level': bl,
      'Address': ad,
      'Centre': ce,
      'Batch Timing': bt
    };
    
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([field]) => field);
      
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return res.status(400).json({ 
        message: 'All fields are required',
        missingFields: missingFields
      });
    }
    
    const admission = new Admission({
      first_name: fn,
      last_name: ln,
      email: em,
      phone: ph,
      age: ag,
      belt_level: bl,
      address: ad,
      centre: ce,
      batch_timing: bt,
      photo_url: pu
    });
    
    await admission.save();
    console.log('Admission saved to MongoDB:', admission.id);
    
    res.status(201).json({
      ...admission.toJSON(),
      message: 'Admission Successful'
    });
  } catch (err) {
    console.error('POST /api/admissions error:', err);
    
    if (err.code === 11000) {
      const existing = await Admission.findOne({ email: em });
      if (existing) {
        return res.status(201).json({
          ...existing.toJSON(),
          message: 'Admission Successful'
        });
      }
    }
    
    res.status(500).json({ message: 'Error creating admission: ' + err.message });
  }
});

app.delete('/api/admissions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Admission.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ message: 'Admission not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admissions/:id error', err);
    res.status(500).json({ message: 'Error deleting admission' });
  }
});


// -------- Payments --------
app.get('/api/payments', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM payments ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/payments error', err);
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { student_name, amount, date, status } = req.body;
    if (!student_name || !amount || !date) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'INSERT INTO payments (student_name, amount, date, status) VALUES (?, ?, ?, ?)',
      [student_name, amount, formattedDate, status || 'Pending']
    );
    const inserted = await query('SELECT * FROM payments WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/payments error', err);
    res.status(500).json({ message: 'Error creating payment' });
  }
});

app.put('/api/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { student_name, amount, date, status } = req.body;
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'UPDATE payments SET student_name = ?, amount = ?, date = ?, status = ? WHERE id = ?',
      [student_name, amount, formattedDate, status, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Payment not found' });
    const updated = await query('SELECT * FROM payments WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/payments/:id error', err);
    res.status(500).json({ message: 'Error updating payment' });
  }
});

app.delete('/api/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM payments WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/payments/:id error', err);
    res.status(500).json({ message: 'Error deleting payment' });
  }
});

// -------- Tournaments (MongoDB) --------
app.get('/api/tournaments', async (req, res) => {
  try {
    const tournaments = await Tournament.find({ active: true }).sort({ date: -1 });
    res.json(tournaments.map(mapTournament));
  } catch (err) {
    console.error('GET /api/tournaments error', err);
    res.status(500).json({ message: 'Error fetching tournaments' });
  }
});

app.post('/api/tournaments', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { title, location, date, description } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: 'Title and date are required' });
    }
    
    const tournament = new Tournament({
      name: title,
      description: description || '',
      date: new Date(date),
      venue: location || ''
    });
    await tournament.save();

    res.status(201).json(mapTournament(tournament));
  } catch (err) {
    console.error('POST /api/tournaments error', err);
    res.status(500).json({ message: 'Error creating tournament' });
  }
});

app.put('/api/tournaments/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, location, date, description } = req.body;
    
    const tournament = await Tournament.findByIdAndUpdate(
      id,
      {
        name: title,
        description: description || '',
        date: new Date(date),
        venue: location || ''
      },
      { new: true }
    );
    
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json(mapTournament(tournament));
  } catch (err) {
    console.error('PUT /api/tournaments/:id error', err);
    res.status(500).json({ message: 'Error updating tournament' });
  }
});

app.delete('/api/tournaments/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tournaments/:id error', err);
    res.status(500).json({ message: 'Error deleting tournament' });
  }
});

// -------- Store Items (MongoDB) --------
app.get('/api/store-items', async (req, res) => {
  try {
    const items = await StoreItem.find({ active: true }).sort({ createdAt: -1 });
    res.json(items.map(mapStoreItem));
  } catch (err) {
    console.error('GET /api/store-items error', err);
    res.status(500).json({ message: 'Error fetching store items' });
  }
});

app.post('/api/store-items', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, price, description } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ message: 'Name and price are required' });
    }
    
    const item = new StoreItem({
      name,
      price,
      description: description || ''
    });
    await item.save();

    res.status(201).json(mapStoreItem(item));
  } catch (err) {
    console.error('POST /api/store-items error', err);
    res.status(500).json({ message: 'Error creating store item' });
  }
});

app.put('/api/store-items/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, description } = req.body;
    
    const item = await StoreItem.findByIdAndUpdate(
      id,
      { name, price, description: description || '' },
      { new: true }
    );
    
    if (!item) return res.status(404).json({ message: 'Store item not found' });
    res.json(mapStoreItem(item));
  } catch (err) {
    console.error('PUT /api/store-items/:id error', err);
    res.status(500).json({ message: 'Error updating store item' });
  }
});

app.delete('/api/store-items/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const item = await StoreItem.findByIdAndUpdate(id, { active: false }, { new: true });
    if (!item) return res.status(404).json({ message: 'Store item not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/store-items/:id error', err);
    res.status(500).json({ message: 'Error deleting store item' });
  }
});

// -------- Exams --------
app.get('/api/exams', async (req, res) => {
  try {
    const exams = await Exam.find({}).sort({ date: -1 });
    res.json(exams.map(function (e) { return e.toJSON(); }));
  } catch (err) {
    console.error('GET /api/exams error', err);
    res.status(500).json({ message: 'Error fetching exams' });
  }
});

app.post('/api/exams', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { title, date, location, description } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: 'Title and date are required' });
    }
    
    const exam = new Exam({
      title: String(title),
      date: new Date(date),
      location: String(location || ''),
      description: String(description || '')
    });
    await exam.save();
    res.status(201).json(exam.toJSON());
  } catch (err) {
    console.error('POST /api/exams error', err);
    res.status(500).json({ message: 'Error creating exam' });
  }
});

app.put('/api/exams/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, date, location, description } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: 'Title and date are required' });
    }

    const updated = await Exam.findByIdAndUpdate(
      id,
      {
        title: String(title),
        date: new Date(date),
        location: String(location || ''),
        description: String(description || '')
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Exam not found' });
    res.json(updated.toJSON());
  } catch (err) {
    console.error('PUT /api/exams/:id error', err);
    res.status(500).json({ message: 'Error updating exam' });
  }
});

app.delete('/api/exams/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Exam.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Exam not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/exams/:id error', err);
    res.status(500).json({ message: 'Error deleting exam' });
  }
});

// -------- Announcements --------
app.get('/api/announcements', async (req, res) => {
  try {
    const rows = await Announcement.find({}).sort({ created_at: -1, createdAt: -1 });
    const out = rows.map(function (a) {
      return {
        id: String(a._id),
        text: a.message || a.title || '',
        created_at: a.created_at || a.createdAt
      };
    });
    res.json(out);
  } catch (err) {
    console.error('GET /api/announcements error', err);
    res.status(500).json({ message: 'Error fetching announcements' });
  }
});

app.post('/api/announcements', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Text is required' });
    const a = new Announcement({ title: 'Announcement', message: String(text) });
    await a.save();
    res.status(201).json({ id: String(a._id), text: a.message, created_at: a.created_at || a.createdAt });
  } catch (err) {
    console.error('POST /api/announcements error', err);
    res.status(500).json({ message: 'Error posting announcement' });
  }
});

app.delete('/api/announcements/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Announcement.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Announcement not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/announcements/:id error', err);
    res.status(500).json({ message: 'Error deleting announcement' });
  }
});

// -------- Attendance --------
app.get('/api/attendance', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM attendance ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/attendance error', err);
    res.status(500).json({ message: 'Error fetching attendance' });
  }
});

app.post('/api/attendance', async (req, res) => {
  try {
    const { student_name, date, status } = req.body;
    if (!student_name || !date || !status) {
      return res.status(400).json({ message: 'Student, date and status are required' });
    }
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'INSERT INTO attendance (student_name, date, status) VALUES (?, ?, ?)',
      [student_name, formattedDate, status]
    );
    const inserted = await query('SELECT * FROM attendance WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/attendance error', err);
    res.status(500).json({ message: 'Error creating attendance record' });
  }
});

app.put('/api/attendance/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { student_name, date, status } = req.body;
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'UPDATE attendance SET student_name = ?, date = ?, status = ? WHERE id = ?',
      [student_name, formattedDate, status, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Attendance record not found' });
    const updated = await query('SELECT * FROM attendance WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/attendance/:id error', err);
    res.status(500).json({ message: 'Error updating attendance record' });
  }
});

app.delete('/api/attendance/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM attendance WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Attendance record not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/attendance/:id error', err);
    res.status(500).json({ message: 'Error deleting attendance record' });
  }
});

// -------- Registration endpoints --------
app.post('/api/tournament-registrations', async (req, res) => {
  try {
    const { tournament_id, name, email, phone, centre, batch } = req.body;
    if (!tournament_id || !name || !email || !phone || !centre || !batch) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const reg = new TournamentRegistration({
      tournament_id,
      name,
      email,
      phone,
      centre,
      batch
    });
    await reg.save();
    const populated = await TournamentRegistration.findById(reg._id).populate('tournament_id', 'name date');
    res.status(201).json({
      id: String(populated._id),
      tournament_id: String(populated.tournament_id?._id || ''),
      tournament_title: populated.tournament_id?.name || '',
      tournament_date: populated.tournament_id?.date ? new Date(populated.tournament_id.date).toISOString().slice(0, 10) : '',
      name: populated.name,
      email: populated.email,
      phone: populated.phone,
      centre: populated.centre,
      batch: populated.batch,
      created_at: populated.created_at
    });
  } catch (err) {
    console.error('POST /api/tournament-registrations error', err);
    res.status(500).json({ message: 'Error creating tournament registration' });
  }
});

app.get('/api/tournament-registrations', async (req, res) => {
  try {
    const regs = await TournamentRegistration.find({}).sort({ created_at: -1 }).populate('tournament_id', 'name date');
    const out = regs.map(function (r) {
      return {
        id: String(r._id),
        tournament_id: String(r.tournament_id?._id || ''),
        tournament_title: r.tournament_id?.name || '',
        tournament_date: r.tournament_id?.date ? new Date(r.tournament_id.date).toISOString().slice(0, 10) : '',
        name: r.name,
        email: r.email,
        phone: r.phone,
        centre: r.centre,
        batch: r.batch,
        created_at: r.created_at
      };
    });
    res.json(out);
  } catch (err) {
    console.error('GET /api/tournament-registrations error', err);
    res.status(500).json({ message: 'Error fetching tournament registrations' });
  }
});

app.delete('/api/tournament-registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TournamentRegistration.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Registration not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tournament-registrations/:id error', err);
    res.status(500).json({ message: 'Error deleting registration' });
  }
});

app.post('/api/exam-registrations', async (req, res) => {
  try {
    const { exam_id, name, email, phone, centre, batch } = req.body;
    if (!exam_id || !name || !email || !phone || !centre || !batch) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const result = await query(
      'INSERT INTO exam_registrations (exam_id, name, email, phone, centre, batch) VALUES (?, ?, ?, ?, ?, ?)',
      [exam_id, name, email, phone, centre, batch]
    );
    const inserted = await query('SELECT er.*, e.title as exam_title, e.date as exam_date FROM exam_registrations er JOIN exams e ON er.exam_id = e.id WHERE er.id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/exam-registrations error', err);
    res.status(500).json({ message: 'Error creating exam registration' });
  }
});

app.get('/api/exam-registrations', async (req, res) => {
  try {
    const result = await query('SELECT er.*, e.title as exam_title, e.date as exam_date, e.belt as exam_belt FROM exam_registrations er JOIN exams e ON er.exam_id = e.id ORDER BY er.created_at DESC');
    res.json(result);
  } catch (err) {
    console.error('GET /api/exam-registrations error', err);
    res.status(500).json({ message: 'Error fetching exam registrations' });
  }
});

app.delete('/api/exam-registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM exam_registrations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Registration not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/exam-registrations/:id error', err);
    res.status(500).json({ message: 'Error deleting registration' });
  }
});

app.post('/api/store-orders', async (req, res) => {
  try {
    const { store_item_id, name, email, phone, centre, batch, quantity = 1 } = req.body;
    if (!store_item_id || !name || !email || !phone || !centre || !batch) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const order = new StoreOrder({
      store_item_id,
      student_name: name,
      student_email: email,
      phone,
      centre,
      batch,
      quantity: Number(quantity) || 1
    });
    await order.save();
    const populated = await StoreOrder.findById(order._id).populate('store_item_id', 'name price');
    res.status(201).json({
      id: String(populated._id),
      store_item_id: String(populated.store_item_id?._id || ''),
      item_name: populated.store_item_id?.name || '',
      item_price: populated.store_item_id?.price || 0,
      total_price: (Number(populated.quantity) || 0) * (Number(populated.store_item_id?.price) || 0),
      name: populated.student_name,
      email: populated.student_email,
      phone: populated.phone,
      centre: populated.centre,
      batch: populated.batch,
      quantity: populated.quantity,
      status: populated.status,
      created_at: populated.created_at
    });
  } catch (err) {
    console.error('POST /api/store-orders error', err);
    res.status(500).json({ message: 'Error creating store order' });
  }
});

app.get('/api/store-orders', async (req, res) => {
  try {
    const orders = await StoreOrder.find({}).sort({ created_at: -1 }).populate('store_item_id', 'name price');
    const out = orders.map(function (o) {
      const price = Number(o.store_item_id?.price) || 0;
      const qty = Number(o.quantity) || 0;
      return {
        id: String(o._id),
        store_item_id: String(o.store_item_id?._id || ''),
        item_name: o.store_item_id?.name || '',
        item_price: price,
        total_price: qty * price,
        name: o.student_name,
        email: o.student_email,
        phone: o.phone,
        centre: o.centre,
        batch: o.batch,
        quantity: o.quantity,
        status: o.status,
        created_at: o.created_at
      };
    });
    res.json(out);
  } catch (err) {
    console.error('GET /api/store-orders error', err);
    res.status(500).json({ message: 'Error fetching store orders' });
  }
});

app.put('/api/store-orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['Pending', 'Confirmed', 'Delivered'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const updated = await StoreOrder.findByIdAndUpdate(id, { status }, { new: true }).populate('store_item_id', 'name price');
    if (!updated) return res.status(404).json({ message: 'Order not found' });
    const price = Number(updated.store_item_id?.price) || 0;
    const qty = Number(updated.quantity) || 0;
    res.json({
      id: String(updated._id),
      store_item_id: String(updated.store_item_id?._id || ''),
      item_name: updated.store_item_id?.name || '',
      item_price: price,
      total_price: qty * price,
      name: updated.student_name,
      email: updated.student_email,
      phone: updated.phone,
      centre: updated.centre,
      batch: updated.batch,
      quantity: updated.quantity,
      status: updated.status,
      created_at: updated.created_at
    });
  } catch (err) {
    console.error('PUT /api/store-orders/:id error', err);
    res.status(500).json({ message: 'Error updating order status' });
  }
});

app.delete('/api/store-orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await StoreOrder.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: 'Order not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/store-orders/:id error', err);
    res.status(500).json({ message: 'Error deleting order' });
  }
});

// -------- Dashboard Stats (with caching) --------
app.get('/api/dashboard/admin', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  try {
    const stats = await getCachedData('dashboard:admin', async () => {
      const [totalInstructors, totalBatches, totalTournaments, totalStoreItems, totalAnnouncements] = await Promise.all([
        Instructor.countDocuments({ active: true }),
        Batch.countDocuments({ active: true }),
        Tournament.countDocuments({ active: true }),
        StoreItem.countDocuments({ active: true }),
        Announcement.countDocuments({})
      ]);

      return {
        totalInstructors: totalInstructors || 0,
        totalBatches: totalBatches || 0,
        totalAdmissions: 0,
        totalPayments: 0,
        totalTournaments: totalTournaments || 0,
        totalStoreItems: totalStoreItems || 0,
        totalExams: 0,
        totalAnnouncements: totalAnnouncements || 0,
        totalAttendance: 0
      };
    }, 600); // Cache for 10 minutes

    res.json(stats);
  } catch (err) {
    console.error('GET /api/dashboard/admin error', err);
    res.status(500).json({ message: 'Error fetching admin dashboard stats' });
  }
});

app.get('/api/dashboard/student', verifyToken, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ message: 'Student access required' });
  }

  try {
    const stats = await getCachedData(`dashboard:student:${req.user.studentId}`, async () => {
      const [
        upcomingTournaments,
        upcomingExams,
        newAnnouncements,
        storeItems
      ] = await Promise.all([
        query('SELECT COUNT(*) as count FROM tournaments WHERE date > CURDATE()'),
        query('SELECT COUNT(*) as count FROM exams WHERE date > CURDATE()'),
        query('SELECT COUNT(*) as count FROM announcements WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)'),
        query('SELECT COUNT(*) as count FROM store_items')
      ]);

      return {
        upcomingTournaments: upcomingTournaments[0].count || 0,
        upcomingExams: upcomingExams[0].count || 0,
        newAnnouncements: newAnnouncements[0].count || 0,
        storeItems: storeItems[0].count || 0
      };
    }, 300); // Cache for 5 minutes

    res.json(stats);
  } catch (err) {
    console.error('GET /api/dashboard/student error', err);
    res.status(500).json({ message: 'Error fetching student dashboard stats' });
  }
});

// -------- Authentication (MongoDB) --------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const normEmail = String(email || '').trim().toLowerCase();

    if (!normEmail || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }
    
    if (role === 'admin') {
      // MongoDB Admin login
      const admin = await Admin.findOne({ email: normEmail });
      
      if (!admin) {
        // Create default admin if doesn't exist
        if (normEmail === 'karatesubhash455@gmail.com' && password === 'karate@123') {
          const newAdmin = new Admin({
            name: 'Admin',
            email: normEmail,
            password: 'karate@123'
          });
          await newAdmin.save();
          
          const token = jwt.sign(
            { email, role: 'admin', name: 'Admin' },
            JWT_SECRET,
            { expiresIn: '24h' }
          );
          return res.json({
            success: true,
            token,
            user: { email, role: 'admin', name: 'Admin' },
            message: 'Admin login successful'
          });
        }
        return res.status(401).json({ message: 'Invalid admin credentials' });
      }
      
      const isMatch = await admin.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid admin credentials' });
      }
      
      const token = jwt.sign(
        { email, role: 'admin', name: admin.name },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({
        success: true,
        token,
        user: { email, role: 'admin', name: admin.name },
        message: 'Admin login successful'
      });
    } else if (role === 'student') {
      // MongoDB Student login
      const student = await Student.findOne({ email: normEmail, active: true });
      
      if (!student) {
        return res.status(401).json({ message: 'Student not found. Please register first.' });
      }
      
      const isMatch = await student.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      
      const token = jwt.sign(
        { 
          email: student.email, 
          role: 'student', 
          name: student.fullName,
          studentId: student._id,
          batch: student.batch
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      res.json({
        success: true,
        token,
        user: { 
          email: student.email, 
          role: 'student', 
          name: student.fullName,
          studentId: student._id,
          batch: student.batch
        },
        message: 'Student login successful'
      });
    } else {
      res.status(400).json({ message: 'Invalid role specified' });
    }
  } catch (err) {
    console.error('POST /api/login error:', err);
    res.status(500).json({ message: 'Login error occurred' });
  }
});

// JWT verification middleware
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Temporary endpoint to delete student registration (for testing)
app.post('/api/delete-registration', async (req, res) => {
  try {
    const { email } = req.body;
    const e = String(email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ message: 'Email required' });

    return res.status(410).json({ message: 'Legacy registration deletion is disabled. Student registrations are stored in MongoDB now.' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Error deleting registration' });
  }
});

// -------- Student Registration (MongoDB with bcrypt) --------
app.post('/api/student-register', async (req, res) => {
  req.setTimeout(30000);
  
  try {
    console.log('📝 Student registration request received:', req.body);
    
    const { firstName, lastName, email, phone, batch, centre, password } = req.body;
    const f = String(firstName || '').trim();
    const l = String(lastName || '').trim();
    const e = String(email || '').trim().toLowerCase();
    const p = String(phone || '').replace(/\D/g, '');
    const b = String(batch || '').trim();
    const c = String(centre || '').trim();
    const pwd = String(password || '').trim();

    console.log('📝 Parsed values:', { f, l, e, p, b, c });

    if (!f || !l || !e || !p || !b || !c) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Check if email already exists
    const existing = await Student.findOne({ email: e });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered. Please login instead.' });
    }
    
    // Create new student with bcrypt password
    const passwordHash = await bcrypt.hash(pwd || 'karate@123', 10);
    const student = new Student({
      fullName: `${f} ${l}`,
      email: e,
      phone: p,
      batch: b,
      centre: c,
      passwordHash
    });
    
    await student.save();
    
    // Send welcome email (non-blocking)
    const mailOptions = {
      to: e,
      from: EMAIL_USER,
      subject: 'Welcome to WTSKF-GOA Karate!',
      html: `
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Welcome to WTSKF-GOA Karate!</h2>
          <p>Hello ${f} ${l},</p>
          <p>Your registration is successful!</p>
          <p><strong>Login Details:</strong></p>
          <p>Email: ${e}</p>
          <p>Password: ${pwd || 'karate@123'}</p>
          <p>Centre: ${c}</p>
          <p>Batch: ${b}</p>
          <p>Please login to access your dashboard.</p>
        </body>
        </html>
      `
    };
    
    sendMail(mailOptions)
      .then(() => console.log('✅ Welcome email SENT to:', e))
      .catch(err => console.error('❌ Email FAILED:', err.message));
    
    res.status(201).json({
      success: true,
      studentId: student._id,
      message: 'Registration successful! Please login with your credentials.'
    });
  } catch (err) {
    console.error('POST /api/student-register error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ message: 'Error creating student registration: ' + err.message });
  }
});

 

// GET test email endpoint - for easy browser testing
app.get('/api/test-email', async (req, res) => {
  const testEmail = req.query.to || 'creativeanisha00@gmail.com';
  console.log('🧪 GET TEST EMAIL endpoint hit for:', testEmail);
  
  // Reuse the POST logic
  req.body = { to: testEmail };
  
  // Forward to POST handler logic
  console.log('🧪 EMAIL CONFIG CHECK:');
  console.log('   EMAIL_USER:', EMAIL_USER);
  console.log('   BREVO_SMTP_USER:', BREVO_SMTP_USER);
  console.log('   BREVO_SMTP_KEY exists:', !!BREVO_SMTP_KEY);
  console.log('   brevoTransporter exists:', !!brevoTransporter);
  console.log('   gmailTransporter exists:', !!gmailTransporter);
  
  try {
    const mailOptions = {
      to: testEmail,
      from: EMAIL_USER,
      subject: 'GET TEST - WTSKF-GOA Email System',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff;">
          <h2 style="color: #d4af37;">GET TEST EMAIL</h2>
          <p>This is a GET test sent at: ${new Date().toISOString()}</p>
          <p>If you received this, email is working!</p>
        </div>
      `
    };
    
    console.log('🧪 About to call sendMail...');
    const info = await sendMail(mailOptions);
    console.log('🧪 sendMail returned:', info);
    
    res.json({ 
      success: true, 
      message: 'Test email sent successfully via GET', 
      messageId: info?.messageId || 'unknown',
      to: testEmail
    });
  } catch (err) {
    console.error('🧪 GET TEST EMAIL FAILED:', err.message);
    console.error('🧪 Full error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to send test email', 
      error: err.message
    });
  }
});

// Test email endpoint - auto sends to test address
app.post('/api/test-email', async (req, res) => {
  console.log('🧪 POST /api/test-email HIT! Body:', req.body);
  
  const testEmail = req.body?.to || 'creativeanisha00@gmail.com';
  
  console.log('🧪 TEST EMAIL: Sending to', testEmail);
  console.log('🧪 EMAIL_USER:', EMAIL_USER);
  console.log('🧪 Brevo transporter exists:', !!brevoTransporter);
  
  const mailOptions = {
    to: testEmail,
    from: EMAIL_USER,
    subject: 'URGENT TEST - WTSKF-GOA Registration',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff;">
        <h2 style="color: #d4af37;">TEST EMAIL - PLEASE IGNORE</h2>
        <p>This is a test email sent at: ${new Date().toISOString()}</p>
        <p>If you received this, Brevo SMTP is working!</p>
        <hr>
        <p>System Info:</p>
        <ul>
          <li>Server: karate-admin-backend.onrender.com</li>
          <li>Time: ${new Date().toLocaleString()}</li>
          <li>From: ${EMAIL_USER}</li>
          <li>To: ${testEmail}</li>
        </ul>
      </div>
    `
  };

  try {
    console.log('🧪 About to call sendMail with:', { to: testEmail, from: EMAIL_USER });
    const info = await sendMail(mailOptions);
    console.log('🧪 sendMail returned:', info);
    
    res.json({ 
      success: true, 
      message: 'Test email sent successfully', 
      messageId: info?.messageId || 'no-message-id',
      to: testEmail,
      from: EMAIL_USER
    });
  } catch (err) {
    console.error('🧪 TEST EMAIL FAILED:', err);
    console.error('🧪 Full error:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to send test email', 
      error: err.message,
      details: err.toString()
    });
  }
});

// Student email verification endpoint
app.get('/verify-student-email', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
        <h1>Email Verification Not Required</h1>
        <p>Student registrations are now handled via MongoDB and do not require email verification.</p>
        <p>Please return to the website and login.</p>
        <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e63946; color: white; text-decoration: none; border-radius: 5px;">Go to Home</a>
      </body>
    </html>
  `);
});

// -------- Create Student Table --------
app.get('/api/create-student-table', async (req, res) => {
  return res.status(410).json({ message: 'Legacy SQL endpoint disabled. Student registrations use MongoDB now.' });
});

// Fallback: send index.html for any unknown route (SPA-style)
app.get('/api/health', async (req, res) => {
  const dbOk = (mongoose.connection && mongoose.connection.readyState === 1);
  const redisOk = !!(redisClient && redisClient.isOpen);
  res.status(200).json({ status: 'ok', db: dbOk, redis: redisOk });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Start server
const startServer = async () => {
  await connectDB();
  await ensureDefaultAdmin();
  await seedMockData();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Karate admin backend running on http://0.0.0.0:${PORT}`);
    console.log('MongoDB is the primary database');
  });
};

startServer().catch(err => {
  console.error('Failed to start server:', err);
  // Do not exit: keep process alive on Render to allow health checks & static pages.
});
