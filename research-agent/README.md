# Research Agent

AI-powered vendor market research automation platform for comprehensive vendor evaluation, product analysis, and ecosystem assessment.

## Features

### Phase 1: Vendor Evaluation
- Evaluate vendors against 8 standard criteria:
  - Product Capabilities
  - ISV Ecosystem
  - Innovation
  - Pricing Strategy
  - Partner Strategy
  - Revenue
  - Business Model
  - Customer Experience
- Custom prompts per criterion
- Multiple LLM support (OpenAI GPT-4.1 mini, Perplexity Sonar Deep Research)
- 200-word commentary generation with source citations
- Web research integration

### Phase 2: Vendor Scoring
- Automatic 0-10 scoring based on Phase 1 commentary
- Detailed reasoning for each score
- Comparative analysis across vendors
- Visual score heatmap

### Future Extensions
- Product Evaluation: Detailed feature-by-feature analysis
- Ecosystem Evaluation: ISV partnership and integration assessment
- Custom criteria: User-defined evaluation dimensions

## Technology Stack

**Backend:**
- Node.js + Express + TypeScript
- Drizzle ORM + PostgreSQL
- Passport.js authentication
- OpenAI & Perplexity LLM APIs

**Frontend:**
- React 18 + TypeScript
- Wouter routing
- TanStack Query
- Radix UI + Tailwind CSS

## Setup Instructions

### 1. Database Setup

Create a PostgreSQL database (use Replit's built-in Postgres or external provider).

Set the `DATABASE_URL` environment variable:
```
DATABASE_URL=postgresql://user:password@host:port/database
```

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL=your_postgresql_connection_string
SESSION_SECRET=your_session_secret
AI_INTEGRATIONS_OPENAI_BASE_URL=your_openai_base_url
AI_INTEGRATIONS_OPENAI_API_KEY=your_openai_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key # optional
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Database Migration

Push the schema to your database:

```bash
npm run db:push
```

### 5. Seed Default Criteria

```bash
tsx server/seed.ts
```

This creates the 8 standard evaluation criteria.

### 6. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:5001`

## Usage Workflow

1. **Register/Login**: Create an account or sign in
2. **Create Project**: Define market name and add vendors with websites
3. **Configure Criteria**: Review the 8 standard criteria (customizable in Phase 1)
4. **Phase 1 - Execute**: Run vendor evaluation to generate commentary
5. **Review Commentary**: View 200-word analysis for each vendor-criterion pair
6. **Phase 2 - Score**: Generate 0-10 scores from commentary
7. **Analyze Results**: Review comparative scores and detailed reasoning

## Architecture

### Backend Structure
```
server/
├── api/routes.ts          # API endpoints
├── auth/setup.ts          # Authentication config
├── llm/provider-registry.ts  # LLM provider abstraction
├── research/
│   ├── phase1-engine.ts   # Commentary generation
│   ├── phase2-engine.ts   # Scoring engine
│   └── web-research.ts    # Web research module
├── storage.ts             # Database operations
└── index.ts               # Server entry point
```

### Frontend Structure
```
client/src/
├── pages/
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   ├── DashboardPage.tsx
│   ├── ProjectSetupPage.tsx
│   ├── Phase1DashboardPage.tsx
│   └── Phase2ReviewPage.tsx
├── components/ui/         # Reusable UI components
└── lib/
    ├── queryClient.ts     # TanStack Query setup
    └── utils.ts           # Utilities
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/user` - Get current user

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project details
- `DELETE /api/projects/:id` - Delete project

### Vendors
- `GET /api/projects/:projectId/vendors` - List vendors
- `POST /api/projects/:projectId/vendors` - Add vendor
- `DELETE /api/vendors/:id` - Remove vendor

### Criteria Configuration
- `GET /api/criteria` - Get all criteria
- `GET /api/projects/:projectId/criteria-config` - Get project criteria config
- `POST /api/projects/:projectId/criteria-config` - Add criteria config
- `PATCH /api/criteria-config/:id` - Update criteria config

### Phase 1 - Evaluation
- `GET /api/projects/:projectId/evaluations` - Get all evaluations
- `POST /api/projects/:projectId/phase1/start` - Start Phase 1

### Phase 2 - Scoring
- `GET /api/projects/:projectId/scores` - Get all scores
- `POST /api/projects/:projectId/phase2/config` - Configure Phase 2
- `POST /api/projects/:projectId/phase2/start` - Start Phase 2

### Providers
- `GET /api/providers` - List available LLM providers

## LLM Provider Support

### OpenAI (GPT-4.1 mini)
- 1M token context window
- Fast and cost-effective
- Default provider

### Perplexity (Sonar Deep Research)
- Deep web research capabilities
- Real-time information
- Optional provider

## Future Enhancements

1. **Product Evaluation**
   - Feature-by-feature analysis
   - Support level scoring (Harvey Ball methodology)
   - Product comparison matrices

2. **Ecosystem Evaluation**
   - ISV partnership analysis
   - Integration ecosystem assessment
   - Platform maturity scoring

3. **Advanced Features**
   - Historical trend analysis
   - Competitive positioning charts
   - Excel export/import
   - PDF report generation
   - Collaborative team features

## License

Proprietary - All rights reserved
