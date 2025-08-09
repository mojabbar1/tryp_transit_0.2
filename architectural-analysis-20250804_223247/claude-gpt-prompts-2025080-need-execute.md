PHASE 4.2 — Wrap parsing with validation and fallback

PROMPT:
```
Goal: Add bulletproof JSON parsing with deterministic fallback.

Actions:
1) In `src/app/api/transit-insights/route.ts`, wrap the AI response parsing:

```typescript
import { logger } from '@/lib/logger';
import { transitInsightsSchema } from '@/lib/schemas/transitInsights';

async function getTransitInsights(departure: string, destination: string, time: string) {
  if (process.env.DEMO_MODE === 'true') {
    logger.apiEvent('Using demo fallback for transit insights');
    return getDeterministicFallback(departure, destination, time);
  }

  try {
    const aiResponse = await aiClient.generateTextJSON(prompt, { timeoutMs: 3000 });
    const parsed = JSON.parse(aiResponse);
    const validated = transitInsightsSchema.parse(parsed);
    return validated;
  } catch (error) {
    logger.apiEvent('AI parsing failed, using fallback', { error: error.message });
    return getDeterministicFallback(departure, destination, time);
  }
}

function getDeterministicFallback(departure: string, destination: string, time: string) {
  // Return a predictable response based on time patterns
  const hour = parseInt(time.split(':')[0]);
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
  
  return {
    summary: isRushHour 
      ? `Heavy traffic expected from ${departure} to ${destination}` 
      : `Light traffic expected from ${departure} to ${destination}`,
    estimatedDuration: isRushHour ? '45-60 minutes' : '25-30 minutes',
    congestionLevel: isRushHour ? 'high' : 'low',
    alternativeRoutes: [
      'Consider taking the Blue Line metro',
      'Highway 101 may be faster'
    ]
  };
}
```

2) Add unit tests in `src/__tests__/transit-insights.test.ts`:
   - Test valid AI response → schema passes
   - Test invalid AI response → fallback used  
   - Test DEMO_MODE=true → always use fallback

Verification:
- All three test scenarios pass
- API returns consistent JSON structure in both success and fallback cases
```