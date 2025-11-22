// server.cjs
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Pouze dynamický port pro Railway
const PORT = process.env.PORT;
if (!PORT) console.warn("⚠️ PORT není nastaven. Lokálně můžeš testovat: export PORT=3000");

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
  connectionString: process.env.DATABASE_URL
});

// Admin ochrana
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

// Hlavní stránka
app.get('/', (req, res) => {
  res.send('NFC redirect service — running');
});

// Nezaplaceno
app.get('/nezaplaceno', (req, res) => {
  res.send(`
    <h1>Služba je pozastavena</h1>
    <p>Kontaktujte správce služby: ${CONTACT}</p>
  `);
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

//////////////////////
// Admin login
//////////////////////
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

//////////////////////
// Admin dashboard
//////////////////////
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
          input[type=text], input[type=date] { width: 100%; }
          button { padding: 5px 10px; margin-top: 5px; cursor: pointer; }
          .logout { margin-bottom: 20px; display: inline-block; }
        </style>
      </head>
      <body>
        <a class="logout" href="/admin/logout">Logout</a>
        <h2>Restaurace</h2>
        <table>
          <tr>
            <th>ID</th><th>Name</th><th>Paid Until</th><th>Target URL</th><th>Akce</th>
          </tr>
    `;

    restaurants.forEach(r => {
      html += `
        <tr>
          <form method="POST" action="/admin/restaurant/update/${r.id}">
            <td>${r.id}</td>
            <td><input name="name" value="${r.name || ''}" /></td>
            <td><input type="date" name="paid_until_date" value="${r.paid_until_date || ''}" /></td>
            <td><input name="target_url" value="${r.target_url || ''}" /></td>
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
          <button type="submit">Přidat</button>
        </form>
    `;

    // Chips table
    html += `
      <h2>Chipy</h2>
      <table>
        <tr>
          <th>ID</th><th>Code</th><th>Restaurant ID</th><th>Target URL</th><th>Akce</th>
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
            <td><button type="submit">Uložit</button></td>
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

//////////////////////
// Admin CRUD
//////////////////////
app.post('/admin/restaurant/add', requireAdmin, async (req,res)=>{
  const {name, paid_until_date, target_url} = req.body;
  await pool.query('INSERT INTO "Restaurants"(name, paid_until_date, target_url) VALUES($1,$2,$3)', [name, paid_until_date, target_url]);
  res.redirect('/admin');
});

app.post('/admin/restaurant/update/:id', requireAdmin, async (req,res)=>{
  const {id} = req.params;
  const {name, paid_until_date, target_url} = req.body;
  await pool.query('UPDATE "Restaurants" SET name=$1, paid_until_date=$2, target_url=$3 WHERE id=$4', [name, paid_until_date, target_url, id]);
  res.redirect('/admin');
});

app.post('/admin/chip/add', requireAdmin, async (req,res)=>{
  const {code, restaurant_id, target_url} = req.body;
  await pool.query('INSERT INTO chips2(code, restaurant_id, target_url) VALUES($1,$2,$3)', [code, restaurant_id, target_url]);
  res.redirect('/admin');
});

app.post('/admin/chip/update/:id', requireAdmin, async (req,res)=>{
  const {id} = req.params;
  const {code, restaurant_id, target_url} = req.body;
  await pool.query('UPDATE chips2 SET code=$1, restaurant_id=$2, target_url=$3 WHERE id=$4', [code, restaurant_id, target_url, id]);
  res.redirect('/admin');
});

//////////////////////
// Logout
//////////////////////
app.get('/admin/logout', (req,res)=>{
  req.session.destroy(err=>res.redirect('/admin/login'));
});

// Spuštění serveru
app.listen(PORT, () => {
  console.log(`✅ Server běží na portu ${PORT}`);
  console.log(`🔗 Railway URL bude dostupná po nasazení (v projektu Railway → Services → Live URL)`);
});
