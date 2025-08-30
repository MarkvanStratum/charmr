// email-ses.js
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "eu-west-1" });
const FROM = process.env.SES_FROM || "no-reply@charmr.xyz";

function sanitizeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

export async function sendRawEmail({ to, subject, html }) {
  const cmd = new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } }
    }
  });
  return ses.send(cmd);
}

export async function sendWelcomeEmail(toEmail, toName = "there") {
  return sendRawEmail({
    to: toEmail,
    subject: "Welcome to Charmr!",
    html: `
      <p>Hi ${sanitizeHtml(toName)},</p>
      <p>Thanks for signing up at Charmr! Let the magic begin ✨</p>
      <p><a href="https://charmr.xyz/login.html" target="_blank">Log in</a></p>
    `
  });
}

export async function sendPasswordResetEmail(toEmail, resetLink) {
  return sendRawEmail({
    to: toEmail,
    subject: "Reset Your Charmr Password",
    html: `
      <p>Hi there,</p>
      <p>You requested a password reset. Click the link below to reset it:</p>
      <p><a href="${resetLink}" target="_blank">${resetLink}</a></p>
      <p>If you didn't request this, just ignore this email.</p>
    `
  });
}

export async function sendNewMessageEmail({ toEmail, senderName, conversationUrl }) {
  return sendRawEmail({
    to: toEmail,
    subject: `New message from ${sanitizeHtml(senderName)}`,
    html: `
      <p>${sanitizeHtml(senderName)} sent you a new message on Charmr.</p>
      <p><a href="${conversationUrl}" target="_blank">Read & reply</a></p>
      <p>You can adjust email notifications in your account settings.</p>
    `
  });
}
