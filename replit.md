# itmap.ai — Enterprise IT Vendor Intelligence Platform

## Overview

itmap.ai (formerly ITMAP, briefly spectio.ai) is a premium enterprise IT vendor selection platform delivering independent, AI-powered intelligence — vendor rankings, feature evaluations, news impact analysis, and research reports. The company tagline is "See Every Vendor. Know Every Move." The platform serves enterprise IT buyers who need unbiased, real-time intelligence on technology vendors across multiple markets.

## Brand & Design System

- **Brand name**: itmap.ai — primary domain and canonical brand as of July 2026 (previously spectio.ai)
- **Tagline**: "See Every Vendor. Know Every Move."
- **Logo**: Custom SVG eye/radar icon + itmap.ai wordmark — `client/src/components/spectio-logo.tsx`
- **Design aesthetic**: Dark premium (inspired by igloo.inc) — deep navy/slate backgrounds, cyan + violet gradient accents
- **Base color**: `bg-slate-950` (#020617)
- **Primary accent**: `text-cyan-400` / `from-cyan-500`
- **Secondary accent**: `text-violet-400` / `to-violet-600`
- **Cards**: `bg-slate-900 border border-white/5` glassmorphism style
- **Gradient buttons**: `bg-gradient-to-r from-cyan-500 to-violet-600`
- **Navigation**: Dark glassmorphism `bg-slate-950/80 backdrop-blur-xl` — auto-detects admin routes and renders a light variant instead
- **Market name display**: DB stores "ITMAP for X" prefix — all display code strips it: `name.replace(/^ITMAP for /i, "")`

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query v5 (object-form only)
- **UI Framework**: Radix UI primitives with shadcn/ui
- **Styling**: Tailwind CSS with CSS variables
- **Animations**: Framer Motion (no `useScroll`/`useTransform` in home.tsx — removed to fix ref warnings)
- **Build Tool**: Vite
- **Data Visualization**: D3.js for Vendor Evaluation charts

### Forecast Builder
New AI-native market forecasting product at `/forecast-builder`. Architecture:
- **DB tables** (9 new): `forecasts`, `forecast_boundaries`, `forecast_briefs`, `forecast_segments`, `forecast_assumptions`, `forecast_cruxes`, `forecast_scenarios`, `forecast_sources`, `forecast_audit_log`
- **Calculation engine**: `server/forecast/engine.ts` — deterministic TypeScript, no LLM arithmetic. Implements MECE validation, year-by-year compound growth, sensitivity tables (±10%/±25%), bull/base/bear scenario paths
- **Audit log**: `server/forecast/audit.ts` — typed `writeAuditEntry()` called on every state change
- **Storage**: `server/storage/forecasts.ts` — full CRUD for all forecast entities
- **Routes**: `server/routes/forecastBuilder.ts` — `/api/forecast-builder/forecasts` (list, create, get, update, delete)
- **Forecast lifecycle**: `draft → boundary_confirmed → brief_complete → debate_complete → calculating → complete`
- **Frontend**: `client/src/pages/forecast-builder/index.tsx` — dark premium list page with stats, status badges, create/delete dialogs

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript
- **Database ORM**: Drizzle ORM
- **Database**: Replit managed PostgreSQL (DATABASE_URL env var) — 27 tables migrated from NeonDB
- **File Uploads**: Google Cloud Storage and Uppy
- **Development**: TSX
- **Cron jobs**: 8 running (news ingestion, weekly backup, health check, user logs cleanup, news cleanup, newsroom health, new players discovery, signal collection)
- **Vendor Signal Pipeline**: Multi-source intelligence collector (`server/signals/`) — HN (Algolia API), Reddit (OpenAI web_search), Layoffs.fyi (web_search), GitHub (public REST API). GPT-4o-mini classifies each signal (sentiment, score, impact). HN/Layoffs HIGH+MEDIUM signals feed into AI suggestion pipeline. Schema: `vendor_signals` table. Storage: `server/storage/signals.ts`. Admin APIs: `GET/POST/DELETE /api/admin/vendor-signals`.

### Key Pages (Public — Dark Premium Design)
- `/` — Home (`client/src/pages/home.tsx`): Hero, stats, live market cards, features, news preview, footer
- `/markets` — Markets (`client/src/pages/markets.tsx`): Pill filter, glassmorphism market cards, live data
- `/platform` — Platform (`client/src/pages/Platform.tsx`): Feature showcase, comparison vs traditional analysts
- `/about` — About (`client/src/pages/About.tsx`): Brand story, mission, team
- `/licensing` — Licensing (`client/src/pages/Licensing.tsx`): IP / reprint licensing info
- `/contact` — Contact (`client/src/pages/Contact.tsx`): Contact form + info cards

### Admin Panel (Light Theme — Untouched)
- `/admin/*` and `/market-builder` — light-themed nav variant auto-applied by `navigation.tsx`

### Data Model
The platform uses a relational data model for Markets, Sub-Markets, Vendors, Criteria (Execution vs. Viability), Vendor Scores, Market Criteria Weights, Vendor News, Features, Research Reports, Historical Positions, and Market Builder Jobs/Stages. The Market Builder feature uses specific tables to support its AI-driven wizard for market creation, ensuring resumability and detailed tracking of job and stage lifecycles.

### Feature Specifications
- **Market Builder**: An AI-powered wizard with LLM provider selection (OpenAI, Anthropic, Perplexity), **9-stage pipeline** (1=Vendor List, 2=Vendor Scoring, 3=Vendor Commentary, 4=Product Feature List, 5=Product Feature Scoring, 6=Product Feature Commentary, 7=Ecosystem List, 8=Ecosystem Scoring, 9=Ecosystem Commentary), per-stage LLM override (`StageLlmPicker`), per-stage source materials, step-by-step approval gates, editable stage results, and post-publish market visibility toggles. DB table `market_builder_job_stage_llm` stores per-stage overrides.
- **End-User Market Builder**: Logged-in non-admin users can run the same wizard at `/me/market-builder` to build their own private markets (`visibility="private"`, owned by the user). Users bring their own LLM API keys (managed at `/me/settings/llm-keys`), author their own private prompts (with system defaults still available read-only), and view their reports at `/me/reports`. Per-user rate limits cap concurrent and daily job creation. Private market PDF/Excel generation is gated to the owner (or admins). Private user-built markets are intentionally hidden from the main admin Markets tab and surfaced in a separate **User Markets** admin tab (component `client/src/components/admin/user-markets-admin.tsx`, endpoint `GET /api/admin/user-markets`) with owner info — admins can see what users build but normally leave it alone.
- **Feature Support Scoring**: Utilizes a Harvey Ball scale (0-4) for vendor feature support, converted to percentages for AI context and handled natively (0-4) by the frontend.
- **Feature-derived criteria (Product Capabilities, ISV Ecosystem)**: the only two Vendor Evaluation criteria not scored by the LLM rubric. `shared/derived-feature-scores.ts` is the single implementation: (1) weighted coverage = Σ(4→1.0, 3→0.75, 2→0.5, 1/0→0) ÷ feature count over the criterion's partition (ecosystem = `isEcosystem` flag or legacy category-name match; product = everything else); (2) piecewise-linear calibration onto the 0–10 rubric through fixed anchors **0%→0, 55%→5, 100%→10** (≈33% ≈ 3 "material deficiency", ≈82% enters the 8–10 leader band), rounded to 1 dp. Both criteria use the same anchors; a market with no features in a partition yields **null** (never a fake 0) — the refresh then **deletes** any existing rows for that criterion in the market (e.g. after the last ecosystem feature is removed) so readers show it as unscored rather than frozen, and Market Builder publish never persists the Stage 2 score-0 placeholders for these two criteria (the end-of-publish derivation creates the rows). The reconciled score plus the raw roll-up are persisted on `vendor_scores` (`score`, `derived_coverage`, `derived_feature_count`); chart, comparison, evaluation tabs (coverage in caption/tooltip), PDF/Excel exports (Excel adds a "… - Feature Coverage" column) and RFP scoring all read the persisted value and never recompute. `server/derivedFeatureScores.ts` refreshes the rows after Market Builder publish, admin "Update … Scores" buttons, Excel import, feature/category/support edits, AI-suggestion and fact-review approvals (post-edit refreshes are best-effort: a failure is logged and never fails the edit — re-run the backfill to repair). Derived scores cannot be set by hand: `checkDerivedScoreWrite` gates every generic writer — `POST /api/vendor-scores` (admin-only; used by the Vendor Management grid, whose derived cells are read-only, and the chart notes editor) and AI-suggestion approvals reject a *changed* score on these two criteria with 400 but accept notes-only saves (score identical to the persisted value); fact-review score approvals on them are rejected outright. Excel import may still write them transiently — the post-import refresh restores the derived value. A writer that changes the score without providing coverage clears the audit columns until the next refresh; the market-clone endpoint copies them across. **Backfill (idempotent):** dev → `npm run derive:backfill` (`-- --dry-run`, `-- --market <id>`); production → `POST /api/admin/derived-scores/rederive` with an admin session (`{ "dryRun": true }` to preview) once the new build is published (the two columns are created additively by `runStartupMigrations` on boot, so no manual DDL is needed). Tests: `npm run test:derived-scores` (shared maths + stubbed-storage persistence/transition tests). **Distribution check (read-only):** `npm run derive:check` (`-- --all` for hidden markets) or `GET /api/admin/derived-scores/distribution` — per-market min/avg/max of all eight criteria. Changing an anchor requires re-running the backfill.
- **Authentication and Authorization**: Passwordless email sign-in (any email; a fixed number of unverified sessions before the emailed link must be clicked — see `shared/verification.ts`) plus an optional **"Continue with Google"** button on the sign-up pop-ups, `/register`, `/login` and the verification block screen (`server/routes/googleAuth.ts`, `client/src/components/google-sign-in-button.tsx`). Google sign-ins are verified by definition: new accounts are created `emailVerified=true`, and an existing account with the same email is linked (`users.google_id`) and marked verified. Admin accounts cannot use Google. The OAuth callback URL is built from the request host, so **each host must be an authorised redirect URI on the Google OAuth client**: `https://itmap.ai/auth/google/callback`, `https://itmap.replit.app/auth/google/callback` and, for the dev workspace, `https://<REPLIT_DEV_DOMAIN>/auth/google/callback`. **Sign-up is a single flow** — there is no buyer/vendor choice at registration; `/auth/register` and `/auth/google` ignore any client-supplied `persona` and create regular (`buyer`) accounts. Vendor seats are provisioned by admins via vendor scoping. Legal pages live at `/privacy-policy` and `/termsofservice` (old `/privacy`, `/terms` redirect). Role-based access control for administrators and end-users.
- **Company-email profile gate** (`shared/company-email.ts`): buyers whose login email is on a consumer domain (Gmail, Yahoo, Outlook, … — typed or via Google) see **Research Reports, News and the Intelligence Feed** locked until they complete the Company profile card on `/me/profile` (company name, company email, designation) and click the link emailed to the company address (`GET /auth/verify-company-email` → `/me/profile?company=verified|invalid|taken`). Enforced server-side inside `requireFeature` (403 `company_email_required`) and mirrored in the UI via `useAuth().isCompanyProfileLocked()`; the login email never changes, admins/vendor seats/business-domain accounts are never gated. Routes: `GET/PUT /api/me/company-profile`, `POST /api/me/company-profile/resend` (60 s cooldown). A company email can only be *verified* on one account.
- **API Design**: RESTful principles with Zod schema validation, standardized error handling, and consistent JSON formats.
- **AI Market Suggestions**: Automatically reviews news for high/medium impact articles and proposes score/commentary changes for admin review, with before/after comparisons.
- **External Partner API**: A public REST API for third-party integrations, authenticating via Bearer token or `X-Api-Key` header, supporting market listing, AI chat, and session history.
- **File Upload Strategy**: Supports document uploads for research reports using Google Cloud Storage with Uppy.js, with AWS S3 as an alternative.
- **Vendor Evaluation**: Interactive visualizations replacing "Magic Quadrant" terminology, integrating support matrix scores.
- **Absolute quadrant positioning** (`shared/quadrant-positioning.ts` is the single engine; chart, snapshot cron, exports and AI-chat context all import it): a vendor's dot depends only on its **own** criterion scores, the market's **published criteria weights** and the market's **three thresholds** — never on the rest of the roster (adding/removing a vendor moves nobody). Per axis: composite (0–10) = Σ score × relative weight share over the criteria the vendor actually has a score for (unscored criteria are "not evaluated", not 0); the composite is then mapped piecewise-linearly onto the 0–100 canvas so the market's thresholds land exactly on the fixed dividers (X: 33 / 67, Y: 50), and the box (Custodians / Contenders / Leaders on top, Emerging Players / Specialists / Catalysts below) is decided by comparing the raw composites with the same thresholds, so box and pixel side always agree. Thresholds live on `markets` (`execution_threshold_low/high`, `viability_threshold`; defaults **4.5 / 5.5 / 5.0**, strictly 0 < low < high < 10) and are edited per market in Admin → Markets → Edit (Quadrant Thresholds card, next to the criteria-weight sliders); the buyer-facing Criteria Weights sliders are a what-if view only and never change the published chart. Every effective change to weights or thresholds writes an immutable row to `market_weight_versions` (v1, v2, …, with who/when/note — admin-only history under the same dialog and `GET /api/admin/markets/:id/weight-versions`); The admin edit dialog previews the box counts and composite ranges the draft weights/thresholds would produce (client-side run of the shared engine over `/chart-provenance` scores), so thresholds are tuned per market with evidence rather than guessed. All writes go through `server/quadrantConfig.ts` (admin-only; end-user Market Builder markets get their defaults server-side on publish): `PUT /api/markets/:id/chart-config` for config alone, and `POST`/`PUT /api/markets[/:id]` accept an optional `chartConfig: { weights, thresholds, note }` so the admin dialog saves market fields + config + version in **one transaction** (a rejected threshold rejects the whole save; a new market is never unversioned). The generic market payload cannot set threshold columns directly (`insertMarketSchema` omits them). Every write runs under a per-market row lock, normalises thresholds to the stored 2-dp precision, and is a no-op when nothing changed; a market-type switch without explicit weights resets saved weights to the new type's defaults (versioned). Market Builder publish/republish uses the same atomic helpers and resets weights to the marketType defaults (recorded as a new version). Read paths: `GET /api/markets/:id/chart-config` (public config) and `GET /api/markets/:id/chart-provenance` (config + every vendor's composites / canvas x,y / box). **Exports carry the provenance**: the Excel export appends "Chart Configuration" and "Quadrant Positions" sheets (full precision; the importer ignores them), the server PDFs add a "Chart Configuration" block, and the client PDF prints weights/thresholds/version plus per-vendor composites, so any dot can be rebuilt from the file alone (`npm run test:quadrant` proves the round-trip). Historical slider positions re-plot stored composites through the current thresholds; stored history rows outside 0–10 (retired synthetic generator) are filtered server-side, and vendors without a plausible snapshot fall back to their current dot. Dragged label positions are absolute pixels: rows saved before the 2026-09-20 cutover are ignored (auto-placed) until re-dragged, and a saved label more than 90 px from its dot falls back to auto-placement. **Production rollout**: nothing manual — `runStartupMigrations` adds the columns/table additively on boot and `seedInitialWeightVersions()` then records v1 for every market without one (idempotent). To run the seed by hand: dev `npm run weights:seed-versions` (`-- --dry-run`, `-- --market <id>`); production `POST /api/admin/weight-versions/seed` with an admin session (`{ "dryRun": true }` to preview).
- **Historical Timeline**: Functional timeline for Vendor Evaluation with 3 years of weekly data.
- **Automated News Processing**: Daily pipeline using OpenAI for combined scrape and analysis of vendor news, classifying impact, and providing key takeaways. Includes a newsroom URL health check and email alerts for unreachable URLs.
- **AI Chat Agent**: Conversational AI assistant (GPT-4.1 mini) accessible from market detail pages, answering complex market intelligence questions using database context with custom RAG, persistent conversations, markdown formatting, and source citations.
- **Mobile Responsiveness**: UI adapts to different screen sizes.
- **Domain Management**: Enforces a custom primary domain with 301 redirects and smart OAuth handling.
- **Ecosystem Support**: Dedicated section for third-party integrations.
- **Vendor Scoring**: Admin portal separates X-axis (Execution) and Y-axis (Viability) criteria tables.
- **Import/Export**: Admin-only feature for Excel data import/export (Vendor Evaluation, Product Evaluation, ISV Ecosystem).
- **PDF Report Generation**: Professional PDF reports with vendor filtering, detailed commentary, and support level badges, rendered using Puppeteer with system Chromium.
- **New Players Discovery Agent**: Admin-only AI agent (`server/agents/new-players-discovery.ts`) that scans a market's definition with GPT-4.1-mini to surface emerging vendors. Triggered manually and by monthly cron job.

## Environment Variables / Secrets

- `DATABASE_URL` — Replit managed PostgreSQL (auto-set)
- `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit OpenAI integration (active)
- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` — LinkedIn OAuth (present)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth ("Continue with Google"; if unset the button redirects to `/login?oauth=unavailable`). Authorised redirect URIs: `https://itmap.ai/auth/google/callback` + `https://<REPLIT_DEV_DOMAIN>/auth/google/callback`
- `SESSION_SECRET` — Session signing
- Optional (features degrade gracefully): `PERPLEXITY_API_KEY`, `LLM_KEY_ENCRYPTION_SECRET`, `TINYMCE_API_KEY`, SMTP vars

## External Dependencies

### Database Services
- **Replit PostgreSQL**: Managed serverless PostgreSQL (migrated from NeonDB).
- **Drizzle ORM**: Type-safe database operations.

### Cloud Storage
- **Google Cloud Storage**: Primary storage for assets.
- **AWS S3**: Alternative storage option via Uppy integration.

### UI and Visualization Libraries
- **Radix UI**: Accessibility-focused primitive components.
- **D3.js**: Data visualization library.
- **Lucide React**: Icon library.
- **Framer Motion**: Animation library.

### Development and Build Tools
- **Vite**: Build tool.
- **TanStack Query**: Server state management and caching.
- **React Hook Form**: Form handling.
- **Tailwind CSS**: Utility-first CSS framework.
- **Wouter**: Lightweight routing library.

### File Upload Infrastructure
- **Uppy**: File upload library.

### Validation and Type Safety
- **Zod**: Runtime type validation.
- **TypeScript**: Static type checking.
- **Drizzle Zod**: Integration for database schema validation.

### AI/ML Integration
- **OpenAI API via Replit AI Integrations**: Powers news impact analysis and conversational AI chat (GPT-4.1 mini) using Replit credits.

### Data Management
- **xlsx Library**: Used for Excel file generation and parsing.

### PDF Generation
- **Puppeteer**: Headless browser automation for rendering HTML to PDF.
- **Chromium**: System browser used by Puppeteer.
