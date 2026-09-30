import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { createDb } from './db.js';

const { db, pool } = createDb(env().DATABASE_URL);
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
await db.execute('CREATE EXTENSION IF NOT EXISTS postgis');
await migrate(db, { migrationsFolder });
await pool.end();
console.log('Migrations appliquées');
