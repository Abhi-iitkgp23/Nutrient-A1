export type Source = null;

export type Claim = {
  text: string;
  source: Source;
};

export type ModelAnswer = {
  answer: string;
  claims: Claim[];
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  answer: string;
  claims: Claim[];
  declined: boolean;
  createdAt: string;
};

export type UserMessage = {
  id: string;
  role: "user";
  content: string;
  claims: null;
  declined: false;
  createdAt: string;
};

export type ChatResponse = {
  conversationId: string;
  message: AssistantMessage;
};

export type ConversationResponse = {
  conversationId: string;
  messages: Array<UserMessage | AssistantMessage>;
};

export const SCOPE_CATEGORIES = [
  "calorie_target",
  "weight_recommendation",
  "medical_advice",
] as const;

export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export type ScopeDecision = {
  decision: "allow" | "decline";
  category: ScopeCategory | null;
};

export type RetrievedChunk = {
  id: string;
  title: string;
  locator: string;
  text: string;
};

export type JsonSchema = Record<string, unknown>;
