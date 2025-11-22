// server.cjs
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Siky2025!';
const SESSION_SECRET = process.env.SESSION_SECRET || 'verysecretstring';
const CONTACT = process.env.CONTACT || 'tvujemail@domena.cz';

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24*60*60*1000 }
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Důležité pro Render DB
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

// --- Nový endpoint pro inicializaci tabulek ---
app.get('/init-tables', async (req, res) => {
  try {
    await pool.connect();

    // Tabulka Restaurants
    const resRestaurants = await pool.query(`SELECT to_regclass('Restaurants') AS exists;`);
    if (!resRestaurants.rows[0].exists) {
      await pool.query(`
        CREATE TABLE Restaurants (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          ip_list TEXT,
          ip_selected TEXT,
          target_url TEXT,
          paid_until_date DATE,
          chip_enabled BOOLEAN DEFAULT true
        );
      `);
    }

    // Tabulka chips2
    const resChips = await pool.query(`SELECT to_regclass('chips2') AS exists;`);
    if (!resChips.rows[0].exists) {
      await pool.query(`
        CREATE TABLE chips2 (
          id SERIAL PRIMARY KEY,
          code VARCHAR(255) UNIQUE NOT NULL,
          restaurant_id INT REFERENCES Restaurants(id),
          target_url TEXT,
          active BOOLEAN DEFAULT true
        );
      `);
    }

    res.send('✅ Tabulky zkontrolovány / vytvořeny');
  } catch (err) {
    console.error('Init tables error:', err);
    res.status(500).send('❌ Chyba při inicializaci tabulek');
  }
});

// --- Zbytek tvého kódu (admin, tap, atd.) ---
app.get('/', (req, res) => {
  res.send('NFC redirect service — running');
});

app.get('/nezaplaceno', (req, res) => {
  res.send(`
    <h1>Služba je pozastavena</h1>
    <p>Kontaktujte správce služby: ${CONTACT}</p>
  `);
});

// ... zbytek tvého kódu admin/tap CRUD je stejný ...

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`✅ Server běží na portu ${PORT}`);
});
