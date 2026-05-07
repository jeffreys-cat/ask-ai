import { createDb } from "@selectdb/db";
import { createDorisPool } from "@selectdb/doris";
import { loadRootEnv } from "./load-env";

loadRootEnv();

let db: ReturnType<typeof createDb> | undefined;
let doris: ReturnType<typeof createDorisPool> | undefined;

export function getDb() {
  db ??= createDb();
  return db;
}

export function getDoris() {
  doris ??= createDorisPool();
  return doris;
}
