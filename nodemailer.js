require('dotenv').config();

const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER || 'karatesubhash455@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'dfym cxhq ljfi rkib';
const SMTP_PORT = Number(process.env.SMTP_PORT || '587'); // Use 587 for TLS

// Create transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for other ports
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // For testing, might need this
  }
});

// Test email function
async function sendTestEmail(toEmail) {
  const mailOptions = {
    from: EMAIL_USER,
    to: toEmail,
    subject: 'Test Email from Nodemailer',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Test Email</h2>
        <p>This is a test email sent using Nodemailer.</p>
        <p>Time: ${new Date().toISOString()}</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

// Test the connection
async function testConnection() {
  try {
    await transporter.verify();
    console.log('SMTP server is ready to take our messages');
    return true;
  } catch (error) {
    console.error('SMTP connection failed:', error);
    return false;
  }
}

// Export for use in other files
module.exports = {
  sendTestEmail,
  testConnection,
  transporter
};

// If run directly
if (require.main === module) {
  const testEmail = process.argv[2] || 'your-test-email@example.com';
  console.log('Testing Nodemailer setup...');
  testConnection().then(() => {
    console.log('Sending test email to:', testEmail);
    return sendTestEmail(testEmail);
  }).then(result => {
    console.log('Result:', result);
    process.exit(0);
  }).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
