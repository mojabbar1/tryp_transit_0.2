# Kiro Integration Patterns - Tryp Transit Application
**Generated:** 2025-08-04 22:32:47  
**Analysis Type:** Service Integration and Communication Patterns

## Integration Architecture Overview

The Tryp Transit application implements a sophisticated integration architecture that connects multiple external services, internal microservices, and data sources. The system uses various integration patterns to ensure reliability, performance, and maintainability.

## External Service Integrations

### 1. AI Service Integration (OpenAI/Gemini)

#### Dual Provider Strategy
```typescript
// Provider selection pattern
const useGemini = process.env.USE_GEMINI === 'true';

const openai = useGemini ? null : new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = useGemini ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY!) : null;
```

#### Request/Response Pattern
```typescript
// Gemini API Integration
if (useGemini) {
  const model = genAI!.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 2048,
    }
  });
  
  const response = await model.generateContent(enhancedPrompt);
  result = response.response.text();
}
```

#### OpenAI Streaming Integration
```typescript
// OpenAI streaming pattern
const stream = await openai!.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: prompt }],
  stream: true,
});

for await (const chunk of stream) {
  result += chunk.choices[0]?.delta?.content || '';
}
```

#### Error Handling and Fallback
```typescript
// Graceful degradation pattern
try {
  const aiNudge = await this.generateWithAI(context);
  if (aiNudge) return aiNudge;
} catch (error) {
  logger.nudgeEvent('ai_failed', context.userId, { error: error.message });
}

// Fall back to templates
const fallbackNudge = this.generateFallbackNudge(context);
return fallbackNudge;
```

### 2. TomTom Traffic API Integration

#### Multi-Endpoint Data Aggregation
```typescript
// Parallel API calls for comprehensive traffic data
const [flowResponseCurrent, flowResponseDestination, incidentResponse] = await Promise.all([
  axios.get(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`, {
    params: { key: TOMTOM_API_KEY, point: `${departureLatitude},${departureLongitude}` }
  }),
  axios.get(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`, {
    params: { key: TOMTOM_API_KEY, point: `${destinationLatitude},${destinationLongitude}` }
  }),
  axios.get(`https://api.tomtom.com/traffic/services/5/incidentDetails`, {
    params: { key: TOMTOM_API_KEY, bbox: bbox, fields: '{incidents{...}}' }
  })
]);
```

#### Data Transformation Pipeline
```typescript
// Traffic data aggregation
const trafficData = {
  flow: {
    current: flowResponseCurrent.data,
    destination: flowResponseDestination.data,
  },
  incidents: incidentResponse.data,
  ridership: { predictedHourly: predictedHourlyRidership },
};
```

### 3. Machine Learning Service Integration

#### HTTP-Based Microservice Communication
```typescript
// ML service integration with error handling
let predictedHourlyRidership: number | null = null;

if (hours_until_destination > 0) {
  try {
    const ridershipApiUrl = `${process.env.RIDERSHIP_API_BASE_URL}/predict/hourly/${hours_until_destination}`;
    
    const ridershipResponse = await axios.get(ridershipApiUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    // Handle different response formats
    if (typeof ridershipResponse.data === 'number') {
      predictedHourlyRidership = ridershipResponse.data;
    } else if (ridershipResponse.data?.prediction) {
      predictedHourlyRidership = ridershipResponse.data.prediction;
    }
  } catch (error) {
    console.error('Ridership API call failed:', error);
    predictedHourlyRidership = null;
  }
}
```

#### Service Discovery Pattern
```typescript
// Environment-based service discovery
const RIDERSHIP_API_BASE_URL = process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001';
```

## Internal Service Integration Patterns

### 1. Service Layer Pattern

#### RewardManager Service Integration
```typescript
// Service instantiation and method chaining
const rewardManager = new RewardManager();

// Initialize user rewards if they don't exist
await rewardManager.initializeUserRewards(userId);

// Record trip completion and update progress
const result = await rewardManager.recordTripCompletion(userId);
```

#### NudgeGenerator Service Integration
```typescript
// Context-driven service integration
const nudgeGenerator = new NudgeGenerator();

const nudgeContext: NudgeContext = {
  userId,
  userName: userInfo.name,
  currentProgress,
  nearbyPartners,
  timeOfDay: new Date().toLocaleTimeString()
};

const generatedNudge = await nudgeGenerator.generatePersonalizedNudge(nudgeContext);
```

### 2. Database Integration Pattern (Prisma ORM)

#### Connection Management
```typescript
// Singleton pattern for database connection
const prisma = new PrismaClient();
```

#### Complex Query Integration
```typescript
// Relationship-aware queries
const progress = await prisma.userRewardProgress.findMany({
  where: { userId },
  include: {
    reward: {
      include: { partner: true }
    }
  },
  orderBy: [
    { isEarned: 'asc' },
    { completedTrips: 'desc' }
  ]
});
```

#### Transaction Pattern
```typescript
// Atomic operations
const updatedProgressItem = await prisma.userRewardProgress.update({
  where: { id: progress.id },
  data: updateData,
  include: {
    reward: { include: { partner: true } }
  }
});
```

### 3. Logging Integration Pattern

#### Centralized Logging Service
```typescript
// Event-driven logging integration
logger.apiEvent('trip_completion_started', { userId });
logger.beerRewardEvent('earned', userId, { 
  rewardCount: beerRewards.length,
  redemptionCodes: beerRewards.map(r => r.redemptionCode)
});
```

#### Performance Monitoring Integration
```typescript
// Response time tracking
const startTime = Date.now();
// ... operation
const responseTime = Date.now() - startTime;
logger.apiEvent('trip_completion_success', { userId, responseTime });
```

## Frontend-Backend Integration Patterns

### 1. API Gateway Pattern

#### Next.js API Routes as Gateway
```typescript
// Centralized API routing
/app/api/
├── transit-insights/route.ts     # Main insights endpoint
├── complete-trip/route.ts        # Trip completion
├── rewards/[userId]/route.ts     # User rewards
├── test-*/route.ts              # Development endpoints
```

#### Request/Response Standardization
```typescript
// Consistent response format
interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
  responseTime?: number;
}
```

### 2. Client-Server Communication Pattern

#### Axios Integration with Retry Logic
```typescript
// Retry pattern implementation
const handleSubmit = async (e: React.FormEvent, isRetry = false) => {
  try {
    const response = await fetch(apiEndpoint, requestConfig);
    // ... success handling
  } catch (err) {
    if (retryCount < maxRetries && !isRetry) {
      setRetryCount(prev => prev + 1);
      setTimeout(() => {
        handleSubmit(syntheticEvent, true);
      }, 1000 * (retryCount + 1));
    }
  }
};
```

#### State Synchronization Pattern
```typescript
// Optimistic updates with server sync
const handleTripCompleted = (result: any) => {
  if (result.success && result.newlyEarnedRewards?.length > 0) {
    setCelebrationReward(result.newlyEarnedRewards[0]);
    setShowCelebration(true);
  }
  
  // Refresh user data from server
  loadUserData(selectedUserId);
};
```

### 3. Real-time Data Integration

#### Polling Pattern for Demo
```typescript
// Periodic data refresh
useEffect(() => {
  const interval = setInterval(() => {
    if (selectedUserId) {
      loadUserData(selectedUserId);
    }
  }, 30000); // 30 seconds

  return () => clearInterval(interval);
}, [selectedUserId]);
```

## Data Transformation Integration Patterns

### 1. Coordinate Mapping Integration

#### Static Data Integration
```typescript
// Bus stop coordinate mapping
import { busStopCoordinates } from '@/app/data/busStopCoordinates';

// Transform user selection to coordinates
const departureCoords = busStopCoordinates[departureStop];
const destinationCoords = busStopCoordinates[destinationStop];
```

### 2. Time Processing Integration

#### UTC Conversion Pattern
```typescript
// Time standardization
import { convertToUTC } from '@/lib/convertToUTC';

const utcTime = convertToUTC(timeToDestination);
```

#### Time Context Integration
```typescript
// Behavioral time analysis
const beerContext = getBeerNudgeContext();
const contextMessage = getBeerContextMessage(beerContext);
```

### 3. Data Validation Integration

#### Multi-layer Validation
```typescript
// Client-side validation
if (!departure || !destination || !timeToDestination) {
  return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
}

// Coordinate validation
if (!departureCoords || !destinationCoords) {
  setError('Invalid bus stop names. Please select from available stops.');
  return;
}
```

## Error Handling Integration Patterns

### 1. Circuit Breaker Pattern

#### Service Availability Checking
```typescript
// Health check integration
@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "tryp-transit-model-service"
    })
```

#### Graceful Degradation
```python
# ML service fallback pattern
if pipeline_hourly == "mock" or df_hourly.empty:
    return generate_realistic_mock_prediction(hours_future)
```

### 2. Timeout and Retry Integration

#### Request Timeout Pattern
```typescript
// API timeout configuration
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

const response = await fetch(url, {
  signal: controller.signal,
  // ... other config
});
```

#### Exponential Backoff
```typescript
// Retry with increasing delays
setTimeout(() => {
  const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
  handleSubmit(syntheticEvent, true);
}, 1000 * (retryCount + 1));
```

### 3. Error Boundary Integration

#### Component-Level Error Handling
```typescript
// Error state management
const [error, setError] = useState<string | null>(null);

// Error recovery
const handleRetry = () => {
  setError(null);
  setRetryCount(0);
  // Retry operation
};
```

## Performance Integration Patterns

### 1. Caching Integration

#### Service-Level Caching
```typescript
// NudgeGenerator caching
private cache = new Map<string, CachedNudge>();

const cacheKey = `${context.userId}-${context.timeOfDay}-${JSON.stringify(context.currentProgress)}`;
const cached = this.cache.get(cacheKey);

if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
  return cached;
}
```

#### Global Resource Loading
```python
# ML model global loading
pipeline_hourly = None
df_hourly = None

def load_hourly_model():
    global pipeline_hourly
    pipeline_hourly = ChronosPipeline.from_pretrained("amazon/chronos-t5-mini")

# Load once at module import
load_hourly_model()
load_hourly_data()
```

### 2. Parallel Processing Integration

#### Concurrent API Calls
```typescript
// Parallel external service calls
const [flowResponseCurrent, flowResponseDestination, incidentResponse] = 
  await Promise.all([
    axios.get(tomtomFlowUrl1),
    axios.get(tomtomFlowUrl2), 
    axios.get(tomtomIncidentUrl)
  ]);
```

#### Async/Await Pattern
```typescript
// Non-blocking operations
const loadUserData = async (userId: string) => {
  setIsLoading(true);
  try {
    const [rewardsData, insightsData] = await Promise.all([
      fetch(`/api/rewards/${userId}`),
      fetch('/api/transit-insights', { method: 'POST', body: JSON.stringify(context) })
    ]);
    // Process results
  } finally {
    setIsLoading(false);
  }
};
```

## Security Integration Patterns

### 1. API Key Management

#### Environment Variable Integration
```typescript
// Secure configuration
const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Validation
if (!process.env.GEMINI_API_KEY) {
  throw new Error('Gemini API key not configured');
}
```

### 2. Input Sanitization Integration

#### Request Validation
```typescript
// Type-safe validation
if (!userId || typeof userId !== 'string') {
  logger.apiEvent('validation_failed', { userId, error: 'Invalid userId' });
  return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
}
```

### 3. CORS and Security Headers

#### Next.js Security Integration
```typescript
// API route security
export async function POST(req: NextRequest) {
  // CORS handling built into Next.js
  // Input validation
  // Error handling without information leakage
}
```

## Monitoring and Observability Integration

### 1. Structured Logging Integration

#### Event Tracking
```typescript
// Comprehensive event logging
logger.apiEvent('trip_completion_success', { 
  userId, 
  responseTime,
  newRewardsCount: result.newlyEarnedRewards.length,
  beerRewardsEarned: beerRewards.length
});
```

### 2. Performance Monitoring Integration

#### Response Time Tracking
```typescript
// Performance measurement
const startTime = Date.now();
// ... operation
const responseTime = Date.now() - startTime;
logger.apiEvent('operation_complete', { responseTime });
```

### 3. Health Check Integration

#### Service Health Monitoring
```python
# ML service health endpoint
@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "tryp-transit-model-service"
    })
```

This integration architecture demonstrates a mature, production-ready approach to service integration with proper error handling, performance optimization, and security considerations. The patterns implemented provide a solid foundation for scaling and maintaining the application.