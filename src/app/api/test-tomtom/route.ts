import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(req: NextRequest) {
  try {
    console.log('=== TOMTOM API TEST ===');
    
    const TOMTOM_API_KEY = process.env.NEXT_PUBLIC_TOMTOM_API_KEY;
    
    console.log('TomTom API Key exists:', !!TOMTOM_API_KEY);
    console.log('TomTom API Key length:', TOMTOM_API_KEY?.length || 0);
    
    if (!TOMTOM_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'NEXT_PUBLIC_TOMTOM_API_KEY not found in environment variables'
      }, { status: 500 });
    }

    // Test TomTom API with a simple location (San Francisco)
    const testLat = 37.7749;
    const testLng = -122.4194;
    
    console.log(`Testing TomTom API with coordinates: ${testLat}, ${testLng}`);
    
    try {
      const flowResponse = await axios.get(
        `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json`,
        {
          params: {
            key: TOMTOM_API_KEY,
            point: `${testLat},${testLng}`,
          },
          timeout: 10000 // 10 second timeout
        }
      );
      
      console.log('TomTom API response status:', flowResponse.status);
      console.log('TomTom API response data keys:', Object.keys(flowResponse.data || {}));
      
      return NextResponse.json({
        success: true,
        tomtomResponse: {
          status: flowResponse.status,
          dataKeys: Object.keys(flowResponse.data || {}),
          hasFlowSegmentData: !!flowResponse.data?.flowSegmentData
        },
        testCoordinates: { lat: testLat, lng: testLng }
      });
      
    } catch (tomtomError) {
      console.error('TomTom API error:', tomtomError);
      
      if (axios.isAxiosError(tomtomError)) {
        return NextResponse.json({
          success: false,
          error: 'TomTom API call failed',
          details: {
            status: tomtomError.response?.status,
            statusText: tomtomError.response?.statusText,
            data: tomtomError.response?.data,
            message: tomtomError.message
          }
        }, { status: 500 });
      } else {
        return NextResponse.json({
          success: false,
          error: 'TomTom API call failed',
          details: tomtomError instanceof Error ? tomtomError.message : String(tomtomError)
        }, { status: 500 });
      }
    }
    
  } catch (error) {
    console.error('TomTom test error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'TomTom test failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}