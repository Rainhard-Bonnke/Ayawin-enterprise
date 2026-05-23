const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host: process.env.DATABASE_HOST || 'localhost',
      port: process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 5432,
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_DB || 'ayawin_enterprise',
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };

const pool = new Pool(poolConfig);

module.exports = pool;
