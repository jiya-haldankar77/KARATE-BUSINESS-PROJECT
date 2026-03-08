const SibApiV3Sdk = require('sib-api-v3-sdk');

SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = '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';

async function sendTestEmail(toEmail) {
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    sender: { email: 'karatesubhash455@gmail.com', name: 'WTSKF-GOA' },
    to: [{ email: toEmail }],
    subject: 'Test Email from Brevo',
    htmlContent: `<p>This is a test email sent via Brevo API at ${new Date().toISOString()}</p>`
  };

  try {
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Test email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Error sending test email:', error);
    return { success: false, error: error.message };
  }
}

// If run directly
if (require.main === module) {
  const email = process.argv[2] || 'jiyahaldankar777@gmail.com';
  console.log('Sending test email to:', email);
  sendTestEmail(email).then(result => {
    console.log('Result:', result);
    process.exit(0);
  }).catch(err => {
    console.error('Failed:', err);
    process.exit(1);
  });
}

module.exports = {
  sendTestEmail
};
