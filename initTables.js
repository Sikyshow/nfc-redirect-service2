import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initTables() {
  try {
    await client.connect();
    console.log("Připojeno k databázi ✅");

    // Tabulka Restaurants
    const resRestaurants = await client.query(`
      SELECT to_regclass('Restaurants') AS exists;
    `);
    if (!resRestaurants.rows[0].exists) {
      console.log("Tabulka Restaurants neexistuje, vytvářím...");
      await client.query(`
        CREATE TABLE Restaurants (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          ip_addresses TEXT[],
          target_url TEXT,
          paid_until DATE,
          chip_enabled BOOLEAN DEFAULT true
        );
      `);
      console.log("Tabulka Restaurants vytvořena ✅");
    } else {
      console.log("Tabulka Restaurants již existuje ✅");
    }

    // Tabulka chips2
    const resChips = await client.query(`
      SELECT to_regclass('chips2') AS exists;
    `);
    if (!resChips.rows[0].exists) {
      console.log("Tabulka chips2 neexistuje, vytvářím...");
      await client.query(`
        CREATE TABLE chips2 (
          id SERIAL PRIMARY KEY,
          chip_id VARCHAR(255) UNIQUE NOT NULL,
          restaurant_id INT REFERENCES Restaurants(id),
          active BOOLEAN DEFAULT true
        );
      `);
      console.log("Tabulka chips2 vytvořena ✅");
    } else {
      console.log("Tabulka chips2 již existuje ✅");
    }

  } catch (err) {
    console.error("Chyba:", err);
  } finally {
    await client.end();
    console.log("Hotovo, odpojeno od databáze");
  }
}

initTables();
