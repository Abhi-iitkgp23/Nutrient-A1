import "server-only";
import type { ModelClient, ModelMessage } from "./model";
import { LlmLimitError } from "./rate-limit";
import { scopeDecisionJsonSchema, scopeDecisionSchema } from "./schema";
import type { ScopeDecision } from "./types";

export const SCOPE_SCHEMA_NAME = "scope_decision";
export const SCOPE_HISTORY_LIMIT = 12;

const SCOPE_INSTRUCTIONS = `You decide whether a nutrition assistant may answer the latest user message.

Decline only these categories:
- calorie_target: a personal or daily calorie number, a deficit or surplus, or how much someone should eat to lose fat or weight.
- weight_recommendation: a goal weight, a weight range, or a BMI target, including what someone should weigh.
- medical_advice: what to eat, take, or avoid for a condition, symptom, medication, pregnancy complication, allergy treatment, or diagnosis.

Decline rephrasings, hypotheticals, role-play, and a forbidden question buried inside an otherwise ordinary nutrition question. Read the recent messages. A later follow-up that asks for one of these categories still declines.

Allow general reference information: nutrient amounts, storage times, cooking temperatures, and food-safety practice. "How much protein does a vegetarian adult generally need?" is allow, with category null.

Return decision "decline" and the matching category, or decision "allow" and category null.`;

const CLASSIFIER_FAILURE: ScopeDecision = {
  decision: "decline",
  category: null,
};

const CALORIE_TARGET = [
  /\b(?:calorie|kcal)s?\s+(?:target|goal|budget|allowance|limit)\b/i,
  /\b(?:daily|per day|a day|each day)\b[^.]{0,48}\b(?:calorie|kcal)s?\b/i,
  /\b(?:calorie|kcal)s?\b[^.]{0,48}\b(?:per day|a day|each day|deficit|surplus)\b/i,
  /\b(?:calorie|kcal)s?\s+(?:deficit|surplus)\b/i,
  /\b(?:eat|consume|aim for|target)\s+\d[\d,]*\s*(?:kcal|calories)\b/i,
  /\b\d[\d,]*\s*(?:kcal|calories)\s+(?:a|per)\s+day\b/i,
];

const WEIGHT_GOAL = [
  /\b(?:goal|target|ideal)\s+(?:weight|bmi)\b/i,
  /\b(?:weight|bmi)\s+(?:target|goal|range)\b/i,
  /\byou should weigh\b/i,
  /\bshould weigh\b/i,
  /\b(?:aim for|target)\s+a?\s*bmi\b/i,
  /\bbmi\s+of\s+\d/i,
  /\bhealthy weight range\b/i,
];

const MEDICAL_CONDITION =
  /\b(?:diabetes|diabetic|hypertension|high blood pressure|pregnan(?:t|cy)|allerg(?:y|ic|ies)|medication|medicine|symptom|diagnosis|celiac|kidney disease|heart disease)\b/i;

const MEDICAL_DIRECTIVE =
  /\b(?:should(?: not)?|must(?: not)?|avoid|don't|do not|cut out|stay away from)\b/i;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isForbiddenAdvice(text: string): boolean {
  if (matchesAny(text, CALORIE_TARGET) || matchesAny(text, WEIGHT_GOAL)) {
    return true;
  }
  return MEDICAL_CONDITION.test(text) && MEDICAL_DIRECTIVE.test(text);
}

export function outputExceedsScope(answer: {
  answer: string;
  claims: { text: string }[];
}): boolean {
  const parts = [answer.answer, ...answer.claims.map((claim) => claim.text)];
  return parts.some((part) => isForbiddenAdvice(part));
}

function recentHistory(message: string, history: ModelMessage[]): ModelMessage[] {
  let prior = history;
  const last = prior[prior.length - 1];
  if (last?.role === "user" && last.content === message) {
    prior = prior.slice(0, -1);
  }
  return prior.slice(-SCOPE_HISTORY_LIMIT);
}

export async function classifyInput(
  client: ModelClient,
  message: string,
  history: ModelMessage[] = [],
): Promise<ScopeDecision> {
  try {
    const raw = await client.complete({
      system: SCOPE_INSTRUCTIONS,
      messages: [...recentHistory(message, history), { role: "user", content: message }],
      schema: scopeDecisionJsonSchema,
      schemaName: SCOPE_SCHEMA_NAME,
    });
    const parsed = scopeDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return CLASSIFIER_FAILURE;
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof LlmLimitError) {
      throw error;
    }
    return CLASSIFIER_FAILURE;
  }
}
