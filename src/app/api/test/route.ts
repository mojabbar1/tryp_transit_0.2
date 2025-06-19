import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  return NextResponse.json({
    message: 'Test POST endpoint working',
    receivedData: body,
    timestamp: new Date().toISOString(),
    status: 'success'
  });
} 