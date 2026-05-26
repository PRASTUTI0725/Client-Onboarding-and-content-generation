import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseHost = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();

const useSsl = !["localhost", "127.0.0.1", "::1"].includes(databaseHost);

export const pool = new Pool({
  connectionString: databaseUrl,
  // Hosted Postgres providers often require SSL, while local Postgres usually does not support it.
  ...(useSsl
    ? {
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {}),
});

pool.on("error", (err) => {
  // Prevent idle pg-pool connection resets from taking down the API process.
  const errorCode =
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  console.error("[db] pooled connection error", {
    message: err.message,
    code: errorCode,
    name: err.name,
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
