# KARATE BUSINESS PROJECT

A comprehensive backend server for WTSKF-GOA (World Traditional Shotokan Karate Federation - Goa) admin panel with MySQL database integration.

## 🥋 Overview

This project provides a complete administrative system for managing karate business operations including student management, attendance tracking, billing, and communication features. The system is built with Node.js, Express, and MySQL, optimized for 100+ concurrent users with Redis caching and performance optimizations.

## 🚀 Features

- **User Authentication**: Secure JWT-based authentication with rate limiting
- **Student Management**: Complete CRUD operations for student data
- **Dashboard Analytics**: Real-time admin and student dashboards
- **Email Notifications**: Automated email system using SendGrid and Nodemailer
- **Performance Optimized**: Redis caching, connection pooling, and rate limiting
- **Production Ready**: PM2 cluster mode for multi-core utilization
- **Security**: Rate limiting, bcrypt password hashing, JWT tokens

## 🛠️ Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MySQL2** - Database driver with connection pooling
- **Redis** - Caching and session storage
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing
- **PM2** - Process management

### Communication
- **Nodemailer** - Email sending
- **SendGrid** - Email service provider
- **UUID** - Unique identifier generation

### Security & Performance
- **express-rate-limit** - API rate limiting
- **cors** - Cross-origin resource sharing
- **dotenv** - Environment variable management

## 📁 Project Structure

```
karate/
├── server.js              # Main application server
├── package.json           # Dependencies and scripts
├── ecosystem.config.json  # PM2 configuration
├── .env                   # Environment variables
├── .env.example           # Environment variables template
├── schema.sql             # Database schema
├── add_student_table.sql  # Student table setup
├── index.html             # Frontend interface
├── test-login.html        # Login testing page
├── test-email.js          # Email testing script
├── test-email-jiya.js     # Email testing (Jiya's config)
├── debug-post.js          # Debug utility
├── DEPLOYMENT.md          # Deployment guide
├── README.md              # This file
├── logs/                  # PM2 log files
└── node_modules/          # Dependencies
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- MySQL Server
- Redis Server
- Git

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/jiya-haldankar77/KARATE-BUSINESS-PROJECT.git
cd KARATE-BUSINESS-PROJECT
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Set up the database**
```bash
# Import the database schema
mysql -u root -p < schema.sql
mysql -u root -p < add_student_table.sql
```

5. **Install and start Redis**
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis
```

6. **Start the application**
```bash
# Development mode
npm start

# Production mode (recommended)
npm install -g pm2
pm2 start ecosystem.config.json
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=kartae

# Redis Configuration
REDIS_URL=redis://localhost:6379

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-2024

# Email Configuration (SendGrid)
SENDGRID_API_KEY=your_sendgrid_api_key
EMAIL_FROM=your-email@example.com

# Other Configuration
NODE_ENV=production
```

## 📊 Database Schema

The application uses a MySQL database with the following main tables:

- **Users**: Admin and user authentication
- **Students**: Student information and details
- **Attendance**: Attendance records
- **Payments**: Billing and payment history
- **Classes**: Class schedules and information

## 🔧 API Endpoints

### Authentication
- `POST /api/login` - User login
- `POST /api/logout` - User logout

### Dashboard
- `GET /api/dashboard/admin` - Admin dashboard data
- `GET /api/dashboard/student` - Student dashboard data

### Students
- `GET /api/students` - Get all students
- `POST /api/students` - Create new student
- `PUT /api/students/:id` - Update student
- `DELETE /api/students/:id` - Delete student

### Email
- `POST /api/send-email` - Send email notifications

## 🚀 Deployment

For production deployment, follow the detailed guide in [DEPLOYMENT.md](./DEPLOYMENT.md).

### Production Setup Summary

1. **Install Redis** for caching
2. **Configure environment variables** for production
3. **Start with PM2** in cluster mode
4. **Set up monitoring** and logging
5. **Configure backup** strategies

## 📈 Performance

The application is optimized for:

- **100+ concurrent users**
- **1000+ requests per second**
- **Redis caching** with 5-10 minute TTL
- **Database connection pooling** (10 max connections)
- **Rate limiting** (100 requests/15min general, 5 requests/15min auth)

## 🔒 Security Features

- **JWT Authentication** with secure tokens
- **Rate Limiting** to prevent abuse
- **bcrypt Password Hashing** for secure storage
- **CORS Configuration** for cross-origin requests
- **Environment Variables** for sensitive data

## 🛠️ Development

### Running Tests
```bash
# Test email functionality
node test-email.js

# Test login functionality
# Open test-login.html in browser
```

### Debugging
```bash
# Run debug script
node debug-post.js
```

### Monitoring
```bash
# PM2 monitoring
pm2 status
pm2 logs
pm2 monit
```

## 📝 Logging

Logs are automatically created in the `logs/` directory when running with PM2:

- **Application logs**: General application events
- **Error logs**: Error messages and stack traces
- **Access logs**: HTTP request logs

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is proprietary software for WTSKF-GOA. All rights reserved.

## 📞 Support

For support and questions:
- **Email**: jiya.haldankar@example.com
- **GitHub Issues**: [Create an issue](https://github.com/jiya-haldankar77/KARATE-BUSINESS-PROJECT/issues)

## 🔄 Version History

- **v1.0.0** - Initial production release with full feature set
- Performance optimizations for 100+ users
- Redis caching implementation
- PM2 cluster configuration
- Enhanced security features

---

**Built with ❤️ for the Karate Community**
