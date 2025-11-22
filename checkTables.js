import pg from "pg";

const client = new pg.Client({
  connectionString: "postgresql://postgres:qNFlLVzVRyKzcCgTnmcEkOvbWewGaOBr@nozomi.proxy.rlwy.net:18070/railway",
  ssl: { rejectUnauthorized: false }
});

async function checkTables() {
  try {
    await client.connect();
    console.log("Připojeno k databázi ✅");

    const tables = ["Restaurants", "chips2"];

    for (const table of tables) {
      const res = await client.query(`
        SELECT to_regclass('${table}') AS exists;
      `);
      if (res.rows[0].exists) {
        console.log(`Tabulka ${table} existuje ✅`);
      } else {
        console.log(`Tabulka ${table} neexistuje ❌`);
      }
    }
  } catch (err) {
    console.error("Chyba:", err);
  } finally {
    await client.end();
  }
}

checkTables();
