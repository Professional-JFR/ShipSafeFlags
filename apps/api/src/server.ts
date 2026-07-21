import { Pool } from "pg";
import { createApp } from "./app.js";
import { PgRepository } from "./repository.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/shipsafe";

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const app = createApp({ repository: new PgRepository(pool) });
  app.listen(PORT, () => {
    console.log(`ShipSafe Flags API listening on ${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
