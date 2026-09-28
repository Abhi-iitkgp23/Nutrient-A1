import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyInput } from "../src/lib/scope";
import {
  GROQ_MODEL_LIMITS,
  LlmLimitError,
  billableTokens,
  createLlmLimiter,
  parseGroqDelayMs,
  type HeaderSource,
} from "../src/lib/rate-limit";

const MODEL = "openai/gpt-oss-120b";

function mockHeaders(record: Record<string, string>): HeaderSource {
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

function clockedLimiter(dbPath: string) {
  let now = 1_700_000_000_000;
  const sleeps: number[] = [];
  const limiter = createLlmLimiter({
    dbPath,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  return {
    limiter,
    sleeps,
    advance(ms: number) {
      now += ms;
    },
  };
}

async function main() {
  assert.equal(parseGroqDelayMs("2"), 2_000);
  assert.equal(parseGroqDelayMs("7.66s"), 7_660);
  assert.equal(parseGroqDelayMs("2m59.56s"), 179_560);
  assert.equal(parseGroqDelayMs("1h"), 3_600_000);
  assert.equal(parseGroqDelayMs("nope"), null);

  assert.equal(billableTokens(undefined, 40), 40);
  assert.equal(billableTokens({ total_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }, 40), 20);
  assert.equal(billableTokens({ total_tokens: 15 }, 40), 15);

  const minute = clockedLimiter(":memory:");
  for (let i = 0; i < GROQ_MODEL_LIMITS.requestsPerMinute; i += 1) {
    await minute.limiter.run(MODEL, 10, async () => ({ value: i, tokens: 10 }));
  }
  assert.equal(minute.sleeps.length, 0);
  const extra = await minute.limiter.run(MODEL, 10, async () => ({ value: "next", tokens: 10 }));
  assert.equal(extra, "next");
  assert.equal(minute.sleeps.length, 1);
  assert.ok(minute.sleeps[0] >= 60_000);

  const tokens = clockedLimiter(":memory:");
  await tokens.limiter.run(MODEL, 5_000, async () => ({ value: 1, tokens: 5_000 }));
  await tokens.limiter.run(MODEL, 5_000, async () => ({ value: 2, tokens: 5_000 }));
  assert.equal(tokens.sleeps.length, 1);
  const released = clockedLimiter(":memory:");
  await released.limiter.run(MODEL, 7_000, async () => ({ value: 1, tokens: 100 }));
  await released.limiter.run(MODEL, 7_000, async () => ({ value: 2, tokens: 100 }));
  assert.equal(released.sleeps.length, 0);

  const oversized = clockedLimiter(":memory:");
  await assert.rejects(
    () =>
      oversized.limiter.run(MODEL, GROQ_MODEL_LIMITS.tokensPerMinute + 1, async () => {
        throw new Error("provider should not be called");
      }),
    (error: unknown) => error instanceof LlmLimitError && error.scope === "minute",
  );
  assert.equal(oversized.sleeps.length, 0);

  const dayTokens = clockedLimiter(":memory:");
  for (let i = 0; i < GROQ_MODEL_LIMITS.tokensPerDay / GROQ_MODEL_LIMITS.tokensPerMinute; i += 1) {
    await dayTokens.limiter.run(MODEL, GROQ_MODEL_LIMITS.tokensPerMinute, async () => ({
      value: i,
      tokens: GROQ_MODEL_LIMITS.tokensPerMinute,
    }));
    dayTokens.advance(61_000);
  }
  await assert.rejects(
    () => dayTokens.limiter.run(MODEL, 1, async () => ({ value: "over", tokens: 1 })),
    (error: unknown) => error instanceof LlmLimitError && error.scope === "day",
  );

  const dayRequests = clockedLimiter(":memory:");
  for (let i = 0; i < GROQ_MODEL_LIMITS.requestsPerDay; i += 1) {
    await dayRequests.limiter.run(MODEL, 1, async () => ({ value: i, tokens: 1 }));
    if ((i + 1) % GROQ_MODEL_LIMITS.requestsPerMinute === 0) {
      dayRequests.advance(61_000);
    }
  }
  await assert.rejects(
    () => dayRequests.limiter.run(MODEL, 1, async () => ({ value: "over", tokens: 1 })),
    (error: unknown) => error instanceof LlmLimitError && error.scope === "day",
  );
  dayRequests.advance(24 * 60 * 60 * 1000);
  const afterDay = await dayRequests.limiter.run(MODEL, 1, async () => ({ value: "fresh", tokens: 1 }));
  assert.equal(afterDay, "fresh");

  const remote = clockedLimiter(":memory:");
  await remote.limiter.run(MODEL, 100, async () => ({
    value: "first",
    tokens: 100,
    headers: mockHeaders({
      "x-ratelimit-limit-tokens": "8000",
      "x-ratelimit-remaining-tokens": "50",
      "x-ratelimit-reset-tokens": "5s",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": "999",
      "x-ratelimit-reset-requests": "2h",
    }),
  }));
  const paced = await remote.limiter.run(MODEL, 100, async () => ({ value: "second", tokens: 100 }));
  assert.equal(paced, "second");
  assert.equal(remote.sleeps.length, 1);
  assert.ok(remote.sleeps[0] >= 5_000);

  const exhaustedDay = clockedLimiter(":memory:");
  await exhaustedDay.limiter.run(MODEL, 10, async () => ({
    value: "last",
    tokens: 10,
    headers: mockHeaders({
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-reset-requests": "2h",
    }),
  }));
  await assert.rejects(
    () => exhaustedDay.limiter.run(MODEL, 10, async () => ({ value: "blocked", tokens: 10 })),
    (error: unknown) => error instanceof LlmLimitError && error.scope === "day",
  );

  const retrying = clockedLimiter(":memory:");
  let attempts = 0;
  const recovered = await retrying.limiter.run(MODEL, 10, async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("429") as Error & { status: number; headers: HeaderSource };
      error.status = 429;
      error.headers = mockHeaders({ "retry-after": "2" });
      throw error;
    }
    return { value: "recovered", tokens: 10 };
  });
  assert.equal(recovered, "recovered");
  assert.equal(attempts, 3);
  assert.equal(retrying.sleeps.length, 2);

  const file = path.join(os.tmpdir(), `llm-usage-${process.pid}.db`);
  const first = clockedLimiter(file);
  await first.limiter.run(MODEL, 10, async () => ({ value: 1, tokens: 10 }));
  const second = clockedLimiter(file);
  for (let i = 0; i < GROQ_MODEL_LIMITS.requestsPerMinute - 1; i += 1) {
    await second.limiter.run(MODEL, 10, async () => ({ value: i, tokens: 10 }));
  }
  await second.limiter.run(MODEL, 10, async () => ({ value: "paced", tokens: 10 }));
  assert.equal(second.sleeps.length, 1);
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });

  const declined = await classifyInput(
    {
      async complete() {
        throw new Error("classifier unavailable");
      },
    },
    "How long can cooked rice sit out?",
  );
  assert.equal(declined.decision, "decline");

  await assert.rejects(
    () =>
      classifyInput(
        {
          async complete() {
            throw new LlmLimitError("day", "Daily model request limit reached (1000 per day). Try again later.");
          },
        },
        "How long can cooked rice sit out?",
      ),
    (error: unknown) => error instanceof LlmLimitError && error.scope === "day",
  );

  console.log("rate limit checks passed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
