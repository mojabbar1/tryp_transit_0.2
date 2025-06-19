'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';

export default function TestPage() {
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const testBasicAPI = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/test');
      const data = await response.json();
      setTestResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  const testTransitInsights = async () => {
    setLoading(true);
    setError('');
    try {
      const availableStops = Object.keys(busStopCoordinates);
      const departureStop = availableStops[0];
      const destinationStop = availableStops[1];
      const departureCoords = busStopCoordinates[departureStop];
      const destinationCoords = busStopCoordinates[destinationStop];

      const response = await fetch('/api/transit-insights-simple', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          departure: departureCoords,
          destination: destinationCoords,
          timeToDestination: '14:30',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setTestResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🧪 API Test Page
          </h1>
          <p className="text-gray-600">
            Test the API functionality without external dependencies
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Basic API Test</CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={testBasicAPI} 
                disabled={loading}
                className="w-full"
              >
                {loading ? 'Testing...' : 'Test Basic API'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transit Insights Test</CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={testTransitInsights} 
                disabled={loading}
                className="w-full"
              >
                {loading ? 'Testing...' : 'Test Transit Insights'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {testResult && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-800">Test Results</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-white p-4 rounded-lg overflow-auto">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Available Bus Stops</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.keys(busStopCoordinates).map((stop, index) => (
                <div key={index} className="text-sm p-2 bg-gray-100 rounded">
                  {stop}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 