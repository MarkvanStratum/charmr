// backend/services/spicyMedia.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Images live in backend/public/spicyimages
const SPICY_BASE = path.join(__dirname, "..", "public", "spicyimages");
const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/** Detects sexual/explicit phrases (server-side trigger). */
export function isSexualExplicit(text = "") {
  const rx = [
    /\bfuck(ing)?\b/i,
    /\bhorn(y|ier|iest)\b/i,
    /\b(naked|nude)\b/i,
    /\b(boob|boobs|tits?)\b/i,
    /\b(cock|dick|cum|pussy)\b/i,
    /\b(anal|blow ?job|hand ?job)\b/i,
    /\bi (wanna|want to|wantta)\s+(have )?sex\b/i
  ];
  return rx.some(r => r.test(text));
}

/** Looser hints for suggestive requests (optional, used alongside explicit). */
export function shouldSendSuggestiveImage(text = "") {
  const rx = [
    /\b(pic|photo|image|selfie|outfit)\b/i,
    /\bspicy\b/i,
    /\bsend (me )?(something|one)\b/i
  ];
  return rx.some(r => r.test(text));
}

/** Picks a random image URL from /public/spicyimages (single common pool). */
export function pickRandomImageUrl(/* girlId optional later */) {
  const files = _listImagesInDir(SPICY_BASE);
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

/** Rotate a few playful, non-explicit lines. */
export function pickSafeFlirtyLine() {
  const choices = [
    "I wanna meet you in real life so you can touch it!",
    "Oh babe you make me so horny I just had to send you this!",
    "You make my pussy so wet! 💕",
    "Babe, I'm going crazy. Here look at this, it's all for you! 😇",
    "Babe I'm so horny now. Here you like what you see? ✨"
    "What will you do with your tounge to this? 💕",
    "Babe, I really wanna feel your hands here! 😇",
    "Does this turn you on? ✨"
	"I wanna suck your dick so bad 😉",
    "Damn babe, I just couldn't help myself. I wanna feel your dick inside me!",
    "Babe my tits are so sensitive now, my nipples are hard and my pussy is wet 💕",
    "Babe, I love sucking dick and swallowing cum. I'm a bad girl for you! 😇",
    "Babe I wanna see you so bad and feel your hands all over my body! ✨"
	"Is your dick hard right now? 😉",
    "I love anal too. Would love to feel your hard dick in my ass",
    "You know, I love tasting my own ass on your dick after you fuck me. It turns me on so much!💕",
    "Babe, I really wanna see you. I cant wait to suck your dick and balls...😇",
    "Do you like it babe?✨"
  ];
  return choices[Math.floor(Math.random() * choices.length)];
}

/* ---------------- internal helpers ---------------- */

function _listImagesInDir(absDir) {
  if (!fs.existsSync(absDir)) return [];
  const files = fs.readdirSync(absDir).filter(f => {
    const dot = f.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = f.slice(dot).toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  });
  return files;
}
