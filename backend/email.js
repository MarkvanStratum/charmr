export async function sendWelcomeEmail(toEmail, toName) {
  try {
    await transactionalEmailApi.sendTransacEmail({
      sender: { email: 'your@email.com', name: 'Charmr' },
      to: [{ email: toEmail, name: toName }],
      subject: 'Welcome to Charmr!',
      htmlContent: `
        <p>Hi ${toName},</p>
        <p>Thanks for signing up at Charmr! Let the magic begin ✨</p>
        <p><a href="https://charmr.xyz/login.html" target="_blank">Click here to log in</a></p>
      `,
    });
    console.log(`✅ Welcome email sent to ${toEmail}`);
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
  }
}
