import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    console.log('=== ENVIRONMENT TEST ===');
    
    const envVars = {
      USE_GEMINI: process.env.USE_GEMINI,
      GEMINI_API_KEY_EXISTS: !!process.env.GEMINI_API_KEY,
      GEMINI_API_KEY_LENGTH: process.env.GEMINI_API_KEY?.length || 0,
      GEMINI_API_KEY_PREFIX: process.env.GEMINI_API_KEY?.substring(0, 10) || 'NOT_FOUND',
      OPENAI_API_KEY_EXISTS: !!process.env.OPENAI_API_KEY,
      TOMTOM_API_KEY_EXISTS: !!process.env.NEXT_PUBLIC_TOMTOM_API_KEY,
      RIDERSHIP_API_BASE_URL: process.env.RIDERSHIP_API_BASE_URL,
      NODE_ENV: process.env.NODE_ENV,
    };
    
    console.log('Environment variables:', envVars);
    
    return NextResponse.json({
      success: true,
      environment: envVars,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Environment test error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to read environment variables',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}