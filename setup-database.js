const { Pool } = require('pg');
require('dotenv').config();

async function setupDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Read and execute schema
    const fs = require('fs');
    const schema = fs.readFileSync('./schema_postgresql.sql', 'utf8');
    
    await pool.query(schema);
    console.log('Database schema created successfully!');
    
    // Create admin user
    await pool.query(`
      INSERT INTO users (username, email, password, role) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['admin', 'admin@karate.com', '$2a$10$placeholder_hash', 'admin']);
    
    console.log('Admin user created!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

setupDatabase();
