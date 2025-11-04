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
- **Automated News Processing**: Features daily cron jobs for vendor news analysis with AI-powered impact scoring using ChatGPT (GPT-4.1 mini). News sources are strictly vendor-authentic, with no third-party content. Includes automated vendor score updates, position backups, and health checks. AI classifier analyzes article content and assigns impact levels (HIGH/MEDIUM/LOW) with confidence scores and detailed reasoning. Implements 90-day retention policy with weekly cleanup (Sunday 4:00 AM UTC) to maintain optimal database performance while preserving recent historical data.
- **AI Chat Agent**: Conversational AI assistant accessible from each market's detail page that answers complex market intelligence questions using GPT-4.1 mini (1M token context) and database context. Supports 12 question patterns including vendor comparisons, quadrant positioning, feature support, ecosystem integrations, news analysis, and methodology explanations. Conversations are persisted per user and market for follow-up questions. AI responses include markdown formatting, actual scores/quotes from database commentary, and source citations. Built with custom RAG approach (no Langchain) for better control. Includes comprehensive error logging and diagnostics for troubleshooting production issues.
- **Automated Research Agent**: AI-powered research automation system that generates vendor evaluation data with minimal manual input. Uses GPT-4o Deep Research for feature category/feature generation, OpenAI Deep Research API (o4-mini-deep-research-2025-06-26 or o3-deep-research-2025-06-26) with web search for web-research-backed commentary on each criterion, and GPT-4o for numerical scoring (0-10). Deep Research API provides autonomous multi-step web research with the web_search_preview tool and code interpreter for data analysis. Supports per-criterion prompt customization allowing different AI prompts for each of the 8 evaluation criteria (ISV Ecosystem, Innovation, Pricing Strategy, Product Capabilities, Business Model, Customer Experience, Partner Ecosystem, Revenue). Prompt templates can optionally link to specific criteria via criteriaId field. Jobs store criterion-prompt mappings in criteriaPrompts JSONB field. Features customizable prompt templates with variable substitution, real-time progress tracking, detailed execution logs, and comprehensive cost tracking (tokens used + web search count + estimated USD cost). Admin interface provides job triggering, status monitoring, template management, and per-criterion prompt selection. Jobs execute asynchronously with automatic database updates to vendor_scores table. Includes retry logic and error handling for production reliability.
- **Product Evaluation Agent**: Automated product feature evaluation system redesigned as **3 independent, standalone job types** that can be run separately with full AI model flexibility. Each job type supports 6 AI model options: Perplexity Sonar Pro, ChatGPT Deep Research, ChatGPT 4.0 Mini, GPT 4.1 Mini, o4-mini Deep Research (o4-mini-deep-research-2025-06-26), and o3 Deep Research (o3-deep-research-2025-06-26). **Job Type 1: Category Generation** (`/api/product-eval/jobs/categories`) - Creates feature categories and features for a market using AI with no vendor selection required; fully supports manual category/feature creation as alternative; supports optional custom prompt for ad-hoc category generation instructions. **Job Type 2: Feature Analysis** (`/api/product-eval/jobs/analysis`) - Generates detailed analysis/commentary for each vendor-feature combination explaining implementation status, capabilities, and limitations; requires feature categories to exist (AI-generated or manually created); supports optional feature-level custom prompts stored in JSONB mapping. **Job Type 3: Feature Scoring** (`/api/product-eval/jobs/scoring`) - Assigns Harvey Ball scores 0-4 (0=Not Supported, 1=Limited/25%, 2=Partial/50%, 3=Good/75%, 4=Full/100%) based on existing commentary; requires analysis to be completed first; supports optional feature-level custom prompts for targeted scoring instructions. Features idempotent create-or-update logic that safely handles existing data by updating rather than duplicating. **Custom Prompts**: Supports per-job custom prompts with variable substitution ({market_name}, {vendor_name}, {feature_name}, {feature_description}, {commentary}); category generation uses free-text customPrompt field; feature analysis and scoring use featurePrompts JSONB field mapping featureId to custom prompt text; custom prompts take precedence over default templates; all prompts are optional with automatic fallback to templates. Each job type independently tracks progress with real-time updates, detailed execution logs, token usage, and cost estimates. Admin UI at /admin/product-evaluation provides 3-panel accordion interface with independent AI model selectors per job type, vendor selection (for analysis/scoring), optional custom prompt fields for category generation, collapsible per-feature prompt editors for analysis/scoring showing selected or all features, and dependency validation warnings. Fully supports mixed workflows: manually create categories then AI-generate analysis, or AI-generate categories then manually add features. Database schema uses `jobType` enum (category_generation, analysis, scoring), `aiModel` column, `customPrompt` text field, and `featurePrompts` JSONB field to differentiate job execution paths and store custom instructions. Designed for maximum flexibility allowing users to choose AI automation level and prompt customization per evaluation phase.
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
- **OpenAI API via Replit AI Integrations**: Powers intelligent news impact analysis, conversational AI chat, and automated research using multiple GPT models. Uses GPT-4o for feature generation/scoring, GPT-4.1 mini for chat with 1M token context window, and OpenAI Deep Research API (o4-mini-deep-research-2025-06-26 or o3-deep-research-2025-06-26) for autonomous multi-step web research with web_search_preview tool and code interpreter. News analyzer classifies business impact (HIGH: 80-100, MEDIUM: 50-79, LOW: 10-49) with confidence scores and detailed reasoning. Chat agent answers complex market intelligence questions with full database context. Research agent automates vendor evaluation data generation with feature creation, web-research-backed commentary, and scoring. Deep Research API pricing: $2/1M input tokens, $8/1M output tokens, $10/1K web searches. Includes fallback to rule-based scoring on errors. Charges are billed to Replit credits, no external API key required.

### Data Management
- **xlsx Library**: Used for Excel file generation and parsing in the Import/Export feature.

### PDF Generation
- **Puppeteer**: Headless browser automation for rendering HTML to PDF.
- **Chromium**: System browser used by Puppeteer for PDF generation.