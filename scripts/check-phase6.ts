import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DECLINE_ANSWER } from "../src/lib/decline";

const dataDir = mkdtempSync(path.join(tmpdir(), "nutrition-restore-"));
process.env.DATA_DIR = dataDir;

async function main() {
  const { loadConversation } = await import("../src/app/api/conversations/[id]/route");
  const { appendMessage, createConversation } = await import("../src/lib/store");

  const missing = loadConversation(crypto.randomUUID());
  assert.equal(missing.status, 404);

  const conversation = createConversation();
  appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: "How long can cooked rice sit out?",
  });
  const answer = appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "Cooked rice should be refrigerated within about two hours.",
    claims: [
      {
        text: "Cooked rice should be refrigerated within about two hours.",
        source: null,
      },
    ],
    declined: false,
    promptVersion: "phase6-check",
  });
  appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: "How many calories should I eat per day to lose fat?",
  });
  appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: DECLINE_ANSWER,
    claims: [],
    declined: true,
    promptVersion: "phase6-check",
  });

  const db = new Database(path.join(dataDir, "nutrition.db"));
  db.prepare("update messages set claims_json = ? where id = ?").run(
    JSON.stringify([
      {
        text: "Cooked rice should be refrigerated within about two hours.",
        source: { title: "Stored citation" },
      },
    ]),
    answer.id,
  );
  db.close();

  const response = loadConversation(conversation.id);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    conversationId: string;
    messages: Array<{
      id: string;
      role: "user" | "assistant";
      content?: string;
      answer?: string;
      claims: { text: string; source: null }[] | null;
      declined: boolean;
    }>;
  };
  assert.equal(body.conversationId, conversation.id);
  assert.deepEqual(
    body.messages.map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  assert.equal(body.messages[0]?.content, "How long can cooked rice sit out?");
  assert.equal(body.messages[0]?.claims, null);
  assert.equal(body.messages[0]?.declined, false);
  assert.equal(
    body.messages[1]?.answer,
    "Cooked rice should be refrigerated within about two hours.",
  );
  assert.deepEqual(body.messages[1]?.claims, [
    {
      text: "Cooked rice should be refrigerated within about two hours.",
      source: null,
    },
  ]);
  assert.equal(body.messages[1]?.declined, false);
  assert.equal(body.messages[2]?.content, "How many calories should I eat per day to lose fat?");
  assert.equal(body.messages[3]?.answer, DECLINE_ANSWER);
  assert.equal(body.messages[3]?.declined, true);
  assert.deepEqual(body.messages[3]?.claims, []);

  console.log("phase 6 restore checks passed");
  rmSync(dataDir, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
