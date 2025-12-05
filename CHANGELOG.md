# Changelog

All notable changes to the Tryp Transit project are documented here.

## [0.2.1] - 2025-12-05

### 🔴 Security Fixes
- **Removed hardcoded API key** from `simple-gemini-test/route.ts` (key was revoked)

### ✅ Code Quality Improvements

#### API Consolidation
- **Created shared API utilities** in `src/lib/api/`:
  - `gemini.ts` — Gemini AI client with JSON parsing and markdown extraction
  - `openai.ts` — OpenAI client with streaming support
  - `tomtom.ts` — TomTom traffic API client with typed responses
  - `ridership.ts` — Python ML service client with error handling
  - `index.ts` — Barrel export for clean imports
- **Refactored `/api/transit-insights`** to use shared utilities (reduced from 280 → 180 lines)
- **Preserved multi-provider support** — toggle between Gemini/OpenAI via `USE_GEMINI` env var

#### Deleted Redundant Endpoints
- `/api/getTravelTime` — duplicate of transit-insights
- `/api/simple-gemini-test` — test endpoint with security issue
- `/api/test-gemini` — redundant test
- `/api/test` — debug endpoint
- `/api/test-env` — exposed env vars
- `/api/test-tomtom` — debug endpoint
- `/api/transit-insights-simple` — merged into transit-insights-demo

#### Python Service Improvements
- **Fixed module-level loading** — models now lazy load on first `predict()` call
- **Pinned dependencies** in `requirements.txt`:
  - Flask==3.0.0
  - pandas==2.1.4
  - torch==2.1.2
  - numpy==1.26.2
  - python-dotenv==1.0.0
  - gunicorn==21.2.0
- **Deleted unused files**:
  - `bus_commuters_regression.py`
  - `bus_daily_chronos_t5_tiny.py.backup`
  - `bus_hourly_chronos_t5_tiny.py.backup`

#### Data Sync
- **Synced bus stops** — `busStops.ts` now has 66 stops (was 10), matching `busStopCoordinates.ts`
- Added region comments (Downtown, North Charleston, Mount Pleasant, etc.)

### 🧪 Testing Infrastructure
- **Added Jest testing framework** with ts-jest
- **Created test suite** with 28 tests:
  - `__tests__/lib/convertToUTC.test.ts` — 6 tests for time parsing
  - `__tests__/lib/api/gemini.test.ts` — 11 tests for JSON extraction
  - `__tests__/lib/api/tomtom.test.ts` — 5 tests for bbox calculation
  - `__tests__/data/busStops.test.ts` — 6 tests for data consistency
- **Added test scripts** to package.json:
  - `npm test` — run all tests
  - `npm run test:watch` — watch mode
  - `npm run test:coverage` — coverage report

### 📚 Documentation
- **Added demo-only comment** to `auth-context-provider.tsx`
- **Added JSDoc comments** to API utility functions
- **Updated `transit-insights-demo/route.ts`** with usage documentation

### 🗑️ Deleted Files
| File | Reason |
|------|--------|
| `src/app/api/getTravelTime/` | Duplicate functionality |
| `src/app/api/simple-gemini-test/` | Security risk |
| `src/app/api/test-gemini/` | Redundant |
| `src/app/api/test/` | Debug only |
| `src/app/api/test-env/` | Security risk |
| `src/app/api/test-tomtom/` | Debug only |
| `src/app/api/transit-insights-simple/` | Merged into demo |
| `model_service/bus_commuters_regression.py` | Never used |
| `model_service/*.py.backup` | Backup clutter |
| `test-gemini.js` | Root test script |
| `test-gemini.sh` | Root test script |

### 📁 New Files
| File | Purpose |
|------|---------|
| `src/lib/api/gemini.ts` | Gemini AI client |
| `src/lib/api/openai.ts` | OpenAI client |
| `src/lib/api/tomtom.ts` | TomTom API client |
| `src/lib/api/ridership.ts` | ML service client |
| `src/lib/api/index.ts` | Barrel export |
| `src/jest.config.js` | Jest configuration |
| `src/__tests__/` | Test suite |
| `REFACTORING_PLAN.md` | Refactoring documentation |
| `CHANGELOG.md` | This file |
| `CONTEXT.md` | Project context for devs/AI |

---

## [0.2.0] - 2025-11-XX (Previous Release)

### Features
- Initial MVP implementation
- AI-powered transit recommendations
- Gemini and OpenAI integration
- TomTom traffic data
- Python ML service with Chronos forecasting
- Next.js 14 frontend with Shadcn/UI
- Demo scenarios for investor presentations

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.2.1 | 2025-12-05 | Refactoring, security fixes, testing |
| 0.2.0 | 2025-11-XX | Initial MVP release |
