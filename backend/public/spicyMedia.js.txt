// services/spicyMedia.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPICY_BASE = path.join(__dirname, "..", "public", "spicy");
const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/** Detects explicit/sexual requests (PG-13 guard: we won’t go explicit) */
export function isSexualExplicit(text = "") {
  // keep this list broad; we don't produce explicit content in response
  const rx = [
    /\bfuck(ing)?\b/i,
    /\bhorn(y|ier|iest)\b/i,
    /\b(naked|nude)\b/i,
    /\b(boobs?|tits?)\b/i,
    /\b(cock|dick|cum|pussy)\b/i,
    /\b(anal|blow ?job|hand ?job)\b/i
  ];
  return rx.some(r => r.test(text));
}

/** Triggers for “suggestive but safe” image (not explicit) */
export function shouldSendSuggestiveImage(text = "") {
  const rx = [
    /\b(pic|photo|image|selfie|outfit)\b/i,
    /\bspicy\b/i,
    /\bsend (me )?(something|one)\b/i
  ];
  return rx.some(r => r.test(text));
}

/** Pick a random public URL like /spicy/7/file.jpg (served by express.static) */
export function pickRandomImageUrl(girlId) {
  const first = _pickIn(`/spicy/${girlId}`);
  if (first) return first;
  const fallback = _pickIn(`/spicy/common`);
  return fallback || null;
}

function _pickIn(relWebPath) {
  const abs = path.join(SPICY_BASE, relWebPath.replace("/spicy", ""));
  if (!fs.existsSync(abs)) return null;
  const files = fs.readdirSync(abs).filter(f => {
    const ext = f.slice(f.lastIndexOf(".")).toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  });
  if (!files.length) return null;
  const f = files[Math.floor(Math.random() * files.length)];
  return `${relWebPath}/${f}`;
}

/** DB helpers */
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

export async function insertImageMessage({ pool, userId, girlId, imageUrl }) {
  const q = `
    INSERT INTO messages (user_id, girl_id, from_user, type, image_url)
    VALUES ($1, $2, false, 'image', $3)
    RETURNING id, user_id, girl_id, from_user, type, image_url, created_at
  `;
  const { rows } = await pool.query(q, [userId, girlId, imageUrl]);
  return rows[0];
}

export async function insertAssistantTextMessage({ pool, userId, girlId, text }) {
  const q = `
    INSERT INTO messages (user_id, girl_id, from_user, type, text)
    VALUES ($1, $2, false, 'text', $3)
    RETURNING id, user_id, girl_id, from_user, type, text, created_at
  `;
  const { rows } = await pool.query(q, [userId, girlId, text]);
  return rows[0];
}

/** Non-explicit, playful responses to keep it flirty but safe */
export function pickSafeFlirtyLine() {
  const choices = [
    "I wanna meet you in real life so you can touch it 😉",
    "Oh babe you make me so horny I just had to send you this!",
    "You make my pussy so wet! 💕",
    "Babe, I'm going crazy. Here look at this, it's all for you! 😇",
    "Babe I'm so horny now. Here you like what you see? ✨"
	"Here babe for you! 😉",
    "I just can't wait, I wanna feel you inside me!",
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
