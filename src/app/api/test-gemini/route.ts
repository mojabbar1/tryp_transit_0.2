import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(req: NextRequest) {
  try {
    console.log('=== GEMINI TEST ENDPOINT ===');
    
    // Check environment variables
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const useGemini = process.env.USE_GEMINI;
    
    console.log('USE_GEMINI:', useGemini);
    console.log('GEMINI_API_KEY exists:', !!geminiApiKey);
    console.log('GEMINI_API_KEY length:', geminiApiKey?.length || 0);
    
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
    console.log('Initializing Gemini...');
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    
    console.log('Creating model...');
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024,
      }
    });
    
    console.log('Sending test prompt...');
    const prompt = 'Return a simple JSON object with these exact fields: {"status": "success", "message": "Gemini is working", "timestamp": "current_time"}. Return ONLY valid JSON without markdown formatting.';
    
    const response = await model.generateContent(prompt);
    const result = response.response.text();
    
    console.log('Raw Gemini response:', result);
    
    // Try to parse the response
    try {
      const parsed = JSON.parse(result);
      console.log('Successfully parsed JSON:', parsed);
      
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
      console.log('Failed to parse as JSON, trying to extract from markdown...');
      
      // Try to extract JSON from markdown
      if (result.includes('```json') && result.includes('```')) {
        const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            const extractedJson = jsonMatch[1].trim();
            const parsed = JSON.parse(extractedJson);
            console.log('Successfully extracted and parsed JSON:', parsed);
            
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
            console.error('Failed to parse extracted JSON:', extractError);
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
    console.error('Gemini test error:', error);
    
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