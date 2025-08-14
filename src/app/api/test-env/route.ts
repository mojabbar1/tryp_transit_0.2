import { validateConfig, getConfigSummary } from '@/lib/config'
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    logger.apiEvent('env_test_started', { route: '/api/test-env' })
    
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
    
    logger.apiEvent('env_vars_read', { route: '/api/test-env', env: envVars })
    
    const validation = validateConfig()
    const summary = getConfigSummary()
    return NextResponse.json({
      success: true,
      environment: envVars,
      config: summary,
      validation,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.apiEvent('env_test_error', { route: '/api/test-env', error: error instanceof Error ? error.message : String(error) })
    
    return NextResponse.json({
      success: false,
      error: 'Failed to read environment variables',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}