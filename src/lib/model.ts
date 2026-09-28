import "server-only";
import Groq, { APIError } from "groq-sdk";
import { billableTokens, estimatePromptTokens, sharedLlmLimiter } from "./rate-limit";
import type { JsonSchema } from "./types";

const MAX_COMPLETION_TOKENS = 1024;

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const QWEN_MODEL = "qwen/qwen3.6-27b";

export type GroqModelId = typeof DEFAULT_GROQ_MODEL | typeof QWEN_MODEL;

export type ModelMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ModelClient = {
  complete(input: {
    system: string;
    messages: ModelMessage[];
    schema: JsonSchema;
    schemaName: string;
  }): Promise<unknown>;
};

export function resolveGroqModel(raw: string | undefined): GroqModelId {
  const model = raw?.trim() || DEFAULT_GROQ_MODEL;
  if (model !== DEFAULT_GROQ_MODEL && model !== QWEN_MODEL) {
    throw new Error(`GROQ_MODEL must be ${DEFAULT_GROQ_MODEL} or ${QWEN_MODEL}`);
  }
  return model;
}

resolveGroqModel(process.env.GROQ_MODEL);

type CompletionInput = {
  system: string;
  messages: ModelMessage[];
  schema: JsonSchema;
  schemaName: string;
};

function reasoningOptions(model: GroqModelId) {
  if (model === QWEN_MODEL) {
    return {
      reasoning_format: "hidden" as const,
      reasoning_effort: "none" as const,
    };
  }
  return {
    include_reasoning: false as const,
    reasoning_effort: "low" as const,
  };
}

function isStrictRejection(error: unknown): boolean {
  return error instanceof APIError && error.status === 400 && /strict/i.test(error.message);
}

export class UnparseableModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnparseableModelOutputError";
  }
}

function parseContent(content: string | null | undefined): unknown {
  if (!content?.trim()) {
    throw new UnparseableModelOutputError("Groq returned no JSON object");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new UnparseableModelOutputError("Groq returned content that is not JSON");
  }
}

function estimateCallTokens(input: CompletionInput): number {
  return (
    estimatePromptTokens([
      input.system,
      input.schemaName,
      JSON.stringify(input.schema),
      ...input.messages.map((message) => message.content),
    ]) + MAX_COMPLETION_TOKENS
  );
}

async function completeOnce(
  groq: Groq,
  model: GroqModelId,
  input: CompletionInput,
  strict: boolean,
) {
  const estimatedTokens = estimateCallTokens(input);
  return sharedLlmLimiter().run(model, estimatedTokens, async () => {
    const { data, response } = await groq.chat.completions
      .create(
        {
          model,
          temperature: 0,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          messages: [{ role: "system", content: input.system }, ...input.messages],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.schemaName,
              strict,
              schema: input.schema,
            },
          },
          ...reasoningOptions(model),
        },
        { maxRetries: 0 },
      )
      .withResponse();
    return {
      value: data,
      tokens: billableTokens(data.usage, estimatedTokens),
      headers: response.headers,
    };
  });
}

export function createModelClient(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required");
  }
  const model = resolveGroqModel(env.GROQ_MODEL);
  const groq = new Groq({ apiKey, maxRetries: 0 });

  return {
    async complete(input) {
      try {
        const response = await completeOnce(groq, model, input, true);
        return parseContent(response.choices[0]?.message?.content);
      } catch (error) {
        if (model !== QWEN_MODEL || !isStrictRejection(error)) {
          throw error;
        }
        const response = await completeOnce(groq, model, input, false);
        return parseContent(response.choices[0]?.message?.content);
      }
    },
  };
}
