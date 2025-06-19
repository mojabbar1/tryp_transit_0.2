import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { departure, destination, timeToDestination }: any = await req.json();

  if (!departure || !destination || !timeToDestination) {
    return NextResponse.json(
      { error: 'Missing required parameters.' },
      { status: 400 },
    );
  }

  try {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate mock response without external APIs
    const mockResponse = {
      travelTime: Math.floor(Math.random() * 30) + 15, // 15-45 minutes
      trafficDensity: ['Light', 'Medium', 'Heavy'][Math.floor(Math.random() * 3)],
      costSavingsPerTrip: `$${(Math.random() * 5 + 2).toFixed(2)}`,
      additionalRides: [
        {
          travelTime: Math.floor(Math.random() * 20) + 10,
          trafficDensity: ['Light', 'Medium', 'Heavy'][Math.floor(Math.random() * 3)]
        },
        {
          travelTime: Math.floor(Math.random() * 25) + 15,
          trafficDensity: ['Light', 'Medium', 'Heavy'][Math.floor(Math.random() * 3)]
        },
        {
          travelTime: Math.floor(Math.random() * 30) + 20,
          trafficDensity: ['Light', 'Medium', 'Heavy'][Math.floor(Math.random() * 3)]
        }
      ]
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: 'Internal Server Error.' },
      { status: 500 },
    );
  }
} 