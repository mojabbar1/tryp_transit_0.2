import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RequestBody, TransitInsightResponse, ApiErrorResponse } from '@/types/interfaces';
import { convertToUTC } from '@/lib/convertToUTC';

const useGemini = process.env.USE_GEMINI === 'true';

const openai = useGemini ? null : new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = useGemini ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY!) : null;

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

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

    const departureLatitude = departure.lat;
    const departureLongitude = departure.lng;
    const destinationLatitude = destination.lat;
    const destinationLongitude = destination.lng;

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
      console.warn(`Long prediction horizon: ${hours_until_destination} hours. Accuracy may be reduced.`);
    }
    
    console.log(`Hours until destination: ${hours_until_destination}`);

    const flowResponseCurrent = await axios.get(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`,
      {
        params: {
          key: TOMTOM_API_KEY,
          point: `${departureLatitude},${departureLongitude}`,
        },
      },
    );

    const flowResponseDestination = await axios.get(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`,
      {
        params: {
          key: TOMTOM_API_KEY,
          point: `${destinationLatitude},${destinationLongitude}`,
        },
      },
    );

    const incidentResponse = await axios.get(
      `https://api.tomtom.com/traffic/services/5/incidentDetails`,
      {
        params: {
          key: TOMTOM_API_KEY,
          bbox: bbox,
          fields:
            '{incidents{type,geometry{type,coordinates},properties{iconCategory}}}',
          language: 'en-GB',
          timeValidityFilter: 'present',
        },
      },
    );

    // Improved ridership API call with better error handling
    let predictedHourlyRidership: number | null = null;
    
    if (hours_until_destination > 0) {
      try {
        const ridershipApiUrl = `${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001'}/predict/hourly/${hours_until_destination}`;
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
          url: `${process.env.RIDERSHIP_API_BASE_URL || 'http://localhost:5001'}/predict/hourly/${hours_until_destination}`,
          hours: hours_until_destination
        });
        predictedHourlyRidership = null;
      }
    } else {
      console.log('Skipping ridership prediction for immediate departure');
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

    // Enhanced OpenAI prompt for nudge messages and diverse incentives
    const prompt = `You are a transit optimization assistant. Based on the provided data, generate compelling transit insights.

CONTEXT:
- Traffic data: ${JSON.stringify(trafficData)}
- Route: ${JSON.stringify(departure)} → ${JSON.stringify(destination)}
- Departure time: ${timeToDestination}${ridershipPromptSegment}

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

    let result = '';
    
    console.log('Using Gemini:', useGemini);
    console.log('Gemini API Key exists:', !!process.env.GEMINI_API_KEY);
    
    if (useGemini) {
      try {
        console.log('Initializing Gemini model...');
        const model = genAI!.getGenerativeModel({ 
          model: 'gemini-1.5-flash',
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 2048,
          }
        });
        
        console.log('Calling Gemini API...');
        // Add explicit instructions to return only JSON
        const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON without any markdown formatting, explanations, or code blocks. The response should be parseable directly with JSON.parse().`;
        
        const response = await model.generateContent(enhancedPrompt);
        console.log('Gemini API response received');
        result = response.response.text();
        console.log('Raw Gemini response:', result);
      } catch (error) {
        console.error('Gemini API error:', error);
        throw error;
      }
    } else {
      console.log('Using OpenAI...');
      const stream = await openai!.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      });

      for await (const chunk of stream) {
        result += chunk.choices[0]?.delta?.content || '';
      }
    }

    // Enhanced response parsing and validation
    try {
      console.log('Attempting to parse JSON response:', result);
      const responseObject = JSON.parse(result) as TransitInsightResponse;
      console.log('Successfully parsed JSON response');
      
      // Validate required fields
      const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
      const missingFields = requiredFields.filter(field => !(field in responseObject));
      
      if (missingFields.length > 0) {
        console.warn(`AI response missing fields: ${missingFields.join(', ')}`);
      }
      
      // Validate incentive structure
      if (responseObject.incentiveDetails && typeof responseObject.incentiveDetails === 'object') {
        const incentiveFields = ['type', 'description', 'value'];
        const missingIncentiveFields = incentiveFields.filter(field => !(field in responseObject.incentiveDetails!));
        if (missingIncentiveFields.length > 0) {
          console.warn(`Incentive details missing fields: ${missingIncentiveFields.join(', ')}`);
        }
      }
      
      return NextResponse.json<TransitInsightResponse>(responseObject);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.error('Raw AI response:', result);
      
      // Attempt to extract JSON from the response if it contains markdown code blocks
      if (result.includes('```json') && result.includes('```')) {
        try {
          console.log('Attempting to extract JSON from markdown code block');
          const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            const extractedJson = jsonMatch[1].trim();
            console.log('Extracted JSON from markdown:', extractedJson);
            const parsedJson = JSON.parse(extractedJson) as TransitInsightResponse;
            
            // Validate required fields in extracted JSON
            const requiredFields = ['travelTime', 'trafficDensity', 'costSavingsPerTrip', 'nudgeMessage', 'incentiveDetails'];
            const missingFields = requiredFields.filter(field => !(field in parsedJson));
            
            if (missingFields.length > 0) {
              console.warn(`Extracted JSON missing fields: ${missingFields.join(', ')}`);
            }
            
            return NextResponse.json<TransitInsightResponse>(parsedJson);
          }
        } catch (extractError) {
          console.error('Failed to extract JSON from markdown:', extractError);
        }
      }
      
      // If we can't parse the JSON, try to create a minimal valid response
      try {
        console.log('Attempting to create a fallback response');
        // Create a minimal valid response with default values
        const fallbackResponse: TransitInsightResponse = {
          travelTime: 30, // Default travel time in minutes
          trafficDensity: "Medium",
          costSavingsPerTrip: "2.50",
          nudgeMessage: "Take the bus to save money and reduce traffic congestion.",
          incentiveDetails: {
            type: "eCredit",
            description: "Credit for your next ride",
            value: "1.00"
          },
          additionalRides: [
            {
              travelTime: 35,
              trafficDensity: "Medium"
            }
          ]
        };
        
        return NextResponse.json<TransitInsightResponse>(fallbackResponse);
      } catch (fallbackError) {
        console.error('Failed to create fallback response:', fallbackError);
        return NextResponse.json<ApiErrorResponse>(
          { error: 'Invalid response format from AI service', details: result.substring(0, 500) }, 
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error('Transit insights API error:', error);
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Internal Server Error.', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
