import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DATA_DIR = "./data";

export function resolveDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? configured : DEFAULT_DATA_DIR;
}

export function openDatabase(filename?: string): Database.Database {
  const file = filename ?? path.join(resolveDataDir(), "nutrition.db");
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return new Database(file);
}
