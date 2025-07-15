# Improved AI Coding Assistant Prompts

Goal is to make this an MVP suitable to demo to investors. MVY will be an API than other apps can call, such as the "Transit" app used in multiple cities, or the app the Chicago CTA uses, Boston's "T" system, or the NYC MTA 

review the included document with context 
then execute the prompts in each of the phases in sequence. for each substep in each phase, execute the prompt, then verify it was done correctly and is functional. then proceed to the next substeps and do the same. 
at the end, append/update the  .md file that descibes the changes made, and include any documentation needed to improve/maintain the app


## Key Improvements Made:

### 1. **Added Context & Prerequisites**
- Included project structure overview
- Added dependency verification steps
- Specified exact file paths and imports needed

### 2. **Enhanced Error Prevention**
- Added backup/rollback instructions
- Included import statements and dependency checks
- Specified exact variable names and function signatures

### 3. **Improved Verification Steps**
- Made testing steps more specific with expected outputs
- Added logging verification
- Included performance measurement suggestions

### 4. **Better Code Examples**
- Fixed potential issues in original code snippets
- Added proper error handling patterns
- Included type safety considerations

---

## **Phase 1: Python Model Service Optimization & Robustness (`model_service/`)**

### **Prompt 1.1: Optimize Model and Data Loading in Flask App**

**Goal:** Prevent reloading of Chronos models and CSV data on every API request to significantly improve performance.

**Prerequisites:**
- Ensure `model_service/` contains the following files: `app.py`, `bus_hourly_chronos_t5_tiny.py`, `bus_daily_chronos_t5_tiny.py`
- Verify these data files exist: `data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv`, `data/MTA_Daily_Ridership_Data__Beginning_2020.csv`
- Confirm required packages are installed: `chronos-forecasting`, `torch`, `pandas`, `flask`

**Instructions for AI Coding Assistant:**

1. **FIRST: Create backup copies of the files you'll modify:**
   ```bash
   cp model_service/bus_hourly_chronos_t5_tiny.py model_service/bus_hourly_chronos_t5_tiny.py.backup
   cp model_service/bus_daily_chronos_t5_tiny.py model_service/bus_daily_chronos_t5_tiny.py.backup
   ```

2. **Modify `model_service/bus_hourly_chronos_t5_tiny.py`:**
   
   **Add these imports at the top if not present:**
## **Phase 1: Python Model Service Optimization & Robustness (`model_service/`)**

### **Prompt 1.1: Optimize Model and Data Loading in Flask App**

**Goal:** Prevent reloading of Chronos models and CSV data on every API request to significantly improve performance.

**Prerequisites:**
- Ensure `model_service/` contains the following files: `app.py`, `bus_hourly_chronos_t5_tiny.py`, `bus_daily_chronos_t5_tiny.py`
- Verify these data files exist: `data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv`, `data/MTA_Daily_Ridership_Data__Beginning_2020.csv`
- Confirm required packages are installed: `chronos-forecasting`, `torch`, `pandas`, `flask`

**Instructions for AI Coding Assistant:**

1. **FIRST: Create backup copies of the files you'll modify:**
   ```bash
   cp model_service/bus_hourly_chronos_t5_tiny.py model_service/bus_hourly_chronos_t5_tiny.py.backup
   cp model_service/bus_daily_chronos_t5_tiny.py model_service/bus_daily_chronos_t5_tiny.py.backup
   ```

2. **Modify `model_service/bus_hourly_chronos_t5_tiny.py`:**
   
   **Add these imports at the top if not present:**
## **Phase 1: Python Model Service Optimization & Robustness (`model_service/`)**

### **Prompt 1.1: Optimize Model and Data Loading in Flask App**

**Goal:** Prevent reloading of Chronos models and CSV data on every API request to significantly improve performance.

**Prerequisites:**
- Ensure `model_service/` contains the following files: `app.py`, `bus_hourly_chronos_t5_tiny.py`, `bus_daily_chronos_t5_tiny.py`
- Verify these data files exist: `data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv`, `data/MTA_Daily_Ridership_Data__Beginning_2020.csv`
- Confirm required packages are installed: `chronos-forecasting`, `torch`, `pandas`, `flask`

**Instructions for AI Coding Assistant:**

1. **FIRST: Create backup copies of the files you'll modify:**
   ```bash
   cp model_service/bus_hourly_chronos_t5_tiny.py model_service/bus_hourly_chronos_t5_tiny.py.backup
   cp model_service/bus_daily_chronos_t5_tiny.py model_service/bus_daily_chronos_t5_tiny.py.backup
   ```

2. **Modify `model_service/bus_hourly_chronos_t5_tiny.py`:**
   
   **Add these imports at the top if not present:**
   ```python
   import pandas as pd
   import torch
   from chronos import ChronosPipeline
   import os
   ```

   **Add global variables at the top of the file (after imports, before any functions):**
   ```python
   # Global model and data loading
   print("Loading hourly Chronos model...")
   pipeline_hourly = ChronosPipeline.from_pretrained(
       "amazon/chronos-t5-mini",  # Note: using t5-mini as specified
       device_map="cpu",  # Change to "cuda" if GPU available
       torch_dtype=torch.bfloat16,
   )
   print("✓ Hourly Chronos model loaded successfully")

   # Load hourly data
   HOURLY_FILE_PATH = 'data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv'
   print(f"Loading hourly data from {HOURLY_FILE_PATH}...")
   
   if not os.path.exists(HOURLY_FILE_PATH):
       raise FileNotFoundError(f"Data file not found: {HOURLY_FILE_PATH}")
   
   df_hourly_raw = pd.read_csv(HOURLY_FILE_PATH)
   df_hourly_raw['transit_timestamp'] = pd.to_datetime(df_hourly_raw['transit_timestamp'])
   
   # Verify the ridership column exists
   if 'ridership' not in df_hourly_raw.columns:
       print(f"Available columns: {df_hourly_raw.columns.tolist()}")
       raise ValueError("'ridership' column not found in hourly data")
   
   hourly_ridership_series = df_hourly_raw['ridership'].dropna()
   print(f"✓ Hourly data loaded: {len(hourly_ridership_series)} records")
   ```

   **Replace the existing `build_df()` function:**
   ```python
   def build_df():
       """Return pre-loaded hourly ridership series."""
       print("Accessing pre-loaded hourly ridership series")
       return hourly_ridership_series
   ```

   **Update the `chronos_forecast` function:**
   - Remove the line that loads the pipeline inside the function
   - Replace `pipeline = ChronosPipeline.from_pretrained(...)` with a comment: `# Using globally loaded pipeline_hourly`
   - Ensure the function uses `pipeline_hourly` instead of `pipeline`

3. **Modify `model_service/bus_daily_chronos_t5_tiny.py`:**
   
   **Apply the same pattern with these specific changes:**
   ```python
   # Global model and data loading  
   print("Loading daily Chronos model...")
   pipeline_daily = ChronosPipeline.from_pretrained(
       "amazon/chronos-t5-mini",
       device_map="cpu",
       torch_dtype=torch.bfloat16,
   )
   print("✓ Daily Chronos model loaded successfully")

   DAILY_FILE_PATH = 'data/MTA_Daily_Ridership_Data__Beginning_2020.csv'
   print(f"Loading daily data from {DAILY_FILE_PATH}...")
   
   if not os.path.exists(DAILY_FILE_PATH):
       raise FileNotFoundError(f"Data file not found: {DAILY_FILE_PATH}")
   
   df_daily_raw = pd.read_csv(DAILY_FILE_PATH)
   # Add appropriate date parsing based on actual column name in your daily data
   daily_ridership_series = df_daily_raw['ridership'].dropna()  # Adjust column name as needed
   print(f"✓ Daily data loaded: {len(daily_ridership_series)} records")
   ```

4. **Verification Steps:**
   ```bash
   # Navigate to model_service directory
   cd model_service
   
   # Start Flask app and watch for loading messages
   FLASK_ENV=development flask run
   
   # You should see the loading messages in the terminal
   # First request (in another terminal):
   time curl "http://localhost:5000/predict/hourly/5"
   
   # Second request (should be much faster):
   time curl "http://localhost:5000/predict/hourly/5"
   
   # Test daily endpoint:
   time curl "http://localhost:5000/predict/daily/7"
   ```

   **Expected Results:**
   - First request: May take 2-5 seconds
   - Subsequent requests: Should take <1 second
   - No model loading messages after the first startup

---

### **Prompt 1.2: Add Structured Error Handling to Flask Routes**

**Goal:** Make the model service API more robust by returning JSON errors instead of HTML tracebacks.

**Instructions for AI Coding Assistant:**

1. **Modify `model_service/app.py`:**

   **Add these imports at the top if not present:**
   ```python
   from flask import Flask, jsonify, request
   import logging
   import traceback
   ```

   **Set up logging:**
   ```python
   # Add after Flask app creation
   logging.basicConfig(level=logging.INFO)
   logger = logging.getLogger(__name__)
   ```

   **Update the hourly prediction route:**
   ```python
   @app.route('/predict/hourly/<int:hours_future>')
   def predict_hourly_ridership(hours_future):
       try:
           logger.info(f"Hourly prediction request for {hours_future} hours")
           result = predict_hourly(hours_future)  # Your existing function call
           return jsonify(result)
       except Exception as e:
           error_msg = f"Hourly prediction failed for {hours_future} hours"
           logger.error(f"{error_msg}: {str(e)}")
           logger.error(traceback.format_exc())
           return jsonify({
               "error": "Hourly prediction failed",
               "details": str(e),
               "hours_requested": hours_future
           }), 500
   ```

   **Update the daily prediction route:**
   ```python
   @app.route('/predict/daily/<int:days_future>')
   def predict_daily_ridership(days_future):
       try:
           logger.info(f"Daily prediction request for {days_future} days")
           result = predict_daily(days_future)  # Your existing function call
           return jsonify(result)
       except Exception as e:
           error_msg = f"Daily prediction failed for {days_future} days"
           logger.error(f"{error_msg}: {str(e)}")
           logger.error(traceback.format_exc())
           return jsonify({
               "error": "Daily prediction failed", 
               "details": str(e),
               "days_requested": days_future
           }), 500
   ```

2. **Verification Steps:**
   ```bash
   # Test normal operation
   curl -i "http://localhost:5000/predict/hourly/5"
   # Should return JSON with Content-Type: application/json
   
   # Test error handling - temporarily break the code
   # In bus_hourly_chronos_t5_tiny.py, change a variable name to cause an error
   # Then test:
   curl -i "http://localhost:5000/predict/hourly/5"
   # Should return JSON error with 500 status, not HTML traceback
   
   # Fix the error and test again
   curl -i "http://localhost:5000/predict/hourly/5"
   # Should work normally again
   ```

---

## **Phase 2: Next.js API Gateway Enhancements (`src/app/api/transit-insights/route.ts`)**

### **Prompt 2.1: Refine Time Logic and Ridership API Call**

**Goal:** Improve robustness of time calculations and conditionally use ridership data.

**Prerequisites:**
- Verify `src/app/api/transit-insights/route.ts` exists
- Confirm `axios` is installed: `npm list axios` in the `src/` directory
- Ensure environment variables are set: `RIDERSHIP_API_BASE_URL`

**Instructions for AI Coding Assistant:**

1. **Modify `src/app/api/transit-insights/route.ts`:**

   **Add these imports at the top if not present:**
   ```typescript
   import axios from 'axios';
   ```

   **Improve the hours calculation logic:**
   ```typescript
   // Find the existing hours_until_destination calculation and replace with:
   const hours_until_destination = Math.max(0, Math.floor(
     (new Date(timeToDestination).getTime() - new Date().getTime()) / (1000 * 60 * 60)
   ));
   
   // Add validation and warning
   if (hours_until_destination > 48) {
     console.warn(`Long prediction horizon: ${hours_until_destination} hours. Accuracy may be reduced.`);
   }
   
   console.log(`Hours until destination: ${hours_until_destination}`);
   ```

   **Improve ridership API call with better error handling:**
   ```typescript
   // Replace the existing ridership API call section with:
   let predictedHourlyRidership: number | null = null;
   
   if (hours_until_destination > 0) {
     try {
       const ridershipApiUrl = `${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5000'}/predict/hourly/${hours_until_destination}`;
       console.log(`Calling ridership API: ${ridershipApiUrl}`);
       
       const ridershipResponse = await axios.get(ridershipApiUrl, {
         timeout: 10000, // 10 second timeout
         headers: {
           'Accept': 'application/json'
         }
       });
       
       // Handle different possible response formats
       if (typeof ridershipResponse.data === 'number') {
         predictedHourlyRidership = ridershipResponse.data;
       } else if (ridershipResponse.data && typeof ridershipResponse.data.prediction === 'number') {
         predictedHourlyRidership = ridershipResponse.data.prediction;
       } else if (Array.isArray(ridershipResponse.data) && ridershipResponse.data.length > 0) {
         predictedHourlyRidership = ridershipResponse.data[0];
       }
       
       console.log(`Ridership prediction: ${predictedHourlyRidership}`);
     } catch (error) {
       console.error('Ridership API call failed:', {
         error: error instanceof Error ? error.message : String(error),
         url: `${process.env.RIDERSHIP_API_BASE_URL}/predict/hourly/${hours_until_destination}`,
         hours: hours_until_destination
       });
       predictedHourlyRidership = null;
     }
   } else {
     console.log('Skipping ridership prediction for immediate departure');
   }
   ```

   **Update the OpenAI prompt construction:**
   ```typescript
   // Build ridership context conditionally
   let ridershipPromptSegment = '';
   if (predictedHourlyRidership !== null && typeof predictedHourlyRidership === 'number') {
     ridershipPromptSegment = ` The predicted bus passenger count around the destination time is approximately ${Math.round(predictedHourlyRidership)} people.`;
   }
   
   // Update your main prompt construction
   const prompt = `Given the following traffic data: ${JSON.stringify(trafficData)}, 
   departure location: ${fromLocation}, 
   destination: ${toLocation}, 
   departure time: ${timeToDestination},${ridershipPromptSegment}
   
   Based on all this information, generate a response with travel insights...`; // Continue with your existing prompt
   ```

2. **Verification Steps:**
   ```bash
   # Test with normal ridership service running
   curl -X POST "http://localhost:3000/api/transit-insights" \
     -H "Content-Type: application/json" \
     -d '{"fromLocation":"123 Main St","toLocation":"456 Oak Ave","timeToDestination":"2024-01-01T15:00:00Z"}'
   
   # Check server logs for ridership API call success
   
   # Test with ridership service stopped
   # Stop the Flask app, then repeat the above curl command
   # Should still work but without ridership data in the prompt
   ```

---

### **Prompt 2.2: Enhanced OpenAI Prompt for "Nudge" Messages & Diverse Incentives**

**Goal:** Make the AI-generated advice more compelling and showcase a variety of potential incentives.

**Instructions for AI Coding Assistant:**

1. **Modify `src/app/api/transit-insights/route.ts`:**

   **Replace the OpenAI prompt section with this enhanced version:**
   ```typescript
   const prompt = `You are a transit optimization assistant. Based on the provided data, generate compelling transit insights.
   
   CONTEXT:
   - Traffic data: ${JSON.stringify(trafficData)}
   - Route: ${fromLocation} → ${toLocation}
   - Departure time: ${timeToDestination}${ridershipPromptSegment}
   
   TASK: Create a JSON response that encourages bus ridership with these exact fields:
   
   {
     "travelTime": (integer, estimated bus travel time in minutes, consider traffic conditions),
     "trafficDensity": (string, exactly one of: "Light", "Medium", "Heavy"),
     "costSavingsPerTrip": (string, estimated USD savings vs driving, like "2.50" or "3.00"),
     "nudgeMessage": (string, compelling 1-2 sentence message highlighting specific benefits. Examples: "Skip the I-95 backup! Take the 3:15 bus and arrive relaxed while others sit in traffic." or "Save 15 minutes and $4 in parking - let someone else do the driving!"),
     "incentiveDetails": {
       "type": (string, exactly one of: "eCredit", "partnerDiscount", "funReward"),
       "description": (string, specific reward description),
       "value": (string, monetary or item value)
     },
     "additionalRides": [
       {
         "departureTime": (string, HH:MM format, optional),
         "travelTime": (integer, minutes),
         "trafficDensity": (string, "Light", "Medium", or "Heavy")
       }
     ]
   }
   
   INCENTIVE GUIDELINES:
   - "eCredit": Offer $0.50-$2.00 credit (e.g., "$1.50 e-credit for your next ride!")
   - "partnerDiscount": Local business discount (e.g., "20% off coffee at downtown cafes!")  
   - "funReward": Engaging reward (e.g., "Free drink token for participating bars!")
   
   Make the nudgeMessage specific to the time, route, and traffic conditions. Focus on tangible benefits: time saved, stress avoided, money saved, convenience gained.
   
   Respond ONLY with valid JSON - no additional text or formatting.`;
   ```

2. **Add response parsing and validation:**
   ```typescript
   // After getting the OpenAI response, add validation:
   try {
     const responseObject = JSON.parse(openaiResponseText);
     
     // Validate required fields
     const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
     const missingFields = requiredFields.filter(field => !(field in responseObject));
     
     if (missingFields.length > 0) {
       console.warn(`OpenAI response missing fields: ${missingFields.join(', ')}`);
     }
     
     // Validate incentive structure
     if (responseObject.incentiveDetails && typeof responseObject.incentiveDetails === 'object') {
       const incentiveFields = ['type', 'description', 'value'];
       const missingIncentiveFields = incentiveFields.filter(field => !(field in responseObject.incentiveDetails));
       if (missingIncentiveFields.length > 0) {
         console.warn(`Incentive details missing fields: ${missingIncentiveFields.join(', ')}`);
       }
     }
     
     return NextResponse.json(responseObject);
   } catch (parseError) {
     console.error('Failed to parse OpenAI response as JSON:', parseError);
     console.error('Raw OpenAI response:', openaiResponseText);
     return NextResponse.json({ error: 'Invalid response format from AI service' }, { status: 500 });
   }
   ```

3. **Verification Steps:**
   ```bash
   # Test multiple times to see variety in responses
   for i in {1..3}; do
     echo "Test $i:"
     curl -X POST "http://localhost:3000/api/transit-insights" \
       -H "Content-Type: application/json" \
       -d '{"fromLocation":"Downtown","toLocation":"Airport","timeToDestination":"2024-01-01T17:00:00Z"}' | jq
     echo "---"
   done
   
   # Verify the response structure matches expectations
   # Check that nudgeMessage is compelling and specific
   # Verify incentiveDetails has all required fields
   # Confirm different incentive types appear across multiple calls
   ```

---

### **Prompt 2.3: Update TypeScript Interfaces**

**Goal:** Ensure type safety for the new API response structure.

**Instructions for AI Coding Assistant:**

1. **Modify or create `src/types/interfaces.ts`:**

   **If the file doesn't exist, create it. Add these interfaces:**
   ```typescript
   export interface IncentiveDetails {
     type: 'eCredit' | 'partnerDiscount' | 'funReward';
     description: string;
     value: string;
   }

   export interface AdditionalRide {
     departureTime?: string; // HH:MM format
     travelTime: number;
     trafficDensity: 'Light' | 'Medium' | 'Heavy';
   }

   export interface TransitInsightResponse {
     travelTime: number | null;
     trafficDensity: 'Light' | 'Medium' | 'Heavy' | null;
     costSavingsPerTrip: string | null;
     nudgeMessage: string | null;
     incentiveDetails: IncentiveDetails | null;
     additionalRides: AdditionalRide[] | null;
   }

   // Form submission interface
   export interface TransitInsightRequest {
     fromLocation: string;
     toLocation: string;
     timeToDestination: string; // ISO string
   }

   // Error response interface
   export interface ApiErrorResponse {
     error: string;
     details?: string;
   }
   ```

2. **Update `src/app/api/transit-insights/route.ts`:**
   ```typescript
   // Add import at the top
   import { TransitInsightRequest, TransitInsightResponse } from '@/types/interfaces';
   
   // Use the interface for request parsing
   export async function POST(request: Request) {
     try {
       const body: TransitInsightRequest = await request.json();
       const { fromLocation, toLocation, timeToDestination } = body;
       
       // Validate required fields
       if (!fromLocation || !toLocation || !timeToDestination) {
         return NextResponse.json(
           { error: 'Missing required fields: fromLocation, toLocation, timeToDestination' }, 
           { status: 400 }
         );
       }
       
       // ... rest of your existing logic
   ```

3. **Update `src/app/page.tsx`:**
   ```typescript
   // Add import at the top
   import { TransitInsightResponse, ApiErrorResponse } from '@/types/interfaces';
   
   // Update state types
   const [data, setData] = useState<TransitInsightResponse | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [isLoading, setIsLoading] = useState<boolean>(false);
   
   // Update the fetch call with proper typing
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
     setIsLoading(true);
     setError(null);
     setData(null);
     
     try {
       const response = await fetch('/api/transit-insights', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           fromLocation,
           toLocation,
           timeToDestination: timeToDestination.toISOString()
         })
       });
       
       if (!response.ok) {
         const errorData: ApiErrorResponse = await response.json();
         throw new Error(errorData.error || `HTTP ${response.status}`);
       }
       
       const result: TransitInsightResponse = await response.json();
       setData(result);
     } catch (err) {
       setError(err instanceof Error ? err.message : 'An unknown error occurred');
     } finally {
       setIsLoading(false);
     }
   };
   ```

4. **Verification:**
   ```bash
   # Check TypeScript compilation
   cd src
   npm run build
   
   # Should pass without type errors
   
   # Test intellisense by opening page.tsx and typing:
   # data. (you should see autocomplete for travelTime, nudgeMessage, etc.)
   
   # Try accessing a non-existent property to verify TypeScript catches it:
   # data.nonExistentField (should show TypeScript error)
   ```

---

## **Phase 3: Frontend Demo UI/UX Improvements (`src/app/page.tsx`)**

### **Prompt 3.1: Display API Results in User-Friendly Way**

**Goal:** Replace raw JSON output with a clear, sectioned display for demo purposes.

**Instructions for AI Coding Assistant:**

1. **Modify `src/app/page.tsx`:**

   **Replace the raw JSON display section with:**
   ```tsx
   {data && (
     <div className="mt-8 max-w-4xl mx-auto">
       <div className="bg-white rounded-lg shadow-lg p-6 border border-gray-200">
         <h2 className="text-3xl font-bold mb-6 text-green-700 text-center">
           🚌 Your Trip Insights
         </h2>

         {/* Nudge Message - Most Prominent */}
         {data.nudgeMessage && (
           <div className="mb-6 p-4 bg-gradient-to-r from-green-100 to-blue-100 border-l-4 border-green-500 rounded-r-lg">
             <div className="flex items-start">
               <div className="text-2xl mr-3">💡</div>
               <div>
                 <h3 className="font-semibold text-lg text-green-800 mb-2">Smart Transit Tip</h3>
                 <p className="text-green-700 text-lg">{data.nudgeMessage}</p>
               </div>
             </div>
           </div>
         )}

         {/* Main Stats Grid */}
         <div className="grid md:grid-cols-3 gap-6 mb-6">
           <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
             <h3 className="font-semibold text-lg text-blue-800 mb-2">⏱️ Travel Time</h3>
             <p className="text-2xl font-bold text-blue-600">
               {data.travelTime !== null ? `${data.travelTime} mins` : 'N/A'}
             </p>
           </div>
           
           <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
             <h3 className="font-semibold text-lg text-yellow-800 mb-2">🚦 Traffic Density</h3>
             <p className="text-2xl font-bold text-yellow-600">
               {data.trafficDensity || 'N/A'}
             </p>
           </div>
           
           <div className="bg-green-50 p-4 rounded-lg border border-green-200">
             <h3 className="font-semibold text-lg text-green-800 mb-2">💰 You Save</h3>
             <p className="text-2xl font-bold text-green-600">
               {data.costSavingsPerTrip ? `$${data.costSavingsPerTrip}` : 'N/A'}
             </p>
           </div>
         </div>

         {/* Incentive Section */}
         {data.incentiveDetails && (
           <div className="mb-6 p-4 bg-gradient-to-r from-purple-100 to-pink-100 border-l-4 border-purple-500 rounded-r-lg">
             <div className="flex items-start">
               <div className="text-2xl mr-3">🎁</div>
               <div>
                 <h3 className="font-semibold text-lg text-purple-800 mb-2">Your Reward</h3>
                 <p className="text-purple-700 text-lg mb-2">{data.incentiveDetails.description}</p>
                 <div className="flex items-center space-x-4 text-sm text-purple-600">
                   <span className="bg-purple-200 px-2 py-1 rounded">
                     Type: {data.incentiveDetails.type}
                   </span>
                   <span className="bg-purple-200 px-2 py-1 rounded">
                     Value: {data.incentiveDetails.value}
                   </span>
                 </div>
               </div>
             </div>
           </div>
         )}

         {/* Alternative Rides */}
         {data.additionalRides && data.additionalRides.length > 0 && (
           <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
             <h3 className="font-semibold text-lg text-gray-800 mb-3 flex items-center">
               🚌 Alternative Options
             </h3>
             <div className="space-y-2">
               {data.additionalRides.map((ride, index) => (
                 <div key={index} className="bg-white p-3 rounded border border-gray-100 flex justify-between items-center">
                   <div>
                     {ride.departureTime && (
                       <span className="text-blue-600 font-semibold mr-4">
                         🕐 {ride.departureTime}
                       </span>
                     )}
                     <span className="text-gray-700">
                       {ride.travelTime} mins travel time
                     </span>
                   </div>
                   <div className={`px-2 py-1 rounded text-sm font-medium ${
                     ride.trafficDensity === 'Light' ? 'bg-green-100 text-green-800' :
                     ride.trafficDensity === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                     'bg-red-100 text-red-800'
                   }`}>
                     {ride.trafficDensity} Traffic
                   </div>
                 </div>
               ))}
             </div>
           </div>
         )}

         {/* Debug Section (Optional - Remove in Production) */}
         <details className="mt-6">
           <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
             Show Raw Data (Debug)
           </summary>
           <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
             {JSON.stringify(data, null, 2)}
           </pre>
         </details>
       </div>
     </div>
   )}
   ```

2. **Verification Steps:**
   ```bash
   # Start the development server
   npm run dev
   
   # Open http://localhost:3000 in browser
   # Submit the form with test data
   # Verify the display shows:
   # - Prominent nudge message with icon
   # - Three-column stats grid
   # - Attractive incentive section
   # - Alternative rides in organized cards
   # - Collapsible debug section
   
   # Test responsive design by resizing browser window
   ```

---

### **Prompt 3.2: Improve Frontend Loading and Error States**

**Goal:** Make the demo frontend more communicative during API calls and on errors.

**Instructions for AI Coding Assistant:**

1. **Modify `src/app/page.tsx`:**

   **Enhance the loading state:**
   ```tsx
   {isLoading && (
     <div className="mt-8 text-center">
       <div className="inline-flex items-center px-6 py-4 bg-blue-50 rounded-lg border border-blue-200">
         <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
         <div>
           <p className="text-xl text-blue-700 font-semibold">Analyzing Your Trip</p>
           <p className="text-blue-600 text-sm mt-1">
             Checking traffic patterns, transit schedules, and calculating savings...
           </p>
         </div>
       </div>
     </div>
   )}
   ```

   **Enhance the error state:**
   ```tsx
   {error && (
     <div className="mt-8 max-w-2xl mx-auto">
       <div className="bg-red-50 border border-red-200 rounded-lg p-6">
         <div className="flex items-start">
           <div className="text-red-400 text-2xl mr-3">⚠️</div>
           <div>
             <h3 className="text-lg font-semibold text-red-800 mb-2">
               Oops! Something went wrong
             </h3>
             <p className="text-red-700 mb-4">
               We couldn't get your transit insights right now. This might be due to:
             </p>
             <ul className="text-red-600 text-sm list-disc list-inside space-y-1 mb-4">
               <li>Temporary service unavailability</li>
               <li>Network connectivity issues</li>
               <li>Invalid location data</li>
             </ul>
             <button 
               onClick={() => setError(null)}
               className="bg-red-100 hover:bg-red-200 text-red-800 px-4 py-2 rounded text-sm transition-colors"
             >
               Try Again
             </button>
             {process.env.NODE_ENV === 'development' && (
               <details className="mt-4">
                 <summary className="text-red-600 text-xs cursor-pointer">Technical Details</summary>
                 <p className="text-red-500 text-xs mt-2 font-mono bg-red-100 p-2 rounded">
                   {error}
                 </p>
               </details>
             )}
           </div>
         </div>
       </div>
     </div>
   )}
   ```

   **Add a retry mechanism to the form submission:**
   ```tsx
   // Update the handleSubmit function to include retry logic
   const [retryCount, setRetryCount] = useState(0);
   const maxRetries = 2;

   const handleSubmit = async (e: React.FormEvent, isRetry = false) => {
     e.preventDefault();
     
     if (!isRetry) {
       setRetryCount(0);
     }
     
     setIsLoading(true);
     setError(null);
     if (!isRetry) setData(null);
     
     try {
       // ... existing fetch logic ...
     } catch (err) {
       const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
       
       if (retryCount < maxRetries && !isRetry) {
         console.log(`Attempt failed, retrying... (${retryCount + 1}/${maxRetries})`);
         setRetryCount(prev => prev + 1);
         setTimeout(() => {
           handleSubmit(e, true);
         }, 1000 * (retryCount + 1)); // Exponential backoff
       } else {
         setError(errorMessage);
       }
     } finally {
       if (retryCount >= maxRetries || isRetry) {
         setIsLoading(false);
       }
     }
   };
   ```

   **Disable the submit button during loading:**
   ```tsx
   <button
     type="submit"
     disabled={isLoading}
     className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
       isLoading
         ? 'bg-gray-400 cursor-not-allowed text-gray-200'
         : 'bg-blue-600 hover:bg-blue-700 text-white'
     }`}
   >
     {isLoading ? 'Analyzing Trip...' : 'Get Transit Insights'}
   </button>
   ```

2. **Verification Steps:**
   ```bash
   # Test loading state
   # Submit form and observe loading animation and text
   
   # Test error state
   # Stop the Next.js API or make the endpoint URL invalid
   # Submit form and observe user-friendly error message
   
   # Test retry mechanism
   # Temporarily cause intermittent failures
   # Observe automatic retry attempts
   
   # Test "Try Again" button
   # Click the button in error state to clear error and allow resubmission
   ```

---

## **Phase 4: Repository Clean-up & Documentation**

### **Prompt 4.1: Repository File Clean-up**

**Goal:** Remove obsolete files from the project root to avoid confusion.

**Prerequisites:**
- Create a backup before deletion: `cp -r . ../project_backup_$(date +%Y%m%d_%H%M%S)`

**Instructions for AI Coding Assistant:**

1. **Safely remove obsolete files from the project ROOT directory:**
   
   **First, verify which files exist:**
   ```bash
   ls -la
   ```

   **Remove these files if they exist in the ROOT directory (NOT in src/ or model_service/):**
   ```bash
   # Remove obsolete Node.js files from root
   rm -f package.json package-lock.json
   
   # Remove old Python scripts
   rm -f bus_commuters_regression.py
   
   # Remove documentation that's no longer relevant
   rm -f TODO.md
   
   # Remove image files
   rm -f "AI for Humanity.png" bus_speed_poster.jpg traffic_jam_cartoon.jpg
   rm -f urban_planning_public_transit.png tryp_app_screenshot.png
   rm -f cheers_beers.png chronos_forecast_plot.png tryp_landing_rewards_page.png
   ```

   **Verify the cleanup:**
   ```bash
   # Confirm essential directories are intact
   ls -la src/ model_service/
   
   # List remaining root files
   ls -la
   ```

   **Create a clean project structure overview:**
   ```bash
   # Create/update README.md with current structure
   cat > README.md << 'EOF'
   # Transit Insights MVP

   A full-stack application that provides AI-powered transit recommendations with ridership predictions and personalized incentives.

   ## Project Structure

   ```
   .
   ├── src/                    # Next.js frontend application
   │   ├── app/               # App router pages and API routes
   │   ├── types/             # TypeScript interfaces
   │   └── components/        # React components (if any)
   ├── model_service/         # Python Flask ML service
   │   ├── app.py            # Flask application
   │   ├── bus_*_chronos*.py # Chronos ML model implementations
   │   └── data/             # CSV data files
   └── README.md             # This file
   ```

   ## Quick Start

   ### 1. Start the ML Service
   ```bash
   cd model_service
   pip install -r requirements.txt  # If requirements.txt exists
   flask run
   ```

   ### 2. Start the Frontend
   ```bash
   cd src
   npm install
   npm run dev
   ```

   ### 3. Configure Environment
   Copy `src/.env.example` to `src/.env.local` and fill in your API keys.

   ## Services
   - **Frontend**: http://localhost:3000
   - **ML API**: http://localhost:5000
   EOF
   ```

2. **Verification:**
   ```bash
   # Confirm cleanup was successful
   echo "Remaining root files:"
   ls -la
   
   # Should only see essential files like:
   # README.md, .git/, .gitignore, src/, model_service/
   
   # Verify subdirectories are intact
   echo "Frontend structure:"
   find src/ -type f -name "*.ts" -o -name "*.tsx" -o -name "*.json" | head -10
   
   echo "Model service structure:"
   find model_service/ -type f -name "*.py" | head -10
   ```

---

### **Prompt 4.2: Create Environment Configuration Files**

**Goal:** Provide templates for necessary environment variables and improve setup documentation.

**Instructions for AI Coding Assistant:**

1. **Create `src/.env.example`:**
   ```bash
   cat > src/.env.example << 'EOF'
   # OpenAI Configuration
   OPENAI_API_KEY="your_openai_api_key_here"

   # TomTom API for traffic data
   NEXT_PUBLIC_TOMTOM_API_KEY="your_tomtom_api_key_here"

   # Ridership Prediction Service
   RIDERSHIP_API_BASE_URL="http://localhost:5000"

   # Optional: Custom model endpoints
   # RIDERSHIP_API_HOURLY_ENDPOINT="/predict/hourly"
   # RIDERSHIP_API_DAILY_ENDPOINT="/predict/daily"

   # Development settings
   # NODE_ENV="development"
   EOF
   ```

2. **Create `model_service/.env.example`:**
   ```bash
   cat > model_service/.env.example << 'EOF'
   # Flask Configuration
   FLASK_ENV="development"
   FLASK_DEBUG="true"

   # Data file paths (relative to model_service directory)
   HOURLY_DATA_FILE="data/MTA_Bus_Hourly_Ridership__Beginning_February_2022_1000.csv"
   DAILY_DATA_FILE="data/MTA_Daily_Ridership_Data__Beginning_2020.csv"

   # Model Configuration
   CHRONOS_MODEL="amazon/chronos-t5-mini"
   TORCH_DEVICE="cpu"  # or "cuda" if GPU available

   # API Configuration
   API_HOST="0.0.0.0"
   API_PORT="5000"
   EOF
   ```

3. **Create `model_service/requirements.txt`:**
   ```bash
   cat > model_service/requirements.txt << 'EOF'
   Flask==2.3.3
   pandas==2.0.3
   torch==2.0.1
   chronos-forecasting==1.0.0
   numpy==1.24.3
   python-dotenv==1.0.0
   gunicorn==21.2.0  # For production deployment
   EOF
   ```

4. **Update the main README.md with setup instructions:**
   ```bash
   cat >> README.md << 'EOF'

   ## Setup Instructions

   ### Prerequisites
   - Node.js 18+ 
   - Python 3.8+
   - OpenAI API key
   - TomTom API key (for traffic data)

   ### Backend Setup (ML Service)
   ```bash
   cd model_service
   
   # Create virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   
   # Install dependencies
   pip install -r requirements.txt
   
   # Copy and configure environment
   cp .env.example .env
   # Edit .env with your preferred settings
   
   # Start the service
   flask run
   ```

   ### Frontend Setup
   ```bash
   cd src
   
   # Install dependencies
   npm install
   
   # Copy and configure environment
   cp .env.example .env.local
   # Edit .env.local with your API keys:
   # - OPENAI_API_KEY: Get from https://platform.openai.com/api-keys
   # - NEXT_PUBLIC_TOMTOM_API_KEY: Get from https://developer.tomtom.com/
   
   # Start development server
   npm run dev
   ```

   ### Verification
   1. ML Service: http://localhost:5000/predict/hourly/5
   2. Frontend: http://localhost:3000
   3. Submit a test trip to verify full integration

   ## Environment Variables

   ### Frontend (`src/.env.local`)
   - `OPENAI_API_KEY`: Required for AI-powered insights
   - `NEXT_PUBLIC_TOMTOM_API_KEY`: Required for traffic data
   - `RIDERSHIP_API_BASE_URL`: ML service URL (default: http://localhost:5000)

   ### Backend (`model_service/.env`)
   - `FLASK_ENV`: development or production
   - `HOURLY_DATA_FILE`: Path to hourly ridership CSV
   - `DAILY_DATA_FILE`: Path to daily ridership CSV
   - `CHRONOS_MODEL`: Hugging Face model identifier
   EOF
   ```

5. **Verification Steps:**
   ```bash
   # Verify environment files exist
   ls -la src/.env.example model_service/.env.example model_service/requirements.txt
   
   # Test that the files are valid
   cd src && node -e "console.log('Frontend env example is readable')"
   cd ../model_service && python -c "print('Backend env example is readable')"
   
   # Verify README.md is comprehensive
   wc -l README.md  # Should be substantial
   
   # Test the setup process from scratch in a new terminal:
   # Follow the README instructions to verify they work
   ```

---

## **Summary of Key Improvements Made:**

### **1. Safety & Robustness**
- Added backup instructions before making changes
- Included proper error handling and logging
- Added input validation and file existence checks
- Provided rollback strategies

### **2. Clarity & Specificity**
- Specified exact file paths and imports needed
- Included complete code snippets rather than partial examples
- Added verification steps with expected outputs
- Clarified which directories to work in

### **3. Error Prevention**
- Fixed potential issues in original code (missing imports, incorrect variable names)
- Added timeout configurations for API calls
- Implemented proper TypeScript typing
- Included environment variable validation

### **4. Better Testing**
- Added specific curl commands for API testing
- Included performance measurement suggestions
- Provided multiple test scenarios (success, failure, edge cases)
- Added debugging sections for development

### **5. Production Readiness**
- Added requirements.txt for Python dependencies
- Created comprehensive environment variable documentation
- Included deployment considerations (gunicorn, environment settings)
- Added proper project structure documentation

### **6. User Experience**
- Enhanced UI with better visual hierarchy and icons
- Added responsive design considerations
- Improved loading states with progress indicators
- Created more informative error messages

These improvements make the prompts much more actionable for an AI coding assistant while reducing the likelihood of errors and improving the overall development experience.