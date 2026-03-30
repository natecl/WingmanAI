## BetterEmailV2
readme: BetterEmail
Gmail/Outlook Extension -manifest.json

An AI productivity layer that works directly inside Gmail, automatically managing your communication workflow. The system scores email importance, highlights messages needing attention, and tracks who owes the next reply. It reminds you to respond, suggests follow-ups when others don’t, and helps you find past conversations using semantic search instead of keywords. For outreach, it monitors responses, schedules nudges, and drafts personalized follow-ups. Instead of replacing email, it transforms Gmail into an intelligent, proactive system that ensures nothing important gets missed, forgotten, or lost in your inbox. It turns conversations into trackable tasks with real-time insights and automated decision-making support.

Features:
Follow up Reminder: if a user hasen't recived a reply to their email in a few days, this extention can remind them to follow up to their email.

Reply reminder: if the user hasn't replied to someone's email in a few days, then this extention can remind them.

Semantic Search: allows users to search past emails using sentences like: "Email from 2 months ago from Nathan about school club opportunity". Better alternative than keyword search which is inaccurate and obsolete. Allows more efficient workflow and streamlines search.

Priority Email list: creates a priority list based on users preferences and past email clicks using ai analysis on user behavior.

Email quality analyzer: gives users a quality score based on their email quality and will suggest changes the user can complete to make their email more professional based on their goals and desire for the email.

AI email agent: The agent will highlight certain words and sentences that the user should change or improve to make their email of more quality based on the user's desires and goals for the email which the user can type into a chat box.

WebScraper: Obtains emails of individuals that the user want based on a semantic search. For example, "UF Research professors", and the scraper will return a list of emails with the professors's names and like their research project.

Techstack:
S: Supbase (database) E: Express.js (backend) R: React.js (frontend) N: Node.js (runtime)

Auth: Supabase

Google Cloud services with gmail api's

API Architecture:
Recommended AI Providers by Feature Priority Email Scoring: Google Gemini 2.5 Flash

Why: This is your "heavy lifter." Since it’s incredibly fast and cost-effective, you can use it to scan every incoming email in real-time without breaking the bank. It integrates natively with your existing Google Cloud/Gmail API setup.

AI Email Agent & Quality Analyzer: Anthropic Codex 4.5 (Sonnet or Opus)

Why: While Gemini is great for data, Codex is widely considered the "best writer" in 2026. For features like "suggesting changes to be more professional," Codex produces more natural, less "robotic" prose that users actually want to send.

Semantic Search: OpenAI (text-embedding-3-small, 1536d) + Supabase pgvector

Why: To make "Email from 2 months ago" work, you don't need a full LLM; you need Embeddings. OpenAI's embedding models are the industry standard for accuracy. Vectors are stored in Supabase using pgvector for native PostgreSQL integration.

WebScraper for Lead Gen: Firecrawl API

Why: Traditional scraping is brittle. Firecrawl is an "AI-first" scraper that can navigate a university directory (like UF's) and return clean JSON data (Name, Email, Research Project) that your backend can instantly process.

Reply & Follow-up Reminders: Gemini 2.5 Flash (Function Calling)

Why: These features require "logic" (checking dates and reply status) rather than "creativity." Gemini’s Function Calling capability allows your Node.js backend to ask the AI, "Should I remind the user about this?" and get a simple "Yes/No" or a drafted nudge.

## Role
-you are a junior developer and I will give you plans in .txt files for you to execute only execute when you are 90% confident or higher. Ask me clarifying questions if you need to.

## Security
-Never push api keys or any keys into the codebase.
-Always use .env files to store api keys.
-Always use .gitignore to ignore .env files.
-If you sense any security risks, immediately stop and inform me.
## Security Rules

- **NEVER write API keys, secrets, tokens, or credentials directly in source files.** Always use environment variables loaded from `.env` files. Reference `.env.example` for the required variable names.
- `.env` files must be listed in `.gitignore` and must never be committed.
- **Google OAuth tokens must only live in Supabase** (`users.gmail_tokens` column) — never in the browser, localStorage, or API responses.
- **Supabase access tokens are fetched on-demand** via `supabase.auth.getSession()` — never stored in localStorage by application code.


## Maintenance Rule

**Keep this file up to date.** Whenever you implement a feature, add a new architectural pattern, change the project structure, add dependencies, or modify commands, update the relevant sections of this file before finishing the task. This ensures AGENTS.md always reflects the current state of the project.

## Testing Rule

**Every feature must have unit tests before it is considered complete.** After finishing a feature implementation, you MUST:

1. **Write unit tests** in the appropriate `__tests__/` directory mirroring the source file path (e.g., `src/controllers/foo.js` → `__tests__/controllers/foo.test.js`).
2. **Cover the happy path** — verify the feature works correctly with valid inputs.
3. **Cover edge cases** — test boundary conditions, empty inputs, missing fields, malformed data, and unexpected types.
4. **Cover security cases** — test for:
   - Unauthorized access (missing/invalid/expired tokens)
   - Forbidden access (accessing another user's data)
   - Input injection (malicious strings in user-controlled fields)
   - Sensitive data leakage (ensure tokens, secrets, and credentials are never exposed in responses)
5. **Cover error handling** — test that failures (DB errors, external API failures) return appropriate status codes and messages without leaking internals.
6. **Run the full test suite** (`cd server && npm test`) and confirm all tests pass before marking the task as done.
7. **Do not skip tests** — if a feature is too complex to test in one pass, break it into testable units. Never leave a feature untested.

## Techstack
**Frontend:** React.js (browser extension)
**Backend:** Express.js (Node.js)
**Database:** Supabase (PostgreSQL)
**Auth:** Supabase Auth with built-in Google OAuth (`signInWithOAuth`)

## Project Structure
```
BetterEmailV2/
├── server/                          # Backend (Express.js)
│   ├── package.json                 # Server dependencies
│   ├── index.js                     # Entry point, API endpoints
│   ├── middleware/
│   │   └── auth.js                  # Supabase JWT auth middleware
│   ├── services/
│   │   ├── scraperService.js        # Web scraper pipeline logic
│   │   ├── firecrawlConfig.js       # Firecrawl env key resolution + validation helpers
│   │   ├── gmailService.js          # Gmail API ingestion & parsing
│   │   ├── embeddingService.js      # Text chunking & OpenAI embeddings
│   │   └── searchService.js         # Vector search & result ranking
│   ├── workers/
│   │   └── indexer.js               # Background embedding worker
│   ├── migrations/
│   │   └── 001_semantic_search.sql  # Supabase schema migration
│   ├── __tests__/
│   │   ├── scraper.test.js          # Scraper unit tests
│   │   ├── auth.test.js             # Auth middleware tests
│   │   ├── client/
│   │   │   ├── auth.test.js         # Client session refresh + provider token regression tests
│   │   │   ├── background.test.js   # Background OAuth scope regression tests
│   │   │   ├── content-api.test.js  # Content-script auth refresh regression tests
│   │   │   └── content-leads.test.js # Research finder prompt/ranking unit tests
│   │   ├── services/
│   │   │   └── firecrawlConfig.test.js # Firecrawl env resolution tests
│   │   ├── gmailService.test.js     # Gmail service tests
│   │   ├── embeddingService.test.js # Embedding service tests
│   │   ├── searchService.test.js    # Search service tests
│   │   └── gmailSend.test.js        # Gmail send endpoint tests
│   └── node_modules/                # (gitignored)
├── client/                          # Chrome Extension
│   ├── manifest.json
│   ├── config.example.js            # Client config template (copy to config.js)
│   ├── config.js                    # (gitignored) actual config with keys
│   ├── auth.js                      # Supabase Google OAuth via chrome.identity (loaded as content script)
│   ├── popup.html / popup.js / popup.css  # Legacy popup (sidebar is now the main UI)
│   ├── content.js / content.css     # Gmail injection (Copilot sidebar + semantic search overlay)
│   ├── background.js                # Service worker (reminders, auth, API proxy)
│   └── icons/
├── public/
│   └── index.html
├── .env.example                     # Required env var names
├── .gitignore
├── AGENTS.md
└── README.md
```

## Commands
- **Start server:** `cd server && node index.js`
- **Run tests:** `cd server && npm test`
- **Install deps:** `cd server && npm install`
- **Start indexing worker:** `cd server && npm run worker`

## API Endpoints
- `POST /analyze-email` — Email quality analysis (OpenRouter/Gemini)
- `POST /scrape-emails` — Web scraper for contact discovery. Supports research-focused searches via `searchMode: "research"` to skip broad domain lead cache and honor the full prompt.
- `POST /gmail/sync` — Gmail email ingestion (requires auth, accepts provider_token)
- `POST /search` — Semantic email search (requires auth, accepts query + filters)
- `POST /draft-email` — Draft a single email from resume + job description (Codex Sonnet, requires auth)
- `POST /draft-personalized-emails` — Draft personalized outreach emails to up to 10 leads (configurable via `limit` param, defaults to 3, max 10). Scrapes arXiv + lead profile pages via Firecrawl, drafts with Codex using user resume. Returns `{ drafts: [{name, email, subject, body}] }`. Requires auth.
- `POST /gmail/send` — Auto-send drafted emails via Gmail API. Accepts `{ provider_token, drafts: [{email, subject, body}] }`. Max 10 per request. Returns `{ results: [{email, success, messageId?, error?}], sent, total }`. Requires auth.
- `POST /ai/classify-followup` — Classify if a sent email is a follow-up (Gemini Flash, requires auth)
- `POST /ai/summarize-email` — 4–6 word AI summary of an email (Gemini Flash, requires auth)

## Implemented Features
- **Copilot Sidebar** — Persistent right-aligned sidebar that is the main control center for all BetterEmail features. Gmail shifts left to accommodate the 350px sidebar. Replaces the old extension popup as the primary UI.
- **Email Quality Analyzer** — Sidebar compose analyzer reads from the active Gmail compose window and provides context-aware AI feedback. Also supports AI-powered email drafting from resume.
- **Follow-up Reminders** — Toast notification after sending, with custom scheduling. Reminders are also displayed in the sidebar's Main tab with AI-generated summaries (Gemini Flash). Smart heuristics auto-dismiss reminders when a reply is sent in the same thread (Re: prefix or threadId match).
- **Research Finder Agent** — Fully automated agent in the sidebar Research tab. Students enter a research area of interest, their university, and the number of professors to contact (max 10). The agent searches for faculty/lab contacts at that university, prioritizes academic matches, drafts research-specific outreach emails with Codex Sonnet + user resume, and auto-sends via Gmail API. Research searches skip the broad university-domain lead cache so the requested research area drives the results. Progress is shown in a real-time log.
- **Research Finder Agent** — Fully automated agent in the sidebar Research tab. Students enter a research area of interest, their university, and the number of professors to contact (max 10). The agent searches for faculty/lab contacts at that university, prioritizes academic matches, drafts research-specific outreach emails with Codex Sonnet + user resume, and auto-sends via Gmail API. Research searches skip the broad university-domain lead cache so the requested research area drives the results, and Firecrawl search volume is scaled down from the requested contact count to avoid unnecessary credit burn.

- **Authentication** — Supabase Google OAuth via chrome.identity, JWT middleware for protected routes. Sign-in/out is handled directly in the sidebar. Auth state changes are detected via `chrome.storage.onChanged` and the sidebar unlocks/locks instantly without page refresh. Content scripts now auto-refresh expired Supabase access tokens before protected API calls and preserve Gmail provider tokens across session refreshes.
- **Authentication** — Supabase Google OAuth via chrome.identity, JWT middleware for protected routes. Sign-in/out is handled directly in the sidebar. Auth state changes are detected via `chrome.storage.onChanged` and the sidebar unlocks/locks instantly without page refresh. Content scripts now auto-refresh expired Supabase access tokens before protected API calls and preserve Gmail provider tokens across session refreshes. Google OAuth now requests both `gmail.readonly` and `gmail.send` so research finder drafts can actually be sent.
- **Firecrawl Configuration** — Server endpoints now resolve Firecrawl credentials from the standard `FIRECRAWL_API_KEY` env var and fall back to legacy `Firecrawl_Api_Key` for backward compatibility. Scrape validation reports the standardized env name when missing.
- **Client Runtime Config** — `client/config.js` must expose `WM_CONFIG` for content scripts. `BE_CONFIG` is kept as an alias for backward compatibility, and runtime config readers now accept either name instead of silently falling back to production.
- **Semantic Search** — Natural language email search using OpenAI embeddings + Supabase pgvector, with Gmail sync, background indexing worker. Available in both the sidebar Search tab AND the Gmail search bar overlay with animated glow ring effect (toggled via Shift key or toggle button).
- **Resume Upload** — PDF resume upload in sidebar Settings tab for AI-powered email drafting.

## Database Tables (Supabase)
- `scraped_pages` — Cache of scraped page data (url PK)
- `email_leads` — Directory of discovered contacts (email PK)
- `prompt_cache` — Maps normalized prompts to cached results (cache_key PK)
- `users` — User profiles with Gmail OAuth tokens (id PK, references auth.users)
- `gmail_messages` — Email metadata + cleaned body text (unique on user_id + gmail_message_id)
- `gmail_message_vectors` — Summary + chunk embeddings with vector(1536) for similarity search
- `indexing_jobs` — Queue for background embedding worker (pending/processing/done/error)

## Learning
-Whenever you are given a task update this file to make youself more efficient and information to run better such as context or skills. Include a project structure outline.
