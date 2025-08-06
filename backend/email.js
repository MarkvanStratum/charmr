export async function sendWelcomeEmail(toEmail, toName = 'there') {
  try {
    const sender = { email: 'no-reply@charmr.xyz', name: 'Charmr' };
    const recipient = { email: toEmail, name: toName };
    const subject = 'Welcome to Charmr!';
    const htmlContent = `
      <p>Hi ${sanitizeHtml(toName)},</p>
      <p>Thanks for signing up at Charmr! Let the magic begin ✨</p>
      <p><a href="https://charmr.xyz/login.html" target="_blank">Click here to log in</a></p>
    `;

    await transactionalEmailApi.sendTransacEmail({
      sender,
      to: [recipient],
      subject,
      htmlContent,
    });

    console.log(`✅ Welcome email sent to ${toEmail}`);
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
  }
}

// Optional: Simple sanitization to avoid XSS if `toName` is user-controlled
function sanitizeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[match]));
}
