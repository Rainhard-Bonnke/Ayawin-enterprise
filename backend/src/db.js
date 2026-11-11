const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
    }
  : {
      host: process.env.DATABASE_HOST || "localhost",
      port: process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 5432,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_DB || "ayawin_enterprise",
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 20),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
    };

const pool = new Pool(poolConfig);

module.exports = pool;
