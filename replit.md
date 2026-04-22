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
The platform utilizes a relational data model encompassing Markets, Sub-Markets, Vendors, Criteria (Execution vs. Viability), Vendor Scores, Market Criteria Weights, Vendor News, Features, Research Reports, and Historical Positions.

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

### File Upload Strategy
Supports document uploads for research reports using Google Cloud Storage as primary storage, with Uppy.js for the frontend interface. AWS S3 is available as an alternative.

### Core Features and Design Decisions
- **Vendor Evaluation**: Replaced "Magic Quadrant" terminology, offers interactive visualizations, and integrates support matrix scores.
- **Historical Timeline**: Implements a functional historical timeline for Vendor Evaluation, allowing navigation through 3 years of weekly data.
- **Automated News Processing**: Features a single combined daily pipeline at 7 AM UTC: (1) GPT-4o scrapes each vendor's configured newsroomUrl for articles published in the last 48 hours, then immediately (2) deep AI analysis produces editorial opinions, competitive context, category classification, and one-sentence key takeaways per article. Each vendor has a configurable `newsroomUrl` field. Articles are deduplicated by URL and content hash. Admin panel includes a "Run Pipeline" button to trigger scrape+analyze on demand for all vendors or a selected vendor. Implements 90-day retention with weekly cleanup (Sunday 4 AM UTC). News module: `server/news/ingestion/browser.ts` (fetch/render), `server/news/ingestion/scraper.ts` (GPT-4o extraction), `server/news/impact/analyzer.ts` (deep analysis). The legacy `news_sources` table still exists in DB for backward compatibility but is no longer managed by the application.
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