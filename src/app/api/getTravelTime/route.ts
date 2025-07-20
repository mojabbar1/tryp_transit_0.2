import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { RequestBody } from '@/types/interfaces';
import { convertToUTC } from '@/lib/convertToUTC';

const useGemini = process.env.USE_GEMINI === 'true';

const openai = useGemini ? null : new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = useGemini ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY!) : null;

const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;

export async function POST(req: NextRequest) {
  const { departure, destination, timeToDestination }: RequestBody =
    await req.json();

  if (!departure || !destination || !timeToDestination) {
    return NextResponse.json(
      { error: 'Missing required parameters.' },
      { status: 400 },
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

  try {
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

    const trafficData: any = {
      flow: {
        current: flowResponseCurrent.data,
        destination: flowResponseDestination.data,
      },
      incidents: incidentResponse.data,
    };

    const utcTime = convertToUTC(timeToDestination);

    const prompt = `Given the following traffic data: ${JSON.stringify(
      trafficData,
    )}, and current location: ${JSON.stringify(
      departure,
    )}, destination: ${JSON.stringify(
      destination,
    )}, and destination time: ${utcTime}, what is the estimated travel time from the current location to the destination in minutes? Also, estimate the current traffic density based on the flow and incidents data I want the traffic density categorizeed as either Light, Medium, or Heavy. Also, can you make an estimate of how many US dollars (in the format 1.20 is $1.20) are saved for one trip by riding the bus versus driving btaking into account gas prices and distance from ${departure} to ${destination}. Also cound you send an array of length 3 containing rides with similiar values for traffic density but higher density and travel times but slower and I want them to be considered runner up rides. I want the rides inside the array to include a "travelTime" and a "trafficDensity". Please return the response as JSON with "travelTime", "trafficDensity", "costSavingsPerTrip", and "additionalRides" fields only.`;

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

    try {
      console.log('Attempting to parse JSON response:', result);
      const responseObject = JSON.parse(result);
      console.log('Successfully parsed JSON response');
      
      return NextResponse.json(responseObject);
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
            const parsedJson = JSON.parse(extractedJson);
            return NextResponse.json(parsedJson);
          }
        } catch (extractError) {
          console.error('Failed to extract JSON from markdown:', extractError);
        }
      }
      
      return NextResponse.json(
        { error: 'Invalid response format from AI service', rawResponse: result.substring(0, 500) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Internal Server Error.' },
      { status: 500 },
    );
  }
}
