require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

console.log('🔍 Debug POST request...');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

const app = express();
app.use(express.json());

// MySQL connection
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kartae',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const query = async (sql, params) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

app.post('/debug-admissions', async (req, res) => {
  try {
    console.log('📥 Request body:', req.body);
    
    const { first_name, last_name, email, phone, age, belt_level, address, photo_url } = req.body;
    
    console.log('🔍 Validation check:');
    console.log('first_name:', first_name);
    console.log('email:', email);
    console.log('first_name valid:', !!first_name);
    console.log('email valid:', !!email);
    
    if (!first_name || !email) {
      console.log('❌ Validation failed');
      return res.status(400).json({ message: 'Name and email are required' });
    }
    
    console.log('✅ Validation passed');
    
    // Generate verification token
    const verificationToken = uuidv4();
    console.log('🔑 Generated token:', verificationToken);
    
    console.log('💾 Inserting into database...');
    const result = await query(
      'INSERT INTO admissions (first_name, last_name, email, phone, age, belt_level, address, photo_url, email_verified, verification_token, verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [first_name, last_name || '', email, phone || '', age || '', belt_level || '', address || '', photo_url || '', false, verificationToken]
    );
    
    console.log('✅ Database insert successful');
    console.log('📊 Result:', result);
    
    const inserted = await query('SELECT * FROM admissions WHERE id = ?', [result.insertId]);
    console.log('📬 Inserted record:', inserted[0]);
    
    res.status(201).json({
      ...inserted[0],
      message: 'Registration successful! Please check your email to verify your account.'
    });
    
  } catch (err) {
    console.error('❌ Error in POST request:', err);
    res.status(500).json({ message: 'Error creating admission', error: err.message });
  }
});

app.listen(3001, () => {
  console.log('🚀 Debug server running on http://localhost:3001');
  console.log('🧪 Test with: curl -X POST http://localhost:3001/debug-admissions -H "Content-Type: application/json" -d \'{"first_name":"Test","email":"test@example.com"}\'');
});
