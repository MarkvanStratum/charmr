// src/notifications.js
// Encapsulates: per-user-per-thread cool-down + Brevo email for new messages.
// Usage:
//   import { initNotifications, createMessageAndNotify } from "./src/notifications.js";
//   const notify = initNotifications({ pool, transactionalEmailApi, profiles, cooldownMinutes: 30 });
//   await notify.createMessageAndNotify({ userId, girlId, fromUser: false, text: reply });

/**
 * @typedef {Object} InitDeps
 * @property {import('pg').Pool} pool
 * @property {{ sendTransacEmail: Function }} transactionalEmailApi
 * @property {Array<{id:number,name:string}>} profiles
 * @property {number} [cooldownMinutes]
 */

/**
 * Ensure the email_notifications table exists.
 * This is safe to run on startup.
 */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_notifications (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      girl_id INT NOT NULL,
      last_sent TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, girl_id)
    );
  `);
}

/**
 * Atomic check + set for cool-down.
 * Returns true iff caller "won" the right to send an email now.
 */
async function tryAcquireCooldown(pool, { userId, girlId, cooldownMinutes }) {
  const q = `
    INSERT INTO email_notifications (user_id, girl_id, last_sent)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, girl_id)
    DO UPDATE SET last_sent = NOW()
    WHERE email_notifications.last_sent < NOW() - ($3 || ' minutes')::interval
    RETURNING last_sent
  `;
  const r = await pool.query(q, [userId, girlId, cooldownMinutes]);
  return r.rowCount > 0;
}

function buildMessageEmail({ girlName, messageText }) {
  const safeGirl = girlName || "Someone";
  const safeText = (messageText || "").slice(0, 1000);
  return `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="margin:0 0 16px;">${safeGirl} sent you a message</h2>
    <div style="background:#f6f7f9; border-radius:12px; padding:16px; margin-bottom:24px;">
      <p style="white-space:pre-wrap; margin:0; line-height:1.5">${safeText}</p>
    </div>
    <a href="https://charmr.xyz/inbox"
       style="display:inline-block; text-decoration:none; padding:12px 18px; border-radius:10px; background:#4f46e5; color:#fff; font-weight:600;">
       Reply to ${safeGirl}
    </a>
    <p style="color:#6b7280; font-size:12px; margin-top:16px;">
      You’re getting this because you have message notifications enabled.
    </p>
  </div>`;
}

/**
 * Initialize the notifications module with shared deps.
 * Returns an object with createMessageAndNotify.
 *
 * @param {InitDeps} deps
 */
export function initNotifications({ pool, transactionalEmailApi, profiles, cooldownMinutes = 30 }) {
  if (!pool) throw new Error("initNotifications requires pool");
  if (!transactionalEmailApi) throw new Error("initNotifications requires transactionalEmailApi");
  if (!profiles) throw new Error("initNotifications requires profiles array");

  // Fire-and-forget schema ensure (you can await during app bootstrap if you prefer)
  ensureSchema(pool).catch(err => {
    console.error("[notifications] ensureSchema failed", err);
  });

  async function createMessageAndNotify({ userId, girlId, fromUser, text }) {
    // 1) Always write the message
    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, $3, $4)`,
      [userId, girlId, fromUser, text]
    );

    // Only notify when the *girl* sent the message (fromUser === false)
    if (fromUser) return;

    // 2) Get recipient email + mute flag
    const u = await pool.query(
      `SELECT email, notifications_muted FROM users WHERE id = $1`,
      [userId]
    );
    const toEmail = u.rows[0]?.email;
    if (!toEmail || u.rows[0]?.notifications_muted) return;

    // 3) Atomic cool-down check
    const okToSend = await tryAcquireCooldown(pool, { userId, girlId, cooldownMinutes });
    if (!okToSend) return;

    // 4) Build and send email via Brevo
    const girl = Array.isArray(profiles) ? profiles.find(g => Number(g.id) === Number(girlId)) : null;
    const girlName = girl?.name || "a user";
    const html = buildMessageEmail({ girlName, messageText: text });

    await transactionalEmailApi.sendTransacEmail({
      sender: { email: 'no-reply@charmr.xyz', name: 'Charmr' },
      to: [{ email: toEmail }],
      subject: `${girlName} sent you a message`,
      htmlContent: html
    });
  }

  return { createMessageAndNotify };
}
