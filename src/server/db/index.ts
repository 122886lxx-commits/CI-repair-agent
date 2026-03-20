import { Pool } from "pg";

import { getConfig } from "@/server/config";
import { MemoryJobRepository } from "@/server/db/memory-repository";
import { PostgresJobRepository } from "@/server/db/postgres-repository";
import type { JobRepository } from "@/server/db/repository";

let repository: JobRepository | null = null;
let pool: Pool | null = null;

export function getRepository(): JobRepository {
  if (repository) {
    return repository;
  }

  const config = getConfig();
  if (config.DATABASE_URL) {
    pool = new Pool({ connectionString: config.DATABASE_URL });
    repository = new PostgresJobRepository(pool);
    return repository;
  }

  repository = new MemoryJobRepository();
  return repository;
}

export async function closeRepository() {
  if (pool) {
    await pool.end();
  }
  repository = null;
  pool = null;
}
