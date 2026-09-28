import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const promptPath = path.join(process.cwd(), "prompts", "system.md");
const promptBytes = readFileSync(promptPath);

export const SYSTEM_PROMPT = promptBytes.toString("utf8");

function gitBlobId(bytes: Buffer): string {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

export const PROMPT_VERSION = gitBlobId(promptBytes);
