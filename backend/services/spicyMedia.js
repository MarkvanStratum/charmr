// backend/services/spicyMedia.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Images live in backend/public/spicyimages
const SPICY_BASE = path.join(__dirname, "..", "public", "spicyimages");
const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/* ===========================
   TRIGGER KEYWORDS (EDIT ME)
   =========================== */

// Strong/explicit triggers
const sexualKeywords = [
  "fuck",
  "fucking",
  "horny",
  "hornier",
  "horniest",
  "naked",
  "nude",
  "boob",
  "boobs",
  "tit",
  "tits",
  "cock",
  "dick",
  "cum",
  "pussy",
  "anal",
  "blowjob",
  "blow job",
  "handjob",
  "hand job",
  "i wanna have sex",
  "i want to have sex",
  "i wantta have sex"
];

// Softer/suggestive triggers
const suggestiveKeywords = [
  "pic",
  "photo",
  "image",
  "selfie",
  "outfit",
  "spicy",
  "send me something",
  "send something",
  "send one"
];

/* ===========================
   PUBLIC APIS
   =========================== */

/** Detects sexual/explicit phrases (server-side trigger). */
export function isSexualExplicit(text = "") {
  const lower = String(text || "").toLowerCase();
  return sexualKeywords.some(k => lower.includes(k));
}

/** Looser hints for suggestive requests (optional, used alongside explicit). */
export function shouldSendSuggestiveImage(text = "") {
  const lower = String(text || "").toLowerCase();
  return suggestiveKeywords.some(k => lower.includes(k));
}

/** Picks a random image URL from /public/spicyimages (single common pool). */
export function pickRandomImageUrl() {
  const files = listImagesInDir(SPICY_BASE);
  if (!files.length) return null;
  const pick = files[Math.floor(Math.random() * files.length)];
  // Public URL (served by express.static("public"))
  return `/spicyimages/${pick}`;
}

/** Ensure DB columns type and image_url exist (safe to call every boot). */
export async function ensureImageColumns(pool) {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='messages' AND column_name='type'
      ) THEN
        ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='messages' AND column_name='image_url'
      ) THEN
        ALTER TABLE messages ADD COLUMN image_url TEXT;
      END IF;
    END$$;
  `);
}

/** Insert an image message from assistant. */
export async function insertImageMessage({ pool, userId, girlId, imageUrl }) {
  const q = `
    INSERT INTO messages (user_id, girl_id, from_user, type, image_url)
    VALUES ($1, $2, false, 'image', $3)
    RETURNING id, user_id, girl_id, from_user, type, image_url, created_at
  `;
  const { rows } = await pool.query(q, [userId, girlId, imageUrl]);
  return rows[0];
}

/** Insert a short assistant text line (PG-13). */
export async function insertAssistantTextMessage({ pool, userId, girlId, text }) {
  const q = `
    INSERT INTO messages (user_id, girl_id, from_user, type, text)
    VALUES ($1, $2, false, 'text', $3)
    RETURNING id, user_id, girl_id, from_user, type, text, created_at
  `;
  const { rows } = await pool.query(q, [userId, girlId, text]);
  return rows[0];
}

/** Hard-coded, PG-13 one-liners you control. (Edit freely.) */
export function pickSafeFlirtyLine() {
  const messages = [
    "Here babe, just for you.",
    "You made me think of this.",
    "Could not resist sending you this one.",
    "This is just for your eyes.",
    "Thought you might like this.",
    "This one makes me think of you.",
    "Here is something to make your day better.",
    "You are too tempting, so here is this.",
    "I hope this gets your heart racing.",
    "This one is my favorite to send to you."
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/* ===========================
   INTERNAL HELPERS
   =========================== */

function listImagesInDir(absDir) {
  if (!fs.existsSync(absDir)) return [];
  const files = fs.readdirSync(absDir).filter(f => {
    const dot = f.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = f.slice(dot).toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  });
  return files;
}
