require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
let ExcelJS;
try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Core middleware must be registered before routes
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/files', express.static(path.join(__dirname, 'data')));

// -------- Excel helpers for Fees Payments --------
const DATA_DIR = path.join(__dirname, 'data');
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

// Force load Gmail credentials - HARDCODED WORKING CREDENTIALS
const EMAIL_USER = process.env.EMAIL_USER || 'karatesubhash455@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'dfym cxhq ljfi rkib';

console.log('📧 Email configuration:');
console.log('EMAIL_USER:', EMAIL_USER);
console.log('EMAIL_PASS configured:', !!EMAIL_PASS);

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

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

// Initialize database tables
async function initializeDatabase() {
  const connection = await pool.getConnection();
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
        email_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        verification_sent_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    // Admissions hardening: dedupe and unique constraints
    try {
      await connection.query(`
        DELETE a1 FROM admissions a1
        INNER JOIN admissions a2
          ON a1.email = a2.email
         AND a1.id > a2.id
      `);
    } catch (e) {}

    try {
      await connection.query(`
        DELETE a1 FROM admissions a1
        INNER JOIN admissions a2
          ON a1.phone = a2.phone
         AND a1.id > a2.id
      `);
    } catch (e) {}

    try { await connection.query('ALTER TABLE admissions MODIFY COLUMN photo_url LONGTEXT'); } catch (e) {}
    try { await connection.query('ALTER TABLE admissions ADD UNIQUE KEY uniq_admissions_email (email)'); } catch (e) {}
    try { await connection.query('ALTER TABLE admissions ADD UNIQUE KEY uniq_admissions_phone (phone)'); } catch (e) {}

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
        email VARCHAR(255) NOT NULL UNIQUE,
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

// Query function for MySQL
async function query(sql, params) {
  const connection = await pool.getConnection();
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
    
    // Generate verification token
    const verificationToken = uuidv4();
    
    // Convert empty strings to NULL for numeric fields
    const ageValue = ag;
    
    try {
      console.log('Attempting to insert into database...');
      const result = await query(
        'INSERT INTO admissions (first_name, last_name, email, phone, age, belt_level, address, centre, batch_timing, photo_url, email_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [fn, ln, em, ph, ageValue, bl, ad, ce, bt, pu, false, verificationToken]
      );
      console.log('Insert result:', JSON.stringify(result, null, 2));
      
      const [inserted] = await query('SELECT * FROM admissions WHERE id = ?', [result.insertId]);
      console.log('Retrieved inserted record:', JSON.stringify(inserted, null, 2));
    
    // Send verification email
    try {
      const verificationLink = `${req.protocol}://${req.get('host')}/verify-email?token=${verificationToken}&email=${encodeURIComponent(em)}`;
      
      const mailOptions = {
        to: em,
        from: EMAIL_USER,
        subject: 'Verify your email - WTSKF-GOA Registration',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #d4af37; margin: 0;">WTSKF-GOA</h2>
              <p style="color: #fff; margin: 5px 0;">World Traditional Shotokan Karate Federation - Goa</p>
            </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; border: 1px solid rgba(212,175,55,0.3);">
              <h3 style="color: #fff; margin-top: 0;">Verify Your Email Address</h3>
              
              <p style="color: #ddd; line-height: 1.6;">Hi ${fn},</p>
              
              <p style="color: #ddd; line-height: 1.6;">Thank you for registering with WTSKF-GOA! Please click the button below to verify your email address and complete your registration.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationLink}" style="background: linear-gradient(135deg, #d4af37, #f4e4bc); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                  Verify Email Address
                </a>
              </div>
              
              <p style="color: #aaa; font-size: 14px; text-align: center;">Or copy and paste this link into your browser:</p>
              <p style="color: #aaa; font-size: 12px; word-break: break-all; text-align: center;">${verificationLink}</p>
              
              <div style="background: rgba(212,175,55,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d4af37;">
                <h4 style="color: #d4af37; margin-top: 0;">Registration Details:</h4>
                <ul style="color: #fff; list-style: none; padding: 0;">
                  <li><strong>Name:</strong> ${fn}</li>
                  <li><strong>Email:</strong> ${em}</li>
                  <li><strong>Status:</strong> Awaiting Verification</li>
                </ul>
              </div>
              
              <p style="color: #ddd; line-height: 1.6;">This verification link will expire in 24 hours. If you didn't register for WTSKF-GOA, please ignore this email.</p>
              
              <div style="text-align: center; margin-top: 30px;">
                <p style="color: #d4af37; font-weight: bold; margin-bottom: 10px;">Questions? Contact Us</p>
                <p style="color: #ddd; margin: 5px 0;">📧 Email: info@wtskf-goa.com</p>
                <p style="color: #ddd; margin: 5px 0;">📞 Phone: +91 98765 43210</p>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #aaa; font-size: 12px; margin: 0;">© 2024 WTSKF-GOA. All rights reserved.</p>
              <p style="color: #aaa; font-size: 12px; margin: 5px 0;">Master the Art of Karate</p>
            </div>
          </div>
        `
      };
      
      // Use Gmail/nodemailer since SendGrid is not configured
      await transporter.sendMail(mailOptions);
      console.log('Verification email sent via Gmail to:', email);
    } catch (emailError) {
      console.error('Error sending verification email:', emailError);
      // Don't fail the registration if email fails
    }
    
      res.status(201).json({
        ...inserted,
        message: 'Registration successful! Please check your email to verify your account.'
      });
    } catch (dbError) {
      console.error('Database error in admission submission:', {
        error: dbError,
        code: dbError.code,
        sqlMessage: dbError.sqlMessage,
        sql: dbError.sql
      });
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
    
    let errorMessage = 'Error creating admission';
    if (err.code === 'ER_DUP_ENTRY') {
      errorMessage = 'This email or phone number is already registered.';
    } else if (err.sqlMessage) {
      errorMessage = `Database error: ${err.sqlMessage}`;
    }
    
    res.status(500).json({ 
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

// Email verification endpoint
app.get('/verify-email', async (req, res) => {
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
    
    // Find the admission record with the verification token
    const admissions = await query('SELECT * FROM admissions WHERE email = ? AND verification_token = ?', [email, token]);
    
    if (admissions.length === 0) {
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
    
    const admission = admissions[0];
    
    // Check if already verified
    if (admission.email_verified) {
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
    
    // Mark email as verified
    await query('UPDATE admissions SET email_verified = TRUE, verification_token = NULL WHERE id = ?', [admission.id]);
    
    // Send welcome email
    try {
      const welcomeMailOptions = {
        to: email,
        from: EMAIL_USER,
        subject: 'Welcome to WTSKF-GOA - Registration Complete!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #d4af37; margin: 0;">WTSKF-GOA</h2>
              <p style="color: #fff; margin: 5px 0;">World Traditional Shotokan Karate Federation - Goa</p>
            </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; border: 1px solid rgba(212,175,55,0.3);">
              <h3 style="color: #fff; margin-top: 0;">Welcome to the Dojo, ${admission.first_name}!</h3>
              
              <p style="color: #27ae60; font-weight: bold; text-align: center;">✅ Your email has been successfully verified!</p>
              
              <p style="color: #ddd; line-height: 1.6;">Thank you for registering with WTSKF-GOA. Your registration is now complete and our team will contact you within 24-48 hours.</p>
              
              <div style="background: rgba(212,175,55,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d4af37;">
                <h4 style="color: #d4af37; margin-top: 0;">What's Next?</h4>
                <ul style="color: #ddd; line-height: 1.6;">
                  <li>📞 Our team will call you to schedule your first trial class</li>
                  <li>👕 Please bring comfortable workout clothes for your first session</li>
                  <li>🥋 Our instructors will assess your skill level and place you in the appropriate batch</li>
                  <li>📚 You'll receive information about class schedules and fees</li>
                </ul>
              </div>
              
              <div style="text-align: center; margin-top: 30px;">
                <p style="color: #d4af37; font-weight: bold; margin-bottom: 10px;">Contact Information</p>
                <p style="color: #ddd; margin: 5px 0;">📧 Email: info@wtskf-goa.com</p>
                <p style="color: #ddd; margin: 5px 0;">📞 Phone: +91 98765 43210</p>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #aaa; font-size: 12px; margin: 0;">© 2024 WTSKF-GOA. All rights reserved.</p>
              <p style="color: #aaa; font-size: 12px; margin: 5px 0;">Master the Art of Karate</p>
            </div>
          </div>
        `
      };
      
      await transporter.sendMail(welcomeMailOptions);
    } catch (welcomeEmailError) {
      console.error('Error sending welcome email:', welcomeEmailError);
    }
    
    // Show success page
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; background: #1a1a1a; color: #fff; text-align: center; padding: 50px;">
          <div style="max-width: 600px; margin: 0 auto;">
            <h2 style="color: #27ae60; margin-bottom: 20px;">✅ Email Verified Successfully!</h2>
            <p style="font-size: 18px; margin-bottom: 30px;">Welcome to WTSKF-GOA, ${admission.first_name}!</p>
            <p style="color: #ddd; margin-bottom: 30px;">Your registration is now complete. Our team will contact you within 24-48 hours to schedule your first trial class.</p>
            <a href="/" style="background: linear-gradient(135deg, #d4af37, #f4e4bc); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Go to Homepage
            </a>
          </div>
        </body>
      </html>
    `);
    
  } catch (err) {
    console.error('Email verification error:', err);
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

// -------- Student Registration --------
app.post('/api/student-register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, batch } = req.body;
    const f = String(firstName || '').trim();
    const l = String(lastName || '').trim();
    const e = String(email || '').trim().toLowerCase();
    const p = String(phone || '').replace(/\D/g, '');
    const b = String(batch || '').trim();

    if (!f || !l || !e || !p || !b) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    // Check if student already exists
    const existingStudents = await query('SELECT * FROM student_registrations WHERE email = ?', [e]);
    if (existingStudents.length > 0) {
      return res.status(400).json({ message: 'Student with this email already exists' });
    }
    
    // Generate verification token
    const verificationToken = uuidv4();
    
    // Insert student registration
    const result = await query(
      'INSERT INTO student_registrations (first_name, last_name, email, phone, batch, email_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [f, l, e, p, b, false, verificationToken]
    );
    
    const inserted = await query('SELECT * FROM student_registrations WHERE id = ?', [result.insertId]);
    
    // Send verification email
    try {
      const verificationLink = `${req.protocol}://${req.get('host')}/verify-student-email?token=${verificationToken}&email=${encodeURIComponent(e)}`;
      
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
              
              <p style="color: #ddd; line-height: 1.6;">Hi ${f} ${l},</p>
              
              <p style="color: #ddd; line-height: 1.6;">Thank you for registering as a student with WTSKF-GOA! Please click the button below to verify your email address and activate your account.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationLink}" style="background: linear-gradient(135deg, #d4af37, #f4e4bc); color: #000; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                  Verify Student Account
                </a>
              </div>
              
              <p style="color: #aaa; font-size: 14px; text-align: center;">Or copy and paste this link into your browser:</p>
              <p style="color: #aaa; font-size: 12px; word-break: break-all; text-align: center;">${verificationLink}</p>
              
              <div style="background: rgba(212,175,55,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d4af37;">
                <h4 style="color: #d4af37; margin-top: 0;">Your Login Details:</h4>
                <ul style="color: #fff; list-style: none; padding: 0;">
                  <li><strong>Name:</strong> ${f} ${l}</li>
                  <li><strong>Email:</strong> ${e}</li>
                  <li><strong>Batch:</strong> ${b}</li>
                  <li><strong>Password:</strong> karate@${b}</li>
                </ul>
              </div>
              
              <p style="color: #ddd; line-height: 1.6;">This verification link will expire in 24 hours. If you didn't register for WTSKF-GOA, please ignore this email.</p>
              
              <div style="text-align: center; margin-top: 30px;">
                <p style="color: #d4af37; font-weight: bold; margin-bottom: 10px;">Questions? Contact Us</p>
                <p style="color: #ddd; margin: 5px 0;">📧 Email: info@wtskf-goa.com</p>
                <p style="color: #ddd; margin: 5px 0;">📞 Phone: +91 98765 43210</p>
              </div>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #aaa; font-size: 12px; margin: 0;">© 2024 WTSKF-GOA. All rights reserved.</p>
              <p style="color: #aaa; font-size: 12px; margin: 5px 0;">Master the Art of Karate</p>
            </div>
          </div>
        `
      };
      
      await transporter.sendMail(mailOptions);
      console.log('Student verification email sent to:', email);
    } catch (emailError) {
      console.error('Error sending student verification email:', emailError);
    }
    
    res.status(201).json({
      ...inserted[0],
      message: 'Registration successful! Please check your email to verify your account.'
    });
  } catch (err) {
    console.error('POST /api/student-register error:', err);
    res.status(500).json({ message: 'Error creating student registration' });
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
        email VARCHAR(255) NOT NULL UNIQUE,
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
  try {
    await query('SELECT 1');
    const redisOk = !!(redisClient && redisClient.isOpen);
    res.json({ status: 'ok', db: true, redis: redisOk });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Karate admin backend running on http://localhost:${PORT}`);
});
