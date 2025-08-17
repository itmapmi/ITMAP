# MarketScope - Enterprise Market Research Platform

## Overview

MarketScope is a comprehensive enterprise market research platform that provides technology vendor analysis through interactive Vendor Evaluation visualizations, competitive intelligence, and detailed market insights. The platform allows users to explore technology markets, compare vendors across multiple criteria, track vendor news and its impact on market positioning, and access detailed research reports.

The application follows a full-stack architecture with a React frontend and Express.js backend, designed to handle complex data visualizations and analytical workflows for enterprise users researching technology markets and vendors.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript for type safety and modern development practices
- **Routing**: Wouter for lightweight client-side routing without the overhead of React Router
- **State Management**: TanStack Query (React Query) for server state management, caching, and data synchronization
- **UI Framework**: Radix UI primitives with shadcn/ui components for accessible, customizable interface elements
- **Styling**: Tailwind CSS with CSS variables for theming and responsive design
- **Build Tool**: Vite for fast development builds and hot module replacement
- **Data Visualization**: D3.js for complex Vendor Evaluation charts and interactive vendor positioning visualizations

### Backend Architecture
- **Runtime**: Node.js with Express.js framework for RESTful API development
- **Language**: TypeScript throughout the stack for consistent type safety
- **Database ORM**: Drizzle ORM for type-safe database operations and schema management
- **Database**: PostgreSQL via Neon serverless for scalable data storage
- **File Uploads**: Integration with Google Cloud Storage and Uppy for file handling
- **Development**: TSX for TypeScript execution in development mode

### Data Model Design
The application uses a relational data model with the following core entities:
- **Markets**: Technology market categories (e.g., CRM, ERP, Cloud Storage)
- **Sub-Markets**: Specialized segments within broader markets
- **Vendors**: Companies operating within specific markets
- **Criteria**: Evaluation dimensions for vendor assessment (execution vs viability categories)
- **Vendor Scores**: Quantitative ratings for vendors across different criteria
- **Market Criteria Weights**: Configurable importance weights for criteria within markets
- **Vendor News**: Automated news analysis affecting vendor positioning
- **Features**: Product capabilities for support matrix comparisons
- **Research Reports**: Downloadable market analysis documents
- **Historical Positions**: Time-series data for tracking vendor movement over time

### Authentication and Authorization
Currently designed for internal enterprise use with basic user management schema in place. The authentication system is structured to support role-based access control for administrators managing market data versus end-users consuming research.

### API Design Patterns
- RESTful endpoints following resource-based URL patterns
- Standardized error handling with proper HTTP status codes
- Request/response logging middleware for debugging and monitoring
- Validation using Zod schemas shared between frontend and backend
- Consistent JSON response formats across all endpoints

### File Upload Strategy
The platform supports document uploads for research reports using:
- Google Cloud Storage as the primary storage backend
- Uppy.js for frontend upload interface with progress tracking
- Multiple upload methods including drag-drop and file selection
- Support for AWS S3 as an alternative storage option

## External Dependencies

### Database Services
- **Neon Database**: Serverless PostgreSQL database for production deployment
- **Drizzle ORM**: Type-safe database operations and migrations

### Cloud Storage
- **Google Cloud Storage**: Primary file storage for research reports and assets
- **AWS S3**: Alternative storage backend via Uppy integration

### UI and Visualization Libraries
- **Radix UI**: Accessibility-focused primitive components for complex UI patterns
- **D3.js**: Data visualization library for Magic Quadrant charts and interactive elements
- **Lucide React**: Icon library for consistent iconography

### Development and Build Tools
- **Vite**: Build tool with TypeScript support and fast HMR
- **TanStack Query**: Server state management and caching
- **React Hook Form**: Form handling with validation
- **Tailwind CSS**: Utility-first CSS framework
- **Wouter**: Lightweight routing library

### File Upload Infrastructure
- **Uppy**: File upload library with multiple backend support
- **Google Cloud Storage SDK**: Direct integration for file operations

### Validation and Type Safety
- **Zod**: Runtime type validation for API requests and responses
- **TypeScript**: Static type checking across the entire application
- **Drizzle Zod**: Integration between database schema and validation

The platform is designed to scale horizontally with its serverless database architecture while maintaining real-time data synchronization through optimistic updates and background refetching strategies.

## Recent Changes

### Ecosystem Support Separation (August 17, 2025)
- **Separated Ecosystem Support**: Created dedicated "Ecosystem Support" tab between Support Matrix and Research Reports
- **Product Capabilities Focus**: Support Matrix now excludes ecosystem-related features from product capabilities scoring
- **New Component**: Created ecosystem-support.tsx component dedicated to third-party integrations and partnerships
- **Filtered Scoring**: Product capabilities scoring only includes non-ecosystem features (excluding integration, partnership, third-party categories)
- **UI Updates**: Changed Support Matrix title to "Product Capabilities Support Matrix" with updated descriptions
- **Tab Structure**: Updated market details page to include 5 tabs: Vendor Evaluation, Vendor News, Support Matrix, Ecosystem Support, Research Reports

### Support Matrix - Vendor Evaluation Integration (August 16, 2025)
- **Automatic Score Integration**: Support matrix normalized scores (out of 10) now directly feed into vendor evaluation Product Capabilities criteria
- **Real-time Updates**: Added "Update Vendor Evaluation" button in support matrix for instant score synchronization
- **Harvey Ball Scoring System**: Implemented consistent scoring (Full=1.0, Good=0.75, Partial=0.5, Limited/None=0) across both systems
- **API Endpoint**: Created `/api/admin/update-product-capabilities-scores` endpoint for automated score updates
- **Toast Notifications**: Added user feedback for successful score updates with vendor count confirmation
- **Query Invalidation**: Automatic refresh of vendor evaluation charts after score updates for real-time visualization

### Terminology Update (August 15, 2025)
- **Replaced "Magic Quadrant" with "Vendor Evaluation"** throughout the application
- **Updated navigation tabs** to reflect new terminology for better clarity
- **Revised platform descriptions** to use consistent "Vendor Evaluation" language
- **Updated documentation** to reflect the new terminology across all content

### ITmap Rebranding Implementation (August 15, 2025)
- **Complete homepage redesign** with new ITmap branding and logo integration
- **Updated navigation component** to display ITmap logo instead of text-based branding
- **Redesigned landing page** featuring "Unbiased. Comprehensive." tagline and professional layout
- **Enhanced value proposition sections** with gradient backgrounds and improved visual hierarchy
- **Updated Login and Register pages** with consistent ITmap branding and tagline placement
- **Implemented gradient CTA buttons** matching the teal-to-purple brand color scheme
- **Added comprehensive feature showcase** highlighting Magic Quadrant analysis, market intelligence, and research capabilities

### Authentication System Fixes (August 15, 2025)
- **Resolved infinite 401 request loop** by configuring proper error handling in useAuth hook
- **Fixed undefined variable references** that were causing application crashes
- **Implemented graceful authentication state management** with proper fallback for unauthenticated users
- **Updated query configuration** to handle 401 errors without infinite retries
- **Admin Portal Access Setup**: Created admin user (admin@itmap.com / admin123) with role-based access control
- **Database Schema Migration**: Updated users table with proper role field and complete user profile structure

### Vendor Scoring Table Restructure (August 14, 2025)
- **Split vendor scoring tables into separate X-axis and Y-axis criteria tables** in the admin portal
- **Created dedicated X-axis (Execution) criteria table** with blue color theme for better visual distinction
- **Created dedicated Y-axis (Viability) criteria table** with green color theme for clear categorization
- **Maintained all existing scoring functionality** including individual save buttons and bulk save operations
- **Improved scoring workflow organization** by separating criteria categories for easier vendor evaluation
- **Enhanced visual hierarchy** with color-coded headers and clear section separation
- **Preserved vendor management actions** (edit/delete) in both tables for consistent user experience

### Historical Timeline Implementation (August 12, 2025)
- **Implemented functional Vendor Evaluation historical timeline** with real dates instead of "36 months ago"
- **Added 156-week timeline range** (3 years of weekly historical data navigation)
- **Created historical positions API endpoint** (`/api/markets/:marketId/historical-positions`) with date filtering
- **Built historical data visualization** that switches between current scores and historical positions
- **Added sample data generation** endpoint for testing timeline functionality with vendor position variations
- **Positioned current date on right side** of timeline slider with weekly backward navigation
- **Dynamic date display** showing selected date and weeks ago counter
- **Integrated historical position storage** with existing database schema and storage methods

### Vendor-Only News Sources Implementation (August 12, 2025)
- **Achieved 100% vendor-authentic news sources** by completely removing all third-party content
- **Eliminated NewsAPI fallback system** and all external news aggregator dependencies
- **Implemented strict vendor-domain validation** ensuring news originates only from official vendor websites
- **Cleaned database of 63 third-party news items** keeping only official vendor sources
- **Added cleanup endpoint** (`/api/admin/vendor-news/cleanup-third-party`) for removing non-vendor sources
- **Updated news processing** to skip third-party sources entirely with zero tolerance policy

### Automated News Processing System (August 11, 2025)
- **Implemented comprehensive automated daily cron jobs** for vendor news analysis and scoring updates
- **Created newsProcessor.ts** with OpenAI integration for intelligent news impact analysis (0-5 scoring scale)
- **Added cronJobs.ts** with scheduled tasks: daily news processing (6 AM UTC), weekly position backups (Sunday 2 AM UTC), hourly health checks
- **Integrated News API and OpenAI API** for automated news fetching and AI-powered impact analysis
- **Built admin news management interface** with real-time cron job status monitoring, manual trigger controls, and news approval workflow
- **Added automated vendor score updates** based on news impact analysis with admin approval requirements
- **Implemented graceful error handling** with fallback to keyword-based analysis when AI services are rate-limited
- **Created historical position tracking** for vendor movement analysis over time

### Technical Implementation Details  
- **VENDOR-ONLY NEWS SOURCES**: 100% strict vendor-domain validation with zero tolerance for third-party sources
- **Direct vendor RSS feed parsing** for authentic press releases from official vendor newsrooms
- **Vendor HTML scraping** when RSS feeds are unavailable, targeting official vendor websites ONLY
- **NO third-party sources**: Completely removed NewsAPI and all external news aggregator fallbacks
- **Strict domain validation**: News must originate from vendor's official website domain
- **Vendor-specific RSS patterns** including /rss.xml, /newsroom/feed, /press-releases/rss
- **30-day content filtering** to focus on recent announcements and press releases
- **Blog content filtering** - Excludes /blog/, /blogs/, /insights/, /thought-leadership/ URLs to focus only on press releases
- **Database cleanup completed**: Removed 63 third-party news items, keeping only official vendor sources
- **Refined impact scoring rules**:
  - Product/Feature launches: Impact score 2, 3, or 4 based on significance
  - Partnerships & Sales wins: Impact score 2
  - Positive financial news: Impact score 3
  - Major acquisitions: Impact score 4
  - Blog posts: Excluded from analysis (impact score 0)
- OpenAI GPT-4o-mini analyzes news articles for business impact on evaluation criteria
- Automated score changes (±2 point range) require admin approval before applying to vendor ratings
- System includes backup mechanisms for API failures and comprehensive logging
- Cron jobs can be individually controlled (start/stop) through admin interface
- News processing includes duplicate detection and content validation
- **Admin cleanup endpoint**: `/api/admin/vendor-news/cleanup-third-party` to remove non-vendor sources