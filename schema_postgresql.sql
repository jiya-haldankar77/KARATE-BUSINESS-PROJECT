-- PostgreSQL Schema for kartae database used by WTSKF-GOA admin panel

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Instructors
CREATE TABLE IF NOT EXISTS instructors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  rank VARCHAR(100),
  photo_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Batches
CREATE TABLE IF NOT EXISTS batches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  timing VARCHAR(255),
  centre VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_batch_name ON batches(name);
-- Seed default batches
INSERT INTO batches (name, description, timing, centre)
VALUES
  ('Batch 1', 'Tue, Thu, Sat batch', 'Tue, Thu, Sat (4:30 PM - 6:00 PM)', 'ST.CRUZ'),
  ('Batch 2', 'Tue, Thu, Sat batch', 'Tue, Thu, Sat (6:00 PM - 8:00 PM)', 'ST.CRUZ'),
  ('Batch 3', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (4:30 PM - 6:00 PM)', 'ST.CRUZ'),
  ('Batch 4', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (6:00 PM - 8:00 PM)', 'ST.CRUZ'),
  ('Batch A1', 'Mon, Wed, Fri batch', 'Mon, Wed, Fri (6:00 PM - 8:00 PM)', 'GUIRIM')
ON CONFLICT (name) DO NOTHING;

-- Admissions (from admission form)
CREATE TABLE IF NOT EXISTS admissions (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  age INTEGER,
  belt_level VARCHAR(50),
  address VARCHAR(500),
  centre VARCHAR(255),
  batch_timing VARCHAR(255),
  photo_url TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_admissions_email ON admissions(email);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_admissions_phone ON admissions(phone);

-- Fees Payments (for payment screenshot submissions)
CREATE TABLE IF NOT EXISTS fees_payments (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  batch_name VARCHAR(100) NOT NULL,
  centre VARCHAR(100) NOT NULL,
  payment_datetime TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL,
  txn_id VARCHAR(64),
  amount DECIMAL(10,2),
  img_hash VARCHAR(64),
  screenshot_base64 TEXT,
  validation_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_txn_id ON fees_payments(txn_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_img_hash ON fees_payments(img_hash);
CREATE INDEX IF NOT EXISTS idx_fees_phone ON fees_payments(phone);
CREATE INDEX IF NOT EXISTS idx_fees_batch ON fees_payments(batch_name);
CREATE INDEX IF NOT EXISTS idx_fees_centre ON fees_payments(centre);
CREATE INDEX IF NOT EXISTS idx_fees_status ON fees_payments(status);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  student_name VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Paid', 'Pending', 'Overdue')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  date DATE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store items (dojo shop)
CREATE TABLE IF NOT EXISTS store_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Exams
CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  grade_info TEXT,
  date DATE NOT NULL,
  belt VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  student_name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('Present', 'Absent', 'Late')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournament Registrations
CREATE TABLE IF NOT EXISTS tournament_registrations (
  id SERIAL PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  centre VARCHAR(255) NOT NULL,
  batch VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Exam Registrations
CREATE TABLE IF NOT EXISTS exam_registrations (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  centre VARCHAR(255) NOT NULL,
  batch VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store Item Orders
CREATE TABLE IF NOT EXISTS store_orders (
  id SERIAL PRIMARY KEY,
  store_item_id INTEGER NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  centre VARCHAR(255) NOT NULL,
  batch VARCHAR(255) NOT NULL,
  quantity INTEGER DEFAULT 1,
  status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Delivered')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student Registrations (for student dashboard login)
CREATE TABLE IF NOT EXISTS student_registrations (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(50) NOT NULL,
  batch VARCHAR(20) NOT NULL CHECK (batch IN ('batch1', 'batch2', 'batch3', 'batch4', 'batchA1')),
  email_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_student_registrations_email ON student_registrations(email);
CREATE INDEX IF NOT EXISTS idx_student_registrations_token ON student_registrations(verification_token);
