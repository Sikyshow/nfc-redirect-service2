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

// === PostgreSQL pool s SSL fixem pro Render ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware pro admina
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

// --- Endpoint pro inicializaci tabulek ---
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

// --- Hlavní stránky a admin panel ---
// Domovská stránka
app.get('/', (req, res) => res.send('NFC redirect service — running'));

// Nezaplaceno
app.get('/nezaplaceno', (req, res) => {
  res.send(`<h1>Služba je pozastavena</h1><p>Kontaktujte správce služby: ${CONTACT}</p>`);
});

// NFC tap
app.get('/tap/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const chipResult = await pool.query('SELECT * FROM chips2 WHERE code = $1 LIMIT 1', [code]);
    const chip = chipResult.rows[0];
    if (!chip) return res.status(404).send('NFC kód neexistuje.');

    const restResult = await pool.query('SELECT * FROM "Restaurants" WHERE id = $1 LIMIT 1', [chip.restaurant_id]);
    const restaurant = restResult.rows[0];
    if (!restaurant) return res.redirect('/nezaplaceno');

    const paidUntilStr = restaurant.paid_until_date || restaurant.paid_until;
    const paidUntil = paidUntilStr ? new Date(paidUntilStr) : null;

    if (!paidUntil || paidUntil < new Date()) return res.redirect('/nezaplaceno');

    return res.redirect(chip.target_url || restaurant.target_url || '/');
  } catch(err) {
    console.error('Tap error:', err);
    return res.status(500).send('Chyba serveru');
  }
});

// Admin login
app.get('/admin/login', (req, res) => {
  res.send(`
    <h2>Admin login</h2>
    <form method="POST" action="/admin/login">
      <input name="password" type="password" placeholder="heslo" required />
      <button type="submit">Přihlásit</button>
    </form>
  `);
});

app.post('/admin/login', (req, res) => {
  const password = req.body.password;
  if (password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.send('Špatné heslo');
});

// Admin dashboard a CRUD funkce
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const restaurants = (await pool.query('SELECT * FROM "Restaurants"')).rows || [];
    const chips = (await pool.query('SELECT * FROM chips2')).rows || [];

    let html = `
      <html>
      <head>
        <title>Admin Panel</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
          h2 { color: #333; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
          th, td { border: 1px solid #aaa; padding: 8px; text-align: left; }
          th { background-color: #ddd; }
          input[type=text], input[type=date], select { width: 100%; }
          button { padding: 5px 10px; margin-top: 5px; cursor: pointer; }
          .logout { margin-bottom: 20px; display: inline-block; }
          #search { margin-bottom: 20px; padding: 5px; width: 300px; }
        </style>
        <script>
          function filterRestaurants() {
            const search = document.getElementById('search').value.toLowerCase();
            const rows = document.querySelectorAll('#restaurantsTable tr.dataRow');
            rows.forEach(row => {
              const name = row.querySelector('.restName').innerText.toLowerCase();
              row.style.display = name.includes(search) ? '' : 'none';
            });
          }
        </script>
      </head>
      <body>
        <a class="logout" href="/admin/logout">Logout</a>
        <h2>Restaurace</h2>
        <input type="text" id="search" placeholder="Vyhledat restauraci..." onkeyup="filterRestaurants()" />
        <table id="restaurantsTable">
          <tr>
            <th>ID</th><th>Name</th><th>Paid Until</th><th>Target URL</th><th>IP</th><th>Akce</th>
          </tr>
    `;

    restaurants.forEach(r => {
      html += `
        <tr class="dataRow">
          <form method="POST" action="/admin/restaurant/update/${r.id}">
            <td>${r.id}</td>
            <td class="restName"><input name="name" value="${r.name || ''}" /></td>
            <td><input type="date" name="paid_until_date" value="${r.paid_until_date || ''}" /></td>
            <td><input name="target_url" value="${r.target_url || ''}" /></td>
            <td>
              <select name="ip">
                ${r.ip_list ? r.ip_list.split(',').map(ip => `<option value="${ip}" ${r.ip_selected===ip?'selected':''}>${ip}</option>`).join('') : '<option value="">--none--</option>'}
              </select>
            </td>
            <td><button type="submit">Uložit</button></td>
          </form>
        </tr>
      `;
    });

    html += `
        </table>
        <h3>Přidat novou restauraci</h3>
        <form method="POST" action="/admin/restaurant/add">
          <input name="name" placeholder="Name" required />
          <input type="date" name="paid_until_date" required />
          <input name="target_url" placeholder="Target URL" required />
          <input name="ip_list" placeholder="IP seznam, oddělený čárkou" />
          <button type="submit">Přidat</button>
        </form>
    `;

    // Chips table
    html += `
      <h2>Chipy</h2>
      <table>
        <tr>
          <th>ID</th><th>Code</th><th>Restaurant ID</th><th>Target URL</th><th>Status</th><th>Akce</th>
        </tr>
    `;
    chips.forEach(c => {
      html += `
        <tr>
          <form method="POST" action="/admin/chip/update/${c.id}">
            <td>${c.id}</td>
            <td><input name="code" value="${c.code}" /></td>
            <td><input name="restaurant_id" value="${c.restaurant_id}" /></td>
            <td><input name="target_url" value="${c.target_url}" /></td>
            <td>${c.active ? '✅' : '❌'}</td>
            <td>
              <button name="toggle" value="toggle" type="submit">Zapnout/Vypnout</button>
              <button type="submit">Uložit</button>
            </td>
          </form>
        </tr>
      `;
    });

    html += `
      </table>
      <h3>Přidat nový chip</h3>
      <form method="POST" action="/admin/chip/add">
        <input name="code" placeholder="Code" required />
        <input name="restaurant_id" placeholder="Restaurant ID" required />
        <input name="target_url" placeholder="Target URL" required />
        <button type="submit">Přidat</button>
      </form>
      </body></html>
    `;

    res.send(html);
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.send('Chyba při načítání admin panelu');
  }
});

// Admin CRUD endpoints
app.post('/admin/restaurant/add', requireAdmin, async (req,res)=>{
  const {name, paid_until_date, target_url, ip_list} = req.body;
  await pool.query('INSERT INTO "Restaurants"(name, paid_until_date, target_url, ip_list) VALUES($1,$2,$3,$4)', [name, paid_until_date, target_url, ip_list]);
  res.redirect('/admin');
});

app.post('/admin/restaurant/update/:id', requireAdmin, async (req,res)=>{
  const {id} = req.params;
  const {name, paid_until_date, target_url, ip} = req.body;
  await pool.query('UPDATE "Restaurants" SET name=$1, paid_until_date=$2, target_url=$3, ip_selected=$4 WHERE id=$5', [name, paid_until_date, target_url, ip, id]);
  res.redirect('/admin');
});

app.post('/admin/chip/add', requireAdmin, async (req,res)=>{
  const {code, restaurant_id, target_url} = req.body;
  await pool.query('INSERT INTO chips2(code, restaurant_id, target_url, active) VALUES($1,$2,$3,true)', [code, restaurant_id, target_url]);
  res.redirect('/admin');
});

app.post('/admin/chip/update/:id', requireAdmin, async (req,res)=>{
  const {id} = req.params;
  const {code, restaurant_id, target_url, toggle} = req.body;
  if(toggle) {
    const current = await pool.query('SELECT active FROM chips2 WHERE id=$1', [id]);
    const newStatus = !current.rows[0].active;
    await pool.query('UPDATE chips2 SET active=$1 WHERE id=$2', [newStatus, id]);
  } else {
    await pool.query('UPDATE chips2 SET code=$1, restaurant_id=$2, target_url=$3 WHERE id=$4', [code, restaurant_id, target_url, id]);
  }
  res.redirect('/admin');
});

// Logout
app.get('/admin/logout', (req,res)=>{
  req.session.destroy(err=>res.redirect('/admin/login'));
});

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`✅ Server běží na portu ${PORT}`);
});
