import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    logger.apiEvent('gemini_test_started', { route: '/api/test-gemini' });
    
    // Check environment variables
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const useGemini = process.env.USE_GEMINI;
    
    logger.apiEvent('gemini_env', { useGemini, hasKey: !!geminiApiKey, keyLength: geminiApiKey?.length || 0 });
    
    if (!geminiApiKey) {
      return NextResponse.json({
        error: 'GEMINI_API_KEY not found in environment variables',
        env: {
          USE_GEMINI: useGemini,
          GEMINI_API_KEY_EXISTS: false
        }
      }, { status: 500 });
    }

    // Test Gemini API
    logger.apiEvent('gemini_init');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    
    logger.apiEvent('gemini_model_create');
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024,
      }
    });
    
    logger.apiEvent('gemini_send_prompt');
    const prompt = 'Return a simple JSON object with these exact fields: {"status": "success", "message": "Gemini is working", "timestamp": "current_time"}. Return ONLY valid JSON without markdown formatting.';
    
    const response = await model.generateContent(prompt);
    const result = response.response.text();
    
    logger.apiEvent('gemini_raw_response');
    
    // Try to parse the response
    try {
      const parsed = JSON.parse(result);
      logger.apiEvent('gemini_parse_success');
      
      return NextResponse.json({
        success: true,
        geminiResponse: parsed,
        rawResponse: result,
        env: {
          USE_GEMINI: useGemini,
          GEMINI_API_KEY_EXISTS: true
        }
      });
    } catch (parseError) {
      logger.warn('gemini_parse_failed_try_extract');
      
      // Try to extract JSON from markdown
      if (result.includes('```json') && result.includes('```')) {
        const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const extractedJson = jsonMatch[1].trim();
            const parsed = JSON.parse(extractedJson);
            logger.apiEvent('gemini_extract_parse_success');
            
            return NextResponse.json({
              success: true,
              geminiResponse: parsed,
              rawResponse: result,
              extractedFromMarkdown: true,
              env: {
                USE_GEMINI: useGemini,
                GEMINI_API_KEY_EXISTS: true
              }
            });
          } catch (extractError) {
            logger.error('gemini_extract_parse_failed', { error: extractError instanceof Error ? extractError.message : String(extractError) });
          }
        }
      }
      
      // If all parsing fails, return the raw response
      return NextResponse.json({
        success: false,
        error: 'Failed to parse Gemini response as JSON',
        rawResponse: result,
        parseError: parseError instanceof Error ? parseError.message : String(parseError),
        env: {
          USE_GEMINI: useGemini,
          GEMINI_API_KEY_EXISTS: true
        }
      });
    }
    
  } catch (error) {
    logger.error('gemini_test_error', { error: error instanceof Error ? error.message : String(error) });
    
    return NextResponse.json({
      success: false,
      error: 'Gemini API call failed',
      details: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      env: {
        USE_GEMINI: process.env.USE_GEMINI,
        GEMINI_API_KEY_EXISTS: !!process.env.GEMINI_API_KEY
      }
    }, { status: 500 });
  }
}