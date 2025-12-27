require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('🧪 Testing Nodemailer Configuration...');
console.log('Email User from env:', process.env.EMAIL_USER);
console.log('Password configured:', process.env.EMAIL_PASS ? 'Yes' : 'No');

// Force reload env variables
if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-email@gmail.com') {
  console.log('⚠️  Using hardcoded credentials from .env file...');
  process.env.EMAIL_USER = 'karatesubhash455@gmail.com';
  process.env.EMAIL_PASS = 'dfym cxhq ljfi rkib';
  console.log('Updated Email User:', process.env.EMAIL_USER);
}

async function testEmail() {
  try {
    // Create transporter
    console.log('📧 Creating email transporter...');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Verify connection
    console.log('🔗 Verifying transporter connection...');
    await transporter.verify();
    console.log('✅ Transporter verified successfully!');

    // Send test email
    console.log('📨 Sending test email...');
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Send to self for testing
      subject: '🧪 Nodemailer Test - WTSKF-GOA',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff;">
          <h2 style="color: #d4af37;">🎉 Nodemailer Test Successful!</h2>
          <p>This is a test email from WTSKF-GOA application.</p>
          <div style="background: rgba(212,175,55,0.1); padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #d4af37;">Test Details:</h3>
            <ul style="color: #fff;">
              <li>✅ Transporter created successfully</li>
              <li>✅ Connection verified</li>
              <li>✅ Email sent successfully</li>
              <li>📅 Sent at: ${new Date().toLocaleString()}</li>
            </ul>
          </div>
          <p style="color: #aaa;">If you receive this email, nodemailer is working perfectly! 🚀</p>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    console.log('📬 Message ID:', result.messageId);
    console.log('📧 Response:', result.response);

  } catch (error) {
    console.error('❌ Error testing email:', error);
    
    // Provide specific error guidance
    if (error.code === 'EAUTH') {
      console.log('\n🔧 Gmail Authentication Error Fix:');
      console.log('1. Enable 2-Step Verification on your Gmail account');
      console.log('2. Generate an App Password: https://myaccount.google.com/apppasswords');
      console.log('3. Use the App Password (16 characters) instead of your regular password');
      console.log('4. Update EMAIL_PASS in .env file with the App Password');
    } else if (error.code === 'ECONNECTION') {
      console.log('\n🔧 Connection Error Fix:');
      console.log('1. Check your internet connection');
      console.log('2. Verify Gmail credentials are correct');
      console.log('3. Make sure Gmail SMTP is not blocked');
    }
  }
}

// Run the test
testEmail().then(() => {
  console.log('\n🎯 Email test completed!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Email test failed:', error);
  process.exit(1);
});
