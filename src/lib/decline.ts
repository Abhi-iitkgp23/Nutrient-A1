import type { Claim } from "./types";

export const DECLINE_ANSWER =
  "I can't give calorie targets, weight recommendations, or medical advice. A registered dietitian or a clinician is the right person to ask.";

export const declineBody: {
  answer: typeof DECLINE_ANSWER;
  claims: Claim[];
  declined: true;
} = {
  answer: DECLINE_ANSWER,
  claims: [],
  declined: true,
};
