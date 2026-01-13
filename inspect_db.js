import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Usually needed for Supabase/Cloud Postgres
});

async function inspect() {
  try {
    const client = await pool.connect();
    console.log("Connected to DB");
    
    // List tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables:", res.rows.map(r => r.table_name));
    
    // If 'users' or 'restaurant_admins' exists, check columns
    const usersTable = res.rows.find(r => r.table_name.includes('user') || r.table_name.includes('admin'));
    if (usersTable) {
        console.log(`\nColumns in ${usersTable.table_name}:`);
        const cols = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '${usersTable.table_name}'
        `);
        console.log(cols.rows);
    }
    
    client.release();
    pool.end();
  } catch (err) {
    console.error("DB Error", err);
  }
}

inspect();
