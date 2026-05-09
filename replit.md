# spectio.ai — Enterprise IT Vendor Intelligence Platform

## Overview

spectio.ai (formerly ITMAP) is a premium enterprise IT vendor selection platform delivering independent, AI-powered intelligence — vendor rankings, feature evaluations, news impact analysis, and research reports. The company tagline is "See Every Vendor. Know Every Move." The platform serves enterprise IT buyers who need unbiased, real-time intelligence on technology vendors across multiple markets.

## Brand & Design System

- **Brand name**: spectio.ai (Latin: "observation")
- **Tagline**: "See Every Vendor. Know Every Move."
- **Logo**: Custom SVG eye/radar icon + spectio.ai wordmark — `client/src/components/spectio-logo.tsx`
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
- **Authentication and Authorization**: Basic user management with role-based access control for administrators and end-users.
- **API Design**: RESTful principles with Zod schema validation, standardized error handling, and consistent JSON formats.
- **AI Market Suggestions**: Automatically reviews news for high/medium impact articles and proposes score/commentary changes for admin review, with before/after comparisons.
- **External Partner API**: A public REST API for third-party integrations, authenticating via Bearer token or `X-Api-Key` header, supporting market listing, AI chat, and session history.
- **File Upload Strategy**: Supports document uploads for research reports using Google Cloud Storage with Uppy.js, with AWS S3 as an alternative.
- **Vendor Evaluation**: Interactive visualizations replacing "Magic Quadrant" terminology, integrating support matrix scores.
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
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth
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
