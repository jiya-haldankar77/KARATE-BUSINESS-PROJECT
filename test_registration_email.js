require('dotenv').config();

const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER || 'karatesubhash455@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'dfym cxhq ljfi rkib';
const SMTP_PORT = Number(process.env.SMTP_PORT || '587');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function sendRegistrationEmail(toEmail, firstName, lastName, batch) {
  const verificationToken = 'test-token-123';
  const verificationLink = `http://localhost:3000/verify-student-email?token=${verificationToken}&email=${encodeURIComponent(toEmail)}`;
  const mailOptions = {
    to: toEmail,
    from: EMAIL_USER,
    subject: 'Verify your Student Account - WTSKF-GOA',
    html: `
      <html>
      <body>
        <h2>Verify Your Student Account</h2>
        <p>Hi ${firstName} ${lastName},</p>
        <p>Thank you for registering with WTSKF-GOA!</p>
        <p>Your login details:</p>
        <ul>
          <li>Email: ${toEmail}</li>
          <li>Password: karate@${batch}</li>
        </ul>
        <p>Click here to verify your account: <a href="${verificationLink}">Verify Account</a></p>
        <p>This link expires in 24 hours.</p>
        <p>If you didn't register, ignore this email.</p>
      </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Registration email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending registration email:', error);
    return { success: false, error: error.message };
  }
}

// Test connection
async function testConnection() {
  try {
    await transporter.verify();
    console.log('SMTP server is ready');
    return true;
  } catch (error) {
    console.error('SMTP connection failed:', error);
    return false;
  }
}

// If run directly
if (require.main === module) {
  const email = process.argv[2] || 'jiyahaldankar77@gmail.com';
  const firstName = process.argv[3] || 'Test';
  const lastName = process.argv[4] || 'User';
  const batch = process.argv[5] || 'batch1';

  console.log('Testing SMTP connection...');
  testConnection().then(() => {
    console.log('Sending registration email to:', email);
    return sendRegistrationEmail(email, firstName, lastName, batch);
  }).then(result => {
    console.log('Result:', result);
    process.exit(0);
  }).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = {
  sendRegistrationEmail,
  testConnection
};
