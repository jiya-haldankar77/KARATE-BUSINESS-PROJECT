require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('🧪 Testing Nodemailer to jiyahaldankar777@gmail.com...');

// Use the working credentials
const EMAIL_USER = 'karatesubhash455@gmail.com';
const EMAIL_PASS = 'dfym cxhq ljfi rkib';

async function testEmailToJiya() {
  try {
    // Create transporter
    console.log('📧 Creating email transporter...');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    // Verify connection
    console.log('🔗 Verifying transporter connection...');
    await transporter.verify();
    console.log('✅ Transporter verified successfully!');

    // Send test email to Jiya
    console.log('📨 Sending test email to jiyahaldankar777@gmail.com...');
    const mailOptions = {
      from: EMAIL_USER,
      to: 'jiyahaldankar777@gmail.com',
      subject: '🧪 Nodemailer Test - WTSKF-GOA Email Verification',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); color: #fff;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #d4af37; margin: 0;">WTSKF-GOA</h2>
            <p style="color: #fff; margin: 5px 0;">World Traditional Shotokan Karate Federation - Goa</p>
          </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; border: 1px solid rgba(212,175,55,0.3);">
            <h3 style="color: #fff; margin-top: 0;">🎉 Email Test Successful!</h3>
            
            <p style="color: #27ae60; font-weight: bold; text-align: center;">✅ Nodemailer is working perfectly!</p>
            
            <p style="color: #ddd; line-height: 1.6;">This is a test email from the WTSKF-GOA karate registration system. If you're receiving this email, it means our email verification system is working correctly.</p>
            
            <div style="background: rgba(212,175,55,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #d4af37;">
              <h4 style="color: #d4af37; margin-top: 0;">📧 Test Details:</h4>
              <ul style="color: #fff; list-style: none; padding: 0;">
                <li><strong>From:</strong> ${EMAIL_USER}</li>
                <li><strong>To:</strong> jiyahaldankar777@gmail.com</li>
                <li><strong>Status:</strong> ✅ Delivered Successfully</li>
                <li><strong>📅 Sent at:</strong> ${new Date().toLocaleString()}</li>
                <li><strong>🔧 Service:</strong> Gmail SMTP via Nodemailer</li>
              </ul>
            </div>
            
            <div style="background: rgba(39,174,96,0.1); padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #27ae60;">
              <h4 style="color: #27ae60; margin-top: 0;">🚀 What This Means:</h4>
              <ul style="color: #fff; line-height: 1.6;">
                <li>✅ Email authentication is working</li>
                <li>✅ Gmail SMTP connection is successful</li>
                <li>✅ Registration verification emails will work</li>
                <li>✅ Welcome emails will be delivered</li>
              </ul>
            </div>
            
            <p style="color: #ddd; line-height: 1.6;">The WTSKF-GOA registration system is now ready to send verification emails to new users!</p>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #d4af37; font-weight: bold; margin-bottom: 10px;">🥋 Ready for Karate Registration!</p>
              <p style="color: #ddd; margin: 5px 0;">Master the Art of Karate</p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="color: #aaa; font-size: 12px; margin: 0;">© 2024 WTSKF-GOA. All rights reserved.</p>
            <p style="color: #aaa; font-size: 12px; margin: 5px 0;">Email System Test - Successful!</p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    console.log('📬 Message ID:', result.messageId);
    console.log('📧 Gmail Response:', result.response);
    console.log('📨 To: jiyahaldankar777@gmail.com');
    console.log('📤 From:', EMAIL_USER);

  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

// Run the test
testEmailToJiya().then(() => {
  console.log('\n🎯 Email test to Jiya completed!');
  console.log('📧 Check jiyahaldankar777@gmail.com inbox for the test email!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Email test failed:', error);
  process.exit(1);
});
