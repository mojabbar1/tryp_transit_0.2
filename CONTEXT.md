# Project Context — Tryp Transit

> **Purpose**: Provide context for software engineers and AI coding assistants working on this codebase.
> 
> **Last Updated**: December 5, 2025

---

## Project Overview

**Tryp Transit** is an AI-powered transit recommendation app that encourages public transportation use through personalized incentives and real-time traffic insights.

### Core Value Proposition
- Help users choose transit over driving
- Provide compelling "nudge" messages using AI
- Offer incentives (credits, discounts, rewards)
- Show real-time traffic conditions and travel estimates

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Frontend                        │
│                    (src/, port 3000)                         │
├─────────────────────────────────────────────────────────────┤
│  Pages          │  API Routes           │  Shared Libs       │
│  - /find-rides  │  - /transit-insights  │  - lib/api/        │
│  - /dashboard   │  - /transit-demo      │  - lib/utils.ts    │
│  - /routes      │                       │  - contexts/       │
└────────┬────────┴───────────┬───────────┴────────────────────┘
         │                    │
         │                    ▼
         │         ┌──────────────────────┐
         │         │   External APIs       │
         │         │  - TomTom (traffic)   │
         │         │  - Gemini/OpenAI (AI) │
         │         └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Python ML Service                           │
│              (model_service/, port 5001)                     │
├─────────────────────────────────────────────────────────────┤
│  Flask App     │  Prediction Models    │  Data               │
│  - /health     │  - Hourly ridership   │  - MTA CSV files    │
│  - /predict/*  │  - Daily ridership    │  - Mock fallbacks   │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Directories

### Frontend (`src/`)

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/transit-insights/` | **Main API** — calls TomTom, AI, and ML service |
| `app/api/transit-insights-demo/` | Mock endpoint for demos (no API keys needed) |
| `app/data/` | Static data (bus stops, coordinates) |
| `components/` | Reusable React components |
| `components/ui/` | Shadcn/UI primitives |
| `contexts/` | React Context providers (auth, geolocation, travel) |
| `lib/` | Utilities and shared code |
| `lib/api/` | **API clients** for Gemini, OpenAI, TomTom, ridership |
| `types/` | TypeScript interfaces |
| `validation/` | Zod schemas for form validation |
| `__tests__/` | Jest test suite |

### Backend (`model_service/`)

| File | Purpose |
|------|---------|
| `app.py` | Flask server with `/health`, `/predict/hourly/:n`, `/predict/daily/:n` |
| `bus_hourly_chronos_t5_tiny.py` | Hourly ridership prediction (Chronos or mock) |
| `bus_daily_chronos_t5_tiny.py` | Daily ridership prediction |
| `data/` | CSV files with MTA ridership data |

---

## Environment Variables

### Frontend (`src/.env.local`)
```bash
# AI Provider (set one)
USE_GEMINI=true                    # Use Gemini instead of OpenAI
GEMINI_API_KEY=your_key            # Required if USE_GEMINI=true
OPENAI_API_KEY=your_key            # Required if USE_GEMINI=false

# Traffic Data
NEXT_PUBLIC_TOMTOM_API_KEY=your_key

# ML Service
RIDERSHIP_API_BASE_URL=http://localhost:5001
```

### Backend (`model_service/.env`)
```bash
FLASK_ENV=development
API_HOST=0.0.0.0
API_PORT=5001
```

---

## Key Patterns

### 1. Multi-Provider AI Support
The app supports both Gemini and OpenAI. Toggle via `USE_GEMINI` env var:

```typescript
// src/lib/api/gemini.ts — Gemini client
// src/lib/api/openai.ts — OpenAI client

// In transit-insights/route.ts:
const useGemini = process.env.USE_GEMINI === 'true';
if (useGemini) {
  rawResponse = await callGemini(prompt);
} else {
  rawResponse = await callOpenAI(prompt);
}
```

### 2. Graceful Degradation
The ML service falls back to realistic mock predictions when Chronos isn't available:

```python
# bus_hourly_chronos_t5_tiny.py
if pipeline_hourly == "mock" or df_hourly.empty:
    return generate_realistic_mock_prediction(hours_future)
```

### 3. Lazy Model Loading
Models load on first use, not at import time:

```python
def predict(hours_future):
    if pipeline_hourly is None:
        load_hourly_model()  # Lazy load
    ...
```

### 4. JSON Response Parsing
AI responses may come as raw JSON or markdown-wrapped. The parser handles both:

```typescript
// src/lib/api/gemini.ts
export function parseJsonResponse<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const extracted = extractJsonFromMarkdown(text);
    if (extracted) return JSON.parse(extracted);
    throw new Error('Could not parse JSON');
  }
}
```

### 5. Demo-Only Authentication
Current auth uses localStorage (MVP only). See `auth-context-provider.tsx`:

```typescript
// NOTE: Demo/MVP implementation. For production, use NextAuth.js
const currentUser = localStorage.getItem('currentUser');
```

---

## API Contracts

### POST `/api/transit-insights`

**Request:**
```typescript
interface RequestBody {
  departure: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  timeToDestination: string; // "HH:MM" format
}
```

**Response:**
```typescript
interface TransitInsightResponse {
  travelTime: number;                    // minutes
  trafficDensity: "Light" | "Medium" | "Heavy";
  costSavingsPerTrip: string;            // e.g., "3.50"
  nudgeMessage: string;                  // AI-generated encouragement
  incentiveDetails: {
    type: "eCredit" | "partnerDiscount" | "funReward";
    description: string;
    value: string;
  };
  additionalRides: Array<{
    departureTime?: string;
    travelTime: number;
    trafficDensity: string;
  }>;
}
```

### GET `/predict/hourly/:hours`

**Response:** `number` (predicted ridership count)

---

## Testing

```bash
cd src
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Test Files
- `__tests__/lib/convertToUTC.test.ts` — Time utilities
- `__tests__/lib/api/gemini.test.ts` — JSON parsing
- `__tests__/lib/api/tomtom.test.ts` — Bbox calculation
- `__tests__/data/busStops.test.ts` — Data consistency

---

## Common Tasks

### Adding a New Bus Stop
1. Add coordinates to `src/app/data/busStopCoordinates.ts`
2. Add entry to `src/app/data/busStops.ts`
3. Run `npm test` to verify consistency

### Switching AI Provider
```bash
# In src/.env.local
USE_GEMINI=true   # Use Gemini
USE_GEMINI=false  # Use OpenAI
```

### Running Without API Keys
Use the demo endpoint which returns mock data:
```
POST /api/transit-insights-demo
{ "demoScenario": "rush-hour" | "weekend" | "night-out" }
```

### Adding a New API Utility
1. Create file in `src/lib/api/`
2. Export from `src/lib/api/index.ts`
3. Add tests in `src/__tests__/lib/api/`

---

## Known Limitations

| Limitation | Impact | Future Fix |
|------------|--------|------------|
| localStorage auth | Not secure for production | Migrate to NextAuth.js |
| PyTorch ~2GB | Large model service footprint | Migrate to Prophet |
| No rate limiting | API abuse possible | Add middleware |
| No caching | Repeated API calls | Add Redis/memory cache |
| CSV data source | Not scalable | Migrate to database |

---

## Code Quality Standards

- **TypeScript**: Strict mode enabled, avoid `any`
- **Testing**: Add tests for new utilities
- **API Responses**: Use typed interfaces from `types/interfaces.ts`
- **Error Handling**: Always provide fallback responses
- **Comments**: Add JSDoc for exported functions
- **Imports**: Use `@/` alias for absolute imports

---

## Related Documentation

- [REFACTORING_PLAN.md](./REFACTORING_PLAN.md) — Detailed refactoring notes
- [CHANGELOG.md](./CHANGELOG.md) — Version history
- [SETUP.md](./SETUP.md) — Installation guide
- [DEMO_CHECKLIST.md](./DEMO_CHECKLIST.md) — Investor demo guide

---

## Contact

For questions about this codebase, check the documentation or review the test files for usage examples.
