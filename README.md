Wingman
Gmail/Outlook Extension -manifest.json

An AI productivity layer that works directly inside Gmail, automatically managing your communication workflow. The system scores email importance, highlights messages needing attention, and tracks who owes the next reply. It reminds you to respond, suggests follow-ups when others don’t, and helps you find past conversations using semantic search instead of keywords. For outreach, it monitors responses, schedules nudges, and drafts personalized follow-ups. Instead of replacing email, it transforms Gmail into an intelligent, proactive system that ensures nothing important gets missed, forgotten, or lost in your inbox. It turns conversations into trackable tasks with real-time insights and automated decision-making support.

Features:
Sidebar ui: all the features are implemented into a gmail sidebar that interects with the regular gmail interface.
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

AI Email Agent & Quality Analyzer: Anthropic Claude 4.5 (Sonnet or Opus)

Why: While Gemini is great for data, Claude is widely considered the "best writer" in 2026. For features like "suggesting changes to be more professional," Claude produces more natural, less "robotic" prose that users actually want to send.

Semantic Search: OpenAI (text-embedding-3-large) + Supabase (pgvector)

Why: To make "Email from 2 months ago" work, you don't need a full LLM; you need Embeddings. OpenAI’s embedding models are the industry standard for accuracy. You store these "vector" versions of emails in your existing Supabase database using pgvector to keep your tech stack lean.

WebScraper for Lead Gen: Firecrawl API

Why: Traditional scraping is brittle. Firecrawl is an "AI-first" scraper that can navigate a university directory (like UF's) and return clean JSON data (Name, Email, Research Project) that your backend can instantly process.

Reply & Follow-up Reminders: Gemini 2.5 Flash (Function Calling)

Why: These features require "logic" (checking dates and reply status) rather than "creativity." Gemini’s Function Calling capability allows your Node.js backend to ask the AI, "Should I remind the user about this?" and get a simple "Yes/No" or a drafted nudge.

---

## How to Run

### Prerequisites
- Node.js (v18+)
- A Supabase project with pgvector enabled
- Google Cloud project with Gmail API enabled
- API keys for OpenAI, Firecrawl, and OpenRouter/Gemini

### 1. Clone & Configure Environment

```bash
git clone <repo-url>
cd BetterEmailV2
cp .env.example server/.env
# Fill in all required values in server/.env
```

### 2. Install Server Dependencies

```bash
cd server
npm install
```

### 3. Run Database Migrations

Apply the SQL migration in Supabase’s SQL editor:

```
server/migrations/001_semantic_search.sql
```

### 4. Start the Backend Server

```bash
cd server
node index.js
# Server runs on http://localhost:3000 by default
```

### 5. Start the Background Indexing Worker (optional)

In a separate terminal, run the embedding worker to index Gmail messages:

```bash
cd server
npm run worker
```

### 6. Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `client/` folder
4. Copy `client/config.example.js` to `client/config.js` and fill in your Supabase URL and anon key

### 7. Run Tests

```bash
cd server
npm test
```
