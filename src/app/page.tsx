'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';
import { TransitInsightResponse, ApiErrorResponse } from '@/types/interfaces';

export default function TransitInsightsPage() {
  const [departureStop, setDepartureStop] = useState('');
  const [destinationStop, setDestinationStop] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [data, setData] = useState<TransitInsightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSubmit = async (e: React.FormEvent, isRetry = false) => {
    e.preventDefault();
    
    if (!isRetry) {
      setRetryCount(0);
    }
    
    setIsLoading(true);
    setError(null);
    if (!isRetry) setData(null);

    // Validate inputs
    if (!departureStop || !destinationStop || !arrivalTime) {
      setError('Please fill in all fields');
      setIsLoading(false);
      return;
    }

    // Get coordinates from bus stop names
    const departureCoords = busStopCoordinates[departureStop];
    const destinationCoords = busStopCoordinates[destinationStop];

    if (!departureCoords || !destinationCoords) {
      setError('Invalid bus stop names. Please select from the available stops.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/transit-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          departure: departureCoords,
          destination: destinationCoords,
          timeToDestination: arrivalTime,
        }),
      });

      if (!response.ok) {
        const errorData: ApiErrorResponse = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result: TransitInsightResponse = await response.json();
      setData(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      
      if (retryCount < maxRetries && !isRetry) {
        console.log(`Attempt failed, retrying... (${retryCount + 1}/${maxRetries})`);
        setRetryCount(prev => prev + 1);
        
        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        
        // Exponential backoff: 1s, 2s delays
        timeoutRef.current = setTimeout(() => {
          const syntheticEvent = { preventDefault: () => {} } as React.FormEvent;
          handleSubmit(syntheticEvent, true);
        }, 1000 * (retryCount + 1));
      } else {
        setError(errorMessage);
        setIsLoading(false);
      }
    }
    
    // Only set loading to false if this is the final attempt or a successful retry
    if (retryCount >= maxRetries || isRetry) {
      setIsLoading(false);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const availableStops = Object.keys(busStopCoordinates);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🚌 Tryp Transit Insights
          </h1>
          <p className="text-gray-600">
            Get real-time transit insights with AI-powered recommendations
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Plan Your Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Departure Stop
                  </label>
                  <select
                    value={departureStop}
                    onChange={(e) => setDepartureStop(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="">Select departure stop</option>
                    {availableStops.map((stop) => (
                      <option key={stop} value={stop}>
                        {stop}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Destination Stop
                  </label>
                  <select
                    value={destinationStop}
                    onChange={(e) => setDestinationStop(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="">Select destination stop</option>
                    {availableStops.map((stop) => (
                      <option key={stop} value={stop}>
                        {stop}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Desired Arrival Time (HH:MM)
                </label>
                <Input
                  type="time"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  className="w-full"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
                  isLoading
                    ? 'bg-gray-400 cursor-not-allowed text-gray-200'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isLoading ? (
                  retryCount > 0 ? `Retrying... (${retryCount}/${maxRetries})` : 'Analyzing Trip...'
                ) : (
                  'Get Transit Insights'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Enhanced Loading State */}
        {isLoading && (
          <div className="mt-8 text-center">
            <div className="inline-flex items-center px-6 py-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
              <div>
                <p className="text-xl text-blue-700 font-semibold">
                  {retryCount > 0 ? `Retrying Request (${retryCount}/${maxRetries})` : 'Analyzing Your Trip'}
                </p>
                <p className="text-blue-600 text-sm mt-1">
                  {retryCount > 0 
                    ? 'Previous attempt failed, automatically retrying...'
                    : 'Checking traffic patterns, transit schedules, and calculating savings...'
                  }
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Error State */}
        {error && (
          <div className="mt-8 max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-start">
                <div className="text-red-400 text-2xl mr-3">⚠️</div>
                <div>
                  <h3 className="text-lg font-semibold text-red-800 mb-2">
                    Oops! Something went wrong
                  </h3>
                  <p className="text-red-700 mb-4">
                    We couldn&apos;t get your transit insights right now{retryCount > 0 ? ` after ${retryCount + 1} attempts` : ''}. This might be due to:
                  </p>
                  <ul className="text-red-600 text-sm list-disc list-inside space-y-1 mb-4">
                    <li>Temporary service unavailability</li>
                    <li>Network connectivity issues</li>
                    <li>Invalid location data</li>
                  </ul>
                  <button 
                    onClick={() => {
                      setError(null);
                      setRetryCount(0);
                    }}
                    className="bg-red-100 hover:bg-red-200 text-red-800 px-4 py-2 rounded text-sm transition-colors"
                  >
                    Try Again
                  </button>
                  {process.env.NODE_ENV === 'development' && (
                    <details className="mt-4">
                      <summary className="text-red-600 text-xs cursor-pointer">Technical Details</summary>
                      <p className="text-red-500 text-xs mt-2 font-mono bg-red-100 p-2 rounded">
                        {error}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Enhanced Results Display */}
        {data && (
          <div className="mt-8 max-w-4xl mx-auto">
            <div className="bg-white rounded-lg shadow-lg p-6 border border-gray-200">
              <h2 className="text-3xl font-bold mb-6 text-green-700 text-center">
                🚌 Your Trip Insights
              </h2>

              {/* Nudge Message - Most Prominent */}
              {data.nudgeMessage && (
                <div className="mb-6 p-4 bg-gradient-to-r from-green-100 to-blue-100 border-l-4 border-green-500 rounded-r-lg">
                  <div className="flex items-start">
                    <div className="text-2xl mr-3">💡</div>
                    <div>
                      <h3 className="font-semibold text-lg text-green-800 mb-2">Smart Transit Tip</h3>
                      <p className="text-green-700 text-lg">{data.nudgeMessage}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Main Stats Grid */}
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h3 className="font-semibold text-lg text-blue-800 mb-2">⏱️ Travel Time</h3>
                  <p className="text-2xl font-bold text-blue-600">
                    {data.travelTime !== null ? `${data.travelTime} mins` : 'N/A'}
                  </p>
                </div>
                
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <h3 className="font-semibold text-lg text-yellow-800 mb-2">🚦 Traffic Density</h3>
                  <p className="text-2xl font-bold text-yellow-600">
                    {data.trafficDensity || 'N/A'}
                  </p>
                </div>
                
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h3 className="font-semibold text-lg text-green-800 mb-2">💰 You Save</h3>
                  <p className="text-2xl font-bold text-green-600">
                    {data.costSavingsPerTrip ? `$${data.costSavingsPerTrip}` : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Incentive Section */}
              {data.incentiveDetails && (
                <div className="mb-6 p-4 bg-gradient-to-r from-purple-100 to-pink-100 border-l-4 border-purple-500 rounded-r-lg">
                  <div className="flex items-start">
                    <div className="text-2xl mr-3">🎁</div>
                    <div>
                      <h3 className="font-semibold text-lg text-purple-800 mb-2">Your Reward</h3>
                      <p className="text-purple-700 text-lg mb-2">{data.incentiveDetails.description}</p>
                      <div className="flex items-center space-x-4 text-sm text-purple-600">
                        <span className="bg-purple-200 px-2 py-1 rounded">
                          Type: {data.incentiveDetails.type}
                        </span>
                        <span className="bg-purple-200 px-2 py-1 rounded">
                          Value: {data.incentiveDetails.value}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Alternative Rides */}
              {data.additionalRides && data.additionalRides.length > 0 && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h3 className="font-semibold text-lg text-gray-800 mb-3 flex items-center">
                    🚌 Alternative Options
                  </h3>
                  <div className="space-y-2">
                    {data.additionalRides.map((ride, index) => (
                      <div key={index} className="bg-white p-3 rounded border border-gray-100 flex justify-between items-center">
                        <div>
                          {ride.departureTime && (
                            <span className="text-blue-600 font-semibold mr-4">
                              🕐 {ride.departureTime}
                            </span>
                          )}
                          <span className="text-gray-700">
                            {ride.travelTime} mins travel time
                          </span>
                        </div>
                        <div className={`px-2 py-1 rounded text-sm font-medium ${
                          ride.trafficDensity === 'Light' ? 'bg-green-100 text-green-800' :
                          ride.trafficDensity === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {ride.trafficDensity} Traffic
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Debug Section (Optional - Remove in Production) */}
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Show Raw Data (Debug)
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
