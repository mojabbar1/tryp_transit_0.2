import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger'
import { aiClient } from '@/lib/aiClient';
import { RequestBody, TransitInsightResponse, ApiErrorResponse } from '@/types/interfaces';
import { transitInsightsSchema } from '@/lib/schemas/transitInsights';
import { runPreflight, TOMTOM_API_KEY, DEMO_MODE } from '@/lib/config'
import { convertToUTC } from '@/lib/convertToUTC';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';

export async function POST(req: NextRequest) {
  let routeLabelForCatch: string | null = null
  try {
    // Preflight on first request (simple static flag)
    // Note: In serverless, consider a more robust cache
    ;(global as any).__preflightRun = (global as any).__preflightRun || false
    if (!(global as any).__preflightRun) {
      const pre = runPreflight()
      if (!pre.success) {
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('preflight_failed_nonprod_continue', { message: pre.message })
        } else {
          logger.error('preflight_failed', { message: pre.message })
          return NextResponse.json({ error: 'System configuration error' }, { status: 500 })
        }
      } else {
        logger.info('preflight_passed', { message: pre.message })
      }
      ;(global as any).__preflightRun = true
    }
    const body: RequestBody = await req.json();
    const { departure, destination, timeToDestination } = body;

    // Validate required fields
    if (!departure || !destination || !timeToDestination) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Missing required fields: departure, destination, timeToDestination' },
        { status: 400 }
      );
    }

    const departureLatitude = departure.lat;
    const departureLongitude = departure.lng;
    const destinationLatitude = destination.lat;
    const destinationLongitude = destination.lng;

    // Find nearest named stops (best-effort) to make messages feel specific
    const nearestStopName = (lat: number, lng: number): string | null => {
      let nearest: string | null = null
      let minDist = Number.POSITIVE_INFINITY
      for (const [name, coords] of Object.entries(busStopCoordinates)) {
        const d = Math.hypot((coords.lat - lat), (coords.lng - lng))
        if (d < minDist) { minDist = d; nearest = name }
      }
      // Rough threshold so we do not claim mismatched locations (~1km)
      return minDist < 0.01 ? nearest : null
    }
    const fromName = nearestStopName(departureLatitude, departureLongitude)
    const toName = nearestStopName(destinationLatitude, destinationLongitude)
    const routeLabel = fromName && toName
      ? `${fromName} → ${toName}`
      : `${departureLatitude.toFixed(3)},${departureLongitude.toFixed(3)} → ${destinationLatitude.toFixed(3)},${destinationLongitude.toFixed(3)}`
    routeLabelForCatch = routeLabel

    const bbox = `${Math.min(departureLatitude!, destinationLatitude)},${Math.min(
      departureLongitude,
      destinationLongitude,
    )},${Math.max(departureLatitude, destinationLatitude)},${Math.max(
      departureLongitude,
      destinationLongitude,
    )}`;

    // Parse timeToDestination (HH:MM) → JS Date
    const [hours, minutes] = timeToDestination.split(':').map(Number);
    const now = new Date();
    const destinationTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
    );

    // If time is in the past, roll it forward a day
    if (destinationTime <= now) {
      destinationTime.setDate(destinationTime.getDate() + 1);
    }

    // Improved hours calculation logic with validation
    const hours_until_destination = Math.max(0, Math.floor(
      (destinationTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    ));
    
    // Add validation and warning
    if (hours_until_destination > 48) {
      logger.warn('long_prediction_horizon', { hours_until_destination });
    }
    
    logger.info('hours_until_destination', { hours_until_destination });

    // If demo mode is enabled, return a deterministic response immediately
    if (DEMO_MODE) {
      const demoResponse: TransitInsightResponse = {
        travelTime: 28,
        trafficDensity: 'Medium',
        costSavingsPerTrip: '3.00',
        nudgeMessage: 'Beat the traffic and save a few bucks—take the bus and arrive relaxed!',
        incentiveDetails: {
          type: 'eCredit',
          description: 'Automatic $1.00 credit on your next ride',
          value: '1.00',
        },
        additionalRides: [
          { travelTime: 26, trafficDensity: 'Light' },
          { travelTime: 32, trafficDensity: 'Medium' }
        ],
      }
      return NextResponse.json<TransitInsightResponse>(demoResponse)
    }

    let flowResponseCurrent: any = { data: { flowSegmentData: { currentSpeed: null } } }
    let flowResponseDestination: any = { data: { flowSegmentData: { currentSpeed: null } } }
    let incidentResponse: any = { data: { incidents: [] } }

    if (!TOMTOM_API_KEY) {
      logger.warn('tomtom_key_missing', { note: 'Proceeding with defaults', demoMode: DEMO_MODE })
    } else {
      const requests = [
        axios.get(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`, {
          params: { key: TOMTOM_API_KEY, point: `${departureLatitude},${departureLongitude}` },
          timeout: 5000,
        }),
        axios.get(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`, {
          params: { key: TOMTOM_API_KEY, point: `${destinationLatitude},${destinationLongitude}` },
          timeout: 5000,
        }),
        axios.get(`https://api.tomtom.com/traffic/services/5/incidentDetails`, {
          params: {
            key: TOMTOM_API_KEY,
            bbox: bbox,
            fields: '{incidents{type,geometry{type,coordinates},properties{iconCategory}}}',
            language: 'en-GB',
            timeValidityFilter: 'present',
          },
          timeout: 5000,
        }),
      ]
      const [flowCurRes, flowDestRes, incidentRes] = await Promise.allSettled(requests)
      if (flowCurRes.status === 'fulfilled') flowResponseCurrent = flowCurRes.value
      else logger.warn('tomtom_flow_current_failed', { error: (flowCurRes as any).reason?.message || String((flowCurRes as any).reason) })
      if (flowDestRes.status === 'fulfilled') flowResponseDestination = flowDestRes.value
      else logger.warn('tomtom_flow_destination_failed', { error: (flowDestRes as any).reason?.message || String((flowDestRes as any).reason) })
      if (incidentRes.status === 'fulfilled') incidentResponse = incidentRes.value
      else logger.warn('tomtom_incidents_failed', { error: (incidentRes as any).reason?.message || String((incidentRes as any).reason) })
    }

    // Improved ridership API call with better error handling
    let predictedHourlyRidership: number | null = null;
    
    if (hours_until_destination > 0) {
      try {
        const ridershipApiUrl = `${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001'}/predict/hourly/${hours_until_destination}`;
        logger.apiEvent('ridership_api_call', { url: ridershipApiUrl });
        
        const ridershipResponse = await axios.get(ridershipApiUrl, {
          timeout: 3000,
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
        
        logger.apiEvent('ridership_prediction', { predictedHourlyRidership });
      } catch (error) {
        logger.error('ridership_api_failed', { error: error instanceof Error ? error.message : String(error), url: `${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001'}/predict/hourly/${hours_until_destination}`, hours: hours_until_destination });
        predictedHourlyRidership = null;
      }
    } else {
      logger.info('ridership_skip_immediate_departure');
    }

    const trafficData: any = {
      flow: {
        current: flowResponseCurrent.data,
        destination: flowResponseDestination.data,
      },
      incidents: incidentResponse.data,
      ridership: { predictedHourly: predictedHourlyRidership },
    };

    const utcTime = convertToUTC(timeToDestination);

    // Build ridership context conditionally
    let ridershipPromptSegment = '';
    if (predictedHourlyRidership !== null && typeof predictedHourlyRidership === 'number') {
      ridershipPromptSegment = ` The predicted bus passenger count around the destination time is approximately ${Math.round(predictedHourlyRidership)} people.`;
    }

    // Enhanced prompt: require specificity and persuasive framing
    const prompt = `You are a transit optimization assistant. Based on the provided data, generate compelling, specific transit insights for this exact trip.

CONTEXT:
- Traffic data: ${JSON.stringify(trafficData)}
- Route: ${routeLabel}
- Departure time: ${timeToDestination}${ridershipPromptSegment}

TASK: Create a JSON response that encourages bus ridership with these exact fields:

{
  "travelTime": (integer, estimated bus travel time in minutes, consider traffic conditions),
  "trafficDensity": (string, exactly one of: "Light", "Medium", "Heavy"),
  "costSavingsPerTrip": (string, estimated USD savings vs driving, like "2.50" or "3.00"),
  "nudgeMessage": (string, 1-2 sentences. Be SPECIFIC: reference the route label "${routeLabel}", the trafficDensity you selected, the approximate travelTime and costSavingsPerTrip. Use behavioral psychology: loss aversion ("don’t lose $X or Y minutes in traffic"), scarcity/urgency ("leave by HH:MM" if helpful), and social proof ("many riders choose this corridor"). If ridership is low, reference comfort ("less crowded"); if heavy, emphasize reliability/savings.),
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

    let result: string
    try {
      result = await aiClient.generateTextJSON(prompt, { timeoutMs: 6000 });
    } catch (aiError) {
      logger.error('ai_call_failed', { error: aiError instanceof Error ? aiError.message : String(aiError) })
      const fallbackResponse: TransitInsightResponse = {
        travelTime: 28,
        trafficDensity: flowResponseCurrent?.data?.flowSegmentData?.currentSpeed ? 'Medium' : 'Light',
        costSavingsPerTrip: '3.00',
        nudgeMessage: `Skip delays on ${routeLabel}: bus is ~28 mins and saves about $3 today. Arrive relaxed and avoid parking hassle.`,
        incentiveDetails: {
          type: 'eCredit',
          description: 'Automatic $1.00 credit on your next ride',
          value: '1.00'
        },
        additionalRides: [
          { travelTime: 26, trafficDensity: 'Light' },
          { travelTime: 32, trafficDensity: 'Medium' }
        ]
      };
      return NextResponse.json<TransitInsightResponse>(fallbackResponse);
    }

    // Enhanced response parsing and validation
    try {
      logger.apiEvent('ai_response_received');
      const responseObject = JSON.parse(result) as TransitInsightResponse;
      try {
        // Best-effort validation if provider returns extended fields
        transitInsightsSchema.parse(responseObject)
      } catch (e) {
        logger.warn('ai_response_schema_mismatch', { error: (e as Error).message })
      }
      logger.apiEvent('ai_response_parsed');
      
      // Validate required fields
      const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
      const missingFields = requiredFields.filter(field => !(field in responseObject));
      
      if (missingFields.length > 0) {
        logger.warn('ai_response_missing_fields', { missingFields });
      }
      
      // Validate incentive structure
      if (responseObject.incentiveDetails && typeof responseObject.incentiveDetails === 'object') {
        const incentiveFields = ['type', 'description', 'value'];
        const missingIncentiveFields = incentiveFields.filter(field => !(field in responseObject.incentiveDetails!));
        if (missingIncentiveFields.length > 0) {
          logger.warn('ai_response_incentive_missing_fields', { missingIncentiveFields });
        }
      }
      
      // Compose behavior-based persuasive message (overrides generic LLM copy)
      try {
        const tt = responseObject.travelTime ?? 28
        const cs = responseObject.costSavingsPerTrip ?? '3.00'
        const td = (responseObject.trafficDensity ?? 'Medium') as 'Light'|'Medium'|'Heavy'
        const savingsNum = parseFloat(cs)
        const savingsText = isNaN(savingsNum) ? 'avoid parking costs' : `save ~$${savingsNum.toFixed(0)}`
        const lead = `${routeLabel || 'This route'}: `
        let msg: string
        if (td === 'Heavy') {
          msg = `${lead}traffic Heavy. Bus is ~${tt} mins — don’t lose time in jams; ${savingsText}. Leave now to arrive relaxed.`
        } else if (td === 'Light') {
          const crowd = (typeof predictedHourlyRidership === 'number' && predictedHourlyRidership < 20) ? ' (more seats likely)' : ''
          msg = `${lead}traffic Light${crowd}. Bus is ~${tt} mins; ${savingsText}. Ride now for a calmer trip.`
        } else {
          const proof = (typeof predictedHourlyRidership === 'number' && predictedHourlyRidership >= 40) ? ' Popular corridor — skip parking hassle.' : ''
          msg = `${lead}bus is ~${tt} mins; traffic ${td}. ${savingsText}.${proof ? ' ' + proof : ''}`
        }
        responseObject.nudgeMessage = msg
      } catch { /* ignore post-process errors */ }
      return NextResponse.json<TransitInsightResponse>(responseObject);
    } catch (parseError) {
      logger.error('ai_response_parse_error', { error: parseError instanceof Error ? parseError.message : String(parseError) });
      
      // Attempt to extract JSON from the response if it contains markdown code blocks
      if (result.includes('```json') && result.includes('```')) {
        try {
          logger.info('ai_response_extracting_markdown_json');
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            const extractedJson = jsonMatch[1].trim();
            logger.info('ai_response_markdown_json_extracted');
            const parsedJson = JSON.parse(extractedJson) as TransitInsightResponse;
            
            // Validate required fields in extracted JSON
            const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
            const missingFields = requiredFields.filter(field => !(field in parsedJson));
            
            if (missingFields.length > 0) {
              logger.warn('ai_response_extracted_missing_fields', { missingFields });
            }
            
            // Compose behavior-based persuasive message on extracted JSON
            const tt = (parsedJson as any).travelTime ?? 28
            const cs = (parsedJson as any).costSavingsPerTrip ?? '3.00'
            const td = ((parsedJson as any).trafficDensity ?? 'Medium') as 'Light'|'Medium'|'Heavy'
            const savingsNum = parseFloat(cs)
            const savingsText = isNaN(savingsNum) ? 'avoid parking costs' : `save ~$${savingsNum.toFixed(0)}`
            const lead = `${routeLabel || 'This route'}: `
            let msg: string
            if (td === 'Heavy') {
              msg = `${lead}traffic Heavy. Bus is ~${tt} mins — don’t lose time in jams; ${savingsText}. Leave now to arrive relaxed.`
            } else if (td === 'Light') {
              const crowd = (typeof predictedHourlyRidership === 'number' && predictedHourlyRidership < 20) ? ' (more seats likely)' : ''
              msg = `${lead}traffic Light${crowd}. Bus is ~${tt} mins; ${savingsText}. Ride now for a calmer trip.`
            } else {
              const proof = (typeof predictedHourlyRidership === 'number' && predictedHourlyRidership >= 40) ? ' Popular corridor — skip parking hassle.' : ''
              msg = `${lead}bus is ~${tt} mins; traffic ${td}. ${savingsText}.${proof ? ' ' + proof : ''}`
            }
            (parsedJson as any).nudgeMessage = msg
            return NextResponse.json<TransitInsightResponse>(parsedJson);
          }
        } catch (extractError) {
          logger.error('ai_response_extract_markdown_failed', { error: extractError instanceof Error ? extractError.message : String(extractError) });
        }
      }
      
      // If we can't parse the JSON, try to create a minimal valid response
      try {
        logger.info('ai_response_creating_fallback');
        // Create a specific deterministic response
        const fallbackResponse: TransitInsightResponse = {
          travelTime: 28,
          trafficDensity: flowResponseCurrent?.data?.flowSegmentData?.currentSpeed ? 'Medium' : 'Light',
          costSavingsPerTrip: '3.00',
          nudgeMessage: `${routeLabel}: bus is ~28 mins; traffic ${flowResponseCurrent?.data?.flowSegmentData?.currentSpeed ? 'building' : 'light'}. Save ~$3 and skip parking stress—leave now to arrive relaxed.`,
          incentiveDetails: {
            type: 'eCredit',
            description: 'Automatic $1.00 credit on your next ride',
            value: '1.00'
          },
          additionalRides: [
            { travelTime: 26, trafficDensity: 'Light' },
            { travelTime: 32, trafficDensity: 'Medium' }
          ]
        };
        
        return NextResponse.json<TransitInsightResponse>(fallbackResponse);
      } catch (fallbackError) {
        logger.error('ai_response_fallback_failed', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
        return NextResponse.json<ApiErrorResponse>(
          { error: 'Invalid response format from AI service', details: result.substring(0, 500) }, 
          { status: 500 }
        );
      }
    }
  } catch (error) {
    logger.error('transit_insights_api_error', { error: error instanceof Error ? error.message : String(error) });
    // Specific deterministic fallback even if an unexpected error occurred
    const fallbackResponse: TransitInsightResponse = {
      travelTime: 28,
      trafficDensity: 'Medium',
      costSavingsPerTrip: '3.00',
      nudgeMessage: `${routeLabelForCatch || 'This route'}: bus is ~28 mins; traffic Medium. Save ~$3 and skip parking stress—leave now to arrive relaxed.`,
      incentiveDetails: {
        type: 'eCredit',
        description: 'Automatic $1.00 credit on your next ride',
        value: '1.00'
      },
      additionalRides: [
        { travelTime: 26, trafficDensity: 'Light' },
        { travelTime: 32, trafficDensity: 'Medium' }
      ]
    };
    return NextResponse.json<TransitInsightResponse>(fallbackResponse);
  }
}
