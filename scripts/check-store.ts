import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { declineBody } from "../src/lib/decline";
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
} from "../src/lib/store";

const dataDir = mkdtempSync(path.join(tmpdir(), "nutrition-store-"));
process.env.DATA_DIR = dataDir;

try {
  const missing = getConversation(crypto.randomUUID());
  assert.equal(missing, null);

  const conversation = createConversation();
  assert.ok(getConversation(conversation.id));
  assert.deepEqual(listMessages(conversation.id), []);

  const user = appendMessage({
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
    promptVersion: "phase2-check",
  });
  const decline = appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: declineBody.answer,
    claims: declineBody.claims,
    declined: true,
    promptVersion: "phase2-check",
  });

  const messages = listMessages(conversation.id);
  assert.deepEqual(
    messages.map((message) => message.content),
    [user.content, answer.content, decline.content],
  );
  assert.equal(messages[0]?.claims, null);
  assert.equal(messages[0]?.declined, false);
  assert.equal(messages[0]?.promptVersion, null);
  assert.deepEqual(messages[1]?.claims, answer.claims);
  assert.equal(messages[2]?.declined, true);
  assert.deepEqual(messages[2]?.claims, []);

  const reopened = new Database(path.join(dataDir, "nutrition.db"));
  try {
    const stored = reopened
      .prepare(
        `select content, claims_json, declined, prompt_version
         from messages
         order by rowid asc`,
      )
      .all() as Array<{
      content: string;
      claims_json: string | null;
      declined: number;
      prompt_version: string | null;
    }>;
    assert.deepEqual(
      stored.map((row) => row.content),
      [user.content, answer.content, decline.content],
    );
    assert.equal(stored[2]?.declined, 1);
    assert.equal(stored[2]?.claims_json, "[]");
    assert.equal(stored[0]?.claims_json, null);
  } finally {
    reopened.close();
  }

  assert.throws(() =>
    appendMessage({
      conversationId: crypto.randomUUID(),
      role: "user",
      content: "This conversation does not exist.",
    }),
  );

  console.log("phase 2 store checks passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
