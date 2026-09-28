import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * Free-tier ceilings for openai/gpt-oss-120b.
 * qwen/qwen3.6-27b is published at the same ceilings, so every model call
 * this process makes uses one shared budget. Groq's token headers describe
 * the per-minute token window. Its request headers describe the per-day
 * request window.
 */
export const GROQ_MODEL_LIMITS = {
  requestsPerMinute: 30,
  requestsPerDay: 1_000,
  tokensPerMinute: 8_000,
  tokensPerDay: 200_000,
} as const;

export type GroqLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerDay: number;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WAIT_MS = 70_000;
const WINDOW_SLACK_MS = 250;

export class LlmLimitError extends Error {
  readonly scope: "minute" | "day";
  readonly retryAfterMs: number | null;

  constructor(scope: "minute" | "day", message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "LlmLimitError";
    this.scope = scope;
    this.retryAfterMs = retryAfterMs;
  }
}

export type HeaderSource = {
  get(name: string): string | null;
};

type UsageRow = {
  requests: number;
  tokens: number;
  settled_tokens: number;
  unsettled_tokens: number;
  settled_requests: number;
  unsettled_requests: number;
};

type CallRow = {
  created_at: number;
  tokens: number;
};

type RemoteRow = {
  minute_tokens_used: number | null;
  minute_limit: number | null;
  minute_resets_at: number | null;
  day_requests_used: number | null;
  day_limit: number | null;
  day_resets_at: number | null;
  cooldown_until: number | null;
};

type ReserveResult = { id: number } | { waitMs: number };

export type LlmCallResult<T> = {
  value: T;
  tokens: number;
  headers?: HeaderSource;
};

export type LlmLimiter = {
  run<T>(model: string, estimatedTokens: number, send: () => Promise<LlmCallResult<T>>): Promise<T>;
};

export type LlmLimiterOptions = {
  dbPath?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limits?: GroqLimits;
};

function defaultDataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? configured : "./data";
}

function emptyUsage(): UsageRow {
  return {
    requests: 0,
    tokens: 0,
    settled_tokens: 0,
    unsettled_tokens: 0,
    settled_requests: 0,
    unsettled_requests: 0,
  };
}

function asUsage(row: UsageRow | undefined): UsageRow {
  if (!row) {
    return emptyUsage();
  }
  return {
    requests: Number(row.requests) || 0,
    tokens: Number(row.tokens) || 0,
    settled_tokens: Number(row.settled_tokens) || 0,
    unsettled_tokens: Number(row.unsettled_tokens) || 0,
    settled_requests: Number(row.settled_requests) || 0,
    unsettled_requests: Number(row.unsettled_requests) || 0,
  };
}

export function estimatePromptTokens(parts: string[]): number {
  const characters = parts.reduce((sum, part) => sum + part.length, 0);
  return Math.ceil(characters / 3) + parts.length * 4;
}

export function billableTokens(
  usage:
    | {
        total_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number } | null;
      }
    | undefined,
  fallback: number,
): number {
  if (!usage) {
    return fallback;
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return Math.max(0, usage.total_tokens - cached);
}

export function parseGroqDelayMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.ceil(Number(trimmed) * 1000);
  }
  const match = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(trimmed);
  if (!match || (!match[1] && !match[2] && !match[3])) {
    return null;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return Math.ceil((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function headerNumber(headers: HeaderSource | undefined, name: string): number | null {
  const raw = headers?.get(name);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function openUsageDatabase(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      tokens INTEGER NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS llm_calls_model_time ON llm_calls(model, created_at);
    CREATE TABLE IF NOT EXISTS llm_remote (
      model TEXT PRIMARY KEY,
      minute_tokens_used INTEGER,
      minute_limit INTEGER,
      minute_resets_at INTEGER,
      day_requests_used INTEGER,
      day_limit INTEGER,
      day_resets_at INTEGER,
      cooldown_until INTEGER
    );
  `);
  return db;
}

function delayUntilTokensFit(
  rows: CallRow[],
  at: number,
  used: number,
  adding: number,
  ceiling: number,
  windowMs: number,
): number | null {
  if (used + adding <= ceiling) {
    return 0;
  }
  let tokens = used;
  for (const row of rows) {
    tokens -= row.tokens;
    if (tokens + adding <= ceiling) {
      return Math.max(0, row.created_at + windowMs - at);
    }
  }
  return null;
}

function delayUntilRequestsFit(rows: CallRow[], at: number, used: number, ceiling: number): number | null {
  if (used + 1 <= ceiling) {
    return 0;
  }
  const row = rows[used + 1 - ceiling - 1];
  if (!row) {
    return null;
  }
  return Math.max(0, row.created_at + MINUTE_MS - at);
}

export function createLlmLimiter(options: LlmLimiterOptions = {}): LlmLimiter {
  const limits = options.limits ?? GROQ_MODEL_LIMITS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const dbPath = options.dbPath ?? path.join(defaultDataDir(), "llm-usage.db");
  const db = openUsageDatabase(dbPath);

  const usageStmt = db.prepare(`
    SELECT
      COUNT(*) AS requests,
      COALESCE(SUM(tokens), 0) AS tokens,
      COALESCE(SUM(CASE WHEN settled = 1 THEN tokens ELSE 0 END), 0) AS settled_tokens,
      COALESCE(SUM(CASE WHEN settled = 0 THEN tokens ELSE 0 END), 0) AS unsettled_tokens,
      COALESCE(SUM(CASE WHEN settled = 1 THEN 1 ELSE 0 END), 0) AS settled_requests,
      COALESCE(SUM(CASE WHEN settled = 0 THEN 1 ELSE 0 END), 0) AS unsettled_requests
    FROM llm_calls
    WHERE model = ? AND created_at > ?
  `);
  const rowsStmt = db.prepare(
    `SELECT created_at, tokens FROM llm_calls WHERE model = ? AND created_at > ? ORDER BY created_at ASC`,
  );
  const remoteStmt = db.prepare(`SELECT * FROM llm_remote WHERE model = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO llm_calls (model, created_at, tokens, settled) VALUES (?, ?, ?, 0)`,
  );
  const settleStmt = db.prepare(`UPDATE llm_calls SET tokens = ?, settled = 1 WHERE id = ?`);
  const pruneStmt = db.prepare(`DELETE FROM llm_calls WHERE settled = 1 AND created_at <= ?`);
  const upsertRemote = db.prepare(`
    INSERT INTO llm_remote (
      model, minute_tokens_used, minute_limit, minute_resets_at,
      day_requests_used, day_limit, day_resets_at, cooldown_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model) DO UPDATE SET
      minute_tokens_used = excluded.minute_tokens_used,
      minute_limit = excluded.minute_limit,
      minute_resets_at = excluded.minute_resets_at,
      day_requests_used = excluded.day_requests_used,
      day_limit = excluded.day_limit,
      day_resets_at = excluded.day_resets_at,
      cooldown_until = excluded.cooldown_until
  `);

  let queue: Promise<void> = Promise.resolve();

  function exclusive<T>(fn: () => T): Promise<T> {
    const previous = queue;
    let release: () => void = () => undefined;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(fn).finally(release);
  }

  function tokenCeiling(remote: RemoteRow | undefined, at: number): number {
    if (remote?.minute_limit && remote.minute_resets_at && remote.minute_resets_at > at) {
      return Math.min(limits.tokensPerMinute, remote.minute_limit);
    }
    return limits.tokensPerMinute;
  }

  function requestCeiling(remote: RemoteRow | undefined, at: number): number {
    if (remote?.day_limit && remote.day_resets_at && remote.day_resets_at > at) {
      return Math.min(limits.requestsPerDay, remote.day_limit);
    }
    return limits.requestsPerDay;
  }

  function effectiveMinuteTokens(usage: UsageRow, remote: RemoteRow | undefined, at: number): number {
    const remoteFresh =
      remote?.minute_resets_at != null && remote.minute_resets_at > at && remote.minute_tokens_used != null;
    const seen = remoteFresh ? Math.max(remote.minute_tokens_used ?? 0, usage.settled_tokens) : usage.settled_tokens;
    return seen + usage.unsettled_tokens;
  }

  function effectiveDayRequests(usage: UsageRow, remote: RemoteRow | undefined, at: number): number {
    const remoteFresh =
      remote?.day_resets_at != null && remote.day_resets_at > at && remote.day_requests_used != null;
    const seen = remoteFresh ? Math.max(remote.day_requests_used ?? 0, usage.settled_requests) : usage.settled_requests;
    return seen + usage.unsettled_requests;
  }

  function rememberRemote(
    model: string,
    at: number,
    headers: HeaderSource | undefined,
    cooldownUntil: number | null,
  ) {
    const current = remoteStmt.get(model) as RemoteRow | undefined;
    const limitTokens = headerNumber(headers, "x-ratelimit-limit-tokens");
    const remainingTokens = headerNumber(headers, "x-ratelimit-remaining-tokens");
    const resetTokens = parseGroqDelayMs(headers?.get("x-ratelimit-reset-tokens"));
    const limitRequests = headerNumber(headers, "x-ratelimit-limit-requests");
    const remainingRequests = headerNumber(headers, "x-ratelimit-remaining-requests");
    const resetRequests = parseGroqDelayMs(headers?.get("x-ratelimit-reset-requests"));

    upsertRemote.run(
      model,
      limitTokens != null && remainingTokens != null
        ? Math.max(0, limitTokens - remainingTokens)
        : current?.minute_tokens_used ?? null,
      limitTokens ?? current?.minute_limit ?? null,
      resetTokens != null ? at + resetTokens : current?.minute_resets_at ?? null,
      limitRequests != null && remainingRequests != null
        ? Math.max(0, limitRequests - remainingRequests)
        : current?.day_requests_used ?? null,
      limitRequests ?? current?.day_limit ?? null,
      resetRequests != null ? at + resetRequests : current?.day_resets_at ?? null,
      cooldownUntil,
    );
  }

  function tryReserve(model: string, estimatedTokens: number): ReserveResult {
    return db.transaction(() => reserveUnlocked(model, estimatedTokens)).immediate();
  }

  function reserveUnlocked(model: string, estimatedTokens: number): ReserveResult {
    const at = now();
    if (estimatedTokens > limits.tokensPerMinute) {
      throw new LlmLimitError(
        "minute",
        `This request is about ${estimatedTokens} tokens, above the ${limits.tokensPerMinute} token per-minute limit.`,
      );
    }

    pruneStmt.run(at - DAY_MS);
    const minute = asUsage(usageStmt.get(model, at - MINUTE_MS) as UsageRow | undefined);
    const day = asUsage(usageStmt.get(model, at - DAY_MS) as UsageRow | undefined);
    const minuteRows = rowsStmt.all(model, at - MINUTE_MS) as CallRow[];
    const dayRows = rowsStmt.all(model, at - DAY_MS) as CallRow[];
    const remote = remoteStmt.get(model) as RemoteRow | undefined;

    const cooldownUntil = remote?.cooldown_until ?? 0;
    if (cooldownUntil > at) {
      const waitMs = cooldownUntil - at;
      if (waitMs > MAX_WAIT_MS) {
        throw new LlmLimitError("minute", "The model is at its per-minute limit. Try again in a moment.", waitMs);
      }
      return { waitMs: waitMs + WINDOW_SLACK_MS };
    }

    const tpm = tokenCeiling(remote, at);
    const rpd = requestCeiling(remote, at);
    const usedDayRequests = effectiveDayRequests(day, remote, at);

    if (usedDayRequests + 1 > rpd) {
      const retryAfterMs = remote?.day_resets_at && remote.day_resets_at > at ? remote.day_resets_at - at : null;
      if (retryAfterMs != null && retryAfterMs <= MAX_WAIT_MS) {
        return { waitMs: retryAfterMs + WINDOW_SLACK_MS };
      }
      throw new LlmLimitError(
        "day",
        `Daily model request limit reached (${rpd} per day). Try again later.`,
        retryAfterMs,
      );
    }

    if (day.tokens + estimatedTokens > limits.tokensPerDay) {
      const waitMs = delayUntilTokensFit(dayRows, at, day.tokens, estimatedTokens, limits.tokensPerDay, DAY_MS);
      if (waitMs != null && waitMs > 0 && waitMs <= MAX_WAIT_MS) {
        return { waitMs: waitMs + WINDOW_SLACK_MS };
      }
      throw new LlmLimitError(
        "day",
        `Daily model token limit reached (${limits.tokensPerDay} per day). Try again later.`,
        waitMs,
      );
    }

    const requestWait = delayUntilRequestsFit(minuteRows, at, minute.requests, limits.requestsPerMinute);
    const localTokenWait = delayUntilTokensFit(minuteRows, at, minute.tokens, estimatedTokens, tpm, MINUTE_MS);
    if (requestWait == null || localTokenWait == null) {
      throw new LlmLimitError(
        "minute",
        `This request does not fit in the ${limits.tokensPerMinute} token per-minute limit.`,
      );
    }

    const usedMinuteTokens = effectiveMinuteTokens(minute, remote, at);
    const remoteTokenWait =
      remote?.minute_resets_at && remote.minute_resets_at > at && usedMinuteTokens + estimatedTokens > tpm
        ? remote.minute_resets_at - at
        : 0;

    const waitMs = Math.max(requestWait, localTokenWait, remoteTokenWait);
    if (waitMs > 0) {
      if (waitMs > MAX_WAIT_MS) {
        throw new LlmLimitError("minute", "The model is at its per-minute limit. Try again in a moment.", waitMs);
      }
      return { waitMs: waitMs + WINDOW_SLACK_MS };
    }

    const inserted = insertStmt.run(model, at, estimatedTokens);
    return { id: Number(inserted.lastInsertRowid) };
  }

  function settle(
    id: number,
    model: string,
    tokens: number,
    headers: HeaderSource | undefined,
    cooldownMs: number | null | "keep",
  ) {
    db.transaction(() => {
      const at = now();
      settleStmt.run(Math.max(0, tokens), id);
      if (!headers && cooldownMs === "keep") {
        return;
      }
      const current = remoteStmt.get(model) as RemoteRow | undefined;
      const cooldownUntil =
        cooldownMs === "keep"
          ? (current?.cooldown_until ?? null)
          : cooldownMs != null && cooldownMs > 0
            ? at + cooldownMs
            : null;
      rememberRemote(model, at, headers, cooldownUntil);
    }).immediate();
  }

  async function acquire(model: string, estimatedTokens: number): Promise<number> {
    for (let spin = 0; spin < 8; spin += 1) {
      const outcome = await exclusive(() => tryReserve(model, estimatedTokens));
      if ("id" in outcome) {
        return outcome.id;
      }
      if (outcome.waitMs <= 0) {
        break;
      }
      await sleep(outcome.waitMs);
    }
    throw new LlmLimitError("minute", "Unable to schedule the model call inside the per-minute limit.");
  }

  return {
    async run(model, estimatedTokens, send) {
      const maxAttempts = 3;
      let lastLimit: LlmLimitError | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const id = await acquire(model, estimatedTokens);
        try {
          const result = await send();
          await exclusive(() => settle(id, model, result.tokens, result.headers, null));
          return result.value;
        } catch (error) {
          const retryMs = retryDelayMs(error);
          await exclusive(() => settle(id, model, 0, errorHeaders(error), retryMs ?? "keep"));
          if (retryMs == null) {
            throw error;
          }
          lastLimit = new LlmLimitError(
            "minute",
            "The model is at its per-minute limit. Try again in a moment.",
            retryMs,
          );
          if (attempt === maxAttempts - 1) {
            throw lastLimit;
          }
        }
      }
      throw lastLimit ?? new LlmLimitError("minute", "The model is at its per-minute limit. Try again in a moment.");
    },
  };
}

function errorHeaders(error: unknown): HeaderSource | undefined {
  if (!error || typeof error !== "object" || !("headers" in error)) {
    return undefined;
  }
  const headers = (error as { headers?: HeaderSource }).headers;
  if (!headers || typeof headers.get !== "function") {
    return undefined;
  }
  return headers;
}

function retryDelayMs(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }
  if ((error as { status?: number }).status !== 429) {
    return null;
  }
  const parsed = parseGroqDelayMs(errorHeaders(error)?.get("retry-after"));
  return parsed != null && parsed > 0 ? parsed : 1_000;
}

let shared: LlmLimiter | undefined;

export function sharedLlmLimiter(): LlmLimiter {
  shared ??= createLlmLimiter();
  return shared;
}
