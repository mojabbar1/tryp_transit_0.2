# Tryp Transit 0.2 — Refactoring Plan

> **Goal**: MVP Demo with clean, maintainable code  
> **Scope**: Moderate refactoring (Option B) — fix issues, consolidate duplicates, improve patterns  
> **Generated**: December 5, 2025

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Code Quality Assessment](#code-quality-assessment)
3. [Phase 1: Critical Fixes (Do Now)](#phase-1-critical-fixes-do-now)
4. [Phase 2: API Consolidation](#phase-2-api-consolidation)
5. [Phase 3: Authentication Cleanup](#phase-3-authentication-cleanup)
6. [Phase 4: Python Model Service](#phase-4-python-model-service)
7. [Phase 5: Code Cleanup & Testing](#phase-5-code-cleanup--testing)
8. [Future Iterations](#future-iterations)
9. [Appendix: Detailed Recommendations](#appendix-detailed-recommendations)

---

## Executive Summary

### What's Good ✅
| Area | Assessment | Notes |
|------|------------|-------|
| **Next.js App Router** | Excellent | Proper use of server/client separation |
| **TypeScript Setup** | Good | Types defined in `src/types/interfaces.ts` |
| **UI Components** | Excellent | Shadcn/UI with proper patterns |
| **Context Architecture** | Good | Clean separation of concerns |
| **Zod Validation** | Good | Form validation in place |
| **Error Handling (API)** | Good | Fallback responses, JSON extraction |

### What's OK 🟡
| Area | Assessment | Notes |
|------|------------|-------|
| **API Routes** | Needs work | Duplicated logic, some `any` types |
| **Python Service** | Functional | Works but has module-level loading issues |
| **Documentation** | Adequate | Setup docs exist, missing inline docs |
| **Auth System** | Demo-ready | localStorage-based, not production-ready |

### What Needs Improvement 🔴
| Area | Assessment | Priority |
|------|------------|----------|
| **Hardcoded API Key** | Security risk | CRITICAL - Remove immediately |
| **Duplicate API Routes** | Maintainability debt | High |
| **Dead Code/Backups** | Clutter | Medium |
| **No Tests** | Quality risk | Medium |
| **Python Dependencies** | Unpinned versions | Medium |

---

## Code Quality Assessment

### Frontend (Next.js)

#### ✅ Excellent Code
```
src/components/ui/          # Shadcn/UI components - well structured
src/contexts/               # Clean context pattern
src/validation/             # Zod schemas properly defined
src/types/interfaces.ts     # Good TypeScript definitions
```

#### 🟡 OK Code (Minor Improvements)
```
src/app/find-rides/page.tsx    # Large file (~500 lines), could split
src/contexts/travel-context.tsx # Missing persistence, some unused values
src/lib/convertToUTC.ts        # Works but could be cleaner
```

#### 🔴 Needs Improvement
```
src/app/api/getTravelTime/       # Duplicate of transit-insights
src/app/api/simple-gemini-test/  # Hardcoded API key (REVOKED)
src/app/api/transit-insights-demo/ # Consider removing
src/app/data/busStopCoordinates.ts # Only 10 stops vs 60+ in busStops.ts
```

### Backend (Python)

#### ✅ Good
```
model_service/app.py                    # Clean Flask routing
model_service/bus_hourly_chronos_t5_tiny.py # Good mock fallback logic
```

#### 🔴 Needs Improvement
```
model_service/requirements.txt          # Unpinned versions
model_service/bus_commuters_regression.py # Unused, deprecated pandas methods
model_service/*.py.backup               # Should be deleted
```

---

## Phase 1: Critical Fixes (Do Now)

### 1.1 Remove Hardcoded API Key ⚠️
**File**: `src/app/api/simple-gemini-test/route.ts`  
**Action**: Remove the hardcoded key (already revoked)

```typescript
// BEFORE (line 7)
const genAI = new GoogleGenerativeAI('AIzaSyAEgPHNz1VoKj7P2LvczFl8l34wOkPdWzw');

// AFTER
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
```

### 1.2 Delete Backup Files
```bash
rm model_service/bus_daily_chronos_t5_tiny.py.backup
rm model_service/bus_hourly_chronos_t5_tiny.py.backup
```

### 1.3 Pin Python Dependencies
**File**: `model_service/requirements.txt`

```txt
# BEFORE (current)
Flask
pandas
torch
numpy
python-dotenv
gunicorn

# AFTER (recommended)
Flask==3.0.0
pandas==2.1.4
torch==2.1.2
numpy==1.26.2
python-dotenv==1.0.0
gunicorn==21.2.0
```

**Estimated Time**: 15-30 minutes

---

## Phase 2: API Consolidation

### Current State: 3+ Overlapping Endpoints

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/transit-insights` | Main endpoint with full features | **KEEP** |
| `/api/getTravelTime` | Legacy, ~80% duplicate code | **DELETE** |
| `/api/transit-insights-simple` | Mock data for testing | **KEEP (rename)** |
| `/api/transit-insights-demo` | Demo data | **MERGE or DELETE** |
| `/api/simple-gemini-test` | Test endpoint | **DELETE** |
| `/api/test-gemini` | Another test endpoint | **DELETE** |
| `/api/test`, `/api/test-env`, `/api/test-tomtom` | Debug endpoints | **DELETE** |

### Recommendation: Option B — Modular API with Shared Utilities

**Pros of Consolidation:**
- Single source of truth for transit logic
- Easier maintenance
- Consistent response format
- Reduced bundle size

**Cons:**
- More upfront work
- Need to update any consumers

### Proposed Structure
```
src/
├── app/api/
│   ├── transit-insights/
│   │   └── route.ts           # Main endpoint (enhanced)
│   └── transit-insights-mock/
│       └── route.ts           # For demos without API keys
└── lib/
    ├── api/
    │   ├── tomtom.ts          # TomTom API client
    │   ├── gemini.ts          # Gemini client + JSON parsing
    │   └── ridership.ts       # Python service client
    └── utils.ts               # Existing utilities
```

### Shared Utilities to Extract

```typescript
// src/lib/api/gemini.ts
export async function callGemini(prompt: string): Promise<string> { ... }
export function parseJsonResponse(text: string): object { ... }
export function extractJsonFromMarkdown(text: string): object | null { ... }

// src/lib/api/tomtom.ts
export async function getTrafficFlow(lat: number, lng: number): Promise<TrafficFlow> { ... }
export async function getIncidents(bbox: string): Promise<Incident[]> { ... }
```

**Estimated Time**: 2-3 hours

---

## Phase 3: Authentication Cleanup

### Current State (Demo-Ready)
```typescript
// auth-context-provider.tsx
const currentUser = localStorage.getItem('currentUser');
setIsLoggedIn(!!currentUser);
```

**This is fine for MVP demo** — simple, works, no external dependencies.

### Cleanup Actions for MVP
1. **Add comments** explaining this is demo-only
2. **Remove unused `isLoading`** state or use it consistently
3. **Add session expiry** (optional) — auto-logout after X hours

### Future: Proper Authentication (Option B)

For production, implement NextAuth.js:

```typescript
// Future: src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // Validate against your database
        return { id: "1", email: credentials.email };
      }
    })
  ],
  session: { strategy: "jwt" },
  pages: { signIn: '/login' }
};

export const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

**Why NextAuth.js:**
- Works with Next.js App Router
- Built-in session management
- Easy to add OAuth providers later (Google, GitHub)
- Production-ready security

**Estimated Time**: MVP cleanup: 30 min | Future NextAuth: 2-4 hours

---

## Phase 4: Python Model Service

### Current State
- **PyTorch + Chronos**: ~2GB dependency for time-series forecasting
- **Module-level loading**: Models load at import (blocking startup)
- **Good fallback**: Mock predictions when model unavailable

### Lighter Alternatives Analysis

| Approach | Size | Accuracy | Effort | Recommendation |
|----------|------|----------|--------|----------------|
| **Keep PyTorch + Chronos** | ~2GB | High | None | ✅ For MVP |
| **statsmodels ARIMA** | ~50MB | Medium | 2-3 hrs | Good alternative |
| **Prophet (Facebook)** | ~100MB | High | 1-2 hrs | Great alternative |
| **Simple heuristics** | ~0MB | Low | 30 min | Fallback only |

### Recommendation: Keep PyTorch for MVP, Plan Prophet Migration

**Rationale:**
1. Current implementation works
2. Mock fallback handles failures gracefully
3. Switching models mid-refactor adds risk
4. Prophet is easier to install (no CUDA issues)

### Immediate Fixes (Do Now)

#### 4.1 Fix Module-Level Loading
```python
# BEFORE (bus_hourly_chronos_t5_tiny.py, bottom)
load_hourly_model()
load_hourly_data()

# AFTER — Lazy loading
# Remove module-level calls. Models load on first predict() call.
```

#### 4.2 Delete Unused Files
```bash
rm model_service/bus_commuters_regression.py
rm model_service/bus_daily_chronos_t5_tiny.py.backup
rm model_service/bus_hourly_chronos_t5_tiny.py.backup
```

#### 4.3 Pin Dependencies with Constraints
```txt
# model_service/requirements.txt
Flask==3.0.0
pandas==2.1.4
torch==2.1.2 --index-url https://download.pytorch.org/whl/cpu
numpy==1.26.2
python-dotenv==1.0.0
gunicorn==21.2.0
chronos-forecasting>=1.0.0
```

### Future Session: Prophet Migration

When ready to reduce model size:

```python
# model_service/bus_hourly_prophet.py (future)
from prophet import Prophet
import pandas as pd

def predict_ridership(hours_future: int) -> int:
    df = pd.read_csv("data/ridership.csv")
    df = df.rename(columns={"transit_timestamp": "ds", "ridership": "y"})
    
    model = Prophet(daily_seasonality=True, weekly_seasonality=True)
    model.fit(df)
    
    future = model.make_future_dataframe(periods=hours_future, freq='H')
    forecast = model.predict(future)
    
    return int(forecast.iloc[-1]['yhat'])
```

**Benefits of Prophet:**
- 50x smaller than PyTorch
- No CUDA/GPU complexity
- Native support for seasonality (exactly what transit needs)
- Easy to explain predictions

**Estimated Time**: Immediate fixes: 30 min | Prophet migration: 3-4 hours (future)

---

## Phase 5: Code Cleanup & Testing

### 5.1 Dead Code Removal

| File/Folder | Action | Reason |
|-------------|--------|--------|
| `src/app/api/getTravelTime/` | Delete | Duplicate of transit-insights |
| `src/app/api/simple-gemini-test/` | Delete | Test endpoint with security issue |
| `src/app/api/test-gemini/` | Delete | Redundant test |
| `src/app/api/test/` | Delete | Debug endpoint |
| `src/app/api/test-env/` | Delete | Exposes env vars |
| `src/app/api/test-tomtom/` | Delete | Debug endpoint |
| `model_service/bus_commuters_regression.py` | Delete | Never used |
| `model_service/*.py.backup` | Delete | Backup clutter |
| `test-gemini.js` | Delete | Root-level test script |
| `test-gemini.sh` | Delete | Root-level test script |

### 5.2 Sync Bus Stops Data

**Problem**: Two files with different bus stop counts
- `src/app/data/busStops.ts` — 60+ stops ✅
- `src/app/data/busStopCoordinates.ts` — 10 stops ❌

**Solution**: Generate coordinates from main busStops.ts or merge.

### 5.3 Testing Strategy (Option B — Minimal Critical Tests)

**Why Option B > Option C for this project:**
- You have working code to test against
- TDD (Option C) is slower for refactoring existing code
- Diminishing returns for MVP demo

**Recommended Test Coverage:**

```
tests/
├── lib/
│   └── convertToUTC.test.ts      # Unit tests for utilities
├── api/
│   └── transit-insights.test.ts  # API route integration test
└── components/
    └── navbar.test.tsx           # Basic component render test
```

**Example Test:**
```typescript
// tests/lib/convertToUTC.test.ts
import { convertToUTC } from '@/lib/convertToUTC';

describe('convertToUTC', () => {
  it('converts HH:MM to UTC format', () => {
    const result = convertToUTC('14:30');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
  
  it('handles midnight correctly', () => {
    const result = convertToUTC('00:00');
    expect(result).toBeDefined();
  });
});
```

**Estimated Time**: 2-3 hours for minimal test suite

---

## Future Iterations

### Iteration 2: Production Readiness
- [ ] Implement NextAuth.js authentication
- [ ] Add proper session management
- [ ] Set up error monitoring (Sentry)
- [ ] Add rate limiting to API routes
- [ ] Configure CORS properly

### Iteration 3: Performance
- [ ] Add Redis caching for API responses
- [ ] Implement React.memo for expensive components
- [ ] Lazy load bus images
- [ ] Add loading skeletons

### Iteration 4: Model Optimization
- [ ] Migrate from PyTorch to Prophet
- [ ] Add model warm-up endpoint
- [ ] Implement prediction caching

### Iteration 5: Production Deployment
- [ ] Vercel deployment configuration
- [ ] Docker optimization for Python service
- [ ] CI/CD pipeline with tests
- [ ] Environment-specific configurations

---

## Appendix: Detailed Recommendations

### A. TypeScript Improvements

**Add types for external APIs:**
```typescript
// src/types/tomtom.ts
export interface TrafficFlowResponse {
  flowSegmentData: {
    currentSpeed: number;
    freeFlowSpeed: number;
    currentTravelTime: number;
    freeFlowTravelTime: number;
    confidence: number;
  };
}

// src/types/ridership.ts
export interface RidershipPrediction {
  prediction: number;
  confidence?: number;
  timestamp: string;
}
```

**Remove `any` types:**
```typescript
// BEFORE
const trafficData: any = { ... }

// AFTER
interface TrafficData {
  flow: { current: TrafficFlowResponse; destination: TrafficFlowResponse };
  incidents: IncidentResponse;
  ridership: { predictedHourly: number | null };
}
const trafficData: TrafficData = { ... }
```

### B. Error Boundary Addition

```typescript
// src/components/error-boundary.tsx
'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong.</div>;
    }
    return this.props.children;
  }
}
```

### C. Environment Variable Validation

```typescript
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  NEXT_PUBLIC_TOMTOM_API_KEY: z.string().min(1),
  RIDERSHIP_API_BASE_URL: z.string().url().optional(),
  USE_GEMINI: z.enum(['true', 'false']).optional(),
});

export function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}
```

### D. Deployment Without Overcomplicating (Option B)

**Yes, you can deploy to production without overcomplicating:**

1. **Next.js on Vercel** — Zero configuration deployment
2. **Python on Railway/Render** — Simple container hosting

**Key Config Files Needed:**

```yaml
# vercel.json (minimal)
{
  "buildCommand": "cd src && npm run build",
  "outputDirectory": "src/.next"
}
```

```dockerfile
# model_service/Dockerfile (already exists)
# Just ensure it works locally first
```

**Environment Variables for Production:**
- Move all secrets to Vercel/Railway dashboards
- Remove `NEXT_PUBLIC_` prefix from sensitive keys
- Use different API keys for prod vs dev

---

## Summary: Recommended Order of Operations

| Phase | Task | Time | Priority | Status |
|-------|------|------|----------|--------|
| 1.1 | Remove hardcoded API key | 5 min | 🔴 CRITICAL | ✅ Done |
| 1.2 | Delete backup files | 5 min | 🔴 High | ✅ Done |
| 1.3 | Pin Python dependencies | 10 min | 🟠 High | ✅ Done |
| 2 | Consolidate API routes | 2-3 hrs | 🟠 High | ✅ Done |
| 3 | Auth cleanup + comments | 30 min | 🟡 Medium | ✅ Done |
| 4 | Fix Python module loading | 30 min | 🟡 Medium | ✅ Done |
| 5.1 | Delete dead code | 30 min | 🟡 Medium | ✅ Done |
| 5.2 | Sync bus stops data | 30 min | 🟢 Low | ✅ Done |
| 5.3 | Add minimal tests | 2-3 hrs | 🟢 Low | ✅ Done |

**All phases complete!**

**Total Estimated Time**: 6-8 hours for full Option B refactor

---

## Questions for You

Before proceeding with implementation:

1. **Should I start with Phase 1 (critical fixes) immediately?**
2. **For API consolidation (Phase 2), confirm: delete `/api/getTravelTime` and all test endpoints?**
3. **Any specific features in the dead code you want to preserve before deletion?**

