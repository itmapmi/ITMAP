# MarketScope - Enterprise Market Research Platform

## Overview

MarketScope is a comprehensive enterprise market research platform that provides technology vendor analysis through interactive Magic Quadrant visualizations, competitive intelligence, and detailed market insights. The platform allows users to explore technology markets, compare vendors across multiple criteria, track vendor news and its impact on market positioning, and access detailed research reports.

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
- **Data Visualization**: D3.js for complex Magic Quadrant charts and interactive vendor positioning visualizations

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