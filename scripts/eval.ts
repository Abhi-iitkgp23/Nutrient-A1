import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  consistencyQuestion,
  delayedThread,
  mainSet,
  scopeBattery,
  weightProbe,
  type EvalItem,
} from "../src/evals/questions";

const REQUEST_TIMEOUT_MS = 180_000;

type Attempt = {
  status: number;
  body: unknown;
};

type TurnRecord = {
  id: string;
  category: string;
  message: string;
  attempts: Attempt[];
};

type ChatBody = {
  conversationId?: string;
  message?: {
    declined?: boolean;
    claims?: unknown[];
    answer?: string;
  };
  error?: string;
};

function promptVersion(): string {
  const bytes = readFileSync(path.join(process.cwd(), "prompts", "system.md"));
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function postChat(baseUrl: string, message: string, conversationId?: string): Promise<Attempt> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function ask(baseUrl: string, item: EvalItem, conversationId?: string): Promise<TurnRecord> {
  const attempts: Attempt[] = [];
  const first = await postChat(baseUrl, item.question, conversationId);
  attempts.push(first);
  if (first.status === 422 || first.status >= 500) {
    const second = await postChat(baseUrl, item.question, conversationId);
    attempts.push(second);
  }
  return {
    id: item.id,
    category: item.category,
    message: item.question,
    attempts,
  };
}

function latest(record: TurnRecord): Attempt {
  return record.attempts[record.attempts.length - 1] ?? record.attempts[0];
}

function chatBody(attempt: Attempt | undefined): ChatBody | null {
  if (!attempt || !attempt.body || typeof attempt.body !== "object") {
    return null;
  }
  return attempt.body as ChatBody;
}

function tallyLine(record: TurnRecord): string {
  const attempt = latest(record);
  const body = chatBody(attempt);
  const declined = body?.message?.declined;
  const claims = body?.message?.claims;
  const conversationId = body?.conversationId ?? "-";
  const declinedText = typeof declined === "boolean" ? String(declined) : "-";
  const claimCount = Array.isArray(claims) ? String(claims.length) : "-";
  const statuses = record.attempts.map((item) => String(item.status)).join(",");
  return `${record.id.padEnd(5)} ${statuses.padEnd(8)} declined=${declinedText.padEnd(5)} claims=${claimCount.padEnd(3)} ${conversationId}`;
}

async function main() {
  const baseUrl = (process.env.EVAL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  try {
    const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) {
      throw new Error(`${baseUrl}/api/health returned ${health.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`The app must already be running at ${baseUrl}. ${message}`);
    process.exitCode = 1;
    return;
  }

  const runId = stamp();
  const runDir = path.join(process.cwd(), "evals", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const version = promptVersion();
  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({ timestamp: runId, baseUrl, promptVersion: version }, null, 2),
  );

  const lines: string[] = [];
  console.log(`eval ${runId}`);
  console.log(`prompt ${version}`);

  for (const item of mainSet) {
    const record = await ask(baseUrl, item);
    writeFileSync(path.join(runDir, `${item.id}.json`), JSON.stringify(record, null, 2));
    lines.push(tallyLine(record));
    console.log(lines[lines.length - 1]);
  }

  const consistencyIds: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const record = await ask(baseUrl, { ...consistencyQuestion, id: `C1-${index}` });
    writeFileSync(path.join(runDir, `C1-${index}.json`), JSON.stringify(record, null, 2));
    const conversationId = chatBody(latest(record))?.conversationId;
    if (conversationId) {
      consistencyIds.push(conversationId);
    }
    lines.push(tallyLine(record));
    console.log(lines[lines.length - 1]);
  }

  for (const item of scopeBattery) {
    const record = await ask(baseUrl, item);
    writeFileSync(path.join(runDir, `${item.id}.json`), JSON.stringify(record, null, 2));
    lines.push(tallyLine(record));
    console.log(lines[lines.length - 1]);
  }

  const delayed: TurnRecord[] = [];
  let delayedConversationId: string | undefined;
  for (const item of delayedThread) {
    const record = await ask(baseUrl, item, delayedConversationId);
    delayed.push(record);
    delayedConversationId = chatBody(latest(record))?.conversationId ?? delayedConversationId;
    lines.push(tallyLine(record));
    console.log(lines[lines.length - 1]);
  }
  writeFileSync(path.join(runDir, "L1.json"), JSON.stringify({ id: "L1", turns: delayed }, null, 2));

  const weight = await ask(baseUrl, weightProbe);
  writeFileSync(path.join(runDir, "W1.json"), JSON.stringify(weight, null, 2));
  lines.push(tallyLine(weight));
  console.log(lines[lines.length - 1]);

  const uniqueConsistency = new Set(consistencyIds);
  console.log(`run ${runDir}`);
  console.log(`C1 conversations ${consistencyIds.join(" ") || "-"}`);
  console.log(`C1 distinct ${uniqueConsistency.size}`);
  if (uniqueConsistency.size !== 3) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
