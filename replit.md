# MarketScope - Enterprise Market Research Platform

## Overview

MarketScope is a comprehensive enterprise market research platform designed for technology vendor analysis. It offers interactive Vendor Evaluation visualizations, competitive intelligence, and detailed market insights. The platform enables users to explore technology markets, compare vendors, track vendor news, and access research reports. It supports a full-stack architecture with a React frontend and Express.js backend, built for complex data visualizations and analytical workflows for enterprise users. The business vision is to provide unbiased and comprehensive market intelligence, positioning the platform as a crucial tool for understanding and navigating technology markets.

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

### Authentication and Authorization
Designed for internal enterprise use, featuring basic user management and role-based access control for administrators and end-users.

### API Design
Follows RESTful principles with standardized error handling, request/response logging, Zod schema validation, and consistent JSON response formats.

### File Upload Strategy
Supports document uploads for research reports using Google Cloud Storage as primary storage, with Uppy.js for the frontend interface. AWS S3 is available as an alternative.

### Core Features and Design Decisions
- **Vendor Evaluation**: Replaced "Magic Quadrant" terminology, offers interactive visualizations, and integrates support matrix scores.
- **Historical Timeline**: Implements a functional historical timeline for Vendor Evaluation, allowing navigation through 3 years of weekly data.
- **Automated News Processing**: Features daily cron jobs for vendor news analysis using OpenAI for impact scoring (0-5 scale), with admin approval for score updates. News sources are strictly vendor-authentic, with no third-party content. Includes automated vendor score updates, position backups, and health checks.
- **Mobile Responsiveness**: UI adapts to different screen sizes, optimizing charts, typography, navigation, and spacing for mobile devices.
- **Domain Management**: Enforces a custom primary domain (itmap.ai) via BASE_URL environment variable with 301 redirects from the Replit domain, smart OAuth callback handling, and automatic fallback to REPLIT_DOMAINS detection.
- **Ecosystem Support**: Dedicated section for third-party integrations, separating ecosystem-related features from core product capabilities in the support matrix.
- **Vendor Scoring**: Admin portal separates X-axis (Execution) and Y-axis (Viability) criteria tables for improved organization.

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
- **OpenAI API**: Used for intelligent news impact analysis in automated news processing.