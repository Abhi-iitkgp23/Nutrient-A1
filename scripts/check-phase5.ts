import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DECLINE_ANSWER } from "../src/lib/decline";
import { UnparseableModelOutputError, type ModelClient } from "../src/lib/model";
import { SCOPE_SCHEMA_NAME } from "../src/lib/scope";

const dataDir = mkdtempSync(path.join(tmpdir(), "nutrition-chat-"));
process.env.DATA_DIR = dataDir;

const FORMAT_MESSAGE = "This answer didn't match the expected format, so it wasn't shown.";

function request(body: unknown) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allowThen(answer: unknown): ModelClient {
  return {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "allow", category: null };
      }
      return answer;
    },
  };
}

function conversationIds(): string[] {
  const file = path.join(dataDir, "nutrition.db");
  if (!existsSync(file)) {
    return [];
  }
  const db = new Database(file);
  try {
    const rows = db.prepare("select id from conversations").all() as { id: string }[];
    return rows.map((row) => row.id);
  } finally {
    db.close();
  }
}

function createdSince(before: string[]): string {
  const prior = new Set(before);
  const created = conversationIds().filter((id) => !prior.has(id));
  assert.equal(created.length, 1);
  return created[0] ?? "";
}

async function main() {
  const { ANSWER_SCHEMA_NAME, handleChat } = await import("../src/app/api/chat/route");
  const { listMessages } = await import("../src/lib/store");

  const beforeBlank = conversationIds();
  const blank = await handleChat(request({ message: "   " }), allowThen({}));
  assert.equal(blank.status, 400);
  assert.deepEqual(conversationIds(), beforeBlank);

  const missing = await handleChat(
    request({ conversationId: crypto.randomUUID(), message: "How long can cooked rice sit out?" }),
    allowThen({}),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(conversationIds(), beforeBlank);

  let nutritionCalls = 0;
  const declining: ModelClient = {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "decline", category: "calorie_target" };
      }
      nutritionCalls += 1;
      return { answer: "unused", claims: [] };
    },
  };
  const beforeDecline = conversationIds();
  const declined = await handleChat(
    request({ message: "How many calories should I eat per day to lose fat?" }),
    declining,
  );
  assert.equal(declined.status, 200);
  const declinedBody = (await declined.json()) as {
    conversationId: string;
    message: { answer: string; claims: unknown[]; declined: boolean };
  };
  assert.equal(declinedBody.conversationId, createdSince(beforeDecline));
  assert.equal(declinedBody.message.answer, DECLINE_ANSWER);
  assert.deepEqual(declinedBody.message.claims, []);
  assert.equal(declinedBody.message.declined, true);
  assert.equal(nutritionCalls, 0);
  assert.equal(listMessages(declinedBody.conversationId).length, 2);

  const beforeInvalid = conversationIds();
  const invalid = await handleChat(
    request({ message: "How long can cooked rice sit out?" }),
    allowThen({ nope: true }),
  );
  assert.equal(invalid.status, 422);
  const invalidBody = (await invalid.json()) as { error: string };
  assert.equal(invalidBody.error, FORMAT_MESSAGE);
  const invalidId = createdSince(beforeInvalid);
  const invalidMessages = listMessages(invalidId);
  assert.equal(invalidMessages.length, 1);
  assert.equal(invalidMessages[0]?.role, "user");

  const unparseable: ModelClient = {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "allow", category: null };
      }
      throw new UnparseableModelOutputError("Groq returned content that is not JSON");
    },
  };
  const beforeUnparsed = conversationIds();
  const unparsed = await handleChat(
    request({ message: "How long can cooked rice sit out?" }),
    unparseable,
  );
  assert.equal(unparsed.status, 422);
  assert.equal(listMessages(createdSince(beforeUnparsed)).length, 1);

  const rice = {
    answer: "Cooked rice should be refrigerated within about two hours.",
    claims: [
      {
        text: "Cooked rice should be refrigerated within about two hours.",
        source: null,
      },
    ],
  };
  let seenHistory: { role: string; content: string }[] = [];
  const continuing: ModelClient = {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "allow", category: null };
      }
      assert.equal(input.schemaName, ANSWER_SCHEMA_NAME);
      seenHistory = input.messages;
      return rice;
    },
  };
  const first = await handleChat(request({ message: "How long can cooked rice sit out?" }), continuing);
  assert.equal(first.status, 200);
  const firstBody = (await first.json()) as {
    conversationId: string;
    message: { answer: string; claims: { source: null }[]; declined: boolean };
  };
  assert.equal(firstBody.message.declined, false);
  assert.equal(firstBody.message.answer, rice.answer);
  assert.ok(firstBody.message.claims.every((claim) => claim.source === null));
  assert.equal(listMessages(firstBody.conversationId).length, 2);

  const second = await handleChat(
    request({
      conversationId: firstBody.conversationId,
      message: "What about leftover soup?",
    }),
    continuing,
  );
  assert.equal(second.status, 200);
  const secondBody = (await second.json()) as { conversationId: string };
  assert.equal(secondBody.conversationId, firstBody.conversationId);
  assert.equal(listMessages(firstBody.conversationId).length, 4);
  assert.deepEqual(
    seenHistory.map((message) => message.content),
    ["How long can cooked rice sit out?", rice.answer, "What about leftover soup?"],
  );

  const advising: ModelClient = {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "allow", category: null };
      }
      return {
        answer: "You should eat 1,800 calories per day.",
        claims: [{ text: "You should eat 1,800 calories per day.", source: null }],
      };
    },
  };
  const replaced = await handleChat(request({ message: "How long can cooked rice sit out?" }), advising);
  assert.equal(replaced.status, 200);
  const replacedBody = (await replaced.json()) as {
    conversationId: string;
    message: { answer: string; declined: boolean; claims: unknown[] };
  };
  assert.equal(replacedBody.message.answer, DECLINE_ANSWER);
  assert.equal(replacedBody.message.declined, true);
  assert.deepEqual(replacedBody.message.claims, []);
  assert.equal(listMessages(replacedBody.conversationId).at(-1)?.content, DECLINE_ANSWER);

  const beforeOutage = conversationIds();
  const failing: ModelClient = {
    async complete(input) {
      if (input.schemaName === SCOPE_SCHEMA_NAME) {
        return { decision: "allow", category: null };
      }
      throw new Error("provider unavailable");
    },
  };
  const outage = await handleChat(request({ message: "How long can cooked rice sit out?" }), failing);
  assert.equal(outage.status, 500);
  const outageBody = (await outage.json()) as { error: string };
  assert.match(outageBody.error, /try again/i);
  const outageMessages = listMessages(createdSince(beforeOutage));
  assert.equal(outageMessages.length, 1);
  assert.equal(outageMessages[0]?.role, "user");

  console.log("phase 5 route checks passed");
  rmSync(dataDir, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
