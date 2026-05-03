# ITMAP - Enterprise Market Research Platform

## Overview

ITMAP is a comprehensive enterprise market research platform designed for technology vendor analysis. It offers interactive Vendor Evaluation visualizations, competitive intelligence, and detailed market insights. The platform enables users to explore technology markets, compare vendors, track vendor news, and access research reports. It supports a full-stack architecture with a React frontend and Express.js backend, built for complex data visualizations and analytical workflows for enterprise users. The business vision is to provide unbiased and comprehensive market intelligence, positioning the platform as a crucial tool for understanding and navigating technology markets.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI Framework**: Radix UI primitives with shadcn/ui
- **Styling**: Tailwind CSS with CSS variables
- **Build Tool**: Vite
- **Data Visualization**: D3.js for Vendor Evaluation charts

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript
- **Database ORM**: Drizzle ORM
- **Database**: PostgreSQL via Neon serverless
- **File Uploads**: Google Cloud Storage and Uppy
- **Development**: TSX

### Data Model
The platform utilizes a relational data model encompassing Markets, Sub-Markets, Vendors, Criteria (Execution vs. Viability), Vendor Scores, Market Criteria Weights, Vendor News, Features, Research Reports, Historical Positions, and Market Builder Jobs/Stages.

**Market Builder**: Four tables support the AI Market Builder wizard (`/market-builder`):
- `market_builder_jobs` — one row per wizard session (inputs, status, link to created market once published). Job lifecycle: `idle → running → completed | failed → published`.
- `market_builder_stages` — one row per stage per job (stage 1–5, status, JSONB AI result, error, timestamps). Stage lifecycle: `pending → running → completed | failed`.
- `market_builder_llm_settings` — one row per LLM provider, stores encrypted API key. Providers: `openai`, `anthropic`, `perplexity`.
- `market_builder_sources` — source materials (URLs + uploaded files) attached to a job, optionally scoped to a specific stage.

Storage module: `server/storage/marketBuilder.ts`. These tables enable resumability — if the browser closes mid-wizard, the job survives.

**Market Builder features:**
- **LLM provider selection**: Choose OpenAI, Anthropic (Claude), or Perplexity, with all published models listed. API keys stored via `PUT /api/admin/market-builder/settings/llm/:provider`, shown only as preview.
- **Per-stage source materials**: URLs are fetched server-side (HTML stripped, capped at 10k chars each, 40k total). Files can be uploaded or pasted as text. Sources can be scoped globally or to a specific stage.
- **Editable stage results**: Each stage result is editable inline — vendors, criteria weights, feature chips, score matrix (click-to-edit), and Harvey Ball support grid. Edits saved via `PATCH /api/admin/market-builder/jobs/:id/stages/:stage/result`.
- **Regenerate individual stages**: POST to `/api/admin/market-builder/jobs/:id/stages/:stage/regenerate` resets and re-runs a single stage via SSE stream.
- **Horizontal step tracker**: Top-of-page tracker shows all 5 stages with completion status; clicking a completed stage navigates to it in review mode.
- **Post-publish visibility toggle**: After publishing, a Switch lets admins toggle market visibility without navigating away. Also available via `PATCH /api/admin/market-builder/jobs/:id/visibility`.
- **Key files**: `server/market-builder/llm.ts` (OpenAI/Anthropic/Perplexity abstraction), `server/market-builder/sources.ts` (URL fetch + source context builder), `server/market-builder/stages/stage{1-5}.ts` (per-stage runners), `server/market-builder/runner.ts` (SSE orchestrator), `server/routes/marketBuilder.ts` (API routes), `client/src/components/admin/market-builder-wizard.tsx` (complete UI), `client/src/components/admin/market-builder-llm-panel.tsx`, `client/src/components/admin/market-builder-sources.tsx`.

**Feature Support Scoring**: Uses Harvey Ball scale (0-4) for vendor feature support:
- 0 = Not Supported (0%)
- 1 = Limited (25%)
- 2 = Partial (50%)
- 3 = Good (75%)
- 4 = Full Support (100%)

Data is stored as integers 0-4 in the database. The AI chat context builder converts these to 0-100 percentages (multiplying by 25) for natural language responses, while the frontend Support Matrix and PDF generation handle 0-4 natively.

### Authentication and Authorization
Designed for internal enterprise use, featuring basic user management and role-based access control for administrators and end-users.

### API Design
Follows RESTful principles with standardized error handling, request/response logging, Zod schema validation, and consistent JSON response formats.

### AI Market Suggestions
After each daily news scrape, AI automatically reviews new articles and proposes specific score/commentary changes pending admin review. Only HIGH/MEDIUM impact articles trigger suggestions. Criterion score changes are modest (0.3-1.0); feature support changes require strong product announcement evidence. Admins review suggestions in the new "AI Suggestions" admin tab with full before/after comparisons and commentary diffs. Approving applies the change live; rejecting discards it. Suggestions are grouped by vendor with pending count badge on the tab. Duplicate prevention stops redundant pending suggestions per vendor/subject. Key files: `server/news/suggestions/generator.ts` (OpenAI-powered generator), `server/routes.ts` (GET/POST /api/admin/ai-suggestions/*), `shared/schema.ts` (`aiSuggestions` table), `client/src/components/admin/ai-suggestions-admin.tsx`, `client/src/pages/admin.tsx`.

### External Partner API
A public REST API for third-party integrations (e.g. Slack bots, custom agents). Partners authenticate via Bearer token or `X-Api-Key` header. API keys are managed in the admin panel (Admin → API Keys tab). Keys are stored as SHA-256 hashes and the raw key is shown only once on creation.

**Endpoints:**
- `GET /api/external/v1/markets` — list markets the key is authorized to query
- `POST /api/external/v1/chat` — send a question, get an AI-powered answer (body: `market_id`, `message`, optional `session_id`)
- `GET /api/external/v1/sessions/:sessionId` — retrieve full conversation history for a session

**Session management:** Partners pass their own session identifier (e.g. Slack thread ID) as `session_id`. ITMAP stores conversation history keyed on `api_key_id + session_id`, so the same Slack thread automatically continues the same conversation.

**Key files:** `server/external/index.ts` (routes + auth middleware), `client/src/components/admin/api-keys-admin.tsx` (admin UI), `shared/schema.ts` (`external_api_keys`, `external_chat_sessions`, `external_chat_messages` tables).

### File Upload Strategy
Supports document uploads for research reports using Google Cloud Storage as primary storage, with Uppy.js for the frontend interface. AWS S3 is available as an alternative.

### Core Features and Design Decisions
- **Vendor Evaluation**: Replaced "Magic Quadrant" terminology, offers interactive visualizations, and integrates support matrix scores.
- **Historical Timeline**: Implements a functional historical timeline for Vendor Evaluation, allowing navigation through 3 years of weekly data.
- **Automated News Processing**: Features a single combined daily pipeline at 7 AM UTC. For each vendor, one OpenAI API call with the `web_search_preview` tool visits the vendor's configured newsroomUrl, finds articles published in the last 48 hours, and returns them already fully analyzed — editorial opinion, competitive context, category classification, impact level (HIGH/MEDIUM/LOW), and a one-sentence key takeaway — all in a single request. No HTML fetching or separate analysis step is needed. Articles are deduplicated by URL and content hash. Admin panel includes a "Run Pipeline" button to trigger the pipeline on demand for all vendors or a single vendor. Implements 90-day retention with weekly cleanup (Sunday 4 AM UTC). Key files: `server/news/ingestion/scraper.ts` (OpenAI web search, combined scrape+analysis), `server/news/impact/analyzer.ts` (fallback analyzer for any pre-existing pending articles). The legacy `server/news/ingestion/browser.ts` and `news_sources` table still exist for backward compatibility but are no longer used by the main pipeline.
- **Newsroom URL Health Check**: Daily automated check (6:30 AM UTC, before the scrape) that verifies each vendor's newsroom URL is reachable via HTTP HEAD requests with a 10s timeout. Results are stored in memory and displayed in the vendor management admin panel with colour-coded badges ("URL unreachable" in red, "OK" in green). Admins can also trigger an on-demand check with a "Check All URLs" button. A summary card lists all broken URLs with error details. Broken URLs can be fixed immediately via the existing vendor edit form. Implementation: `server/news/ingestion/urlHealthCheck.ts`, `GET/POST /api/admin/newsroom-url-health`, `client/src/components/admin/vendor-management.tsx`.
- **Newsroom URL Alert Emails**: When a vendor newsroom URL transitions from reachable to unreachable, admins are notified by email. Email alerts require SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` env vars) and an optional `ALERT_FROM_EMAIL`. Global on/off toggle and custom recipient emails are configurable from the News admin tab. Per-vendor opt-out is available on each vendor's edit form (`newsroomAlertDisabled` field). Alert state-transition tracking (`ok → broken`) is in-memory in `urlHealthCheck.ts`. Email dispatch is in `server/emailService.ts`. Alert settings are stored in the `admin_alert_settings` DB table. Endpoints: `GET/PUT /api/admin/alert-settings`, `POST /api/admin/alert-settings/test`.
- **AI Chat Agent**: Conversational AI assistant accessible from each market's detail page that answers complex market intelligence questions using GPT-4.1 mini (1M token context) and database context. Supports 12 question patterns including vendor comparisons, quadrant positioning, feature support, ecosystem integrations, news analysis, and methodology explanations. Conversations are persisted per user and market for follow-up questions. AI responses include markdown formatting, actual scores/quotes from database commentary, and source citations. Built with custom RAG approach (no Langchain) for better control. Includes comprehensive error logging and diagnostics for troubleshooting production issues.
- **Mobile Responsiveness**: UI adapts to different screen sizes, optimizing charts, typography, navigation, and spacing for mobile devices.
- **Domain Management**: Enforces a custom primary domain (itmap.ai) via BASE_URL environment variable with 301 redirects from the Replit domain, smart OAuth callback handling, and automatic fallback to REPLIT_DOMAINS detection.
- **Ecosystem Support**: Dedicated section for third-party integrations, separating ecosystem-related features from core product capabilities in the support matrix.
- **Vendor Scoring**: Admin portal separates X-axis (Execution) and Y-axis (Viability) criteria tables for improved organization.
- **Import/Export**: Admin-only feature for exporting market data to Excel with three sheets (Vendor Evaluation, Product Evaluation, ISV Ecosystem) and importing pre-filled Excel templates to bulk-populate market data. Uses xlsx library for Excel generation/parsing.
- **PDF Report Generation**: Professional PDF reports with vendor filtering, featuring detailed commentary/analysis embedded within feature support tables. Reports include support level badges (Full/Good/Partial/Limited/Not Supported) with inline commentary boxes showing detailed explanations and source references. Uses Puppeteer with system Chromium for PDF rendering.

## External Dependencies

### Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database operations.

### Cloud Storage
- **Google Cloud Storage**: Primary storage for assets.
- **AWS S3**: Alternative storage option via Uppy integration.

### UI and Visualization Libraries
- **Radix UI**: Accessibility-focused primitive components.
- **D3.js**: Data visualization library.
- **Lucide React**: Icon library.

### Development and Build Tools
- **Vite**: Build tool.
- **TanStack Query**: Server state management and caching.
- **React Hook Form**: Form handling.
- **Tailwind CSS**: Utility-first CSS framework.
- **Wouter**: Lightweight routing library.

### File Upload Infrastructure
- **Uppy**: File upload library.
- **Google Cloud Storage SDK**: Direct integration for file operations.

### Validation and Type Safety
- **Zod**: Runtime type validation.
- **TypeScript**: Static type checking.
- **Drizzle Zod**: Integration for database schema validation.

### AI/ML Integration
- **OpenAI API via Replit AI Integrations**: Powers intelligent news impact analysis and conversational AI chat using GPT-4.1 mini (1M token context window). News analyzer classifies business impact (HIGH: 80-100, MEDIUM: 50-79, LOW: 10-49) with confidence scores and detailed reasoning. Chat agent answers complex market intelligence questions with full database context. Includes fallback to rule-based scoring on errors. Charges are billed to Replit credits, no external API key required.

### Data Management
- **xlsx Library**: Used for Excel file generation and parsing in the Import/Export feature.

### PDF Generation
- **Puppeteer**: Headless browser automation for rendering HTML to PDF.
- **Chromium**: System browser used by Puppeteer for PDF generation.