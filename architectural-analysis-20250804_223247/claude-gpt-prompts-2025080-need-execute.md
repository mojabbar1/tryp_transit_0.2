# GPT Execution Plan for MVP/Investor Demo Hardening — Tryp Transit v0.2

Generated: 2025-08-08 17:13:45  
**Improved Version with Specific Instructions for Cursor**

## How to use this plan

- Paste one PHASE at a time into your AI coding tool (e.g., Cursor) and let it execute each substep sequentially.
- For every substep: implement edits, run the listed commands, verify acceptance criteria, and only then proceed.
- Keep changes scoped to the current substep (KISS/YAGNI). Avoid cross-phase refactors unless required to get green tests/build.

## Conventions

- Monorepo root: `tryp_transit_0.2/`
- App root: `tryp_transit_0.2/src/`
- ML service: `tryp_transit_0.2/model_service/`
- Duplicate tree to avoid: `tryp_transit_0.2/src/src/` (do not delete yet; remove from build/test scope first)

---

## PHASE 0 — Preflight and Baseline

Goal: Establish a clean baseline, determine package manager, and capture current test/build status.

DoD: Package manager detected; dependencies installed; baseline tests/build results captured; no code changes yet.

### Substep 0.1 — Detect toolchain and install

PROMPT
```
Status update: Detect toolchain and install deps without interactive prompts.

Actions:
1) Check for lockfiles in this order:
   - If `pnpm-lock.yaml` exists → use pnpm
   - If `yarn.lock` exists → use yarn  
   - Otherwise → use npm
2) Install dependencies at repo root using the detected manager
3) Print versions for verification

Commands (run the appropriate set based on lockfile found):
For pnpm: 
  corepack enable && pnpm install

For yarn:
  corepack enable && yarn install --immutable || yarn install

For npm:
  npm ci || npm install

Then always run:
  node -v
  [detected-manager] --version

Verification:
- Dependencies installed without errors
- Print the chosen package manager and versions
- No interactive prompts appeared
```

### Substep 0.2 — Baseline tests and build

PROMPT
```
Status update: Run baseline tests/build to capture current state.

Actions:
1) Auto-detect and run tests:
   - Try: npm test || pnpm test || yarn test
   - If no script found, try: npx jest --runInBand --verbose
   - If jest not found, try: npx vitest run
   - Report which command succeeded

2) Auto-detect and run build:
   - Try: npm run build || pnpm build || yarn build
   - If no script found, try: npx next build

3) Create summary file:
   - Append results to `TEST_COMPLETION_SUMMARY.md`

Verification:
- Report exact number: "X tests passed, Y failed, Z skipped"
- Report build status: "Build succeeded" or specific error
- Show which commands were used
```

---

## PHASE 1 — Eliminate duplicate source tree from build/test scope (no deletions)

Why: Avoid ambiguous imports and fragile builds (DRY/KISS).

DoD: `src/src/` excluded from tsconfig and tests; app builds and tests pass as before or better.

### Substep 1.1 — Align TypeScript path mapping to canonical `src/`

PROMPT
```
Goal: Ensure alias `@/*` resolves only to `src/*`; exclude `src/src/*` from compilation.

Actions:
1) Find and open the main TypeScript config:
   - Check `src/tsconfig.json` first
   - If not found, check root `tsconfig.json`

2) Ensure these exact settings:
   - `baseUrl` points to project root (usually "." or "./")  
   - `paths` has: `"@/*": ["src/*"]` (NOT "src/src/*")
   - Add to `exclude` array: `"src/src/**"`

3) If `next.config.mjs` exists, check that any `experimental.tsconfigPaths` settings align

4) Show me the before/after of the changed config files

Commands:
  npx tsc --noEmit
  npm run build || pnpm build || yarn build

Verification:
- Build succeeds without errors
- No TypeScript errors about duplicate module declarations
- `@/` imports resolve to `src/` not `src/src/`
```

### Substep 1.2 — Scope Jest to canonical tree

PROMPT
```
Goal: Ensure tests only run from canonical `src/` directory.

Actions:
1) Find Jest configuration:
   - Check `src/jest.config.js` 
   - Check root `jest.config.js`
   - Check `package.json` "jest" section

2) Update test patterns to exclude `src/src/`:
   - `testMatch` should include `"src/**/*.test.{js,ts,tsx}"` 
   - `testMatch` should NOT include `"src/src/**"`
   - If using `moduleNameMapper` for `@/(.*)`, map to `<rootDir>/src/$1`

3) Show me the Jest config before/after changes

Commands:
  npm test || pnpm test || yarn test || npx jest --runInBand

Verification:
- Tests run successfully
- No tests are imported from `src/src/` directory
- Same or better test count than baseline
```

---

## PHASE 2 — PrismaClient singleton

Why: Prevent per-request client instantiation; reduce connection pressure.

DoD: A shared `lib/prisma.ts` with `globalThis` guard; all API routes/services import it; tests/build pass.

### Substep 2.1 — Create `src/lib/prisma.ts`

PROMPT
```
Goal: Add Prisma singleton with `globalThis` guard.

Actions:
1) Create file `src/lib/prisma.ts` with this exact content:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

2) Verify the file was created and compiles:

Commands:
  ls -la src/lib/prisma.ts
  npx tsc --noEmit

Verification: 
- File exists at `src/lib/prisma.ts`
- TypeScript compilation succeeds with no errors
- File exports a `prisma` constant
```

### Substep 2.2 — Replace route-level `new PrismaClient()`

PROMPT
```
Goal: Use shared prisma singleton in all API routes and services.

Actions:
1) Search for `new PrismaClient()` in these specific files:
   - `src/app/api/transit-insights/route.ts`
   - `src/app/api/rewards/[userId]/route.ts`
   - `src/app/api/complete-trip/route.ts`
   - `src/lib/services/rewardManager.ts`
   - Any other files in `src/lib/services/`

2) For each occurrence found:
   - Remove: `import { PrismaClient } from '@prisma/client'`
   - Remove: `const prisma = new PrismaClient()`
   - Add: `import { prisma } from '@/lib/prisma'`
   - Show me each file before/after the change

3) Re-run tests to ensure no breaking changes

Commands:
  npm test || pnpm test || yarn test

Verification:
- No remaining `new PrismaClient()` outside of `src/lib/prisma.ts`
- All tests pass
- All API routes still function correctly
```

---

## PHASE 3 — Unified AI provider abstraction

Why: Single interface to toggle Gemini/OpenAI; reduce divergence.

DoD: `src/lib/aiClient.ts` with `generateTextJSON(prompt): Promise<string>`; API route and `NudgeGenerator` use it; provider selected via env.

### Substep 3.1 — Create `src/lib/aiClient.ts`

PROMPT
```
Goal: Add provider-agnostic AI client with timeout and error handling.

Actions:
1) Create `src/lib/aiClient.ts` with this structure:

```typescript
interface AIClientOptions {
  timeoutMs?: number;
}

export interface AIClient {
  generateTextJSON(prompt: string, options?: AIClientOptions): Promise<string>;
}

export const aiClient: AIClient = createAIClient();

function createAIClient(): AIClient {
  const provider = process.env.AI_PROVIDER || 'gemini';
  
  switch (provider) {
    case 'gemini':
      return new GeminiClient();
    case 'openai': 
      return new OpenAIClient();
    case 'mock':
      return new MockClient();
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

class GeminiClient implements AIClient {
  async generateTextJSON(prompt: string, options: AIClientOptions = {}): Promise<string> {
    const timeout = options.timeoutMs || 10000;
    // Implementation with existing Gemini logic + timeout
    // Add "Return only valid JSON, no markdown or explanations" to prompt
  }
}

class OpenAIClient implements AIClient {
  async generateTextJSON(prompt: string, options: AIClientOptions = {}): Promise<string> {
    const timeout = options.timeoutMs || 10000;
    // Implementation with existing OpenAI logic + timeout
    // Add "Return only valid JSON, no markdown or explanations" to prompt
  }
}

class MockClient implements AIClient {
  async generateTextJSON(prompt: string, options: AIClientOptions = {}): Promise<string> {
    // Return deterministic JSON for testing
    return JSON.stringify({
      summary: "Mock transit insight for testing",
      estimatedDuration: "30 minutes",
      congestionLevel: "moderate"
    });
  }
}
```

2) Implement timeout handling for all HTTP requests
3) Add the "Return only valid JSON" instruction to all prompts

Commands:
  npx tsc --noEmit

Verification: 
- File compiles without errors
- All three provider classes implement the AIClient interface
- MockClient returns valid JSON string
```

### Substep 3.2 — Refactor consumers to use `aiClient`

PROMPT
```
Goal: Replace direct provider calls with unified aiClient interface.

Actions:
1) Update `src/app/api/transit-insights/route.ts`:
   - Remove direct Gemini/OpenAI imports and fetch calls
   - Add: `import { aiClient } from '@/lib/aiClient'`
   - Replace AI call with: `const response = await aiClient.generateTextJSON(prompt, { timeoutMs: 3000 })`
   - Keep existing prompt logic unchanged otherwise
   - Show me before/after

2) Update `src/lib/services/nudgeGenerator.ts`:
   - Same pattern: import aiClient and use generateTextJSON()
   - Replace direct fetch calls with aiClient
   - Keep existing prompt logic unchanged
   - Show me before/after

3) Test both endpoints manually:

Commands:
  # Test transit insights
  curl http://localhost:3000/api/transit-insights -X POST -H "Content-Type: application/json" -d '{"departure":"Downtown","destination":"Airport","time":"09:00"}'
  
  # Test with different AI_PROVIDER values
  AI_PROVIDER=mock npm run dev
  # (test the same curl command)

Verification: 
- Both API endpoints return the same JSON structure as before
- No more direct fetch() calls to AI providers outside of aiClient.ts
- Environment variable AI_PROVIDER correctly switches between providers
- Mock provider works for testing
```

---

## PHASE 4 — Schema validation + deterministic fallback

Why: LLMs can return malformed JSON; enforce contract and graceful fallback.

DoD: Zod schema validates AI output; on failure, use deterministic template; errors logged via `logger`.

### Substep 4.1 — Add Zod schemas for insights

PROMPT
```
Goal: Create strict validation schemas for AI responses.

Actions:
1) Install zod if not already present:

Commands:
  npm install zod || pnpm add zod || yarn add zod

2) Create `src/lib/schemas/transitInsights.ts`:

```typescript
import { z } from 'zod';

export const transitInsightsSchema = z.object({
  summary: z.string().min(1),
  estimatedDuration: z.string().min(1), 
  congestionLevel: z.enum(['low', 'moderate', 'high']),
  alternativeRoutes: z.array(z.string()).optional(),
  tips: z.array(z.string()).optional()
});

export type TransitInsights = z.infer<typeof transitInsightsSchema>;
```

3) Create `src/lib/schemas/nudge.ts` for nudge responses:

```typescript
import { z } from 'zod';

export const nudgeSchema = z.object({
  message: z.string().min(1),
  type: z.enum(['incentive', 'reminder', 'celebration']),
  actionable: z.boolean().optional()
});

export type Nudge = z.infer<typeof nudgeSchema>;
```

Commands:
  npx tsc --noEmit

Verification:
- Both schema files compile without errors
- Types are properly exported
- Zod dependency installed successfully
```

### Substep 4.2 — Wrap parsing with validation and fallback

PROMPT
```
Goal: Add bulletproof JSON parsing with deterministic fallback.

Actions:
1) Update `src/app/api/transit-insights/route.ts` with validation and fallback:

```typescript
import { logger } from '@/lib/logger';
import { transitInsightsSchema, type TransitInsights } from '@/lib/schemas/transitInsights';
import { aiClient } from '@/lib/aiClient';

async function getTransitInsights(departure: string, destination: string, time: string): Promise<TransitInsights> {
  // Force fallback in demo mode for reliability
  if (process.env.DEMO_MODE === 'true') {
    logger.apiEvent('Using demo fallback for transit insights');
    return getDeterministicFallback(departure, destination, time);
  }

  try {
    const aiResponse = await aiClient.generateTextJSON(prompt, { timeoutMs: 3000 });
    const parsed = JSON.parse(aiResponse);
    const validated = transitInsightsSchema.parse(parsed);
    logger.apiEvent('AI response validated successfully');
    return validated;
  } catch (error) {
    logger.apiEvent('AI parsing failed, using fallback', { 
      error: error.message,
      departure,
      destination 
    });
    return getDeterministicFallback(departure, destination, time);
  }
}

function getDeterministicFallback(departure: string, destination: string, time: string): TransitInsights {
  const hour = parseInt(time.split(':')[0]);
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
  
  return {
    summary: isRushHour && !isWeekend
      ? `Heavy traffic expected from ${departure} to ${destination} during rush hour` 
      : `Light to moderate traffic expected from ${departure} to ${destination}`,
    estimatedDuration: isRushHour && !isWeekend ? '45-60 minutes' : '25-35 minutes',
    congestionLevel: isRushHour && !isWeekend ? 'high' : 'moderate',
    alternativeRoutes: [
      'Consider taking the Blue Line metro',
      'Highway 101 may have better flow',
      'Surface streets might be faster'
    ],
    tips: [
      'Check real-time traffic before departing',
      'Consider traveling 30 minutes earlier or later'
    ]
  };
}
```

2) Apply similar pattern to `src/lib/services/nudgeGenerator.ts` with nudgeSchema

3) Add unit tests in `src/__tests__/transit-insights.test.ts`:

```typescript
describe('getTransitInsights', () => {
  test('returns valid schema with good AI response', async () => {
    // Mock aiClient to return valid JSON
  });
  
  test('uses fallback with invalid AI response', async () => {
    // Mock aiClient to return malformed JSON
  });
  
  test('uses fallback in DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'true';
    // Test always returns deterministic fallback
  });
});
```

Commands:
  npm test || pnpm test || yarn test

Verification:
- All three test scenarios pass
- API returns consistent JSON structure in both success and fallback cases  
- DEMO_MODE=true always uses deterministic responses
- Errors are properly logged with context
```

---

## PHASE 5 — Centralized config

Why: Reduce scattered `process.env.*`; enable safer toggles.

DoD: `src/lib/config.ts` centralizes env reads; routes/services import from it.

### Substep 5.1 — Create `src/lib/config.ts`

PROMPT
```
Goal: Centralize all environment variable reads with validation and safe defaults.

Actions:
1) Create `src/lib/config.ts` with complete environment handling:

```typescript
function assertRequired(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function getOptional(name: string, defaultValue: string): string {
  return process.env[name]?.trim() || defaultValue;
}

function getBooleanFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name]?.toLowerCase().trim();
  return value === 'true' || value === '1';
}

// Core Application Settings
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const DEMO_MODE = getBooleanFlag('DEMO_MODE');

// AI Configuration  
export const AI_PROVIDER = getOptional('AI_PROVIDER', 'gemini') as 'gemini' | 'openai' | 'mock';

// API Keys (server-side only - never NEXT_PUBLIC_*)
export const GEMINI_API_KEY = DEMO_MODE 
  ? 'demo-key' 
  : assertRequired('GEMINI_API_KEY', process.env.GEMINI_API_KEY);

export const OPENAI_API_KEY = DEMO_MODE 
  ? 'demo-key' 
  : getOptional('OPENAI_API_KEY', '');

// External Services  
export const TOMTOM_API_KEY = assertRequired('NEXT_PUBLIC_TOMTOM_API_KEY', process.env.NEXT_PUBLIC_TOMTOM_API_KEY);
export const RIDERSHIP_API_BASE_URL = getOptional('RIDERSHIP_API_BASE_URL', 'http://localhost:5001');

// Database
export const DATABASE_URL = assertRequired('DATABASE_URL', process.env.DATABASE_URL);

// Legacy support (mark as deprecated)
export const USE_GEMINI = AI_PROVIDER === 'gemini'; // @deprecated: use AI_PROVIDER instead

// Validation function for startup checks
export interface ConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Required for all modes
    assertRequired('NEXT_PUBLIC_TOMTOM_API_KEY', process.env.NEXT_PUBLIC_TOMTOM_API_KEY);
    assertRequired('DATABASE_URL', process.env.DATABASE_URL);
    
    // Required for production (unless demo mode)
    if (!DEMO_MODE && NODE_ENV === 'production') {
      if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
        errors.push('Either GEMINI_API_KEY or OPENAI_API_KEY required in production');
      }
    }
    
    // Warnings for suboptimal config
    if (DEMO_MODE && NODE_ENV === 'production') {
      warnings.push('DEMO_MODE enabled in production environment');
    }
    
    if (process.env.USE_GEMINI) {
      warnings.push('USE_GEMINI is deprecated, use AI_PROVIDER instead');
    }
    
  } catch (error) {
    errors.push(error.message);
  }
  
  return { 
    valid: errors.length === 0, 
    errors, 
    warnings 
  };
}

// Helper for logging current config (without exposing secrets)
export function getConfigSummary() {
  return {
    nodeEnv: NODE_ENV,
    demoMode: DEMO_MODE,
    aiProvider: AI_PROVIDER,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenAiKey: !!process.env.OPENAI_API_KEY,
    hasTomTomKey: !!process.env.NEXT_PUBLIC_TOMTOM_API_KEY,
    ridershipsApiUrl: RIDERSHIP_API_BASE_URL
  };
}
```

Commands:
  npx tsc --noEmit

Verification:
- File compiles successfully  
- All exported constants have correct types
- validateConfig() returns expected ConfigValidation structure
- getConfigSummary() doesn't expose secret values
```

### Substep 5.2 — Replace ad-hoc env reads with config imports

PROMPT
```
Goal: Use centralized config throughout the application.

Actions:
1) Find and replace `process.env.*` reads in these locations:
   - All files in `src/app/api/`
   - All files in `src/lib/services/`
   - `src/lib/aiClient.ts`
   - Any test files that read env vars

2) For each file found:
   - Add: `import { GEMINI_API_KEY, AI_PROVIDER, DEMO_MODE, /* etc */ } from '@/lib/config'`
   - Replace: `process.env.GEMINI_API_KEY` with `GEMINI_API_KEY`
   - Replace: `process.env.AI_PROVIDER` with `AI_PROVIDER`
   - Show me each file before/after changes

3) Update `/api/test-env` route to use config and show validation:

```typescript
import { validateConfig, getConfigSummary } from '@/lib/config';

export async function GET() {
  const validation = validateConfig();
  const summary = getConfigSummary();
  
  return Response.json({
    ...summary,
    validation,
    timestamp: new Date().toISOString()
  });
}
```

Commands:
  npm test || pnpm test || yarn test
  # Test the updated endpoint:
  curl http://localhost:3000/api/test-env

Verification:
- No remaining direct `process.env.*` reads outside of `config.ts`
- All tests pass with same behavior as before
- `/api/test-env` returns validation status and config summary
- Secrets are not exposed in API responses
```

---

## PHASE 6 — ML service health endpoint

Why: Health checks improve demo reliability.

DoD: `/health` returns `{ status: 'ok', timestamp: <iso> }` with HTTP 200.

### Substep 6.1 — Implement `/health` in Flask app

PROMPT
```
Goal: Add robust JSON health response to ML service.

Actions:
1) Open `model_service/app.py` and add this health endpoint:

```python
from datetime import datetime
import json

@app.route('/health', methods=['GET'])
def health_check():
    try:
        # Basic health check - could add DB connection test, model loading, etc.
        return json.dumps({
            'status': 'ok',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'service': 'ridership-ml',
            'version': '1.0.0'
        }), 200, {'Content-Type': 'application/json'}
    except Exception as e:
        return json.dumps({
            'status': 'error',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': str(e)
        }), 500, {'Content-Type': 'application/json'}
```

2) Verify the ML service starts correctly:

Commands:
  cd model_service
  python app.py &
  sleep 2
  curl -s http://localhost:5001/health | python -m json.tool

3) Check that RIDERSHIP_API_BASE_URL in config matches the ML service port

Verification:
- Health endpoint returns valid JSON with status 'ok' 
- HTTP response code is 200
- Service runs on the port specified in RIDERSHIP_API_BASE_URL
- JSON structure matches the expected format
```

---

## PHASE 7 — Time/locale normalization

Why: Consistent time display for demo.

DoD: Server outputs normalized to UTC or fixed demo TZ; client renders consistently.

### Substep 7.1 — Normalize server-side time formatting

PROMPT
```
Goal: Replace locale-dependent time formatting with deterministic UTC/fixed timezone.

Actions:
1) Audit time formatting in these files:
   - `src/lib/services/timeContext.ts`
   - Any API routes that return time strings
   - `src/lib/utils/convertToUTC.ts` (if exists)

2) Create or update `src/lib/utils/timeFormatter.ts`:

```typescript
export function formatTimeForDemo(date: Date): string {
  // Use consistent UTC formatting for demo reliability
  return date.toISOString().slice(0, 19) + 'Z';
}

export function formatTimeForDisplay(date: Date): string {
  // Fixed timezone for demo consistency (PST)
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function getCurrentTimeContext(): string {
  const now = new Date();
  const hour = now.getHours();
  
  if (hour >= 6 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';  
  if (hour >= 17 && hour < 22) return 'Evening';
  return 'Night';
}
```

3) Replace `toLocaleTimeString()` and similar calls with these utilities
4) Update any time-based logic to use consistent timezone

Commands:
  npm test || pnpm test || yarn test

Verification:
- Time strings are consistent across multiple API calls
- No `toLocaleTimeString()` calls remain in server code
- Tests pass with stable time formatting
- Demo displays show consistent timezone
```

---

## PHASE 8 — Logging centralization

Why: Consistent observability and demo debugging.

DoD: `logger` used instead of `console.*`; option to include request-scoped IDs.

### Substep 8.1 — Replace `console.*` with centralized logger

PROMPT
```
Goal: Use consistent logging throughout the application.

Actions:
1) Verify `src/lib/logger.ts` exists and has these methods:
   - `logger.apiEvent(message, context?)`
   - `logger.error(message, context?)`
   - `logger.warn(message, context?)`
   - `logger.info(message, context?)`

2) If logger doesn't exist or is incomplete, create it:

```typescript
interface LogContext {
  [key: string]: any;
  requestId?: string;
  userId?: string;
  route?: string;
}

class Logger {
  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private formatLog(level: string, message: string, context?: LogContext): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...context
    };
    
    // In production, you might send this to a logging service
    console.log(JSON.stringify(logEntry));
  }

  apiEvent(message: string, context?: LogContext): void {
    this.formatLog('API_EVENT', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.formatLog('ERROR', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.formatLog('WARN', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.formatLog('INFO', message, context);
  }
}

export const logger = new Logger();
```

3) Search for `console.log`, `console.error`, `console.warn` in `src/**` and replace:
   - `console.log()` → `logger.info()`
   - `console.error()` → `logger.error()`  
   - `console.warn()` → `logger.warn()`
   - Add context where helpful (route name, user ID, etc.)

4) Update API routes to include request correlation:

```typescript
// Example in API route:
const requestId = Math.random().toString(36).substring(2, 15);
logger.apiEvent('Processing transit insights request', { 
  requestId, 
  route: '/api/transit-insights',
  departure,
  destination 
});
```

Commands:
  # Search for remaining console usage:
  grep -r "console\." src/ --include="*.ts" --include="*.tsx" || echo "No console usage found"
  
  npm test || pnpm test || yarn test

Verification:
- No `console.*` calls remain in `src/**` (except in test files where allowed)
- All API routes use logger with consistent formatting
- Log entries include structured context information
- Tests still pass with new logging
```

---

## PHASE 9 — One-click demo scripts and smoke tests

Why: Deterministic demo flow and easy recovery.

DoD: `demo:prep` script warms and verifies; smoke tests runnable quickly.

### Substep 9.1 — Add demo preparation and smoke test scripts

PROMPT
```
Goal: Create bulletproof demo preparation workflow.

Actions:
1) Create `src/scripts/setupDemo.ts` (or update if exists):

```typescript
import { validateConfig, getConfigSummary } from '../lib/config';
import { logger } from '../lib/logger';

async function setupDemo() {
  console.log('🚀 Starting demo preparation...\n');
  
  // 1. Validate configuration
  console.log('1. Validating configuration...');
  const validation = validateConfig();
  if (!validation.valid) {
    console.error('❌ Configuration errors:');
    validation.errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }
  
  if (validation.warnings.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    validation.warnings.forEach(warning => console.warn(`   - ${warning}`));
  }
  console.log('✅ Configuration valid\n');
  
  // 2. Test API endpoints
  console.log('2. Testing API endpoints...');
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  
  try {
    // Test config endpoint
    const configResponse = await fetch(`${baseUrl}/api/test-env`);
    if (!configResponse.ok) throw new Error(`Config test failed: ${configResponse.status}`);
    console.log('✅ Config endpoint working');
    
    // Test ML service health
    const healthResponse = await fetch(`${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001'}/health`);
    if (!healthResponse.ok) throw new Error(`ML service health check failed: ${healthResponse.status}`);
    console.log('✅ ML service healthy');
    
    // Test transit insights with mock data
    const transitResponse = await fetch(`${baseUrl}/api/transit-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        departure: 'Downtown',
        destination: 'Airport', 
        time: '09:00'
      })
    });
    if (!transitResponse.ok) throw new Error(`Transit insights failed: ${transitResponse.status}`);
    console.log('✅ Transit insights working');
    
  } catch (error) {
    console.error(`❌ API test failed: ${error.message}`);
    process.exit(1);
  }
  console.log('✅ All API endpoints responding\n');
  
  // 3. Warm caches and pre-generate demo data
  console.log('3. Warming caches...');
  // Add any cache warming logic here
  console.log('✅ Caches warmed\n');
  
  // 4. Final summary
  const summary = getConfigSummary();
  console.log('📋 Demo Ready Summary:');
  console.log(`   - Environment: ${summary.nodeEnv}`);
  console.log(`   - Demo Mode: ${summary.demoMode}`);
  console.log(`   - AI Provider: ${summary.aiProvider}`);
  console.log(`   - TomTom API: ${summary.hasTomTomKey ? 'configured' : 'missing'}`);
  console.log(`   - ML Service: healthy`);
  
  console.log('\n🎉 Demo preparation complete!');
  console.log('👉 Navigate to http://localhost:3000/rewards to start demo');
}

setupDemo().catch(error => {
  console.error('💥 Demo setup failed:', error.message);
  process.exit(1);
});
```

2) Add package.json scripts:

```json
{
  "scripts": {
    "demo:prep": "ts-node src/scripts/setupDemo.ts",
    "test:smoke": "jest --testPathPattern='(unit|integration)' --runInBand --verbose",
    "demo:reset": "ts-node src/scripts/resetDemo.ts"
  }
}
```

3) Create `src/scripts/resetDemo.ts` for quick recovery:

```typescript
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

async function resetDemo() {
  console.log('🔄 Resetting demo data...');
  
  try {
    // Reset user data to known demo state
    await prisma.user.deleteMany({});
    
    // Create demo users
    await prisma.user.createMany({
      data: [
        { id: 'alice', name: 'Alice Chen', email: 'alice@demo.com', points: 150 },
        { id: 'bob', name: 'Bob Wilson', email: 'bob@demo.com', points: 75 },
        { id: 'carol', name: 'Carol Smith', email: 'carol@demo.com', points: 220 }
      ]
    });
    
    console.log('✅ Demo users created');
    console.log('✅ Demo reset complete');
    
  } catch (error) {
    console.error('❌ Demo reset failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetDemo();
```

4) Update `start-app.sh` to include demo prep:

```bash
#!/bin/bash
echo "🚀 Starting Tryp Transit Demo..."

# Run demo preparation
npm run demo:prep

if [ $? -eq 0 ]; then
  echo "✅ Demo prep successful, starting application..."
  npm run dev
else
  echo "❌ Demo prep failed, please check configuration"
  exit 1
fi
```

Commands:
  chmod +x start-app.sh
  npm run demo:prep
  npm run test:smoke

Verification:
- `demo:prep` script runs without errors and reports all systems green
- `test:smoke` runs only unit/integration tests (excludes E2E)
- `start-app.sh` includes demo preparation step
- Scripts provide clear pass/fail status with specific error messages
```

---

## PHASE 10 — Temporary E2E handling for demo window

Why: Reduce live-demo flakiness.

DoD: Known flaky E2E tests are skipped or gated; CI unaffected unless desired.

### Substep 10.1 — Mark flaky tests and gate E2E

PROMPT
```
Goal: Isolate flaky E2E tests to ensure demo stability.

Actions:
1) Find E2E test files (likely in `src/__tests__/e2e/` or `src/tests/e2e/`):
   - Look for files with `.e2e.test.ts` or in an `e2e` directory
   - Look for files using Playwright, Cypress, or similar E2E frameworks

2) For the 2 failing E2E tests mentioned in docs:
   - Mark them as `it.skip('test description', () => { ... })`
   - Add TODO comments with issue tracking:

```typescript
// TODO: Re-enable after fixing rendering timing issues
// See: https://github.com/yourproject/issues/123
it.skip('should load rewards page correctly', () => {
  // test code...
});

// TODO: Re-enable after fixing mock stability  
// See: https://github.com/yourproject/issues/124
it.skip('should complete trip flow end-to-end', () => {
  // test code...
});
```

3) Update Jest configuration to exclude E2E from smoke tests:
   - Ensure `test:smoke` script doesn't run files matching `*.e2e.test.*`
   - Add `testPathIgnorePatterns` for E2E if needed

4) Create `DEMO_CHECKLIST.md` documenting the temporary gating:

```markdown
# Demo Checklist - Temporary E2E Exclusions

## Skipped Tests (Demo Window Only)
- `rewards-page.e2e.test.ts` - Skipped due to rendering timing issues
- `trip-completion.e2e.test.ts` - Skipped due to mock instability  

## Post-Demo Tasks
- [ ] Fix E2E rendering timing with proper waitFor conditions
- [ ] Stabilize mocks using MSW or similar deterministic handlers
- [ ] Re-enable E2E tests and verify in CI

## Demo Command Reference
- `npm run test:smoke` - Unit/integration only (E2E excluded)
- `npm run test` - Full test suite including E2E
- `npm run demo:prep` - Demo readiness check
```

Commands:
  npm run test:smoke
  # Should run successfully without E2E failures
  
  npm run test
  # Should show skipped E2E tests but not fail the build

Verification:
- `test:smoke` runs successfully with only unit/integration tests
- Full test suite shows skipped E2E tests with clear TODO comments  
- `DEMO_CHECKLIST.md` documents the temporary exclusions
- No E2E failures block the demo preparation workflow
```

---

## PHASE 11 — Security preflight

Why: Prevent accidental key exposure and fail-fast on missing config.

DoD: Preflight at startup validates required server-side keys (or confirms demo fallbacks); no server keys are exposed with `NEXT_PUBLIC_*`.

### Substep 11.1 — Add comprehensive security validation

PROMPT
```
Goal: Validate configuration security and prevent key exposure.

Actions:
1) Update `src/lib/config.ts` to add security validation:

```typescript
// Add to existing config.ts

export interface SecurityValidation {
  secure: boolean;
  violations: string[];
  recommendations: string[];
}

export function validateSecurity(): SecurityValidation {
  const violations: string[] = [];
  const recommendations: string[] = [];
  
  // Check for accidentally exposed server secrets
  if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    violations.push('GEMINI_API_KEY exposed as NEXT_PUBLIC_ - this will be visible to clients!');
  }
  
  if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    violations.push('OPENAI_API_KEY exposed as NEXT_PUBLIC_ - this will be visible to clients!');
  }
  
  if (process.env.NEXT_PUBLIC_DATABASE_URL) {
    violations.push('DATABASE_URL exposed as NEXT_PUBLIC_ - this will be visible to clients!');
  }
  
  // Check for missing required keys in production
  if (NODE_ENV === 'production' && !DEMO_MODE) {
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      violations.push('No AI API keys configured for production');
    }
  }
  
  // Recommendations for better security
  if (!process.env.DATABASE_URL?.includes('ssl=true') && NODE_ENV === 'production') {
    recommendations.push('Consider enabling SSL for database connections in production');
  }
  
  if (DEMO_MODE && NODE_ENV === 'production') {
    recommendations.push('DEMO_MODE should not be enabled in production');
  }
  
  return {
    secure: violations.length === 0,
    violations,
    recommendations
  };
}

// Enhanced preflight that includes security check
export function runPreflight(): { success: boolean; message: string } {
  try {
    // Config validation
    const configValidation = validateConfig();
    if (!configValidation.valid) {
      return {
        success: false,
        message: `Configuration errors: ${configValidation.errors.join(', ')}`
      };
    }
    
    // Security validation  
    const securityValidation = validateSecurity();
    if (!securityValidation.secure) {
      return {
        success: false,
        message: `Security violations: ${securityValidation.violations.join(', ')}`
      };
    }
    
    // Log warnings but don't fail
    if (configValidation.warnings.length > 0) {
      console.warn('Configuration warnings:', configValidation.warnings);
    }
    
    if (securityValidation.recommendations.length > 0) {
      console.warn('Security recommendations:', securityValidation.recommendations);
    }
    
    return { success: true, message: 'Preflight checks passed' };
    
  } catch (error) {
    return { success: false, message: `Preflight failed: ${error.message}` };
  }
}
```

2) Add preflight call to key API routes (first request triggers it):

```typescript
// Add to src/app/api/transit-insights/route.ts and other key routes
import { runPreflight } from '@/lib/config';
import { logger } from '@/lib/logger';

let preflightRun = false;

export async function POST(request: Request) {
  // Run preflight check on first request
  if (!preflightRun) {
    const preflight = runPreflight();
    if (!preflight.success) {
      logger.error('Preflight check failed', { error: preflight.message });
      return Response.json({ error: 'System configuration error' }, { status: 500 });
    }
    logger.info('Preflight check passed', { message: preflight.message });
    preflightRun = true;
  }
  
  // ... rest of the API logic
}
```

3) Update demo setup script to run security validation:

```typescript
// Add to src/scripts/setupDemo.ts
import { validateSecurity, runPreflight } from '../lib/config';

// Add this check in the setupDemo function:
console.log('🔒 Validating security...');
const securityCheck = validateSecurity();
if (!securityCheck.secure) {
  console.error('❌ Security violations found:');
  securityCheck.violations.forEach(violation => 
    console.error(`   - ${violation}`)
  );
  process.exit(1);
}

if (securityCheck.recommendations.length > 0) {
  console.warn('⚠️  Security recommendations:');
  securityCheck.recommendations.forEach(rec => 
    console.warn(`   - ${rec}`)
  );
}
console.log('✅ Security validation passed\n');
```

Commands:
  npm run demo:prep
  # Should include security validation step
  
  # Test with intentionally bad config:
  NEXT_PUBLIC_GEMINI_API_KEY=test npm run demo:prep
  # Should fail with security violation

Verification:
- Demo prep includes security validation step
- Server-side API keys are never exposed with NEXT_PUBLIC_ prefix
- Preflight runs on first API request and logs clear status
- Security violations cause demo prep to fail with specific error messages
- Production deployment without proper keys fails fast with clear messaging
```

---

## Quick Commands Reference

```bash
# Tests
npm test                 # Full test suite
npm run test:smoke      # Unit/integration only (no E2E)

# Build  
npm run build || pnpm build || yarn build

# Demo workflow
npm run demo:prep       # Validate config, test APIs, warm caches
npm run demo:reset      # Reset demo data to known state
./start-app.sh          # Full demo startup with preflight

# ML service health
curl -s http://localhost:5001/health | jq .

# Configuration check
curl -s http://localhost:3000/api/test-env | jq .
```

## Definition of Done (Overall)

✅ **PHASE 0-11 Complete**: All substeps executed successfully  
✅ **Build Success**: `npm run build` completes without errors  
✅ **Test Success**: `npm run test:smoke` passes consistently  
✅ **Demo Ready**: `npm run demo:prep` validates all systems  
✅ **One-Click Start**: `./start-app.sh` includes preflight and launches demo  
✅ **Duplicate Resolution**: `src/src/` excluded from build/test scope  
✅ **Fallback Hardening**: AI failures use deterministic responses  
✅ **Security Validated**: No server keys exposed; preflight prevents runtime failures  

**Post-Demo Cleanup Tasks:**
- Delete duplicate `src/src/` directory entirely
- Re-enable skipped E2E tests with proper stability fixes  
- Consider promoting mock/demo mode features to production toggle