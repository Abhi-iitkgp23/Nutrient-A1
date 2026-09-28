import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { modelAnswerJsonSchema, modelAnswerSchema } from "../src/lib/schema";

function loadEnvFile(file: string) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator);
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(separator + 1);
    }
  }
}

async function main() {
  loadEnvFile(".env.local");

  const { DEFAULT_GROQ_MODEL, createModelClient, resolveGroqModel } = await import(
    "../src/lib/model"
  );
  const { PROMPT_VERSION, SYSTEM_PROMPT } = await import("../src/lib/prompt");

  assert.equal(resolveGroqModel(undefined), DEFAULT_GROQ_MODEL);
  assert.equal(resolveGroqModel(""), DEFAULT_GROQ_MODEL);
  assert.equal(resolveGroqModel("qwen/qwen3.6-27b"), "qwen/qwen3.6-27b");
  assert.throws(() => resolveGroqModel("gpt-4o-2024-08-06"), /GROQ_MODEL/);

  const gitVersion = execFileSync("git", ["hash-object", "prompts/system.md"], {
    encoding: "utf8",
  }).trim();
  assert.equal(PROMPT_VERSION, gitVersion);
  assert.match(SYSTEM_PROMPT, /food, nutrition, and food safety/);

  const other = Buffer.from(`${SYSTEM_PROMPT}\nchanged\n`);
  const otherVersion = createHash("sha1")
    .update(Buffer.from(`blob ${other.length}\0`))
    .update(other)
    .digest("hex");
  assert.notEqual(otherVersion, PROMPT_VERSION);

  const savedKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  assert.throws(() => createModelClient(), /GROQ_API_KEY is required/);
  if (savedKey === undefined) {
    delete process.env.GROQ_API_KEY;
  } else {
    process.env.GROQ_API_KEY = savedKey;
  }

  if (!process.env.GROQ_API_KEY?.trim()) {
    console.log("phase 3 local checks passed");
    console.log("skipped live Groq call: GROQ_API_KEY is empty");
    return;
  }

  const client = createModelClient();
  const result = await client.complete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: "How long can cooked rice sit out at room temperature?",
      },
    ],
    schema: modelAnswerJsonSchema,
    schemaName: "nutrition_answer",
  });
  const parsed = modelAnswerSchema.parse(result);
  assert.ok(parsed.claims.every((claim) => claim.source === null));
  console.log("phase 3 local checks passed");
  console.log(`live answer claims: ${parsed.claims.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
