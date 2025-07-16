import { NextRequest, NextResponse } from 'next/server';
import { TransitInsightResponse } from '@/types/interfaces';

// Demo scenarios with deterministic responses for consistent investor demos
const demoScenarios: Record<string, TransitInsightResponse> = {
  'rush-hour': {
    travelTime: 22,
    trafficDensity: 'Heavy',
    costSavingsPerTrip: '$4.25',
    nudgeMessage: 'Beat the rush hour traffic! Take the express bus and arrive stress-free while others sit in gridlock for 45+ minutes.',
    incentiveDetails: {
      type: 'eCredit',
      description: 'Earn $2.00 transit credit for choosing public transportation during peak hours',
      value: '$2.00'
    },
    additionalRides: [
      {
        departureTime: '08:15',
        travelTime: 25,
        trafficDensity: 'Heavy'
      },
      {
        departureTime: '08:45',
        travelTime: 28,
        trafficDensity: 'Heavy'
      }
    ]
  },
  'weekend': {
    travelTime: 35,
    trafficDensity: 'Light',
    costSavingsPerTrip: '$2.75',
    nudgeMessage: 'Perfect weekend adventure! Enjoy the scenic coastal route to Folly Beach while saving money and reducing your carbon footprint.',
    incentiveDetails: {
      type: 'partnerDiscount',
      description: '20% off at participating Folly Beach restaurants and shops',
      value: '20% discount'
    },
    additionalRides: [
      {
        departureTime: '13:30',
        travelTime: 32,
        trafficDensity: 'Light'
      },
      {
        departureTime: '14:30',
        travelTime: 38,
        trafficDensity: 'Medium'
      }
    ]
  },
  'night-out': {
    travelTime: 18,
    trafficDensity: 'Light',
    costSavingsPerTrip: '$3.50',
    nudgeMessage: 'Safe night out guaranteed! Skip the parking hassles and ride safely with well-lit stops and late-night security.',
    incentiveDetails: {
      type: 'funReward',
      description: 'Free drink token at participating downtown bars and clubs',
      value: '1 free drink'
    },
    additionalRides: [
      {
        departureTime: '23:00',
        travelTime: 16,
        trafficDensity: 'Light'
      },
      {
        departureTime: '00:00',
        travelTime: 15,
        trafficDensity: 'Light'
      }
    ]
  }
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { demoScenario } = body;

    // Add artificial delay to showcase loading experience
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (demoScenario && demoScenarios[demoScenario]) {
      return NextResponse.json<TransitInsightResponse>(demoScenarios[demoScenario]);
    }

    // Fallback to default scenario if not found
    return NextResponse.json<TransitInsightResponse>(demoScenarios['rush-hour']);
  } catch (error) {
    console.error('Demo API error:', error);
    return NextResponse.json(
      { error: 'Demo service temporarily unavailable' },
      { status: 500 }
    );
  }
}