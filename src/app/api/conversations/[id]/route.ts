import { getConversation, listMessages, type StoredMessage } from "@/lib/store";
import type { AssistantMessage, ConversationResponse, UserMessage } from "@/lib/types";

const NOT_FOUND_MESSAGE = "That conversation does not exist.";
const RETRY_MESSAGE = "Something went wrong. Try again.";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

function toThreadMessage(stored: StoredMessage): UserMessage | AssistantMessage {
  if (stored.role === "user") {
    return {
      id: stored.id,
      role: "user",
      content: stored.content,
      claims: null,
      declined: false,
      createdAt: stored.createdAt,
    };
  }
  return {
    id: stored.id,
    role: "assistant",
    answer: stored.content,
    claims: (stored.claims ?? []).map((claim) => ({ text: claim.text, source: null })),
    declined: stored.declined,
    createdAt: stored.createdAt,
  };
}

export function loadConversation(id: string): Response {
  try {
    const conversation = getConversation(id);
    if (!conversation) {
      return jsonError(404, NOT_FOUND_MESSAGE);
    }
    const body: ConversationResponse = {
      conversationId: conversation.id,
      messages: listMessages(conversation.id).map(toThreadMessage),
    };
    return Response.json(body);
  } catch (error) {
    console.error(error);
    return jsonError(500, RETRY_MESSAGE);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return loadConversation(id);
}
