import express from "express";
import cors from "cors";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

// Define __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "yoursecretkey";

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        gender TEXT,
        lookingfor TEXT,
        phone TEXT,
        credits INT DEFAULT 3,
        lifetime BOOLEAN DEFAULT false
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
  { id: 1, name: "Evie Hughes", age: 29, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 2, name: "Evie Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 3, name: "Grace Johnson", age: 20, city: "London", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  { id: 4, name: "Amelia Davies", age: 27, city: "Swansea", image: "https://randomuser.me/api/portraits/women/4.jpg" },
  { id: 5, name: "Charlotte Hall", age: 37, city: "Glasgow", image: "https://randomuser.me/api/portraits/women/5.jpg" },
  { id: 6, name: "Evie White", age: 25, city: "Exeter", image: "https://randomuser.me/api/portraits/women/6.jpg" },
  { id: 7, name: "Sophie Evans", age: 23, city: "Bristol", image: "https://randomuser.me/api/portraits/women/7.jpg" },
  { id: 8, name: "Isla Wilson", age: 40, city: "Belfast", image: "https://randomuser.me/api/portraits/women/8.jpg" },
  { id: 9, name: "Amelia Lewis", age: 22, city: "Norwich", image: "https://randomuser.me/api/portraits/women/9.jpg" },
  { id: 10, name: "Freya Evans", age: 37, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/10.jpg" },
  { id: 11, name: "Sophie Williams", age: 36, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/11.jpg" },
  { id: 12, name: "Scarlett Thomas", age: 21, city: "Bristol", image: "https://randomuser.me/api/portraits/women/12.jpg" },
  { id: 13, name: "Daisy White", age: 37, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/13.jpg" },
  { id: 14, name: "Freya Wright", age: 23, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/14.jpg" },
  { id: 15, name: "Freya Jones", age: 36, city: "London", image: "https://randomuser.me/api/portraits/women/15.jpg" },
  { id: 16, name: "Sophie White", age: 40, city: "Swindon", image: "https://randomuser.me/api/portraits/women/16.jpg" },
  { id: 17, name: "Olivia Brown", age: 27, city: "Leicester", image: "https://randomuser.me/api/portraits/women/17.jpg" },
  { id: 18, name: "Olivia Evans", age: 37, city: "Worcester", image: "https://randomuser.me/api/portraits/women/18.jpg" },
  { id: 19, name: "Evie Wilson", age: 19, city: "Coventry", image: "https://randomuser.me/api/portraits/women/19.jpg" },
  { id: 20, name: "Sophie Thompson", age: 26, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/20.jpg" },
  { id: 21, name: "Sophia Hall", age: 31, city: "Dundee", image: "https://randomuser.me/api/portraits/women/21.jpg" },
  { id: 22, name: "Ella Hughes", age: 20, city: "York", image: "https://randomuser.me/api/portraits/women/22.jpg" },
  { id: 23, name: "Amelia Wright", age: 18, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/23.jpg" },
  { id: 24, name: "Florence Edwards", age: 34, city: "Bath", image: "https://randomuser.me/api/portraits/women/24.jpg" },
  { id: 25, name: "Sophia Wilson", age: 21, city: "Stoke-on-Trent", image: "https://randomuser.me/api/portraits/women/25.jpg" },
  { id: 26, name: "Lily White", age: 20, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/26.jpg" },
  { id: 27, name: "Ava Brown", age: 38, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/27.jpg" },
  { id: 28, name: "Daisy Lewis", age: 20, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/28.jpg" },
  { id: 29, name: "Ava Walker", age: 29, city: "Slough", image: "https://randomuser.me/api/portraits/women/29.jpg" },
  { id: 30, name: "Jessica Brown", age: 35, city: "Newport", image: "https://randomuser.me/api/portraits/women/30.jpg" },
  { id: 31, name: "Daisy Smith", age: 19, city: "Belfast", image: "https://randomuser.me/api/portraits/women/31.jpg" },
  { id: 32, name: "Mia Wright", age: 24, city: "Dundee", image: "https://randomuser.me/api/portraits/women/32.jpg" },
  { id: 33, name: "Isla Thompson", age: 34, city: "Leeds", image: "https://randomuser.me/api/portraits/women/33.jpg" },
  { id: 34, name: "Olivia Johnson", age: 40, city: "Newport", image: "https://randomuser.me/api/portraits/women/34.jpg" },
  { id: 35, name: "Sophie Thompson", age: 37, city: "Belfast", image: "https://randomuser.me/api/portraits/women/35.jpg" },
  { id: 36, name: "Amelia Lewis", age: 19, city: "Bath", image: "https://randomuser.me/api/portraits/women/36.jpg" },
  { id: 37, name: "Grace White", age: 37, city: "Oxford", image: "https://randomuser.me/api/portraits/women/37.jpg" },
  { id: 38, name: "Ella Evans", age: 27, city: "Slough", image: "https://randomuser.me/api/portraits/women/38.jpg" },
  { id: 39, name: "Sophie Edwards", age: 18, city: "Reading", image: "https://randomuser.me/api/portraits/women/39.jpg" },
  { id: 40, name: "Charlotte Wilson", age: 23, city: "Luton", image: "https://randomuser.me/api/portraits/women/40.jpg" },
  { id: 41, name: "Daisy White", age: 40, city: "Swindon", image: "https://randomuser.me/api/portraits/women/41.jpg" },
  { id: 42, name: "Poppy White", age: 40, city: "Exeter", image: "https://randomuser.me/api/portraits/women/42.jpg" },
  { id: 43, name: "Amelia Evans", age: 32, city: "Slough", image: "https://randomuser.me/api/portraits/women/43.jpg" },
  { id: 44, name: "Ella Johnson", age: 34, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/44.jpg" },
  { id: 45, name: "Mia Johnson", age: 22, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/45.jpg" },
  { id: 46, name: "Charlotte Walker", age: 40, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/46.jpg" },
  { id: 47, name: "Emily Johnson", age: 24, city: "Telford", image: "https://randomuser.me/api/portraits/women/47.jpg" },
  { id: 48, name: "Freya Brown", age: 29, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/48.jpg" },
  { id: 49, name: "Charlotte White", age: 39, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/49.jpg" },
  { id: 50, name: "Florence Evans", age: 19, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/50.jpg" },
  { id: 51, name: "Evie Wilson", age: 27, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/51.jpg" },
  { id: 52, name: "Lily Thomas", age: 25, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/52.jpg" },
  { id: 53, name: "Daisy Hughes", age: 34, city: "London", image: "https://randomuser.me/api/portraits/women/53.jpg" },
  { id: 54, name: "Emily Wilson", age: 24, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/54.jpg" },
  { id: 55, name: "Isla Brown", age: 21, city: "Colchester", image: "https://randomuser.me/api/portraits/women/55.jpg" },
  { id: 56, name: "Poppy Taylor", age: 25, city: "Manchester", image: "https://randomuser.me/api/portraits/women/56.jpg" },
  { id: 57, name: "Daisy Smith", age: 28, city: "Stockport", image: "https://randomuser.me/api/portraits/women/57.jpg" },
  { id: 58, name: "Isabella Walker", age: 40, city: "Bolton", image: "https://randomuser.me/api/portraits/women/58.jpg" },
  { id: 59, name: "Isla Williams", age: 21, city: "Inverness", image: "https://randomuser.me/api/portraits/women/59.jpg" },
  { id: 60, name: "Isabella Wright", age: 39, city: "Preston", image: "https://randomuser.me/api/portraits/women/60.jpg" },
  { id: 61, name: "Charlotte Davies", age: 35, city: "Ipswich", image: "https://randomuser.me/api/portraits/women/61.jpg" },
  { id: 62, name: "Amelia Davies", age: 26, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/62.jpg" },
  { id: 63, name: "Isla Wilson", age: 25, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/63.jpg" },
  { id: 64, name: "Isabella Hall", age: 21, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/64.jpg" },
  { id: 65, name: "Poppy Brown", age: 37, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/65.jpg" },
  { id: 66, name: "Freya Thompson", age: 18, city: "Bradford", image: "https://randomuser.me/api/portraits/women/66.jpg" },
  { id: 67, name: "Florence White", age: 29, city: "Leeds", image: "https://randomuser.me/api/portraits/women/67.jpg" },
  { id: 68, name: "Daisy Walker", age: 20, city: "Northampton", image: "https://randomuser.me/api/portraits/women/68.jpg" },
  { id: 69, name: "Amelia Thompson", age: 31, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/69.jpg" },
  { id: 70, name: "Freya Brown", age: 25, city: "Derby", image: "https://randomuser.me/api/portraits/women/70.jpg" },
  { id: 71, name: "Emily Thomas", age: 36, city: "Bath", image: "https://randomuser.me/api/portraits/women/71.jpg" },
  { id: 72, name: "Florence Johnson", age: 32, city: "Northampton", image: "https://randomuser.me/api/portraits/women/72.jpg" },
  { id: 73, name: "Charlotte Smith", age: 23, city: "Stockport", image: "https://randomuser.me/api/portraits/women/73.jpg" },
  { id: 74, name: "Emily Evans", age: 19, city: "London", image: "https://randomuser.me/api/portraits/women/74.jpg" },
  { id: 75, name: "Poppy Edwards", age: 33, city: "Southampton", image: "https://randomuser.me/api/portraits/women/75.jpg" },
  { id: 76, name: "Mia Lewis", age: 35, city: "Southampton", image: "https://randomuser.me/api/portraits/women/76.jpg" },
  { id: 77, name: "Daisy Davies", age: 21, city: "Bristol", image: "https://randomuser.me/api/portraits/women/77.jpg" },
  { id: 78, name: "Ella Thomas", age: 34, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/78.jpg" },
  { id: 79, name: "Sophie Edwards", age: 21, city: "Bath", image: "https://randomuser.me/api/portraits/women/79.jpg" },
  { id: 80, name: "Jessica Edwards", age: 39, city: "York", image: "https://randomuser.me/api/portraits/women/80.jpg" },
  { id: 81, name: "Grace Wright", age: 28, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/81.jpg" },
  { id: 82, name: "Isla Thomas", age: 22, city: "Colchester", image: "https://randomuser.me/api/portraits/women/82.jpg" },
  { id: 83, name: "Freya Williams", age: 24, city: "Luton", image: "https://randomuser.me/api/portraits/women/83.jpg" },
  { id: 84, name: "Ava Evans", age: 27, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/84.jpg" },
  { id: 85, name: "Poppy Brown", age: 27, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/85.jpg" },
  { id: 86, name: "Emily Green", age: 40, city: "Exeter", image: "https://randomuser.me/api/portraits/women/86.jpg" },
  { id: 87, name: "Isabella White", age: 38, city: "Belfast", image: "https://randomuser.me/api/portraits/women/87.jpg" },
  { id: 88, name: "Sophie Thompson", age: 20, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/88.jpg" },
  { id: 89, name: "Amelia Green", age: 33, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/89.jpg" },
  { id: 90, name: "Ella Smith", age: 38, city: "Derry", image: "https://randomuser.me/api/portraits/women/90.jpg" },
  { id: 91, name: "Ava Johnson", age: 25, city: "Leicester", image: "https://randomuser.me/api/portraits/women/91.jpg" },
  { id: 92, name: "Grace Jones", age: 19, city: "Oxford", image: "https://randomuser.me/api/portraits/women/92.jpg" },
  { id: 93, name: "Scarlett Wilson", age: 23, city: "Leeds", image: "https://randomuser.me/api/portraits/women/93.jpg" },
  { id: 94, name: "Poppy Walker", age: 21, city: "Manchester", image: "https://randomuser.me/api/portraits/women/94.jpg" },
  { id: 95, name: "Amelia Davies", age: 38, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/95.jpg" },
  { id: 96, name: "Emily Green", age: 23, city: "Dundee", image: "https://randomuser.me/api/portraits/women/96.jpg" },
  { id: 97, name: "Florence Taylor", age: 18, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/97.jpg" },
  { id: 98, name: "Lily Wilson", age: 32, city: "Belfast", image: "https://randomuser.me/api/portraits/women/98.jpg" },
  { id: 99, name: "Jessica Thompson", age: 25, city: "Leicester", image: "https://randomuser.me/api/portraits/women/99.jpg" },
  { id: 100, name: "Freya Wright", age: 34, city: "Bolton", image: "https://randomuser.me/api/portraits/women/0.jpg" },
  { id: 101, name: "Florence Taylor", age: 35, city: "Sheffield", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 102, name: "Evie Brown", age: 20, city: "Oxford", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 103, name: "Grace White", age: 33, city: "Southampton", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  { id: 104, name: "Florence Thomas", age: 31, city: "York", image: "https://randomuser.me/api/portraits/women/4.jpg" },
  { id: 105, name: "Isabella Brown", age: 24, city: "Preston", image: "https://randomuser.me/api/portraits/women/5.jpg" },
  { id: 106, name: "Jessica Hughes", age: 36, city: "Slough", image: "https://randomuser.me/api/portraits/women/6.jpg" },
  { id: 107, name: "Daisy Brown", age: 37, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/7.jpg" },
  { id: 108, name: "Amelia Hughes", age: 34, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/8.jpg" },
  { id: 109, name: "Grace Robinson", age: 34, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/9.jpg" },
  { id: 110, name: "Amelia Jones", age: 38, city: "Exeter", image: "https://randomuser.me/api/portraits/women/10.jpg" },
  { id: 111, name: "Sophia Hall", age: 31, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/11.jpg" },
  { id: 112, name: "Evie Green", age: 27, city: "Worcester", image: "https://randomuser.me/api/portraits/women/12.jpg" },
  { id: 113, name: "Sophia Edwards", age: 35, city: "Colchester", image: "https://randomuser.me/api/portraits/women/13.jpg" },
  { id: 114, name: "Mia Wright", age: 22, city: "Colchester", image: "https://randomuser.me/api/portraits/women/14.jpg" },
  { id: 115, name: "Freya Wright", age: 19, city: "Bolton", image: "https://randomuser.me/api/portraits/women/15.jpg" },
  { id: 116, name: "Charlotte Davies", age: 22, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/16.jpg" },
  { id: 117, name: "Olivia Edwards", age: 31, city: "Preston", image: "https://randomuser.me/api/portraits/women/17.jpg" },
  { id: 118, name: "Grace Hughes", age: 25, city: "Northampton", image: "https://randomuser.me/api/portraits/women/18.jpg" },
  { id: 119, name: "Sophia Williams", age: 24, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/19.jpg" },
  { id: 120, name: "Sophie Hall", age: 28, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/20.jpg" },
  { id: 121, name: "Amelia Smith", age: 25, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/21.jpg" },
  { id: 122, name: "Jessica Thomas", age: 39, city: "Belfast", image: "https://randomuser.me/api/portraits/women/22.jpg" },
  { id: 123, name: "Grace Hall", age: 25, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/23.jpg" },
  { id: 124, name: "Grace Taylor", age: 39, city: "Leicester", image: "https://randomuser.me/api/portraits/women/24.jpg" },
  { id: 125, name: "Olivia Wright", age: 34, city: "Southampton", image: "https://randomuser.me/api/portraits/women/25.jpg" },
  { id: 126, name: "Sophia Taylor", age: 19, city: "Southampton", image: "https://randomuser.me/api/portraits/women/26.jpg" },
  { id: 127, name: "Ella Wilson", age: 19, city: "Inverness", image: "https://randomuser.me/api/portraits/women/27.jpg" },
  { id: 128, name: "Florence Smith", age: 32, city: "Leicester", image: "https://randomuser.me/api/portraits/women/28.jpg" },
  { id: 129, name: "Amelia White", age: 25, city: "Bradford", image: "https://randomuser.me/api/portraits/women/29.jpg" },
  { id: 130, name: "Scarlett Lewis", age: 33, city: "Stoke-on-Trent", image: "https://randomuser.me/api/portraits/women/30.jpg" },
  { id: 131, name: "Ella Jones", age: 21, city: "Stoke-on-Trent", image: "https://randomuser.me/api/portraits/women/31.jpg" },
  { id: 132, name: "Freya Wright", age: 38, city: "Ipswich", image: "https://randomuser.me/api/portraits/women/32.jpg" },
  { id: 133, name: "Evie Smith", age: 22, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/33.jpg" },
  { id: 134, name: "Emily Walker", age: 38, city: "Coventry", image: "https://randomuser.me/api/portraits/women/34.jpg" },
  { id: 135, name: "Charlotte Hughes", age: 23, city: "Newport", image: "https://randomuser.me/api/portraits/women/35.jpg" },
  { id: 136, name: "Grace Edwards", age: 30, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/36.jpg" },
  { id: 137, name: "Charlotte Robinson", age: 28, city: "York", image: "https://randomuser.me/api/portraits/women/37.jpg" },
  { id: 138, name: "Ella Thomas", age: 30, city: "Swindon", image: "https://randomuser.me/api/portraits/women/38.jpg" },
  { id: 139, name: "Emily Hughes", age: 29, city: "Stockport", image: "https://randomuser.me/api/portraits/women/39.jpg" },
  { id: 140, name: "Grace Johnson", age: 40, city: "Coventry", image: "https://randomuser.me/api/portraits/women/40.jpg" },
  { id: 141, name: "Sophie White", age: 24, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/41.jpg" },
  { id: 142, name: "Scarlett Walker", age: 20, city: "Slough", image: "https://randomuser.me/api/portraits/women/42.jpg" },
  { id: 143, name: "Grace White", age: 21, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/43.jpg" },
  { id: 144, name: "Jessica Walker", age: 26, city: "Swansea", image: "https://randomuser.me/api/portraits/women/44.jpg" },
  { id: 145, name: "Florence Thomas", age: 19, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/45.jpg" },
  { id: 146, name: "Olivia Thomas", age: 33, city: "Oxford", image: "https://randomuser.me/api/portraits/women/46.jpg" },
  { id: 147, name: "Florence Hughes", age: 29, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/47.jpg" },
  { id: 148, name: "Daisy Thompson", age: 23, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/48.jpg" },
  { id: 149, name: "Amelia Hall", age: 18, city: "Bolton", image: "https://randomuser.me/api/portraits/women/49.jpg" },
  { id: 150, name: "Evie Brown", age: 23, city: "Worcester", image: "https://randomuser.me/api/portraits/women/50.jpg" },
  { id: 151, name: "Mia Thompson", age: 20, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/51.jpg" },
  { id: 152, name: "Florence Hall", age: 38, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/52.jpg" },
  { id: 153, name: "Poppy Robinson", age: 36, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/53.jpg" },
  { id: 154, name: "Ella Wilson", age: 38, city: "Southampton", image: "https://randomuser.me/api/portraits/women/54.jpg" },
  { id: 155, name: "Isla Smith", age: 26, city: "London", image: "https://randomuser.me/api/portraits/women/55.jpg" },
  { id: 156, name: "Mia White", age: 37, city: "Stockport", image: "https://randomuser.me/api/portraits/women/56.jpg" },
  { id: 157, name: "Ava Williams", age: 35, city: "Southampton", image: "https://randomuser.me/api/portraits/women/57.jpg" },
  { id: 158, name: "Olivia Hughes", age: 31, city: "Preston", image: "https://randomuser.me/api/portraits/women/58.jpg" },
  { id: 159, name: "Isla Smith", age: 25, city: "Kingston upon Hull", image: "https://randomuser.me/api/portraits/women/59.jpg" },
  { id: 160, name: "Ella Thomas", age: 20, city: "Preston", image: "https://randomuser.me/api/portraits/women/60.jpg" },
  { id: 161, name: "Freya Taylor", age: 34, city: "Bradford", image: "https://randomuser.me/api/portraits/women/61.jpg" },
  { id: 162, name: "Jessica Thompson", age: 34, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/62.jpg" },
  { id: 163, name: "Jessica Brown", age: 28, city: "Luton", image: "https://randomuser.me/api/portraits/women/63.jpg" },
  { id: 164, name: "Scarlett Hall", age: 32, city: "Sheffield", image: "https://randomuser.me/api/portraits/women/64.jpg" },
  { id: 165, name: "Freya Brown", age: 19, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/65.jpg" },
  { id: 166, name: "Amelia Taylor", age: 37, city: "Derby", image: "https://randomuser.me/api/portraits/women/66.jpg" },
  { id: 167, name: "Freya Thomas", age: 40, city: "Telford", image: "https://randomuser.me/api/portraits/women/67.jpg" },
  { id: 168, name: "Scarlett Evans", age: 25, city: "Newport", image: "https://randomuser.me/api/portraits/women/68.jpg" },
  { id: 169, name: "Evie Thomas", age: 27, city: "Lincoln", image: "https://randomuser.me/api/portraits/women/69.jpg" },
  { id: 170, name: "Ella Williams", age: 20, city: "Nottingham", image: "https://randomuser.me/api/portraits/women/70.jpg" },
  { id: 171, name: "Ella Williams", age: 35, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/71.jpg" },
  { id: 172, name: "Jessica Taylor", age: 31, city: "Derby", image: "https://randomuser.me/api/portraits/women/72.jpg" },
  { id: 173, name: "Daisy Lewis", age: 33, city: "Reading", image: "https://randomuser.me/api/portraits/women/73.jpg" },
  { id: 174, name: "Poppy Lewis", age: 33, city: "Exeter", image: "https://randomuser.me/api/portraits/women/74.jpg" },
  { id: 175, name: "Daisy Brown", age: 25, city: "Newport", image: "https://randomuser.me/api/portraits/women/75.jpg" },
  { id: 176, name: "Isabella Hughes", age: 39, city: "Lincoln", image: "https://randomuser.me/api/portraits/women/76.jpg" },
  { id: 177, name: "Isabella Johnson", age: 28, city: "Reading", image: "https://randomuser.me/api/portraits/women/77.jpg" },
  { id: 178, name: "Mia Hughes", age: 25, city: "York", image: "https://randomuser.me/api/portraits/women/78.jpg" },
  { id: 179, name: "Ava Jones", age: 33, city: "York", image: "https://randomuser.me/api/portraits/women/79.jpg" },
  { id: 180, name: "Jessica Walker", age: 27, city: "Glasgow", image: "https://randomuser.me/api/portraits/women/80.jpg" },
  { id: 181, name: "Ava Johnson", age: 39, city: "Bolton", image: "https://randomuser.me/api/portraits/women/81.jpg" },
  { id: 182, name: "Sophie Robinson", age: 40, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/82.jpg" },
  { id: 183, name: "Isabella Hall", age: 36, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/83.jpg" },
  { id: 184, name: "Sophia Davies", age: 25, city: "Belfast", image: "https://randomuser.me/api/portraits/women/84.jpg" },
  { id: 185, name: "Sophie Robinson", age: 25, city: "London", image: "https://randomuser.me/api/portraits/women/85.jpg" },
  { id: 186, name: "Sophie Jones", age: 38, city: "Northampton", image: "https://randomuser.me/api/portraits/women/86.jpg" },
  { id: 187, name: "Poppy Lewis", age: 33, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/87.jpg" },
  { id: 188, name: "Sophie Williams", age: 20, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/88.jpg" },
  { id: 189, name: "Isabella Green", age: 25, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/89.jpg" },
  { id: 190, name: "Charlotte Johnson", age: 28, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/90.jpg" },
  { id: 191, name: "Lily Evans", age: 31, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/91.jpg" },
  { id: 192, name: "Freya Johnson", age: 32, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/92.jpg" },
  { id: 193, name: "Emily Hughes", age: 25, city: "Telford", image: "https://randomuser.me/api/portraits/women/93.jpg" },
  { id: 194, name: "Mia Brown", age: 32, city: "Ipswich", image: "https://randomuser.me/api/portraits/women/94.jpg" },
  { id: 195, name: "Olivia Walker", age: 35, city: "Bath", image: "https://randomuser.me/api/portraits/women/95.jpg" },
  { id: 196, name: "Poppy Evans", age: 25, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/96.jpg" },
  { id: 197, name: "Isabella Thompson", age: 33, city: "Sheffield", image: "https://randomuser.me/api/portraits/women/97.jpg" },
  { id: 198, name: "Sophie Wright", age: 22, city: "Coventry", image: "https://randomuser.me/api/portraits/women/98.jpg" },
  { id: 199, name: "Ava Walker", age: 29, city: "Northampton", image: "https://randomuser.me/api/portraits/women/99.jpg" },
  { id: 200, name: "Ava White", age: 20, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/0.jpg" },
  { id: 201, name: "Ella Taylor", age: 31, city: "Belfast", image: "https://randomuser.me/api/portraits/women/1.jpg" },
  { id: 202, name: "Isla Robinson", age: 38, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/2.jpg" },
  { id: 203, name: "Emily Hughes", age: 32, city: "Bradford", image: "https://randomuser.me/api/portraits/women/3.jpg" },
  { id: 204, name: "Evie Thomas", age: 38, city: "Inverness", image: "https://randomuser.me/api/portraits/women/4.jpg" },
  { id: 205, name: "Freya Taylor", age: 28, city: "Leicester", image: "https://randomuser.me/api/portraits/women/5.jpg" },
  { id: 206, name: "Sophie Johnson", age: 33, city: "Worcester", image: "https://randomuser.me/api/portraits/women/6.jpg" },
  { id: 207, name: "Jessica Jones", age: 28, city: "Belfast", image: "https://randomuser.me/api/portraits/women/7.jpg" },
  { id: 208, name: "Ava Jones", age: 21, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/8.jpg" },
  { id: 209, name: "Isla Evans", age: 18, city: "Bristol", image: "https://randomuser.me/api/portraits/women/9.jpg" },
  { id: 210, name: "Jessica Davies", age: 23, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/10.jpg" },
  { id: 211, name: "Ava White", age: 38, city: "Glasgow", image: "https://randomuser.me/api/portraits/women/11.jpg" },
  { id: 212, name: "Sophia Green", age: 25, city: "Telford", image: "https://randomuser.me/api/portraits/women/12.jpg" },
  { id: 213, name: "Poppy Edwards", age: 20, city: "Northampton", image: "https://randomuser.me/api/portraits/women/13.jpg" },
  { id: 214, name: "Daisy Hughes", age: 38, city: "Dundee", image: "https://randomuser.me/api/portraits/women/14.jpg" },
  { id: 215, name: "Ava Walker", age: 26, city: "Lincoln", image: "https://randomuser.me/api/portraits/women/15.jpg" },
  { id: 216, name: "Sophia Evans", age: 18, city: "Coventry", image: "https://randomuser.me/api/portraits/women/16.jpg" },
  { id: 217, name: "Emily Davies", age: 19, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/17.jpg" },
  { id: 218, name: "Olivia Hall", age: 29, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/18.jpg" },
  { id: 219, name: "Olivia Hughes", age: 40, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/19.jpg" },
  { id: 220, name: "Mia White", age: 29, city: "Wigan", image: "https://randomuser.me/api/portraits/women/20.jpg" },
  { id: 221, name: "Scarlett White", age: 35, city: "Derry", image: "https://randomuser.me/api/portraits/women/21.jpg" },
  { id: 222, name: "Poppy Wilson", age: 21, city: "Oxford", image: "https://randomuser.me/api/portraits/women/22.jpg" },
  { id: 223, name: "Isabella Davies", age: 22, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/23.jpg" },
  { id: 224, name: "Sophia Smith", age: 32, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/24.jpg" },
  { id: 225, name: "Freya Smith", age: 34, city: "Newcastle", image: "https://randomuser.me/api/portraits/women/25.jpg" },
  { id: 226, name: "Sophie Johnson", age: 39, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/26.jpg" },
  { id: 227, name: "Evie Green", age: 35, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/27.jpg" },
  { id: 228, name: "Sophie Wilson", age: 33, city: "Colchester", image: "https://randomuser.me/api/portraits/women/28.jpg" },
  { id: 229, name: "Charlotte Smith", age: 27, city: "Swindon", image: "https://randomuser.me/api/portraits/women/29.jpg" },
  { id: 230, name: "Sophie Wilson", age: 22, city: "Slough", image: "https://randomuser.me/api/portraits/women/30.jpg" },
  { id: 231, name: "Scarlett Lewis", age: 29, city: "Bath", image: "https://randomuser.me/api/portraits/women/31.jpg" },
  { id: 232, name: "Jessica Jones", age: 34, city: "Derry", image: "https://randomuser.me/api/portraits/women/32.jpg" },
  { id: 233, name: "Isla Davies", age: 39, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/33.jpg" },
  { id: 234, name: "Amelia Brown", age: 28, city: "Wigan", image: "https://randomuser.me/api/portraits/women/34.jpg" },
  { id: 235, name: "Emily Walker", age: 36, city: "Wigan", image: "https://randomuser.me/api/portraits/women/35.jpg" },
  { id: 236, name: "Sophia Edwards", age: 31, city: "Slough", image: "https://randomuser.me/api/portraits/women/36.jpg" },
  { id: 237, name: "Florence White", age: 31, city: "Belfast", image: "https://randomuser.me/api/portraits/women/37.jpg" },
  { id: 238, name: "Amelia Wilson", age: 22, city: "Bristol", image: "https://randomuser.me/api/portraits/women/38.jpg" },
  { id: 239, name: "Grace Thomas", age: 37, city: "Colchester", image: "https://randomuser.me/api/portraits/women/39.jpg" },
  { id: 240, name: "Mia Wright", age: 30, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/40.jpg" },
  { id: 241, name: "Florence White", age: 39, city: "London", image: "https://randomuser.me/api/portraits/women/41.jpg" },
  { id: 242, name: "Scarlett Davies", age: 36, city: "Middlesbrough", image: "https://randomuser.me/api/portraits/women/42.jpg" },
  { id: 243, name: "Jessica Lewis", age: 35, city: "Birmingham", image: "https://randomuser.me/api/portraits/women/43.jpg" },
  { id: 244, name: "Olivia Brown", age: 20, city: "Preston", image: "https://randomuser.me/api/portraits/women/44.jpg" },
  { id: 245, name: "Mia White", age: 32, city: "Reading", image: "https://randomuser.me/api/portraits/women/45.jpg" },
  { id: 246, name: "Ella Davies", age: 20, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/46.jpg" },
  { id: 247, name: "Charlotte Hughes", age: 20, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/47.jpg" },
  { id: 248, name: "Isabella Hall", age: 30, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/48.jpg" },
  { id: 249, name: "Freya Wright", age: 33, city: "Basingstoke", image: "https://randomuser.me/api/portraits/women/49.jpg" },
  { id: 250, name: "Freya Walker", age: 37, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/50.jpg" },
  { id: 251, name: "Ava Smith", age: 36, city: "Derby", image: "https://randomuser.me/api/portraits/women/51.jpg" },
  { id: 252, name: "Freya Lewis", age: 24, city: "Worcester", image: "https://randomuser.me/api/portraits/women/52.jpg" },
  { id: 253, name: "Scarlett Smith", age: 28, city: "Ipswich", image: "https://randomuser.me/api/portraits/women/53.jpg" },
  { id: 254, name: "Florence Thompson", age: 26, city: "Milton Keynes", image: "https://randomuser.me/api/portraits/women/54.jpg" },
  { id: 255, name: "Isla Hughes", age: 29, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/55.jpg" },
  { id: 256, name: "Jessica Thomas", age: 37, city: "Telford", image: "https://randomuser.me/api/portraits/women/56.jpg" },
  { id: 257, name: "Florence Thompson", age: 32, city: "Colchester", image: "https://randomuser.me/api/portraits/women/57.jpg" },
  { id: 258, name: "Ella Evans", age: 31, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/58.jpg" },
  { id: 259, name: "Florence Robinson", age: 27, city: "Wolverhampton", image: "https://randomuser.me/api/portraits/women/59.jpg" },
  { id: 260, name: "Poppy Hall", age: 27, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/60.jpg" },
  { id: 261, name: "Isla Davies", age: 22, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/61.jpg" },
  { id: 262, name: "Grace Williams", age: 23, city: "London", image: "https://randomuser.me/api/portraits/women/62.jpg" },
  { id: 263, name: "Grace Brown", age: 23, city: "Worcester", image: "https://randomuser.me/api/portraits/women/63.jpg" },
  { id: 264, name: "Ava Thompson", age: 30, city: "Reading", image: "https://randomuser.me/api/portraits/women/64.jpg" },
  { id: 265, name: "Sophia Robinson", age: 18, city: "Leicester", image: "https://randomuser.me/api/portraits/women/65.jpg" },
  { id: 266, name: "Freya Lewis", age: 40, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/66.jpg" },
  { id: 267, name: "Charlotte Wright", age: 19, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/67.jpg" },
  { id: 268, name: "Freya Hughes", age: 39, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/68.jpg" },
  { id: 269, name: "Charlotte Lewis", age: 23, city: "Northampton", image: "https://randomuser.me/api/portraits/women/69.jpg" },
  { id: 270, name: "Amelia Wilson", age: 26, city: "Swansea", image: "https://randomuser.me/api/portraits/women/70.jpg" },
  { id: 271, name: "Florence Brown", age: 28, city: "Stockport", image: "https://randomuser.me/api/portraits/women/71.jpg" },
  { id: 272, name: "Olivia Walker", age: 29, city: "Leeds", image: "https://randomuser.me/api/portraits/women/72.jpg" },
  { id: 273, name: "Amelia Walker", age: 39, city: "Colchester", image: "https://randomuser.me/api/portraits/women/73.jpg" },
  { id: 274, name: "Grace Smith", age: 35, city: "Blackpool", image: "https://randomuser.me/api/portraits/women/74.jpg" },
  { id: 275, name: "Poppy Jones", age: 23, city: "Leicester", image: "https://randomuser.me/api/portraits/women/75.jpg" },
  { id: 276, name: "Freya Wright", age: 18, city: "Norwich", image: "https://randomuser.me/api/portraits/women/76.jpg" },
  { id: 277, name: "Sophia Lewis", age: 35, city: "Dundee", image: "https://randomuser.me/api/portraits/women/77.jpg" },
  { id: 278, name: "Evie Wilson", age: 23, city: "Huddersfield", image: "https://randomuser.me/api/portraits/women/78.jpg" },
  { id: 279, name: "Ella Green", age: 35, city: "Northampton", image: "https://randomuser.me/api/portraits/women/79.jpg" },
  { id: 280, name: "Emily Evans", age: 36, city: "Inverness", image: "https://randomuser.me/api/portraits/women/80.jpg" },
  { id: 281, name: "Lily Davies", age: 35, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/81.jpg" },
  { id: 282, name: "Sophie Taylor", age: 18, city: "London", image: "https://randomuser.me/api/portraits/women/82.jpg" },
  { id: 283, name: "Isabella Green", age: 38, city: "Peterborough", image: "https://randomuser.me/api/portraits/women/83.jpg" },
  { id: 284, name: "Emily Edwards", age: 20, city: "Exeter", image: "https://randomuser.me/api/portraits/women/84.jpg" },
  { id: 285, name: "Emily Walker", age: 34, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/85.jpg" },
  { id: 286, name: "Lily Walker", age: 37, city: "Bristol", image: "https://randomuser.me/api/portraits/women/86.jpg" },
  { id: 287, name: "Florence Taylor", age: 37, city: "York", image: "https://randomuser.me/api/portraits/women/87.jpg" },
  { id: 288, name: "Sophie Jones", age: 24, city: "Cambridge", image: "https://randomuser.me/api/portraits/women/88.jpg" },
  { id: 289, name: "Emily Taylor", age: 34, city: "Cardiff", image: "https://randomuser.me/api/portraits/women/89.jpg" },
  { id: 290, name: "Mia Smith", age: 31, city: "Aberdeen", image: "https://randomuser.me/api/portraits/women/90.jpg" },
  { id: 291, name: "Ava Hall", age: 20, city: "Oxford", image: "https://randomuser.me/api/portraits/women/91.jpg" },
  { id: 292, name: "Charlotte Hall", age: 37, city: "Preston", image: "https://randomuser.me/api/portraits/women/92.jpg" },
  { id: 293, name: "Emily Evans", age: 30, city: "Northampton", image: "https://randomuser.me/api/portraits/women/93.jpg" },
  { id: 294, name: "Isabella Brown", age: 28, city: "Manchester", image: "https://randomuser.me/api/portraits/women/94.jpg" },
  { id: 295, name: "Ella Green", age: 35, city: "Swindon", image: "https://randomuser.me/api/portraits/women/95.jpg" },
  { id: 296, name: "Florence Smith", age: 18, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/96.jpg" },
  { id: 297, name: "Florence Davies", age: 22, city: "Derry", image: "https://randomuser.me/api/portraits/women/97.jpg" },
  { id: 298, name: "Ava Evans", age: 22, city: "Liverpool", image: "https://randomuser.me/api/portraits/women/98.jpg" },
  { id: 299, name: "Freya Robinson", age: 31, city: "Wakefield", image: "https://randomuser.me/api/portraits/women/99.jpg" },
  { id: 300, name: "Amelia Edwards", age: 27, city: "Wigan", image: "https://randomuser.me/api/portraits/women/0.jpg" }
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
    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Register error:", err);
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
});

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
if (!user) {
  return res.status(404).json({ error: "User not found" });
}

    if (!user.lifetime && user.credits <= 0) {
      return res.status(403).json({ error: "I really wanna meet you, but you're out of credits I see. Please buy more so we can meet!" });
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

    // ✅ 3. Deduct 1 credit if not lifetime
    if (!user.lifetime) {
      await pool.query("UPDATE users SET credits = credits - 1 WHERE id = $1", [userId]);
    }

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
      "price_1Rse1SEJXIhiKzYGhUalpwBS": 9900,
    };

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




import bodyParser from "body-parser"; // Add this at the top if not present
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

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
  const session = event.data.object;
  const userId = session.metadata?.userId;
  const priceId = session.metadata?.priceId;

  console.log('✅ Payment received for user ID:', userId, 'with price ID:', priceId);

  const amountMap = {
    "price_1Rsdy1EJXIhiKzYGOtzvwhUH": 5,
    "price_1RsdzREJXIhiKzYG45b69nSl": 20,
    "price_1Rse1SEJXIhiKzYGhUalpwBS": 99,
  };

  const creditsToAdd = amountMap[priceId];

  if (userId && creditsToAdd !== undefined) {
    try {
      await pool.query(
        `UPDATE users SET credits = credits + $1 WHERE id = $2`,
        [creditsToAdd, userId]
      );
      console.log(`✅ Added ${creditsToAdd} credits to user ${userId}`);
    } catch (err) {
      console.error("❌ Failed to update credits in DB:", err.message);
    }
  } else {
    console.error("❌ Missing userId or invalid priceId in metadata");
  }

  break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).send('Received');
});


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
