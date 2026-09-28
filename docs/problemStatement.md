# AI Nutrition Assistant Prototype

## Brief

Build a prototype chatbot that answers questions about food, nutrition, and food safety.

Nothing sits under the model yet. It answers from its own memory. It will invent facts, and the work of this milestone is to write down what it invents.

## Where This Goes

Milestone 2 slides a retrieval layer under this same app and turns every invented claim into a cited one.

The interface, endpoints, and response schema stay exactly as they are. This milestone builds the container the citations land in.

## Why This One Comes First

Ask a model how much protein a vegetarian adult needs. The answer arrives in seconds, sounds specific, and comes from nobody. Ask again tomorrow and the number has moved. Ask what a health authority recommends and the model will happily attribute a statement to that authority, whether or not the authority ever said it.

Food is a bad place for this to happen. A wrong answer reads exactly like a right one, and almost nobody goes and checks.

This prototype exists to make that failure visible and measurable before any retrieval layer is added. The goal is not to hide the model's mistakes. The goal is to record them so Milestone 2 can be compared against the same questions.

## What You Build

### 1. Chat Frontend

A message list, an input box, and a sources panel next to the conversation.

The sources panel stays empty this week. Build it now, because Milestone 2 fills it. The layout, the panel, and the place a source would appear must already exist even though every source is null.

### 2. Backend

A chat endpoint, somewhere to store the conversation, and the model call.

Keep the model call on the server. The browser never talks to the model provider directly. API keys stay on the server.

### 3. Response Schema

The model returns structured output, not prose. Parse the response against the schema and fail when it does not parse. Do not fall back to free-form text.

The response contains:

- **Answer text** — the message shown in the conversation.
- **A list of claims** — the factual statements inside that answer.
- **Each claim contains:**
  - **Claim text** — the statement itself.
  - **Source field** — a citation slot.

Every source comes back as `null` this week. That is deliberate. The contract is fixed now so Milestone 2 only has to fill the source field in.

Use the provider's structured output mode (Anthropic or OpenAI). Do not ask the model for prose and then parse it yourself.

### 4. System Prompt

Write a system prompt that states:

- What the assistant does.
- How it answers.
- How long its answers should be.
- What it will not touch.

Keep a fixed set of questions and re-run all of them after every prompt change. Fixing one case while quietly breaking three others is the usual way this goes wrong. A prompt change is not done until the full question set has been run again.

### 5. Scope Limits, Enforced in Code

The assistant must not provide:

- Calorie or weight targets.
- Recommendations about what anyone should weigh.
- Medical advice.

It should decline these questions and point the person to a qualified professional.

A line in the prompt will not hold on its own. Put the check in code as well, so a rephrased, sideways, or delayed question still gets declined even if the model would have answered it.

### 6. Deploy

Push the project to GitHub and deploy it so it is reachable at a public URL.

Use:

- Vercel
- Railway

### 7. The Failure Log

Write 10 questions across these 4 categories:

1. Nutrient requirements
2. Food safety and storage
3. Cooking methods
4. Questions where nobody has a clear answer

Run all 10 questions. For each response, record:

- Claims stated as fact with nothing behind them
- Numbers that shift between runs
- Sources it cited that you cannot find
- Questions it should have declined
- Questions where it hedged into uselessness

Group the failures and count them.

Milestone 2 will run the same 10 questions and compare the results. Do not hardcode fixes. Record the failures.

## Tools You Can Use

| Area | Tools |
| --- | --- |
| Frontend and backend | Next.js, or React with FastAPI |
| Scaffolding | Cursor or Anti-gravity |
| Model | Anthropic or OpenAI API |
| Storage | Supabase or Postgres. SQLite is fine too |
| Deployment | Vercel or Railway |

## Model Requirements

Both Anthropic and OpenAI have structured output modes. Use structured outputs rather than parsing prose yourself.

## Rules

- Every response must parse against the schema.
- The schema must include a claims list and a source field for each claim.
- Source fields must stay `null`.
- Scope limits must live in code, not only in the prompt.
- The app must be live at a public URL.
- Failures must be recorded, not patched around.
- Model calls must run behind the backend.

## Before You Submit

### Test for Consistency

Ask the same question 3 times and compare the substance, not the wording.

A number that moves between runs is the thing you most need to catch.

Then run the 10 questions and fill in the failure log.

### Test the Scope Limit

Ask the assistant:

- For a daily calorie target
- What someone with a specific condition should eat

Then:

- Rephrase both questions
- Ask them sideways
- Bring them up again after a few unrelated messages

The assistant should decline every time.

## Success Criteria

This milestone is done when all of the following are true:

- A person can send a food, nutrition, or food-safety question and see an answer in the chat.
- The sources panel is visible and empty, because every claim's source is `null`.
- The backend stores the conversation and is the only place that calls the model.
- Every model response is validated against the schema, and an invalid response fails rather than being shown as prose.
- Calorie targets, weight recommendations, and medical advice are declined by a code check, including when the question is rephrased, asked sideways, or raised again later in the thread.
- The app is deployed and reachable at a public URL.
- A failure log covers 10 questions across the four categories, with failures grouped and counted, and the same question asked three times so shifting numbers are visible.
