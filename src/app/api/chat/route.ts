import { declineBody } from "@/lib/decline";
import {
  createModelClient,
  UnparseableModelOutputError,
  type ModelClient,
  type ModelMessage,
} from "@/lib/model";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/prompt";
import { LlmLimitError } from "@/lib/rate-limit";
import { retrieve } from "@/lib/retrieve";
import { modelAnswerJsonSchema, modelAnswerSchema } from "@/lib/schema";
import { classifyInput, outputExceedsScope } from "@/lib/scope";
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
  type StoredMessage,
} from "@/lib/store";
import type { ChatResponse, Claim } from "@/lib/types";

export const runtime = "nodejs";

export const ANSWER_SCHEMA_NAME = "nutrition_answer";

const VALIDATION_MESSAGE = "Enter a message.";
const NOT_FOUND_MESSAGE = "That conversation does not exist.";
const FORMAT_MESSAGE = "This answer didn't match the expected format, so it wasn't shown.";
const RETRY_MESSAGE = "Something went wrong. Try again.";

type ChatInput = {
  message: string;
  conversationId?: string;
};

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

function chatResponse(conversationId: string, stored: StoredMessage): ChatResponse {
  return {
    conversationId,
    message: {
      id: stored.id,
      role: "assistant",
      answer: stored.content,
      claims: (stored.claims ?? []).map((claim) => ({ text: claim.text, source: null })),
      declined: stored.declined,
      createdAt: stored.createdAt,
    },
  };
}

function storeDecline(conversationId: string): StoredMessage {
  return appendMessage({
    conversationId,
    role: "assistant",
    content: declineBody.answer,
    claims: [],
    declined: true,
    promptVersion: PROMPT_VERSION,
  });
}

async function readInput(request: Request): Promise<ChatInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, VALIDATION_MESSAGE);
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, VALIDATION_MESSAGE);
  }
  const record = body as { message?: unknown; conversationId?: unknown };
  if (typeof record.message !== "string" || record.message.trim() === "") {
    return jsonError(400, VALIDATION_MESSAGE);
  }
  if (record.conversationId != null && typeof record.conversationId !== "string") {
    return jsonError(400, VALIDATION_MESSAGE);
  }
  const conversationId =
    typeof record.conversationId === "string" && record.conversationId.trim() !== ""
      ? record.conversationId.trim()
      : undefined;
  return { message: record.message.trim(), conversationId };
}

function modelMessages(conversationId: string): ModelMessage[] {
  return listMessages(conversationId).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export async function handleChat(request: Request, client?: ModelClient): Promise<Response> {
  const input = await readInput(request);
  if (input instanceof Response) {
    return input;
  }

  let conversationId: string;
  try {
    if (input.conversationId) {
      const existing = getConversation(input.conversationId);
      if (!existing) {
        return jsonError(404, NOT_FOUND_MESSAGE);
      }
      conversationId = existing.id;
    } else {
      conversationId = createConversation().id;
    }
    appendMessage({
      conversationId,
      role: "user",
      content: input.message,
    });
  } catch (error) {
    console.error(error);
    return jsonError(500, RETRY_MESSAGE);
  }

  try {
    const model = client ?? createModelClient();
    const history = modelMessages(conversationId);
    const decision = await classifyInput(model, input.message, history);
    if (decision.decision === "decline") {
      return Response.json(chatResponse(conversationId, storeDecline(conversationId)));
    }

    await retrieve(input.message);

    let raw: unknown;
    try {
      raw = await model.complete({
        system: SYSTEM_PROMPT,
        messages: history,
        schema: modelAnswerJsonSchema,
        schemaName: ANSWER_SCHEMA_NAME,
      });
    } catch (error) {
      if (error instanceof UnparseableModelOutputError) {
        return jsonError(422, FORMAT_MESSAGE);
      }
      throw error;
    }

    const parsed = modelAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(422, FORMAT_MESSAGE);
    }

    const claims: Claim[] = parsed.data.claims.map((claim) => ({
      text: claim.text,
      source: null,
    }));
    if (outputExceedsScope({ answer: parsed.data.answer, claims })) {
      return Response.json(chatResponse(conversationId, storeDecline(conversationId)));
    }

    const stored = appendMessage({
      conversationId,
      role: "assistant",
      content: parsed.data.answer,
      claims,
      declined: false,
      promptVersion: PROMPT_VERSION,
    });
    return Response.json(chatResponse(conversationId, stored));
  } catch (error) {
    console.error(error);
    const message = error instanceof LlmLimitError ? error.message : RETRY_MESSAGE;
    return jsonError(500, message);
  }
}

export function POST(request: Request) {
  return handleChat(request);
}
