import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, '..', 'migrations', '001_init.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/shipsafe';

const pool = new Pool({ connectionString });
await pool.query(sql);
await pool.end();
console.log('Migration applied');
