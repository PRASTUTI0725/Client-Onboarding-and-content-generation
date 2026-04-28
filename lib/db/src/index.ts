import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase pooler TLS chain can fail verification on some local setups.
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("error", (err) => {
  // Prevent idle pg-pool connection resets from taking down the API process.
  console.error("[db] pooled connection error", {
    message: err.message,
    code: err.code,
    name: err.name,
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
