require('dotenv').config();

const express = require('express');
const cors = require('cors');
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

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Core middleware must be registered before routes
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));
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

    const rows = await query('SELECT * FROM student_registrations WHERE email = ?', [e]);
    if (!rows.length) return res.status(404).json({ message: 'No student registration found for this email' });
    const s = rows[0];
    if (s.email_verified) return res.status(409).json({ message: 'This email is already verified.' });

    let token = s.verification_token;
    if (!token) {
      token = uuidv4();
      await query('UPDATE student_registrations SET verification_token = ?, verification_sent_at = NOW() WHERE id = ?', [token, s.id]);
    }

    const verificationLink = `${req.protocol}://${req.get('host')}/verify-student-email?token=${token}&email=${encodeURIComponent(e)}`;
    const mailOptions = {
      to: e,
      from: EMAIL_USER,
      subject: 'Verify your email - WTSKF-GOA Student Registration',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #d4af37; margin: 0;">WTSKF-GOA</h2>
            <p style="color: #fff; margin: 5px 0;">World Traditional Shotokan Karate Federation - Goa</p>
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; border: 1px solid rgba(212,175,55,0.3);">
            <h3 style="color: #fff; margin-top: 0;">Verify Your Student Account</h3>
            <p style="color: #ddd; line-height: 1.6;">We have re-sent your verification link. Please click the button below to activate your account.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}" style="background: linear-gradient(135deg, #d4af37, #f4e4bc); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Verify Student Account</a>
            </div>
            <p style="color: #aaa; font-size: 12px; word-break: break-all; text-align: center;">${verificationLink}</p>
          </div>
        </div>
      `
    };
    await sendMail(mailOptions);
    res.status(200).json({ message: 'Verification link sent to your email.' });
  } catch (err) {
    console.error('Resend student verification error:', err);
    res.status(500).json({ message: 'Failed to send verification email' });
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

app.post('/api/fees-payments', async (req, res) => {
  try {
    const {
      full_name,
      phone,
      batch_name,
      centre,
      payment_datetime,
      status,
      txn_id,
      amount,
      img_hash,
      screenshot_base64,
      validation
    } = req.body || {};

    if (!full_name || !phone || !batch_name || !centre) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const dt = payment_datetime ? new Date(payment_datetime) : new Date();
    if (isNaN(dt.getTime())) return res.status(400).json({ message: 'Invalid payment_datetime' });

    // Dedup by txn_id or img_hash if provided
    if (txn_id) {
      const existing = await query('SELECT id FROM fees_payments WHERE txn_id = ?', [txn_id]);
      if (existing.length) return res.status(409).json({ message: 'Duplicate transaction ID' });
    }
    if (img_hash) {
      const existing2 = await query('SELECT id FROM fees_payments WHERE img_hash = ?', [img_hash]);
      if (existing2.length) return res.status(409).json({ message: 'Duplicate screenshot detected' });
    }

    const result = await query(
      'INSERT INTO fees_payments (full_name, phone, batch_name, centre, payment_datetime, status, txn_id, amount, img_hash, screenshot_base64, validation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [full_name, phone, batch_name, centre, new Date(dt.getTime() - dt.getTimezoneOffset()*60000), status || 'Pending Verification', txn_id || null, amount || null, img_hash || null, screenshot_base64 || null, validation ? JSON.stringify(validation) : null]
    );

    const inserted = await query('SELECT * FROM fees_payments WHERE id = ?', [result.insertId]);
    refreshFeesExcel();
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/fees-payments error', err);
    res.status(500).json({ message: 'Error creating fees payment' });
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

// Force load Gmail credentials - HARDCODED WORKING CREDENTIALS
const EMAIL_USER = process.env.EMAIL_USER || 'karatesubhash455@gmail.com';
const EMAIL_PASS = (process.env.EMAIL_PASS || 'dfymcxhqljfirkib').replace(/\s/g, '');

console.log('📧 Email configuration:');
console.log('EMAIL_USER:', EMAIL_USER);
console.log('EMAIL_PASS configured:', !!EMAIL_PASS);

// Brevo configuration (SMTP preferred over API)
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SMTP_KEY = process.env.BREVO_SMTP_KEY || '';
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER || 'karatesubhash455@gmail.com';

// Configure Brevo API client (fallback)
if (brevo && BREVO_API_KEY) {
  brevo.ApiClient.instance.authentications['api-key'].apiKey = BREVO_API_KEY;
}

// Configure Brevo SMTP transporter (primary)
let brevoTransporter = null;
if (nodemailer && BREVO_SMTP_KEY) {
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
  console.log('Attempting to send email to:', mailOptions.to);
  
  // 1. Try Gmail SMTP (most reliable)
  if (gmailTransporter) {
    console.log('Using Gmail SMTP for email');
    try {
      const info = await gmailTransporter.sendMail({
        from: `"WTSKF-GOA" <${EMAIL_USER}>`,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text || 'Please view this email in an HTML-capable client.'
      });
      console.log('✅ Email sent successfully via Gmail SMTP to:', mailOptions.to, 'MessageId:', info.messageId);
      return;
    } catch (e) {
      console.error('❌ Gmail SMTP send error:', e.message);
      console.error('Full error:', e);
      // Continue to fallback
    }
  }
  
  // 2. Try Brevo SMTP (fallback)
  if (brevoTransporter) {
    console.log('Using Brevo SMTP for email');
    try {
      const info = await brevoTransporter.sendMail({
        from: `"WTSKF-GOA" <${mailOptions.from || EMAIL_USER || 'karatesubhash455@gmail.com'}>`,
        to: mailOptions.to,
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text || 'Please view this email in an HTML-capable client.'
      });
      console.log('✅ Email sent successfully via Brevo SMTP to:', mailOptions.to, 'MessageId:', info.messageId);
      return;
    } catch (e) {
      console.error('❌ Brevo SMTP send error:', e.message);
      // Continue to fallback
    }
  }
  
  // 3. Try Brevo API (fallback)
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
      console.error('❌ Brevo API send error:', e);
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
    try { const u = new URL(rawUrl); console.log('DB selected:', 'postgresql', '@', u.hostname); } catch (_) { console.log('DB selected:', 'postgresql'); }
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
    console.log('DB selected:', 'mysql', '@', u.hostname);
  } else {
    module.exports.pool = pool;
    module.exports.dbType = 'mysql';
    console.log('DB selected:', 'mysql (default local)');
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
        try { await client.query('ALTER TABLE student_registrations DROP CONSTRAINT IF EXISTS student_registrations_email_key'); } catch (_) {}
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

// Initialize the database
initializeDatabase().catch(console.error);

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

// (moved middleware above to ensure availability for all routes)

// -------- Instructors --------
app.get('/api/instructors', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM instructors ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/instructors error', err);
    res.status(500).json({ message: 'Error fetching instructors' });
  }
});

app.post('/api/instructors', async (req, res) => {
  try {
    const { name, description, rank, photo_url } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    const result = await query(
      'INSERT INTO instructors (name, description, `rank`, photo_url) VALUES (?, ?, ?, ?)',
      [name, description || '', rank || '', photo_url || '']
    );
    const inserted = await query('SELECT * FROM instructors WHERE id = ?', [result.insertId]);
    
    // Clear dashboard cache
    await invalidateCache('dashboard:admin*');
    
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/instructors error', err);
    res.status(500).json({ message: 'Error creating instructor' });
  }
});

app.put('/api/instructors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rank, photo_url } = req.body;
    const result = await query(
      'UPDATE instructors SET name = ?, description = ?, `rank` = ?, photo_url = ? WHERE id = ?',
      [name, description || '', rank || '', photo_url || '', id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Instructor not found' });
    const updated = await query('SELECT * FROM instructors WHERE id = ?', [id]);
    
    // Clear dashboard cache
    await invalidateCache('dashboard:admin*');
    
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/instructors/:id error', err);
    res.status(500).json({ message: 'Error updating instructor' });
  }
});

app.delete('/api/instructors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM instructors WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Instructor not found' });
    
    // Clear dashboard cache
    await invalidateCache('dashboard:admin*');
    
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/instructors/:id error', err);
    res.status(500).json({ message: 'Error deleting instructor' });
  }
});

// -------- Batches --------
app.get('/api/batches', async (req, res) => {
  try {
    const rows = await query(`
      SELECT b.*
      FROM batches b
      INNER JOIN (
        SELECT TRIM(name) AS nm, MAX(id) AS max_id
        FROM batches
        GROUP BY TRIM(name)
      ) t
        ON TRIM(b.name) = t.nm
       AND b.id = t.max_id
      ORDER BY b.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/batches error', err);
    res.status(500).json({ message: 'Error fetching batches' });
  }
});

app.post('/api/batches', async (req, res) => {
  try {
    const { name, description, timing, centre } = req.body;
    if (!name) return res.status(400).json({ message: 'Name is required' });
    const result = await query(
      'INSERT INTO batches (name, description, timing, centre) VALUES (?, ?, ?, ?)',
      [name, description || '', timing || '', centre || '']
    );
    const inserted = await query('SELECT * FROM batches WHERE id = ?', [result.insertId]);
    
    // Clear dashboard cache
    await invalidateCache('dashboard:admin*');
    
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/batches error', err);
    res.status(500).json({ message: 'Error creating batch' });
  }
});

app.put('/api/batches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, timing, centre } = req.body;
    const result = await query(
      'UPDATE batches SET name = ?, description = ?, timing = ?, centre = ? WHERE id = ?',
      [name, description || '', timing || '', centre || '', id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Batch not found' });
    const updated = await query('SELECT * FROM batches WHERE id = ?', [id]);
    
    // Clear dashboard cache
    await invalidateCache('dashboard:admin*');
    
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/batches/:id error', err);
    res.status(500).json({ message: 'Error updating batch' });
  }
});

app.delete('/api/batches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM batches WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Batch not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/batches/:id error', err);
    res.status(500).json({ message: 'Error deleting batch' });
  }
});

// -------- Admissions --------
app.get('/api/admissions', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM admissions ORDER BY created_at DESC');
    res.json(rows);
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
    
    // Log the received data
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
    
    // Validate required fields
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
    
    // Convert empty strings to NULL for numeric fields
    const ageValue = ag;
    
    try {
      console.log('Attempting to insert into database...');
      let result;
      if (module.exports.dbType === 'postgresql') {
        result = await query(
          'INSERT INTO admissions (first_name, last_name, email, phone, age, belt_level, address, centre, batch_timing, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [fn, ln, em, ph, ageValue, bl, ad, ce, bt, pu]
        );
      } else {
        result = await query(
          'INSERT INTO admissions (first_name, last_name, email, phone, age, belt_level, address, centre, batch_timing, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [fn, ln, em, ph, ageValue, bl, ad, ce, bt, pu]
        );
      }
      console.log('Insert result:', JSON.stringify(result, null, 2));

      if (!result.insertId) {
        // Likely a race condition or driver didn't return insertId.
        // Attempt to fetch existing record and treat as success for idempotency.
        try {
          let existing = await query('SELECT * FROM admissions WHERE email = ? LIMIT 1', [em]);
          if (Array.isArray(existing) && existing.length > 0) {
            return res.status(201).json({
              ...existing[0],
              message: 'Admission Successful'
            });
          }
          existing = await query('SELECT * FROM admissions WHERE phone = ? LIMIT 1', [ph]);
          if (Array.isArray(existing) && existing.length > 0) {
            return res.status(201).json({
              ...existing[0],
              message: 'Admission Successful'
            });
          }
        } catch (lookupErr) {
          console.error('Lookup after insertId missing failed:', lookupErr);
        }
        return res.status(201).json({ message: 'Admission Successful' });
      }

      const [inserted] = await query('SELECT * FROM admissions WHERE id = ?', [result.insertId]);
      console.log('Retrieved inserted record:', JSON.stringify(inserted, null, 2));
    
    // Respond success without any email flow
    res.status(201).json({
      ...inserted,
      message: 'Admission Successful'
    });
    } catch (dbError) {
      console.error('Database error in admission submission:', {
        error: dbError,
        code: dbError.code,
        sqlMessage: dbError.sqlMessage,
        sql: dbError.sql
      });

      // Gracefully handle duplicate registration (idempotent behavior)
      const dup = (dbError && (
        dbError.code === '23505' || // PostgreSQL unique_violation
        dbError.code === 'ER_DUP_ENTRY' || // MySQL duplicate
        /duplicate key value/i.test(dbError.message || '') ||
        /Duplicate entry/i.test(dbError.sqlMessage || '')
      ));

      if (dup) {
        try {
          // Attempt idempotent success: fetch existing by email or phone
          let existing = await query('SELECT * FROM admissions WHERE email = ? LIMIT 1', [em]);
          if (Array.isArray(existing) && existing.length > 0) {
            return res.status(201).json({
              ...existing[0],
              message: 'Admission Successful'
            });
          }
          existing = await query('SELECT * FROM admissions WHERE phone = ? LIMIT 1', [ph]);
          if (Array.isArray(existing) && existing.length > 0) {
            return res.status(201).json({
              ...existing[0],
              message: 'Admission Successful'
            });
          }
          // If we couldn't find it, fall back to conflict message
          let conflict = 'email';
          const detail = String(dbError.detail || dbError.sqlMessage || '');
          if (/\bphone\b/i.test(detail)) conflict = 'phone';
          return res.status(201).json({ message: 'Admission Successful' });
        } catch (dupHandleErr) {
          console.error('Error handling duplicate admission gracefully:', dupHandleErr);
        }
      }

      // If not handled above, bubble up to outer error handler
      throw dbError; // This will be caught by the outer catch block
    }
  } catch (err) {
    console.error('POST /api/admissions error:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      sqlMessage: err.sqlMessage,
      sql: err.sql
    });
    
    // Idempotent success on duplicate errors even if they bubble here
    if (err.code === 'ER_DUP_ENTRY' || err.code === '23505' || (err.message && /duplicate key value/i.test(err.message))) {
      try {
        let existing = await query('SELECT * FROM admissions WHERE email = ? LIMIT 1', [em]);
        if (Array.isArray(existing) && existing.length > 0) {
          return res.status(201).json({
            ...existing[0],
            message: 'Admission Successful'
          });
        }
        existing = await query('SELECT * FROM admissions WHERE phone = ? LIMIT 1', [ph]);
        if (Array.isArray(existing) && existing.length > 0) {
          return res.status(201).json({
            ...existing[0],
            message: 'Admission Successful'
          });
        }
      } catch (_) {}
      return res.status(201).json({ message: 'Admission Successful' });
    }

    let errorMessage = 'Error creating admission';
    if (err.code === '22001' || (err.message && /value too long/i.test(err.message))) {
      errorMessage = 'Photo or text too large. Please upload a smaller image or shorten the field.';
    } else if (err.sqlMessage) {
      errorMessage = `Database error: ${err.sqlMessage}`;
    }

    const status = (err.code === '22001' || (err.message && /value too long/i.test(err.message))) ? 413 : 500;
    res.status(status).json({
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

app.delete('/api/admissions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM admissions WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Admission not found' });
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

// -------- Tournaments --------
app.get('/api/tournaments', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM tournaments ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/tournaments error', err);
    res.status(500).json({ message: 'Error fetching tournaments' });
  }
});

app.post('/api/tournaments', async (req, res) => {
  try {
    const { title, location, date, description } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: 'Title and date are required' });
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
      'INSERT INTO tournaments (title, location, date, description) VALUES (?, ?, ?, ?)',
      [title, location || '', formattedDate, description || '']
    );
    const inserted = await query('SELECT * FROM tournaments WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/tournaments error', err);
    res.status(500).json({ message: 'Error creating tournament' });
  }
});

app.put('/api/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, location, date, description } = req.body;
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'UPDATE tournaments SET title = ?, location = ?, date = ?, description = ? WHERE id = ?',
      [title, location || '', formattedDate, description || '', id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Tournament not found' });
    const updated = await query('SELECT * FROM tournaments WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/tournaments/:id error', err);
    res.status(500).json({ message: 'Error updating tournament' });
  }
});

app.delete('/api/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM tournaments WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Tournament not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tournaments/:id error', err);
    res.status(500).json({ message: 'Error deleting tournament' });
  }
});

// -------- Store Items --------
app.get('/api/store-items', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM store_items ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/store-items error', err);
    res.status(500).json({ message: 'Error fetching store items' });
  }
});

app.post('/api/store-items', async (req, res) => {
  try {
    const { name, price, description } = req.body;
    if (!name || price == null) {
      return res.status(400).json({ message: 'Name and price are required' });
    }
    const result = await query(
      'INSERT INTO store_items (name, price, description) VALUES (?, ?, ?)',
      [name, price, description || '']
    );
    const inserted = await query('SELECT * FROM store_items WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/store-items error', err);
    res.status(500).json({ message: 'Error creating store item' });
  }
});

app.put('/api/store-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, description } = req.body;
    const result = await query(
      'UPDATE store_items SET name = ?, price = ?, description = ? WHERE id = ?',
      [name, price, description || '', id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Store item not found' });
    const updated = await query('SELECT * FROM store_items WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/store-items/:id error', err);
    res.status(500).json({ message: 'Error updating store item' });
  }
});

app.delete('/api/store-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM store_items WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Store item not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/store-items/:id error', err);
    res.status(500).json({ message: 'Error deleting store item' });
  }
});

// -------- Exams --------
app.get('/api/exams', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM exams ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/exams error', err);
    res.status(500).json({ message: 'Error fetching exams' });
  }
});

app.post('/api/exams', async (req, res) => {
  try {
    const { title, grade_info, date, belt } = req.body;
    if (!title || !date || !belt) {
      return res.status(400).json({ message: 'Title, date, and belt are required' });
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
      'INSERT INTO exams (title, grade_info, date, belt) VALUES (?, ?, ?, ?)',
      [title, grade_info || '', formattedDate, belt]
    );
    const inserted = await query('SELECT * FROM exams WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/exams error', err);
    res.status(500).json({ message: 'Error creating exam' });
  }
});

app.put('/api/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, grade_info, date, belt } = req.body;
    
    // Format date for MySQL DATE column (YYYY-MM-DD)
    let formattedDate = date;
    if (date && typeof date === 'string') {
      // Handle ISO date strings like '1903-01-25T18:38:50.000Z'
      if (date.includes('T')) {
        formattedDate = date.split('T')[0];
      }
    }
    
    const result = await query(
      'UPDATE exams SET title = ?, grade_info = ?, date = ?, belt = ? WHERE id = ?',
      [title, grade_info, formattedDate, belt, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Exam not found' });
    const updated = await query('SELECT * FROM exams WHERE id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/exams/:id error', err);
    res.status(500).json({ message: 'Error updating exam' });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM exams WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Exam not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/exams/:id error', err);
    res.status(500).json({ message: 'Error deleting exam' });
  }
});

// -------- Announcements --------
app.get('/api/announcements', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM announcements ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/announcements error', err);
    res.status(500).json({ message: 'Error fetching announcements' });
  }
});

app.post('/api/announcements', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Text is required' });
    const result = await query('INSERT INTO announcements (text) VALUES (?)', [text]);
    const inserted = await query('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/announcements error', err);
    res.status(500).json({ message: 'Error creating announcement' });
  }
});

app.delete('/api/announcements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM announcements WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Announcement not found' });
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
    const result = await query(
      'INSERT INTO tournament_registrations (tournament_id, name, email, phone, centre, batch) VALUES (?, ?, ?, ?, ?, ?)',
      [tournament_id, name, email, phone, centre, batch]
    );
    const inserted = await query('SELECT tr.*, t.title as tournament_title FROM tournament_registrations tr JOIN tournaments t ON tr.tournament_id = t.id WHERE tr.id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/tournament-registrations error', err);
    res.status(500).json({ message: 'Error creating tournament registration' });
  }
});

app.get('/api/tournament-registrations', async (req, res) => {
  try {
    const result = await query('SELECT tr.*, t.title as tournament_title, t.date as tournament_date FROM tournament_registrations tr JOIN tournaments t ON tr.tournament_id = t.id ORDER BY tr.created_at DESC');
    res.json(result);
  } catch (err) {
    console.error('GET /api/tournament-registrations error', err);
    res.status(500).json({ message: 'Error fetching tournament registrations' });
  }
});

app.delete('/api/tournament-registrations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM tournament_registrations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Registration not found' });
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
    const result = await query(
      'INSERT INTO store_orders (store_item_id, name, email, phone, centre, batch, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [store_item_id, name, email, phone, centre, batch, quantity]
    );
    const inserted = await query('SELECT so.*, si.name as item_name, si.price as item_price FROM store_orders so JOIN store_items si ON so.store_item_id = si.id WHERE so.id = ?', [result.insertId]);
    res.status(201).json(inserted[0]);
  } catch (err) {
    console.error('POST /api/store-orders error', err);
    res.status(500).json({ message: 'Error creating store order' });
  }
});

app.get('/api/store-orders', async (req, res) => {
  try {
    const result = await query('SELECT so.*, si.name as item_name, si.price as item_price, (so.quantity * si.price) as total_price FROM store_orders so JOIN store_items si ON so.store_item_id = si.id ORDER BY so.created_at DESC');
    res.json(result);
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
    const result = await query('UPDATE store_orders SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });
    const updated = await query('SELECT so.*, si.name as item_name, si.price as item_price, (so.quantity * si.price) as total_price FROM store_orders so JOIN store_items si ON so.store_item_id = si.id WHERE so.id = ?', [id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('PUT /api/store-orders/:id error', err);
    res.status(500).json({ message: 'Error updating order status' });
  }
});

app.delete('/api/store-orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM store_orders WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Order not found' });
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
      const [
        instructors,
        batches,
        admissions,
        payments,
        tournaments,
        storeItems,
        exams,
        announcements,
        attendance
      ] = await Promise.all([
        query('SELECT COUNT(*) as count FROM instructors'),
        query('SELECT COUNT(*) as count FROM batches'),
        query('SELECT COUNT(*) as count FROM admissions'),
        query('SELECT COUNT(*) as count FROM payments'),
        query('SELECT COUNT(*) as count FROM tournaments'),
        query('SELECT COUNT(*) as count FROM store_items'),
        query('SELECT COUNT(*) as count FROM exams'),
        query('SELECT COUNT(*) as count FROM announcements'),
        query('SELECT COUNT(*) as count FROM attendance')
      ]);

      return {
        totalInstructors: instructors[0].count || 0,
        totalBatches: batches[0].count || 0,
        totalAdmissions: admissions[0].count || 0,
        totalPayments: payments[0].count || 0,
        totalTournaments: tournaments[0].count || 0,
        totalStoreItems: storeItems[0].count || 0,
        totalExams: exams[0].count || 0,
        totalAnnouncements: announcements[0].count || 0,
        totalAttendance: attendance[0].count || 0
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

// -------- Authentication --------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const normEmail = String(email || '').trim().toLowerCase();

    if (!normEmail || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }
    
    if (role === 'admin') {
      // Hardcoded admin credentials (in production, use proper authentication)
      if (normEmail === 'karatesubhash455@gmail.com' && password === 'karate@123') {
        const token = jwt.sign(
          { email, role: 'admin', name: 'Admin' },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        res.json({
          success: true,
          token,
          user: { email, role: 'admin', name: 'Admin' },
          message: 'Admin login successful'
        });
      } else {
        res.status(401).json({ message: 'Invalid admin credentials' });
      }
    } else if (role === 'student') {
      // Check if student exists in student_registrations table with verified email
      const students = await query('SELECT * FROM student_registrations WHERE email = ? AND email_verified = TRUE', [normEmail]);
      
      if (students.length === 0) {
        return res.status(401).json({ message: 'Student not found or email not verified. Please register first.' });
      }
      
      const student = students[0];
      
      // Check batch-based password
      const expectedPassword = `karate@${student.batch}`;
      if (password === expectedPassword) {
        const token = jwt.sign(
          { 
            email: student.email, 
            role: 'student', 
            name: `${student.first_name} ${student.last_name}`,
            studentId: student.id,
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
            name: `${student.first_name} ${student.last_name}`,
            studentId: student.id,
            batch: student.batch
          },
          message: 'Student login successful'
        });
      } else {
        res.status(401).json({ message: 'Invalid password. Use: karate@' + student.batch });
      }
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
app.post('/api/delete-student-registration', async (req, res) => {
  try {
    const { email } = req.body;
    const e = String(email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ message: 'Email required' });
    
    await query('DELETE FROM student_registrations WHERE email = ?', [e]);
    res.json({ message: 'Registration deleted for: ' + e });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Error deleting registration' });
  }
});

// -------- Student Registration --------
app.post('/api/student-register', async (req, res) => {
  // Set timeout for this request
  req.setTimeout(30000);
  
  try {
    console.log('📝 Student registration request received:', req.body);
    
    const { firstName, lastName, email, phone, batch } = req.body;
    const f = String(firstName || '').trim();
    const l = String(lastName || '').trim();
    const e = String(email || '').trim().toLowerCase();
    const p = String(phone || '').replace(/\D/g, '');
    const b = String(batch || '').trim();

    console.log('📝 Parsed values:', { f, l, e, p, b, dbType: module.exports.dbType });

    if (!f || !l || !e || !p || !b) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Generate verification token
    const verificationToken = uuidv4();
    console.log('📝 Generated verification token:', verificationToken);
    
    // Check if email already exists
    console.log('📝 Checking for existing email:', e);
    const existing = await query('SELECT * FROM student_registrations WHERE email = ?', [e]);
    console.log('📝 Existing check result:', existing.length, 'records found');
    
    let studentId;
    if (existing.length > 0) {
      const existingStudent = existing[0];
      if (existingStudent.email_verified) {
        return res.status(409).json({ message: 'Email already registered. Please login instead.' });
      }
      // Update existing unverified record
      await query(
        module.exports.dbType === 'sqlite' 
          ? 'UPDATE student_registrations SET first_name = ?, last_name = ?, phone = ?, batch = ?, verification_token = ?, verification_sent_at = datetime("now") WHERE id = ?'
          : 'UPDATE student_registrations SET first_name = ?, last_name = ?, phone = ?, batch = ?, verification_token = ?, verification_sent_at = NOW() WHERE id = ?',
        [f, l, p, b, verificationToken, existingStudent.id]
      );
      studentId = existingStudent.id;
    } else {
      // Insert new student registration
      const result = await query(
        module.exports.dbType === 'sqlite'
          ? 'INSERT INTO student_registrations (first_name, last_name, email, phone, batch, email_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"))'
          : 'INSERT INTO student_registrations (first_name, last_name, email, phone, batch, email_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [f, l, e, p, b, false, verificationToken]
      );
      studentId = result.insertId;
    }
    
    const inserted = await query('SELECT * FROM student_registrations WHERE id = ?', [studentId]);
    
    // Send verification email (non-blocking with timeout)
    const verificationLink = `${req.protocol}://${req.get('host')}/verify-student-email?token=${verificationToken}&email=${encodeURIComponent(e)}`;
    const mailOptions = {
      to: e,
      from: EMAIL_USER,
      subject: 'Verify your Student Account - WTSKF-GOA',
      html: `
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Welcome to WTSKF-GOA Karate!</h2>
          <p>Hello ${f} ${l},</p>
          <p>Thank you for registering. Please verify your email by clicking the link below:</p>
          <p><a href="${verificationLink}" style="padding: 10px 20px; background: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
          <p>Or copy this link: ${verificationLink}</p>
          <p>Your login details will be sent after verification.</p>
        </body>
        </html>
      `
    };
    
    // Send email synchronously - wait for confirmation
    let emailSent = false;
    let emailError = null;
    try {
      console.log('📧 Sending email to:', e);
      await sendMail(mailOptions);
      emailSent = true;
      console.log('✅ Email SENT SUCCESSFULLY to:', e);
    } catch (err) {
      emailError = err.message;
      console.error('❌ Email FAILED:', err.message);
    }
    
    // Return response with email status
    res.status(201).json({
      ...inserted[0],
      emailSent: emailSent,
      emailError: emailError,
      message: emailSent 
        ? 'Registration successful! Please check your email to verify your account.'
        : 'Registration saved but email failed to send. Please contact support.'
    });
  } catch (err) {
    console.error('POST /api/student-register error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ message: 'Error creating student registration: ' + err.message });
  }
});

// Resend verification email endpoint
app.post('/api/resend-student-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email required' });

  try {
    const students = await query('SELECT * FROM student_registrations WHERE email = ?', [email]);
    if (students.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const student = students[0];
    if (student.email_verified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new token
    const verificationToken = uuidv4();
    await query('UPDATE student_registrations SET verification_token = ?, verification_sent_at = NOW() WHERE id = ?', [verificationToken, student.id]);

    // Send email
    const verificationLink = `${req.protocol}://${req.get('host')}/verify-student-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const mailOptions = {
      to: email,
      from: EMAIL_USER,
      subject: 'Resend: Verify your Student Account - WTSKF-GOA',
      html: `
        <html>
        <body>
          <h2>Resend: Verify Your Student Account</h2>
          <p>Hi ${student.first_name} ${student.last_name},</p>
          <p>Please verify your account.</p>
          <p>Your login details:</p>
          <ul>
            <li>Email: ${email}</li>
            <li>Password: karate@${student.batch}</li>
          </ul>
          <p>Click here to verify your account: <a href="${verificationLink}">Verify Account</a></p>
          <p>This link expires in 24 hours.</p>
          <p>If you didn't register, ignore this email.</p>
        </body>
        </html>
      `
    };
    sendMail(mailOptions).then(() => {
      console.log('Resend verification email sent to:', email);
    }).catch((emailError) => {
      console.error('Error sending resend verification email:', emailError);
    });

    res.json({ message: 'Verification link resent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ message: 'Error resending verification' });
  }
});

// Test email endpoint - auto sends to test address
app.post('/api/test-email', async (req, res) => {
  const testEmail = req.body.to || 'jiyahaldnakar777@gmail.com';
  
  console.log('🧪 TEST EMAIL: Sending to', testEmail);
  console.log('🧪 EMAIL_USER:', EMAIL_USER);
  console.log('🧪 Gmail transporter exists:', !!gmailTransporter);
  
  const mailOptions = {
    to: testEmail,
    from: EMAIL_USER,
    subject: 'URGENT TEST - WTSKF-GOA Registration',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff;">
        <h2 style="color: #d4af37;">TEST EMAIL - PLEASE IGNORE</h2>
        <p>This is a test email sent at: ${new Date().toISOString()}</p>
        <p>If you received this, the email system is working!</p>
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
    if (!gmailTransporter) {
      throw new Error('Gmail transporter not configured - check EMAIL_USER and EMAIL_PASS');
    }
    
    console.log('🧪 Using Gmail SMTP to send...');
    const info = await gmailTransporter.sendMail({
      from: `"WTSKF-GOA Test" <${EMAIL_USER}>`,
      to: testEmail,
      subject: 'URGENT TEST - WTSKF-GOA Registration System',
      html: mailOptions.html
    });
    
    console.log('🧪 TEST EMAIL SENT SUCCESS:', info);
    res.json({ 
      success: true, 
      message: 'Test email sent successfully', 
      messageId: info.messageId,
      to: testEmail,
      from: EMAIL_USER
    });
  } catch (err) {
    console.error('🧪 TEST EMAIL FAILED:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to send test email', 
      error: err.message,
      details: err.toString()
    });
  }
});

// Student email verification endpoint
app.get('/verify-student-email', async (req, res) => {
  try {
    const { token, email } = req.query;
    
    if (!token || !email) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
            <h2 style="color: #d4af37;">Invalid Verification Link</h2>
            <p>The verification link is invalid or missing required parameters.</p>
            <a href="/" style="color: #d4af37;">Return to Home</a>
          </body>
        </html>
      `);
    }
    
    const students = await query('SELECT * FROM student_registrations WHERE email = ? AND verification_token = ?', [email, token]);
    
    if (students.length === 0) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
            <h2 style="color: #e74c3c;">Verification Failed</h2>
            <p>Invalid or expired verification link.</p>
            <a href="/" style="color: #d4af37;">Return to Home</a>
          </body>
        </html>
      `);
    }
    
    const student = students[0];
    
    if (student.email_verified) {
      return res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
            <h2 style="color: #d4af37;">Already Verified</h2>
            <p>Your email has already been verified.</p>
            <a href="/" style="color: #d4af37;">Return to Home</a>
          </body>
        </html>
      `);
    }
    
    await query('UPDATE student_registrations SET email_verified = TRUE, verification_token = NULL WHERE id = ?', [student.id]);
    
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
          <div style="max-width: 600px; margin: 0 auto;">
            <h2 style="color: #27ae60; margin-bottom: 20px;">✅ Student Account Verified Successfully!</h2>
            <p style="font-size: 18px; margin-bottom: 30px;">Welcome to WTSKF-GOA, ${student.first_name}!</p>
            <p style="color: #ddd; margin-bottom: 30px;">Your student account is now active. You can log in to your dashboard using:</p>
            <div style="background: rgba(212,175,55,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left;">
              <p style="color: #fff; margin: 10px 0;"><strong>Email:</strong> ${student.email}</p>
              <p style="color: #fff; margin: 10px 0;"><strong>Password:</strong> karate@${student.batch}</p>
            </div>
            <a href="/" style="background: linear-gradient(135deg, #d4af37, #f4e4bc); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Go to Login
            </a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Student email verification error:', err);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
          <h2 style="color: #e74c3c;">Verification Error</h2>
          <p>An error occurred during email verification. Please try again or contact support.</p>
          <a href="/" style="color: #d4af37;">Return to Home</a>
        </body>
      </html>
    `);
  }
});

// -------- Create Student Table --------
app.get('/api/create-student-table', async (req, res) => {
  try {
    await query(`
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
    res.json({ message: 'Student registrations table created successfully' });
  } catch (err) {
    console.error('Error creating student table:', err);
    res.status(500).json({ message: 'Error creating student table' });
  }
});

// Fallback: send index.html for any unknown route (SPA-style)
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    await query('SELECT 1');
    dbOk = true;
  } catch (_) {
    dbOk = false;
  }
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Karate admin backend running on http://0.0.0.0:${PORT}`);
});
