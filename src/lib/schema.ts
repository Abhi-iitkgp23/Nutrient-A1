import { z } from "zod";
import {
  SCOPE_CATEGORIES,
  type JsonSchema,
  type ModelAnswer,
  type ScopeDecision,
} from "./types";

const claimSchema = z.strictObject({
  text: z.string().min(1),
  source: z.null(),
});

export const modelAnswerSchema = z.strictObject({
  answer: z.string().min(1),
  claims: z.array(claimSchema),
});

const scopeDecisionObject = z.strictObject({
  decision: z.enum(["allow", "decline"]),
  category: z.enum(SCOPE_CATEGORIES).nullable(),
});

export const scopeDecisionSchema = scopeDecisionObject.superRefine((value, ctx) => {
  if (value.decision === "allow" && value.category !== null) {
    ctx.addIssue({
      code: "custom",
      message: "category must be null when decision is allow",
      path: ["category"],
    });
  }
  if (value.decision === "decline" && value.category === null) {
    ctx.addIssue({
      code: "custom",
      message: "category is required when decision is decline",
      path: ["category"],
    });
  }
});

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _ModelAnswerMatches = AssertEqual<z.infer<typeof modelAnswerSchema>, ModelAnswer>;
type _ScopeDecisionMatches = AssertEqual<z.infer<typeof scopeDecisionSchema>, ScopeDecision>;

const _modelAnswerMatches: _ModelAnswerMatches = true;
const _scopeDecisionMatches: _ScopeDecisionMatches = true;
void _modelAnswerMatches;
void _scopeDecisionMatches;

function jsonSchemaFor(schema: z.ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema, { target: "draft-07" });
  const rest = { ...generated };
  delete rest.$schema;
  return rest;
}

export const modelAnswerJsonSchema = jsonSchemaFor(modelAnswerSchema);
// The model receives the object shape. scopeDecisionSchema rejects an allow
// decision that still carries a category when the server parses the result.
export const scopeDecisionJsonSchema = jsonSchemaFor(scopeDecisionObject);
