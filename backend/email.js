// Sends a welcome email to a new user
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

// Sends a password reset email with a secure reset link
export async function sendPasswordResetEmail(toEmail, resetLink) {
  try {
    const sender = { email: 'no-reply@charmr.xyz', name: 'Charmr' };
    const subject = 'Reset Your Charmr Password';
    const htmlContent = `
      <p>Hi there,</p>
      <p>You requested a password reset. Click the link below to reset it:</p>
      <p><a href="${resetLink}" target="_blank">${resetLink}</a></p>
      <p>If you didn't request this, just ignore this email.</p>
    `;

    await transactionalEmailApi.sendTransacEmail({
      sender,
      to: [{ email: toEmail }],
      subject,
      htmlContent,
    });

    console.log(`✅ Password reset email sent to ${toEmail}`);
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
  }
}

// Basic sanitization for HTML inputs
export function sanitizeHtml(str) {
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[match]));
}
