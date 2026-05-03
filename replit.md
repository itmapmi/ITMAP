# ITMAP - Enterprise Market Research Platform

## Overview

ITMAP is a comprehensive enterprise market research platform for technology vendor analysis. It provides interactive Vendor Evaluation visualizations, competitive intelligence, and detailed market insights. Users can explore technology markets, compare vendors, track news, and access research reports. The platform's business vision is to deliver unbiased, comprehensive market intelligence, serving as a critical tool for understanding and navigating technology markets.

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
The platform uses a relational data model for Markets, Sub-Markets, Vendors, Criteria (Execution vs. Viability), Vendor Scores, Market Criteria Weights, Vendor News, Features, Research Reports, Historical Positions, and Market Builder Jobs/Stages. The Market Builder feature uses specific tables to support its AI-driven wizard for market creation, ensuring resumability and detailed tracking of job and stage lifecycles.

### Feature Specifications
- **Market Builder**: An AI-powered wizard with LLM provider selection (OpenAI, Anthropic, Perplexity), per-stage source materials, step-by-step approval gates, editable stage results, and post-publish market visibility toggles.
- **End-User Market Builder**: Logged-in non-admin users can run the same wizard at `/me/market-builder` to build their own private markets (`visibility="private"`, owned by the user). Users bring their own LLM API keys (managed at `/me/settings/llm-keys`), author their own private prompts (with system defaults still available read-only), and view their reports at `/me/reports`. Per-user rate limits cap concurrent and daily job creation. Private market PDF/Excel generation is gated to the owner (or admins).
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
- **Domain Management**: Enforces a custom primary domain (itemap.ai) with 301 redirects and smart OAuth handling.
- **Ecosystem Support**: Dedicated section for third-party integrations.
- **Vendor Scoring**: Admin portal separates X-axis (Execution) and Y-axis (Viability) criteria tables.
- **Import/Export**: Admin-only feature for Excel data import/export (Vendor Evaluation, Product Evaluation, ISV Ecosystem).
- **PDF Report Generation**: Professional PDF reports with vendor filtering, detailed commentary, and support level badges, rendered using Puppeteer with system Chromium.

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