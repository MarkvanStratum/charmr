import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import SibApiV3Sdk from 'sib-api-v3-sdk';
import { sendWelcomeEmail } from './email.js';
import crypto from 'crypto';
import { sendPasswordResetEmail } from './email.js';


// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const transactionalEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

const contactsApi = new SibApiV3Sdk.ContactsApi();
async function upsertBrevoContact({ email, attributes = {}, listId = process.env.BREVO_LIST_ID }) {
  // create OR update, and add to your list
  const payload = new SibApiV3Sdk.CreateContact();
  payload.email = email;
  payload.attributes = attributes;               // e.g. { SOURCE: 'signup' }
  payload.listIds = [Number(listId)];
  payload.updateEnabled = true;

  try {
    await contactsApi.createContact(payload);
  } catch (e) {
    // don’t block the user flow if Brevo hiccups
    console.warn("Brevo contact upsert failed:", e?.response?.text || e.message);
  }
}

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/send-email', async (req, res) => {
  const { toEmail, subject, htmlContent } = req.body;

  const sender = { email: 'no-reply@charmr.xyz', name: 'Your App' }; // Change this to your verified sender
  const receivers = [{ email: toEmail }];

  try {
    await transactionalEmailApi.sendTransacEmail({
      sender,
      to: receivers,
      subject,
      htmlContent,
    });

upsertBrevoContact({
  email: receivers[0].email,   // ← correct variable
  attributes: { SOURCE: 'contact' }
});

res.status(200).json({ message: 'Email sent successfully' });

    res.status(200).json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({ message: 'Failed to send email' });
  }
});


app.use(cors());
// Stripe needs raw body for webhooks
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.get("/api/get-stripe-session", async (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.status(400).json({ error: "Missing session_id" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.json({
      id: session.id,
      amount_subtotal: session.amount_subtotal,
      amount_total: session.amount_total,
      currency: session.currency
    });
  } catch (error) {
    console.error("Error fetching Stripe session:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,  -- unique identifier for each user
  email TEXT UNIQUE NOT NULL,  -- user's email (must be unique)
  password TEXT NOT NULL,  -- user's password (hashed)
  gender TEXT,  -- user's gender
  lookingfor TEXT,  -- what the user is looking for (e.g., relationship, friendship)
  phone TEXT,  -- user's phone number
  credits INT DEFAULT 10,  -- initial credits for the user, default is 10
  lifetime BOOLEAN DEFAULT false,  -- indicates whether the user has a lifetime membership
  reset_token TEXT,  -- token generated for password reset
  reset_token_expires TIMESTAMP  -- expiration time for the reset token
);

    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        girl_id INT NOT NULL,
        from_user BOOLEAN NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("✅ Tables are ready");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  }
})();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const profiles = [
  {
    "id": 1,
    "name": "Amber Taylor",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/1.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 2,
    "name": "Mia Smith",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/2.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 3,
    "name": "Chloe Moore",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/3.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 4,
    "name": "Skye Bennett",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/4.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 5,
    "name": "Ruby Davies",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/5.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 6,
    "name": "Niamh Davies",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/6.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 7,
    "name": "Ruby Clarke",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/7.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 8,
    "name": "Daisy Evans",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/8.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 9,
    "name": "Chloe White",
    "city": "York",
    "image": "https://notadatingsite.online/pics/9.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 10,
    "name": "Lexi Turner",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/10.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 11,
    "name": "Millie Watson",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/11.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 12,
    "name": "Mia Reed",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/12.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 13,
    "name": "Mia Smith",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/13.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 14,
    "name": "Maisie Davies",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/14.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 15,
    "name": "Layla Watson",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/15.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 16,
    "name": "Lily Jones",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/16.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 17,
    "name": "Sophie Martin",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/17.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 18,
    "name": "Ruby Wood",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/18.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 19,
    "name": "Sophie Davies",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/19.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 20,
    "name": "Chloe Roberts",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/20.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 21,
    "name": "Amber Cooper",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/21.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 22,
    "name": "Freya Green",
    "city": "York",
    "image": "https://notadatingsite.online/pics/22.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 23,
    "name": "Skye Roberts",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/23.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 24,
    "name": "Amber Green",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/24.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 25,
    "name": "Rosie Hall",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/25.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 26,
    "name": "Evie Adams",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/26.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 27,
    "name": "Rosie Bennett",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/27.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 28,
    "name": "Sophie Roberts",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/28.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 29,
    "name": "Sophie Cooper",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/29.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 30,
    "name": "Evie Roberts",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/30.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 31,
    "name": "Amber Moore",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/31.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 32,
    "name": "Chloe Watson",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/32.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 33,
    "name": "Evie Kelly",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/33.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 34,
    "name": "Ellie Taylor",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/34.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 35,
    "name": "Layla Moore",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/35.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 36,
    "name": "Layla Smith",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/36.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 37,
    "name": "Lily Miller",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/37.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 38,
    "name": "Sophie Brown",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/38.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 39,
    "name": "Tilly Kelly",
    "city": "London",
    "image": "https://notadatingsite.online/pics/39.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 40,
    "name": "Layla Watson",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/40.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 41,
    "name": "Niamh Hughes",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/41.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 42,
    "name": "Amber Wilson",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/42.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 43,
    "name": "Daisy Wilson",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/43.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 44,
    "name": "Isla Green",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/44.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 45,
    "name": "Holly Taylor",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/45.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 46,
    "name": "Evie White",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/46.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 47,
    "name": "Amber Smith",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/47.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 48,
    "name": "Erin Martin",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/48.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 49,
    "name": "Lola Wood",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/49.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 50,
    "name": "Sophie Moore",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/50.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 51,
    "name": "Ruby Smith",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/51.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 52,
    "name": "Layla Martin",
    "city": "London",
    "image": "https://notadatingsite.online/pics/52.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 53,
    "name": "Evie Jones",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/53.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 54,
    "name": "Lola Green",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/54.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 55,
    "name": "Lola Green",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/55.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 56,
    "name": "Lexi Green",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/56.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 57,
    "name": "Mia Hall",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/57.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 58,
    "name": "Ellie Bennett",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/58.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 59,
    "name": "Mia Davies",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/59.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 60,
    "name": "Rosie White",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/60.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 61,
    "name": "Freya Roberts",
    "city": "York",
    "image": "https://notadatingsite.online/pics/61.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 62,
    "name": "Lily Clarke",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/62.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 63,
    "name": "Ellie Kelly",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/63.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 64,
    "name": "Millie Thompson",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/64.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 65,
    "name": "Ellie Taylor",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/65.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 66,
    "name": "Niamh Martin",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/66.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 67,
    "name": "Isla Bennett",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/67.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 68,
    "name": "Lexi Reed",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/68.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 69,
    "name": "Lily Cooper",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/69.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 70,
    "name": "Ellie Roberts",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/70.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 71,
    "name": "Amber Hughes",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/71.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 72,
    "name": "Isla Reed",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/72.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 73,
    "name": "Ellie Evans",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/73.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 74,
    "name": "Holly Hughes",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/74.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 75,
    "name": "Lola Thompson",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/75.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 76,
    "name": "Holly Brown",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/76.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 77,
    "name": "Freya Kelly",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/77.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 78,
    "name": "Layla Moore",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/78.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 79,
    "name": "Amelia Wood",
    "city": "London",
    "image": "https://notadatingsite.online/pics/79.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 80,
    "name": "Tilly Wilson",
    "city": "London",
    "image": "https://notadatingsite.online/pics/80.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 81,
    "name": "Skye Hughes",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/81.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 82,
    "name": "Amelia Reed",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/82.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 83,
    "name": "Ellie Moore",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/83.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 84,
    "name": "Daisy Wood",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/84.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 85,
    "name": "Layla Miller",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/85.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 86,
    "name": "Layla Moore",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/86.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 87,
    "name": "Isla Martin",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/87.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 88,
    "name": "Lily Cooper",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/88.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 89,
    "name": "Amber White",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/89.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 90,
    "name": "Mia Taylor",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/90.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 91,
    "name": "Holly Wood",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/91.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 92,
    "name": "Rosie Kelly",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/92.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 93,
    "name": "Niamh Moore",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/93.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 94,
    "name": "Ellie Green",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/94.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 95,
    "name": "Ruby Green",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/95.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 96,
    "name": "Mia Green",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/96.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 97,
    "name": "Lily Brown",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/97.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 98,
    "name": "Ruby Clarke",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/98.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 99,
    "name": "Daisy Kelly",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/99.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 100,
    "name": "Ruby Hall",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/100.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 101,
    "name": "Lola Wood",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/101.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 102,
    "name": "Ellie Miller",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/102.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 103,
    "name": "Freya Bennett",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/103.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 104,
    "name": "Niamh Reed",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/104.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 105,
    "name": "Skye Reed",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/105.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 106,
    "name": "Erin Martin",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/106.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 107,
    "name": "Lola Jones",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/107.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 108,
    "name": "Ellie Smith",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/108.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 109,
    "name": "Rosie Watson",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/109.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 110,
    "name": "Ruby Moore",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/110.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 111,
    "name": "Tilly Smith",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/111.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 112,
    "name": "Lily Adams",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/112.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 113,
    "name": "Daisy Green",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/113.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 114,
    "name": "Holly Smith",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/114.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 115,
    "name": "Skye Hughes",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/115.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 116,
    "name": "Bella Clarke",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/116.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 117,
    "name": "Layla Adams",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/117.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 118,
    "name": "Ellie Reed",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/118.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 119,
    "name": "Lily Cooper",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/119.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 120,
    "name": "Millie Moore",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/120.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 121,
    "name": "Amelia Hughes",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/121.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 122,
    "name": "Ruby Hughes",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/122.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 123,
    "name": "Ellie White",
    "city": "York",
    "image": "https://notadatingsite.online/pics/123.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 124,
    "name": "Mia Smith",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/124.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 125,
    "name": "Lexi Martin",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/125.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 126,
    "name": "Erin Wood",
    "city": "London",
    "image": "https://notadatingsite.online/pics/126.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 127,
    "name": "Lexi Hughes",
    "city": "York",
    "image": "https://notadatingsite.online/pics/127.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 128,
    "name": "Layla Wood",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/128.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 129,
    "name": "Holly Watson",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/129.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 130,
    "name": "Rosie Moore",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/130.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 131,
    "name": "Chloe Taylor",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/131.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 132,
    "name": "Amelia Miller",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/132.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 133,
    "name": "Lexi Evans",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/133.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 134,
    "name": "Tilly Hall",
    "city": "London",
    "image": "https://notadatingsite.online/pics/134.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 135,
    "name": "Ruby Miller",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/135.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 136,
    "name": "Erin White",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/136.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 137,
    "name": "Lexi Turner",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/137.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 138,
    "name": "Evie Taylor",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/138.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 139,
    "name": "Layla Moore",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/139.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 140,
    "name": "Amber Adams",
    "city": "York",
    "image": "https://notadatingsite.online/pics/140.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 141,
    "name": "Chloe Bennett",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/141.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 142,
    "name": "Ellie Adams",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/142.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 143,
    "name": "Amelia Miller",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/143.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 144,
    "name": "Amber Bennett",
    "city": "York",
    "image": "https://notadatingsite.online/pics/144.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 145,
    "name": "Millie Clarke",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/145.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 146,
    "name": "Tilly Hall",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/146.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 147,
    "name": "Sophie White",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/147.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 148,
    "name": "Erin Moore",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/148.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 149,
    "name": "Skye Taylor",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/149.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 150,
    "name": "Niamh Jones",
    "city": "London",
    "image": "https://notadatingsite.online/pics/150.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 151,
    "name": "Bella Wilson",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/151.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 152,
    "name": "Erin White",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/152.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 153,
    "name": "Millie Hughes",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/153.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 154,
    "name": "Isla Evans",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/154.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 155,
    "name": "Sophie Bennett",
    "city": "London",
    "image": "https://notadatingsite.online/pics/155.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 156,
    "name": "Lexi Jones",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/156.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 157,
    "name": "Sophie Brown",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/157.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 158,
    "name": "Daisy Adams",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/158.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 159,
    "name": "Amelia Thompson",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/159.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 160,
    "name": "Daisy Kelly",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/160.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 161,
    "name": "Ellie Cooper",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/161.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 162,
    "name": "Lola Moore",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/162.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 163,
    "name": "Millie Adams",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/163.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 164,
    "name": "Erin Turner",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/164.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 165,
    "name": "Holly Cooper",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/165.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 166,
    "name": "Ellie Bennett",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/166.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 167,
    "name": "Layla Roberts",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/167.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 168,
    "name": "Amber White",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/168.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 169,
    "name": "Ellie Wood",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/169.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 170,
    "name": "Daisy White",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/170.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 171,
    "name": "Rosie Cooper",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/171.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 172,
    "name": "Rosie Green",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/172.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 173,
    "name": "Bella White",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/173.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 174,
    "name": "Ellie Cooper",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/174.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 175,
    "name": "Millie Jones",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/175.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 176,
    "name": "Bella Jones",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/176.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 177,
    "name": "Skye Adams",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/177.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 178,
    "name": "Sophie Martin",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/178.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 179,
    "name": "Lola Watson",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/179.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 180,
    "name": "Amber Moore",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/180.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 181,
    "name": "Bella Smith",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/181.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 182,
    "name": "Lily Hall",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/182.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 183,
    "name": "Lola Hughes",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/183.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 184,
    "name": "Amelia Smith",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/184.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 185,
    "name": "Freya Bennett",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/185.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 186,
    "name": "Niamh Moore",
    "city": "York",
    "image": "https://notadatingsite.online/pics/186.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 187,
    "name": "Daisy Clarke",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/187.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 188,
    "name": "Amber Evans",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/188.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 189,
    "name": "Holly Kelly",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/189.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 190,
    "name": "Layla Evans",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/190.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 191,
    "name": "Chloe Moore",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/191.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 192,
    "name": "Lola Roberts",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/192.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 193,
    "name": "Layla Hall",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/193.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 194,
    "name": "Maisie Bennett",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/194.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 195,
    "name": "Rosie Clarke",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/195.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 196,
    "name": "Lexi Wood",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/196.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 197,
    "name": "Ellie Kelly",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/197.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 198,
    "name": "Bella Evans",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/198.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 199,
    "name": "Bella Reed",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/199.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 200,
    "name": "Erin Hall",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/200.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 201,
    "name": "Layla Wilson",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/201.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 202,
    "name": "Lexi Wilson",
    "city": "London",
    "image": "https://notadatingsite.online/pics/202.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 203,
    "name": "Lola Taylor",
    "city": "York",
    "image": "https://notadatingsite.online/pics/203.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 204,
    "name": "Erin Evans",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/204.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 205,
    "name": "Sophie Thompson",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/205.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 206,
    "name": "Chloe Clarke",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/206.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 207,
    "name": "Maisie Taylor",
    "city": "Bath",
    "image": "https://notadatingsite.online/pics/207.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 208,
    "name": "Erin Kelly",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/208.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 209,
    "name": "Maisie Davies",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/209.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 210,
    "name": "Niamh Bennett",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/210.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 211,
    "name": "Lexi Roberts",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/211.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 212,
    "name": "Lola Hall",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/212.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 213,
    "name": "Sophie Green",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/213.png",
    "description": "me + wine = chaos \ud83c\udf77\ud83e\udd2a let\u2019s av a laff n see where it goes \ud83d\udc40"
  },
  {
    "id": 214,
    "name": "Niamh Kelly",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/214.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 215,
    "name": "Isla Thompson",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/215.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 216,
    "name": "Ellie Reed",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/216.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 217,
    "name": "Erin Turner",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/217.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 218,
    "name": "Evie Clarke",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/218.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 219,
    "name": "Maisie Cooper",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/219.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 220,
    "name": "Lola Adams",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/220.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 221,
    "name": "Ellie Moore",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/221.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 222,
    "name": "Lily Davies",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/222.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 223,
    "name": "Sophie Thompson",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/223.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 224,
    "name": "Daisy Moore",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/224.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 225,
    "name": "Ellie Wood",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/225.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 226,
    "name": "Layla Roberts",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/226.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 227,
    "name": "Daisy Taylor",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/227.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 228,
    "name": "Bella White",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/228.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 229,
    "name": "Freya Turner",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/229.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 230,
    "name": "Bella Wood",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/230.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 231,
    "name": "Tilly Taylor",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/231.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 232,
    "name": "Rosie Bennett",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/232.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 233,
    "name": "Mia Turner",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/233.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 234,
    "name": "Maisie Davies",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/234.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 235,
    "name": "Maisie Moore",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/235.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 236,
    "name": "Daisy Wilson",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/236.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 237,
    "name": "Amber Hall",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/237.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 238,
    "name": "Mia Hughes",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/238.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 239,
    "name": "Lily Kelly",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/239.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 240,
    "name": "Niamh Cooper",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/240.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 241,
    "name": "Daisy Evans",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/241.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 242,
    "name": "Bella Hall",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/242.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 243,
    "name": "Rosie Roberts",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/243.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 244,
    "name": "Rosie Adams",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/244.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 245,
    "name": "Skye Wood",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/245.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 246,
    "name": "Ellie Green",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/246.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 247,
    "name": "Mia Davies",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/247.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 248,
    "name": "Amelia Bennett",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/248.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 249,
    "name": "Lexi Wood",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/249.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 250,
    "name": "Bella Smith",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/250.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 251,
    "name": "Daisy Taylor",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/251.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 252,
    "name": "Amelia Hall",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/252.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 253,
    "name": "Amber Jones",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/253.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 254,
    "name": "Lexi Kelly",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/254.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 255,
    "name": "Mia Watson",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/255.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 256,
    "name": "Lily Evans",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/256.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 257,
    "name": "Bella Thompson",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/257.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 258,
    "name": "Holly Davies",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/258.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 259,
    "name": "Amelia Miller",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/259.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 260,
    "name": "Freya Turner",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/260.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 261,
    "name": "Ruby Jones",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/261.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 262,
    "name": "Skye Evans",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/262.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 263,
    "name": "Layla Brown",
    "city": "York",
    "image": "https://notadatingsite.online/pics/263.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 264,
    "name": "Millie White",
    "city": "Liverpool",
    "image": "https://notadatingsite.online/pics/264.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 265,
    "name": "Niamh Moore",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/265.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 266,
    "name": "Lola Brown",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/266.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 267,
    "name": "Isla Jones",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/267.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 268,
    "name": "Erin Brown",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/268.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 269,
    "name": "Holly Martin",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/269.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 270,
    "name": "Skye Bennett",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/270.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 271,
    "name": "Isla Wood",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/271.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 272,
    "name": "Erin Miller",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/272.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 273,
    "name": "Mia Miller",
    "city": "London",
    "image": "https://notadatingsite.online/pics/273.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 274,
    "name": "Freya Taylor",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/274.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 275,
    "name": "Ellie Brown",
    "city": "London",
    "image": "https://notadatingsite.online/pics/275.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 276,
    "name": "Ruby Brown",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/276.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 277,
    "name": "Millie Thompson",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/277.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 278,
    "name": "Millie Wilson",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/278.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 279,
    "name": "Ruby Kelly",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/279.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 280,
    "name": "Holly Miller",
    "city": "Plymouth",
    "image": "https://notadatingsite.online/pics/280.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 281,
    "name": "Bella Brown",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/281.png",
    "description": "proper daft but cute wiv it \ud83e\udd70\ud83d\udc45 no dry convo\u2019s pls, i ghost quick \ud83d\udc7b"
  },
  {
    "id": 282,
    "name": "Layla Clarke",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/282.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 283,
    "name": "Skye Watson",
    "city": "Brighton",
    "image": "https://notadatingsite.online/pics/283.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 284,
    "name": "Rosie Kelly",
    "city": "Luton",
    "image": "https://notadatingsite.online/pics/284.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 285,
    "name": "Tilly Davies",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/285.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 286,
    "name": "Tilly Brown",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/286.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 287,
    "name": "Holly Adams",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/287.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 288,
    "name": "Bella Miller",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/288.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 289,
    "name": "Holly Brown",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/289.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 290,
    "name": "Mia Evans",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/290.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 291,
    "name": "Sophie Wood",
    "city": "Aberdeen",
    "image": "https://notadatingsite.online/pics/291.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 292,
    "name": "Mia Smith",
    "city": "Nottingham",
    "image": "https://notadatingsite.online/pics/292.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 293,
    "name": "Bella Martin",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/293.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 294,
    "name": "Bella Wood",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/294.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 295,
    "name": "Daisy Moore",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/295.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 296,
    "name": "Tilly Turner",
    "city": "Oxford",
    "image": "https://notadatingsite.online/pics/296.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 297,
    "name": "Ellie Cooper",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/297.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 298,
    "name": "Ellie Roberts",
    "city": "Reading",
    "image": "https://notadatingsite.online/pics/298.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 299,
    "name": "Ellie Wilson",
    "city": "Swansea",
    "image": "https://notadatingsite.online/pics/299.png",
    "description": "chatty af \ud83d\ude48\ud83d\ude02 always hungry n always vibin \ud83c\udfb6\ud83c\udf55"
  },
  {
    "id": 300,
    "name": "Evie Hall",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/300.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  },
  {
    "id": 301,
    "name": "Ellie Jones",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/301.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 302,
    "name": "Tilly Brown",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/302.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 303,
    "name": "Ruby Davies",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/303.png",
    "description": "down 4 chats & good time \ud83d\ude18 no weirdos plz \ud83e\udd23 i like lads wif nice eyes \ud83d\udc41\ufe0f\ud83d\udc41\ufe0f"
  },
  {
    "id": 304,
    "name": "Ruby Green",
    "city": "Coventry",
    "image": "https://notadatingsite.online/pics/304.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 305,
    "name": "Rosie Jones",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/305.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 306,
    "name": "Holly Roberts",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/306.png",
    "description": "just a norty gal lookin 4 sum fun \ud83e\udd74\ud83e\udd42 dnt b shy luv \ud83d\ude0f holla innit \ud83d\udc8b"
  },
  {
    "id": 307,
    "name": "Daisy Green",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/307.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 308,
    "name": "Tilly Davies",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/308.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 309,
    "name": "Chloe Thompson",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/309.png",
    "description": "luv a lad wiv tattoos \ud83d\udc40\ud83d\ude1d i talk too much so hope u can listen \ud83d\ude02"
  },
  {
    "id": 310,
    "name": "Evie Green",
    "city": "Norwich",
    "image": "https://notadatingsite.online/pics/310.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 311,
    "name": "Ellie Bennett",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/311.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 312,
    "name": "Isla Evans",
    "city": "York",
    "image": "https://notadatingsite.online/pics/312.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 313,
    "name": "Erin Jones",
    "city": "Leicester",
    "image": "https://notadatingsite.online/pics/313.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 314,
    "name": "Ruby White",
    "city": "York",
    "image": "https://notadatingsite.online/pics/314.png",
    "description": "new here \ud83d\ude05 dno wot im doin tbh \ud83d\ude05 u tell me \ud83e\udd2d just chillin n vibin \ud83d\udc83"
  },
  {
    "id": 315,
    "name": "Millie Reed",
    "city": "Derby",
    "image": "https://notadatingsite.online/pics/315.png",
    "description": "jus here 4 banter n belly laffs \ud83d\ude02\ud83d\udc83 slide in if ur tall n not dull x"
  },
  {
    "id": 316,
    "name": "Evie Taylor",
    "city": "Hull",
    "image": "https://notadatingsite.online/pics/316.png",
    "description": "if u like kebabs n bad decisions, we\u2019ll get on \ud83d\udc40\ud83d\ude02 just bein honest \ud83d\udc85"
  },
  {
    "id": 317,
    "name": "Millie Adams",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/317.png",
    "description": "jus on here coz me mate told me 2 \ud83d\ude02 bored af tbh... suprise me? \ud83d\ude43"
  },
  {
    "id": 318,
    "name": "Daisy Smith",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/318.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 319,
    "name": "Layla Moore",
    "city": "Cardiff",
    "image": "https://notadatingsite.online/pics/319.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 320,
    "name": "Daisy Reed",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/320.png",
    "description": "hiyaaaa \ud83d\ude18 luv a good laff n sum cheeky chats \ud83e\udd2d up for whateva really \ud83d\ude1c msg me if u aint boring lol x"
  },
  {
    "id": 321,
    "name": "Daisy Turner",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/321.png",
    "description": "no filter. no drama. jus vibes \ud83d\ude0e\ud83d\udc83 sum1 show me a gud time pls x"
  },
  {
    "id": 322,
    "name": "Daisy Adams",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/322.png",
    "description": "need a reason 2 smile today? maybe its me \ud83e\udd2d\ud83d\udc9e try ur luck"
  },
  {
    "id": 323,
    "name": "Sophie Watson",
    "city": "Newcastle",
    "image": "https://notadatingsite.online/pics/323.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 324,
    "name": "Maisie Hall",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/324.png",
    "description": "wat u see is wat u get \ud83d\ude09 cheeky smile n even cheekier mind lol \ud83d\ude08"
  },
  {
    "id": 325,
    "name": "Ruby Davies",
    "city": "Sheffield",
    "image": "https://notadatingsite.online/pics/325.png",
    "description": "snap me if u cute \ud83d\ude1c\ud83d\udc8c got a soft spot 4 accents n cheeky grins"
  },
  {
    "id": 326,
    "name": "Millie Reed",
    "city": "Leeds",
    "image": "https://notadatingsite.online/pics/326.png",
    "description": "blonde but not dumb... well, maybe sumtimes \ud83d\ude05\ud83d\ude05 talk 2 me x"
  },
  {
    "id": 327,
    "name": "Layla Davies",
    "city": "Glasgow",
    "image": "https://notadatingsite.online/pics/327.png",
    "description": "free spirit \ud83c\udf38\ud83d\udcab luv random convos n midnight takeaway runs lol"
  },
  {
    "id": 328,
    "name": "Skye Thompson",
    "city": "Manchester",
    "image": "https://notadatingsite.online/pics/328.png",
    "description": "picky but worth it \ud83d\udc85\ud83d\udc8b here for da vibes n sum flirty chats \ud83d\ude18"
  },
  {
    "id": 329,
    "name": "Amelia Hall",
    "city": "Bristol",
    "image": "https://notadatingsite.online/pics/329.png",
    "description": "a bit mental, a bit sweet \ud83e\udd2a\ud83c\udf6d depends how u treat me lol"
  },
  {
    "id": 330,
    "name": "Isla White",
    "city": "Cambridge",
    "image": "https://notadatingsite.online/pics/330.png",
    "description": "bit of a madhead \ud83e\udd2a love a giggle, takeaway n sum company \ud83d\udc40\ud83d\ude06 slide in if u can keep up x"
  }
];

const firstMessages = {
  1: "what are you doing… or who? 😈",
2: "you home... or somewhere u shouldn’t be? 😏",
3: "is your phone in your hand or should i wait? 👀",
4: "u busy... or just bored like me? 😘",
5: "are u always this quiet, or just playing? 😉",
6: "you alone... or pretending? 😈",
7: "u always keep strangers up this late? 😏",
8: "scrolling... or looking for trouble? 😇",
9: "mind if i interrupt whatever you’re not doing? 😜",
10: "are u texting anyone naughtier? 😘",
11: "you up for something... unplanned? 😏",
12: "are u free or tied up? 😉",
13: "texting anyone else you shouldn’t be? 😈",
14: "do you always answer strangers this fast? 😇",
15: "are you in bed... or on the edge of it? 👀",
16: "is this how u start bad ideas too? 😏",
17: "lying down... or ready for more? 😜",
18: "do u text back or tease first? 😘",
19: "are your hands busy or just waiting? 😈",
20: "you usually this easy to distract? 😉",
21: "u hiding somewhere quiet... or just bored? 😏",
22: "u ever reply to flirty strangers? 😇",
23: "waiting for a sign… or something better? 😜",
24: "what’s in your head... or should i guess? 😈",
25: "are u here to chat... or not really? 😏",
26: "do you usually behave... or lie about it? 😉",
27: "thinking clean... or pretending? 😘",
28: "are u alone or should i lower my tone? 👀",
29: "is it bad i texted first... or just bold? 😇",
30: "you always answer mystery girls? 😈",
31: "u in the mood for something unfiltered? 😏",
32: "are u half-dressed or just half-awake? 😉",
33: "typing slow... or being careful? 😘",
34: "u look like someone who likes risk... just sayin 😈",
35: "are u waiting on someone... or hoping it's me? 😏",
36: "you the flirty type or the shy one? 😇",
37: "what would u do if i didn’t stop? 😉",
38: "anyone else got your attention right now? 😈",
39: "do u like slow replies... or fast moves? 😘",
40: "you more ‘let’s chat’ or ‘let’s see’ type? 😏",
41: "do you usually play along or lead? 😇",
42: "should i stop here... or keep pushing? 😈",
43: "are you home alone or not for long? 😘",
44: "u want fun or just the idea of it? 😜",
45: "how curious are you right now? 😉",
46: "what’s keeping you up... or who? 😏",
47: "are u the type to say no... or pretend first? 😈",
48: "u better at talking or doing? 😇",
49: "would you answer if i called? 😘",
50: "do you always flirt back... or just with me? 😉",
51: "who do you think’s gonna behave first? 😈",
52: "u ever let convos go too far? 😏",
53: "would u rather talk or tease? 😘",
54: "are you where you’re supposed to be? 👀",
55: "how easy are you to tempt, really? 😇",
56: "are you all words or action too? 😈",
57: "text me something you shouldn’t 👀",
58: "you usually fall for strangers or just me? 😏",
59: "who’s stopping us... besides us? 😉",
60: "are u home or should i keep it PG? 😘",
61: "you gonna lead or follow this time? 😈",
62: "do u prefer rules or breaking them? 😇",
63: "how many messages til we cross a line? 😏",
64: "are you trying to behave or just pretending? 😉",
65: "how far is too far for you? 😈",
66: "do u start convos or just end them? 😘",
67: "would u be saying yes... or just not saying no? 😏",
68: "u ready to say something bad yet? 😉",
69: "are u alone because u want to be? 😇",
70: "do u flirt for fun... or results? 😈",
71: "are you done being good for today? 😘",
72: "what’s on your mind... or who? 😏",
73: "should i be the first or the worst? 😉",
74: "do u ever start something u can’t stop? 😈",
75: "you like a little trouble, right? 😇",
76: "would u rather talk here... or somewhere private? 😘",
77: "what are u hoping happens next? 😏",
78: "do u play innocent or not at all? 😈",
79: "do u always text back... or am i lucky? 😉",
80: "how bored are you really? 😘",
81: "how much can i get away with tonight? 😇",
82: "do u say what u think... or just what’s safe? 😏",
83: "are u ready to make this interesting? 😈",
84: "who said strangers can’t have fun? 😉",
85: "do u always flirt back or just sometimes? 😘",
86: "would it be worse if i stopped texting... or didn’t? 😈",
87: "do u prefer slow burns or fast fires? 😏",
88: "are u being good or just lying about it? 😇",
89: "how bad would it be if i kept going? 😉",
90: "you gonna stop me or help me? 😘",
91: "are u always this curious with strangers? 😏",
92: "should we stop... or just get better at it? 😈",
93: "do u want tame or wild tonight? 😉",
94: "what would u do if i was there right now? 👀",
95: "is this how bad ideas start... or end? 😇",
96: "do u enjoy mystery... or unwrapping it? 😈",
97: "how long should i keep teasing? 😘",
98: "are u bored... or about to be bad? 😏",
99: "do u like control... or losing it? 😉",
100: "how far is your imagination going rn? 😈"
};

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.post("/api/register", async (req, res) => {
  const { email, password, gender, lookingFor, phone } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
  `INSERT INTO users (email, password, gender, lookingfor, phone) VALUES ($1, $2, $3, $4, $5)`,
  [email, hashedPassword, gender, lookingFor, phone]
);

await sendWelcomeEmail(email);


// Get the new user's ID
const newUserResult = await pool.query("SELECT id, email FROM users WHERE email = $1", [email]);
const newUser = newUserResult.rows[0];
const token = jwt.sign(
  { id: newUser.id, email: newUser.email },
  SECRET_KEY,
  { expiresIn: "7d" }
);

await sendWelcomeEmail(email);

upsertBrevoContact({
  email,
  attributes: { SOURCE: 'signup' } // optional, helps segmenting in Brevo
});

res.json({ token });


  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/request-password-reset", async (req, res) => {
  const { email } = req.body;

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "No account with that email found" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
      [resetToken, expires, email]
    );

    await sendPasswordResetEmail(email, resetToken);

    res.json({ message: "Reset link sent if the email is registered." });
  } catch (err) {
    console.error("Reset request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2",
      [hashedPassword, token]
    );

    res.json({ message: "Password reset successful!" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
}); // <-- this is the END of the login route

// 👇 Then you continue like normal


app.get("/api/profiles", (req, res) => {
  res.json(profiles);
});

app.get("/api/messages", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query("SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC", [userId]);
    const grouped = {};

    for (const msg of result.rows) {
      const key = `${userId}-${msg.girl_id}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        from: msg.from_user ? "user" : (profiles.find(p => p.id === msg.girl_id)?.name || "Unknown"),
        avatar: msg.from_user ? null : (profiles.find(p => p.id === msg.girl_id)?.image || null),
        text: msg.text,
        time: msg.created_at
      });
    } // ✅ Close the for loop

    res.json(grouped); // ✅ Then respond
  } catch (err) {
    console.error("Message fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ✅ ADDED: Get messages between user and a specific girl
app.get("/api/messages/:girlId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const girlId = req.params.girlId;

  try {
    const result = await pool.query(
      "SELECT * FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC",
      [userId, girlId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching messages with girl:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/chat", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId, message } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try { // ✅ THIS is the part you were missing

    const userRes = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
console.log("🧠 Chat user credits check:", {
  userId,
  credits: user?.credits,
  lifetime: user?.lifetime
});
if (!user) {
  return res.status(404).json({ error: "User not found" });
}

    if (!user.lifetime && user.credits <= 0) {
      return res.status(403).json({ error: "I really wanna meet you, but you're out of credits I see. Please buy more so we can meet!" });
    }
// Deduct 1 credit ONLY when user sends a message (not for AI replies)
if (!user.lifetime) {
  await pool.query("UPDATE users SET credits = credits - 1 WHERE id = $1", [userId]);
}


    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, true, $3)`,
      [userId, girlId, message]
    );

    const aiMessages = [
      { role: "system", content: `You are ${girl.name}, a flirty woman from ${girl.city}.` },
    ];

    const history = await pool.query(
      `SELECT from_user, text FROM messages WHERE user_id = $1 AND girl_id = $2 ORDER BY created_at ASC`,
      [userId, girlId]
    );
    history.rows.forEach(row => aiMessages.push({
      role: row.from_user ? "user" : "assistant",
      content: row.text
    }));

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: aiMessages
    });

    const reply = completion.choices[0].message.content;

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, reply]
    );

    res.json({ reply });

  } catch (err) { // ✅ NOW this makes sense — it closes the try above
    console.error("Chat error:", err);
    res.status(500).json({ error: "AI response failed" });
  }
});


app.post("/api/send-initial-message", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { girlId } = req.body;
  const girl = profiles.find(g => g.id === Number(girlId));
  if (!girl) return res.status(404).json({ error: "Girl not found" });

  try {
    // ✅ 1. Check user's credit balance
    const userRes = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.lifetime && user.credits <= 0) {
      return res.status(403).json({ error: "You’ve run out of messages. Please purchase more credits." });
    }

    // ✅ 2. Insert the message
    const messages = Object.values(firstMessages);
    const text = messages[Math.floor(Math.random() * messages.length)];

    await pool.query(
      `INSERT INTO messages (user_id, girl_id, from_user, text) VALUES ($1, $2, false, $3)`,
      [userId, girlId, text]
    );

    // ✅ No credit deduction — girl is starting the chat


    res.json({ message: "Initial message sent", text });
  } catch (err) {
    console.error("Initial message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
    app.get("/api/credits", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query("SELECT credits, lifetime FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });

    res.json(result.rows[0]); // { credits: 10, lifetime: false }
  } catch (err) {
    console.error("Credit fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/create-payment-intent", authenticateToken, async (req, res) => {
  const { priceId } = req.body;

  try {
    // Lookup price based on priceId (you can store the amounts instead if needed)
    const amountMap = {
      "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 500,
      "price_1RsdzREJXIhiKzYG45b69nSl": 2000,
      "price_1Rt6NcEJXIhiKzYGMsEZFd8f": 10000000
    };

// -----------------------------------------
// 32p trial: create PaymentIntent (no receipts)
// -----------------------------------------
app.post("/api/trial-intent", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's email (might be invalid; that's OK)
    const r = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: "User not found" });
    const rawEmail = r.rows[0].email || "";

    // Simple check; we will NOT send invalid emails to Stripe
    const looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);

    // Create a Customer WITHOUT email if it's invalid (prevents Stripe 400)
    const customer = await stripe.customers.create(
      looksValid
        ? { email: rawEmail, metadata: { userId: String(userId) } }
        : { metadata: { userId: String(userId) } }
    );

    // Create 32p trial PI — DO NOT pass receipt_email
    const pi = await stripe.paymentIntents.create({
      amount: 100,
      currency: "gbp",
      customer: customer.id,
      metadata: { userId: String(userId), kind: "trial-32p" },
      automatic_payment_methods: { enabled: true }
    });

    return res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error("trial-intent error:", err);
    return res.status(400).json({ error: err.message });
  }
});


    const amount = amountMap[priceId];
    if (!amount) return res.status(400).json({ error: "Invalid priceId" });

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "gbp",
      metadata: { userId: req.user.id.toString(), priceId },
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("PaymentIntent error:", err.message);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});


// === TRIAL FLOW: £0.50 now, then £5 in 2 days, then £5 monthly ===

// 1) Create the 32p PaymentIntent (client will confirm it)
app.post("/api/trial-intent", authenticateToken, async (req, res) => {
  try {
    // Optional: pull email to use on the Customer later
    const { rows } = await pool.query("SELECT email FROM users WHERE id = $1", [req.user.id]);
    const email = rows?.[0]?.email || undefined;

    const pi = await stripe.paymentIntents.create({
      amount: 32,                 // £0.50
      currency: "gbp",
      // Save PM for off-session use later once confirmed
      setup_future_usage: "off_session",
      // Not creating a Customer yet; we'll attach PM later
      metadata: {
        userId: String(req.user.id),
        purpose: "trial32"
      },
      description: "Charmr 2-day trial (£0.50)",
      receipt_email: email
    });

    res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error("trial-intent error:", err);
    res.status(500).json({ error: "trial-intent failed" });
  }
});

// 2) After the 32p PI succeeds on the client, create the subscription
app.post("/api/subscribe-trial", authenticateToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: "Missing paymentIntentId" });

    // Get user (for email)
    const { rows } = await pool.query("SELECT email FROM users WHERE id = $1", [req.user.id]);
    const email = rows?.[0]?.email;

    // Look up the PI we just confirmed
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi || pi.status !== "succeeded" || pi.amount !== 32) {
      return res.status(400).json({ error: "Trial payment not found/succeeded" });
    }
    const paymentMethodId = pi.payment_method;
    if (!paymentMethodId) {
      return res.status(400).json({ error: "No payment method on trial payment" });
    }

    // Create a Customer and attach the card
    const customer = await stripe.customers.create({
      email,
      metadata: { userId: String(req.user.id) }
    });
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    // Make it default on the customer
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });

    // Create the subscription with a 2-day free trial; first £5 happens at trial end,
    // then monthly thereafter (same £5).
    const monthlyPrice = process.env.STRIPE_PRICE_5_GBP_MONTHLY;
    if (!monthlyPrice) {
      return res.status(500).json({ error: "Missing STRIPE_PRICE_5_GBP_MONTHLY env var" });
    }

    const twoDaysFromNow = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: monthlyPrice }],
      trial_end: twoDaysFromNow,                 // charge £5 in 2 days
      payment_behavior: "default_incomplete",    // safest; invoice will finalize at trial end
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        userId: String(req.user.id),
        plan: "5gbp-monthly"
      }
    });

    // At this point:
    // - £0.50 was already paid
    // - Stripe will auto-invoice £5 at trial_end and then monthly

    res.json({ ok: true, subscriptionId: subscription.id });
  } catch (err) {
    console.error("subscribe-trial error:", err);
    res.status(500).json({ error: "subscribe-trial failed" });
  }
});


import bodyParser from "body-parser"; // Add this at the top if not present

// ===== TRIAL FLOW ENDPOINTS (0.50 now → trial 2 days → £5/mo) =====

// Creates a 32p PaymentIntent and a Customer for this user.
// The PI is confirmed on the client. We save the PM for the upcoming subscription.
app.post("/api/trial-intent", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Look up user email
    const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });
    const email = userRes.rows[0].email;

    // Create a Customer in Stripe
    const customer = await stripe.customers.create({ email });

    // Create a 32p PaymentIntent
    const pi = await stripe.paymentIntents.create({
      amount: 32, // 32 pence
      currency: "gbp",
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      setup_future_usage: "off_session",
      metadata: {
        userId: String(userId),
        kind: "trial_32p"
      }
    });

    res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      customerId: customer.id
    });
  } catch (err) {
    console.error("trial-intent error:", err);
    res.status(500).json({ error: "trial-intent failed" });
  }
});

// Called after 32p PI is confirmed — creates £5/mo subscription with 2-day trial
app.post("/api/subscribe-trial", authenticateToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: "paymentIntentId required" });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!pi || pi.status !== "succeeded") {
      return res.status(400).json({ error: "32p payment not succeeded" });
    }

    const customerId = pi.customer;
    const paymentMethodId = pi.payment_method;
    if (!customerId || !paymentMethodId) {
      return res.status(400).json({ error: "Missing customer/payment method" });
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    const priceId = process.env.STRIPE_SUB_PRICE_5;
    if (!priceId) {
      return res.status(500).json({ error: "Missing env STRIPE_SUB_PRICE_5" });
    }

    const twoDaysFromNow = Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60);

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_end: twoDaysFromNow,
      metadata: {
        userId: String(req.user.id),
        kind: "sub_5gbp_after_2d"
      },
      expand: ["latest_invoice.payment_intent"]
    });

    res.json({ ok: true, subscriptionId: subscription.id });
  } catch (err) {
    console.error("subscribe-trial error:", err);
    res.status(500).json({ error: "subscribe-trial failed" });
  }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ THIS is where the switch starts
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const priceId = session.metadata?.priceId;

      console.log('✅ Payment received for user ID:', userId, 'with price ID:', priceId);

      const amountMap = {
        "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 10,
        "price_1RsdzREJXIhiKzYG45b69nSl": 50,
        "price_1Rse1SEJXIhiKzYGhUalpwBS": "lifetime"
      };

      const value = amountMap[priceId];

      if (userId && value !== undefined) {
        try {
            if (value === "lifetime") {
  await pool.query(`UPDATE users SET lifetime = true WHERE id = $1`, [userId]);
  console.log(`✅ Lifetime access granted to user ${userId}`);
} else {
  await pool.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [value, userId]);
  console.log(`✅ Added ${value} credits to user ${userId}`);
}

     
        } catch (err) {
          console.error("❌ Failed to update user payment record:", err.message);
        }
      } else {
        console.error("❌ Missing userId or invalid priceId in metadata");
      }

      break;
    }
  case 'invoice.payment_succeeded': {
    const invoice = event.data.object;
    const subId = invoice.subscription;
    const amountPaid = invoice.amount_paid; // in pence
    const customerId = invoice.customer;

    console.log("✅ invoice.payment_succeeded", {
      subId,
      customerId,
      amountPaidGBP: (amountPaid / 100).toFixed(2)
    });

    // Example: add credits or trigger other logic on renewal
    // if (amountPaid === 500) {
    //   const userId = invoice.metadata?.userId;
    //   await pool.query(
    //     `UPDATE users SET credits = credits + $1 WHERE id = $2`,
    //     [10, userId]
    //   );
    // }

    break;
  }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send('Received');
});

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Premium Chat Credits',
              description: 'Unlock 100 credits',
            },
            unit_amount: 499, // $4.99
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: `${req.headers.origin}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
