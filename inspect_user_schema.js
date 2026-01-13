
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, 
});

async function inspect() {
  try {
    const client = await pool.connect();
    console.log("Connected to DB");
    
    // Check users table columns
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' OR table_name = 'auth_user' OR table_name = 'restaurant_admins'
    `);
    
    if (res.rows.length > 0) {
        console.log("User Table Columns:", res.rows);
    } else {
        console.log("No specific 'users' table found. Listing all tables:");
        const tables = await client.query(`
            SELECT table_name FROM information_schema.tables WHERE table_schema='public'
        `);
        console.log(tables.rows.map(r => r.table_name));
    }
    
    client.release();
    pool.end();
  } catch (err) {
    console.error("DB Error", err);
  }
}

inspect();
