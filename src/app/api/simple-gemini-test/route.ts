import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET() {
  try {
    // Simple test with your actual API key
    const genAI = new GoogleGenerativeAI('AIzaSyAEgPHNz1VoKj7P2LvczFl8l34wOkPdWzw');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent('Return only this JSON: {"test": "success", "status": "working"}');
    const text = result.response.text();
    
    // Try to parse, if it fails, extract from markdown
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) {
        parsed = JSON.parse(match[1].trim());
      } else {
        parsed = { error: "Could not parse", raw: text };
      }
    }
    
    return NextResponse.json({ success: true, gemini: parsed, raw: text });
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}