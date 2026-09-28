# Deployment plan

Deploy the whole nutrition assistant — the chat page and the API — to Railway and to Vercel. Both hosts run the same Next.js app. There is no separate frontend service and no public model proxy. The browser talks only to the app. The server calls Groq.

The latest blush-and-butter UI is local and uncommitted. Neither host will show it until that UI is on `main` and each host rebuilds from GitHub.

## What ships

| Piece | Where it lives |
| --- | --- |
| Chat page | `src/app/page.tsx`, `chat.tsx`, `sources-panel.tsx`, `stickers.tsx`, `globals.css` |
| Chat API | `POST /api/chat` |
| Restore API | `GET /api/conversations/:id` |
| Health | `GET /api/health` |
| Conversations | `DATA_DIR/nutrition.db` |
| Model rate-limit ledger | `DATA_DIR/llm-usage.db` |

`next build` produces the page and the route handlers together. `next start` serves both. `better-sqlite3` stays on the server (`serverExternalPackages` in `next.config.ts`). `GROQ_API_KEY` is never prefixed for the browser.

## Current state

| Item | Value |
| --- | --- |
| GitHub | https://github.com/Abhi-iitkgp23/Nutrient-A1 (`main`, public) |
| Last commit on `main` | `27aafb2` — the app before the Stitch UI |
| Local UI not on `main` | `src/app/chat.tsx`, `globals.css`, `layout.tsx`, `sources-panel.tsx`, `stickers.tsx`, `nutrient_ui_design/` |
| Railway project | `nutrient-a1`, service `web` |
| Railway URL | https://web-production-94f81.up.railway.app |
| Railway volume | mounted at `/data` |
| Railway env already set | `DATA_DIR=/data`, `GROQ_API_KEY` |
| Railway model | `GROQ_MODEL` unset, so the server uses `openai/gpt-oss-120b` |
| Vercel | not created yet |

The live Railway site is the previous UI. Redeploying `main` as it is now would not pick up the Stitch screen.

## Before either host builds

1. Commit the Stitch UI and push `main`. Leave `.env.local`, `data/`, and `evals/runs/` untracked. `.gitignore` already excludes them.
2. Confirm `.env.example` still lists only `GROQ_API_KEY`, `GROQ_MODEL`, and `DATA_DIR`, with an empty key.
3. Keep one Groq key. Set it in each host’s dashboard or CLI. Do not put it in the repo, the Docker image, or a `NEXT_PUBLIC_` variable.

Shared variables:

| Variable | Required | Railway | Vercel |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | yes | already set | set in the project env, Production and Preview |
| `GROQ_MODEL` | no | leave unset | leave unset unless overriding |
| `DATA_DIR` | yes for a durable file | `/data` | see the Vercel storage section |

Allowed `GROQ_MODEL` values are only `openai/gpt-oss-120b` and `qwen/qwen3.6-27b`. Any other value crashes the server at startup.

## Railway

Railway already builds this repo from GitHub with the Dockerfile, starts `npm run start` (`next start`), health-checks `/api/health`, and keeps SQLite on the `/data` volume. A new push to `main` rebuilds the same service. Do not create a second service.

The image is `node:22-bookworm-slim`. `npm ci` installs `better-sqlite3` for Linux, and the Dockerfile refuses to continue if that module cannot open an in-memory database. `DATA_DIR=/data` is also set in the image. The volume mount is what makes `nutrition.db` and `llm-usage.db` survive a restart.

`railway.toml` still selects that Dockerfile, start command, and health check. Railway warns that this config format is deprecated after 2026-12-01. It is valid for this deploy.

Steps:

1. Push the Stitch UI to `main`.
2. Watch the `web` service until the new deployment is healthy. The build log must show the `better-sqlite3` load step and `next build`, then `next start`.
3. Open https://web-production-94f81.up.railway.app and confirm the blush page, strawberry header, and butter sources panel.
4. Send an in-scope food question. The answer appears, every source slot says "No source", and the address bar gains `?c=<id>`.
5. Reload that URL. The thread comes back from `GET /api/conversations/:id`.
6. Restart the service without rebuilding. The same `GET` still returns the thread. That proves the volume, not the container disk, holds the file.
7. In the browser network log, chat calls go to this Railway host only. None go to `api.groq.com`.

Leave the volume attached at `/data`. A deploy that drops the mount will boot with an empty database and the old thread will look deleted even though the previous volume still exists.

## Vercel

Import the same GitHub repository as one Vercel project, framework Next.js. Production builds `main`. The page and `/api/chat`, `/api/conversations/:id`, and `/api/health` are part of that one deployment.

Vercel does not offer a mounted disk. Serverless functions can write under `/tmp`, and that directory is wiped between instances and deploys. `better-sqlite3` can be built for Vercel’s Linux image because `next.config.ts` already marks it external, but a file at `./data/nutrition.db` will not survive a restart. That fails the same check Railway passes.

So Vercel gets two storage choices. Pick one before the first production promotion.

### Choice A — preview only

Set `DATA_DIR=/tmp` and `GROQ_API_KEY`. Deploy. The Stitch UI and the API will run, and a conversation will work until that instance goes away. Do not treat this URL as the durable app. Do not point the failure-log or Phase 10 sign-off at it.

### Choice B — durable, same acceptance bar as Railway

Keep the route handlers and the UI. Replace only the storage behind `src/lib/store.ts` and the rate-limit file in `src/lib/rate-limit.ts` with a hosted SQLite-compatible database (Turso / libSQL is the smallest jump from `better-sqlite3`). Set that database’s URL and token on Vercel. Then `DATA_DIR` is no longer how conversations persist.

This choice is a store change. It is outside the current Railway volume setup. Do it only if Vercel must keep threads across restarts. Until that change lands, Railway is the host that meets the persistence check.

Vercel settings once the storage choice is made:

1. Import `Abhi-iitkgp23/Nutrient-A1`. Root directory is the repo root. Framework preset is Next.js. Build command `npm run build`. Install command `npm ci`.
2. Node.js 22.x, matching the Docker image.
3. Environment variables from the table above, scoped to Production. Add the same values to Preview if preview URLs should answer questions.
4. Deploy. The build must compile the App Router routes and the native module. If the build fails tracing `better-sqlite3`, the failure will name that package; keep it in `serverExternalPackages` and do not import it from a client component.
5. Open the Vercel HTTPS URL. Run the same checks as Railway: Stitch UI, in-scope answer, `source` slots reading "No source", reload of `?c=`, and no browser request to `api.groq.com`.
6. For choice B only, redeploy or wait for a new instance and confirm `GET /api/conversations/:id` still returns the thread.

Vercel and Railway do not share a database. A conversation created on one host is invisible on the other unless choice B points both hosts at the same hosted database. Until then, treat them as two copies of the app.

## Checks on every public URL

| Check | Pass |
| --- | --- |
| HTTPS page loads the Stitch UI | Blush background, cream card, strawberry header, butter sources panel |
| Narrow window | Conversation, then composer, then sources |
| Wide window | Conversation and sources side by side |
| In-scope question | `200`, answer visible, claims present, each slot "No source" |
| Decline | Fixed refusal, label "Outside what this assistant can answer", panel "No claims in this answer" |
| Reload `?c=` | Thread restored from this host’s API |
| Restart (Railway, or Vercel choice B) | Same conversation id still returns |
| Network log | Requests stay on that host |

## Out of scope

- A second frontend or a public Groq proxy.
- Filling claim sources. They stay `null`.
- Committing `.env.local`, `data/`, or `evals/runs/`.
- Changing the chat request or response shape.
