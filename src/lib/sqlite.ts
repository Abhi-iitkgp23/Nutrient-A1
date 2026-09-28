import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveDataDir } from "./data-dir";

export { resolveDataDir };

export function openDatabase(filename?: string): Database.Database {
  const file = filename ?? path.join(resolveDataDir(), "nutrition.db");
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ file)), { recursive: true });
  }
  return new Database(file);
}
