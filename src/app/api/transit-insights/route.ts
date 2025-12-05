/**
 * Transit Insights API Route
 * 
 * Main endpoint for getting transit recommendations with AI-powered insights.
 * Supports both Gemini and OpenAI as AI providers (toggle via USE_GEMINI env var).
 */

import { NextRequest, NextResponse } from 'next/server';
import { RequestBody, TransitInsightResponse, ApiErrorResponse } from '@/types/interfaces';
import { convertToUTC } from '@/lib/convertToUTC';
import { getTrafficData } from '@/lib/api/tomtom';
import { getPredictedRidership } from '@/lib/api/ridership';
import { callGemini, parseJsonResponse } from '@/lib/api/gemini';
import { callOpenAI } from '@/lib/api/openai';

// Toggle between AI providers via environment variable
const useGemini = process.env.USE_GEMINI === 'true';

/**
 * Calculate hours until destination time
 */
function calculateHoursUntilDestination(timeToDestination: string): number {
  const [hours, minutes] = timeToDestination.split(':').map(Number);
  const now = new Date();
  const destinationTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes
  );

  // If time is in the past, roll forward a day
  if (destinationTime <= now) {
    destinationTime.setDate(destinationTime.getDate() + 1);
  }

  const hoursUntil = Math.max(0, Math.floor(
    (destinationTime.getTime() - now.getTime()) / (1000 * 60 * 60)
  ));

  if (hoursUntil > 48) {
    console.warn(`Long prediction horizon: ${hoursUntil} hours. Accuracy may be reduced.`);
  }

  return hoursUntil;
}

/**
 * Build the AI prompt for transit insights
 */
function buildPrompt(
  trafficData: unknown,
  departure: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  timeToDestination: string,
  predictedRidership: number | null
): string {
  const ridershipSegment = predictedRidership !== null
    ? ` The predicted bus passenger count around the destination time is approximately ${Math.round(predictedRidership)} people.`
    : '';

  return `You are a transit optimization assistant. Based on the provided data, generate compelling transit insights.

CONTEXT:
- Traffic data: ${JSON.stringify(trafficData)}
- Route: ${JSON.stringify(departure)} → ${JSON.stringify(destination)}
- Departure time: ${timeToDestination}${ridershipSegment}

TASK: Create a JSON response that encourages bus ridership with these exact fields:

{
  "travelTime": (integer, estimated bus travel time in minutes, consider traffic conditions),
  "trafficDensity": (string, exactly one of: "Light", "Medium", "Heavy"),
  "costSavingsPerTrip": (string, estimated USD savings vs driving, like "2.50" or "3.00"),
  "nudgeMessage": (string, compelling 1-2 sentence message highlighting specific benefits. Examples: "Skip the traffic jam! Take the bus and arrive relaxed while others sit in traffic." or "Save 15 minutes and $4 in parking - let someone else do the driving!"),
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
}

/**
 * Create a fallback response when AI parsing fails
 */
function createFallbackResponse(): TransitInsightResponse {
  return {
    travelTime: 30,
    trafficDensity: 'Medium',
    costSavingsPerTrip: '2.50',
    nudgeMessage: 'Take the bus to save money and reduce traffic congestion.',
    incentiveDetails: {
      type: 'eCredit',
      description: 'Credit for your next ride',
      value: '1.00',
    },
    additionalRides: [
      {
        travelTime: 35,
        trafficDensity: 'Medium',
      },
    ],
  };
}

/**
 * Validate the AI response has required fields
 */
function validateResponse(response: TransitInsightResponse): void {
  const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
  const missingFields = requiredFields.filter(field => !(field in response));

  if (missingFields.length > 0) {
    console.warn(`AI response missing fields: ${missingFields.join(', ')}`);
  }

  if (response.incentiveDetails && typeof response.incentiveDetails === 'object') {
    const incentiveFields = ['type', 'description', 'value'];
    const missingIncentiveFields = incentiveFields.filter(
      field => !(field in response.incentiveDetails!)
    );
    if (missingIncentiveFields.length > 0) {
      console.warn(`Incentive details missing fields: ${missingIncentiveFields.join(', ')}`);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { departure, destination, timeToDestination } = body;

    // Validate required fields
    if (!departure || !destination || !timeToDestination) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Missing required fields: departure, destination, timeToDestination' },
        { status: 400 }
      );
    }

    // Get traffic data from TomTom
    const trafficData = await getTrafficData(departure, destination);

    // Calculate hours until destination for ridership prediction
    const hoursUntilDestination = calculateHoursUntilDestination(timeToDestination);
    console.log(`Hours until destination: ${hoursUntilDestination}`);

    // Get ridership prediction from Python service
    const predictedRidership = await getPredictedRidership(hoursUntilDestination);

    // Build AI prompt
    const fullTrafficData = {
      ...trafficData,
      ridership: { predictedHourly: predictedRidership },
    };

    const prompt = buildPrompt(
      fullTrafficData,
      departure,
      destination,
      timeToDestination,
      predictedRidership
    );

    // Call AI provider (Gemini or OpenAI based on env var)
    console.log('Using Gemini:', useGemini);
    let rawResponse: string;

    if (useGemini) {
      console.log('Gemini API Key exists:', !!process.env.GEMINI_API_KEY);
      rawResponse = await callGemini(prompt);
    } else {
      console.log('OpenAI API Key exists:', !!process.env.OPENAI_API_KEY);
      rawResponse = await callOpenAI(prompt);
    }

    console.log('Raw AI response:', rawResponse);

    // Parse and validate response
    try {
      const responseObject = parseJsonResponse<TransitInsightResponse>(rawResponse);
      validateResponse(responseObject);
      return NextResponse.json<TransitInsightResponse>(responseObject);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.log('Using fallback response');
      return NextResponse.json<TransitInsightResponse>(createFallbackResponse());
    }
  } catch (error) {
    console.error('Transit insights API error:', error);
    return NextResponse.json<ApiErrorResponse>(
      { 
        error: 'Internal Server Error.', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}
