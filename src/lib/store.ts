import { randomUUID } from "node:crypto";
import type { Claim } from "./types";
import { openDatabase } from "./sqlite";
import type Database from "better-sqlite3";

export type Conversation = {
  id: string;
  createdAt: string;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  claims: Claim[] | null;
  declined: boolean;
  promptVersion: string | null;
  createdAt: string;
};

type AppendUser = {
  conversationId: string;
  role: "user";
  content: string;
};

type AppendAssistant = {
  conversationId: string;
  role: "assistant";
  content: string;
  claims: Claim[];
  declined: boolean;
  promptVersion: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  claims_json: string | null;
  declined: number;
  prompt_version: string | null;
  created_at: string;
};

let database: Database.Database | undefined;

function db(): Database.Database {
  if (!database) {
    database = openDatabase();
    database.pragma("foreign_keys = ON");
    database.exec(`
      create table if not exists conversations (
        id text primary key,
        created_at text not null
      );

      create table if not exists messages (
        id text primary key,
        conversation_id text not null references conversations(id),
        role text not null check (role in ('user', 'assistant')),
        content text not null,
        claims_json text,
        declined integer not null default 0,
        prompt_version text,
        created_at text not null
      );
    `);
  }
  return database;
}

function parseClaims(claimsJson: string | null): Claim[] | null {
  if (claimsJson === null) {
    return null;
  }
  const parsed = JSON.parse(claimsJson) as Array<{ text: string }>;
  return parsed.map((claim) => ({ text: claim.text, source: null }));
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    claims: parseClaims(row.claims_json),
    declined: row.declined === 1,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}

export function createConversation(): Conversation {
  const conversation: Conversation = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  db()
    .prepare(`insert into conversations (id, created_at) values (?, ?)`)
    .run(conversation.id, conversation.createdAt);
  return conversation;
}

export function getConversation(id: string): Conversation | null {
  const row = db()
    .prepare(`select id, created_at from conversations where id = ?`)
    .get(id) as { id: string; created_at: string } | undefined;
  if (!row) {
    return null;
  }
  return { id: row.id, createdAt: row.created_at };
}

export function listMessages(conversationId: string): StoredMessage[] {
  const rows = db()
    .prepare(
      `select id, conversation_id, role, content, claims_json, declined, prompt_version, created_at
       from messages
       where conversation_id = ?
       order by rowid asc`,
    )
    .all(conversationId) as MessageRow[];
  return rows.map(mapMessage);
}

export function appendMessage(input: AppendUser | AppendAssistant): StoredMessage {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  if (input.role === "user") {
    db()
      .prepare(
        `insert into messages (
          id, conversation_id, role, content, claims_json, declined, prompt_version, created_at
        ) values (?, ?, 'user', ?, null, 0, null, ?)`,
      )
      .run(id, input.conversationId, input.content, createdAt);
  } else {
    db()
      .prepare(
        `insert into messages (
          id, conversation_id, role, content, claims_json, declined, prompt_version, created_at
        ) values (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.content,
        JSON.stringify(input.claims),
        input.declined ? 1 : 0,
        input.promptVersion,
        createdAt,
      );
  }
  const row = db()
    .prepare(
      `select id, conversation_id, role, content, claims_json, declined, prompt_version, created_at
       from messages
       where id = ?`,
    )
    .get(id) as MessageRow;
  return mapMessage(row);
}
