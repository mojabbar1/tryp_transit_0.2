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
  const [demoMode, setDemoMode] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const maxRetries = 2;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadingSteps = [
    "Analyzing traffic patterns...",
    "Calculating ridership predictions...",
    "Generating personalized insights..."
  ];

  const handleSubmit = async (e: React.FormEvent, isRetry = false) => {
    e.preventDefault();

    if (!isRetry) {
      setRetryCount(0);
    }

    setIsLoading(true);
    setLoadingStep(0);
    setLoadingProgress(0);
    setError(null);
    if (!isRetry) setData(null);

    // Start loading animation sequence
    let loadingInterval: NodeJS.Timeout | null = null;
    if (!isRetry) {
      loadingInterval = setInterval(() => {
        setLoadingStep(prev => {
          const next = prev + 1;
          setLoadingProgress((next / loadingSteps.length) * 100);
          if (next >= loadingSteps.length) {
            if (loadingInterval) clearInterval(loadingInterval);
            return loadingSteps.length - 1;
          }
          return next;
        });
      }, 1000);
    }

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
      // Use demo API if in demo mode, otherwise use regular API
      const apiEndpoint = demoMode ? '/api/transit-insights-demo' : '/api/transit-insights';
      const requestBody = demoMode
        ? { demoScenario: demoMode }
        : {
          departure: departureCoords,
          destination: destinationCoords,
          timeToDestination: arrivalTime,
        };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
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
          const syntheticEvent = { preventDefault: () => { } } as React.FormEvent;
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

  const handleDemoScenario = (scenario: string) => {
    setDemoMode(scenario);
    setError(null);
    setData(null);

    // Pre-fill form based on scenario
    switch (scenario) {
      case 'rush-hour':
        setDepartureStop('King St & Meeting St');
        setDestinationStop('MUSC - Ashley Ave');
        setArrivalTime('08:30');
        break;
      case 'weekend':
        setDepartureStop('Charleston City Market');
        setDestinationStop('Folly Beach Park & Ride');
        setArrivalTime('14:00');
        break;
      case 'night-out':
        setDepartureStop('Upper King St Entertainment District');
        setDestinationStop('College of Charleston');
        setArrivalTime('23:30');
        break;
    }

    // Auto-submit after 1 second
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) {
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(submitEvent);
      }
    }, 1000);
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
          <p className="text-gray-600 mb-4">
            Get real-time transit insights with AI-powered recommendations
          </p>
          <div className="flex justify-center space-x-4">
            <a
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              📊 Investor Dashboard
            </a>
            <a
              href="/test"
              className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
            >
              🧪 Test Interface
            </a>
          </div>
        </div>

        {/* Demo Scenarios Section */}
        <Card className="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
          <CardHeader>
            <CardTitle className="text-center text-purple-800">🎯 Demo Scenarios</CardTitle>
            <p className="text-center text-purple-600 text-sm">Try these pre-configured scenarios to see Tryp Transit in action</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Button
                onClick={() => handleDemoScenario('rush-hour')}
                className="bg-red-500 hover:bg-red-600 text-white p-4 h-auto flex flex-col items-center space-y-2"
              >
                <span className="text-2xl">🚌</span>
                <span className="font-semibold">Rush Hour Commute</span>
                <span className="text-xs opacity-90">High traffic, great savings</span>
              </Button>

              <Button
                onClick={() => handleDemoScenario('weekend')}
                className="bg-blue-500 hover:bg-blue-600 text-white p-4 h-auto flex flex-col items-center space-y-2"
              >
                <span className="text-2xl">🌅</span>
                <span className="font-semibold">Weekend Trip</span>
                <span className="text-xs opacity-90">Leisure focus, scenic route</span>
              </Button>

              <Button
                onClick={() => handleDemoScenario('night-out')}
                className="bg-purple-500 hover:bg-purple-600 text-white p-4 h-auto flex flex-col items-center space-y-2"
              >
                <span className="text-2xl">🌙</span>
                <span className="font-semibold">Night Out</span>
                <span className="text-xs opacity-90">Safety focus, well-lit stops</span>
              </Button>
            </div>

            {demoMode && (
              <div className="text-center mb-4">
                <div className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                  Demo Active: {demoMode}
                </div>
                <Button
                  onClick={() => setDemoMode(null)}
                  variant="outline"
                  size="sm"
                  className="ml-2"
                >
                  Clear Demo
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

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
                className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${isLoading
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

        {/* Enhanced Multi-Step Loading State */}
        {isLoading && (
          <div className="mt-8 max-w-2xl mx-auto">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
                <h3 className="text-xl font-semibold text-blue-800 mb-2">
                  {retryCount > 0 ? `Retrying Request (${retryCount}/${maxRetries})` : 'Processing Your Request'}
                </h3>
                <p className="text-blue-600">
                  {retryCount > 0
                    ? 'Previous attempt failed, automatically retrying...'
                    : loadingSteps[loadingStep]
                  }
                </p>
              </div>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-blue-600 mb-2">
                  <span>Progress</span>
                  <span>{Math.round(loadingProgress)}%</span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-1000 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  ></div>
                </div>
              </div>

              {/* Loading Steps */}
              <div className="space-y-2">
                {loadingSteps.map((step, index) => (
                  <div key={index} className={`flex items-center text-sm ${index < loadingStep ? 'text-green-600' :
                    index === loadingStep ? 'text-blue-600' :
                      'text-gray-400'
                    }`}>
                    <div className={`w-4 h-4 rounded-full mr-3 flex items-center justify-center ${index < loadingStep ? 'bg-green-500' :
                      index === loadingStep ? 'bg-blue-500 animate-pulse' :
                        'bg-gray-300'
                      }`}>
                      {index < loadingStep ? (
                        <span className="text-white text-xs">✓</span>
                      ) : index === loadingStep ? (
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      ) : (
                        <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                      )}
                    </div>
                    {step}
                  </div>
                ))}
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

              {/* Nudge Message - THE MAGIC MOMENT */}
              {data.nudgeMessage && (
                <div className="mb-8 p-6 bg-gradient-to-r from-green-50 via-blue-50 to-purple-50 border-2 border-green-400 rounded-xl shadow-lg relative overflow-hidden">
                  {/* Animated background effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-green-400/10 via-blue-400/10 to-purple-400/10 animate-pulse"></div>

                  <div className="relative flex items-start">
                    <div className="text-4xl mr-4 animate-bounce">💡</div>
                    <div className="flex-1">
                      <h3 className="font-bold text-2xl text-green-800 mb-3 flex items-center">
                        ✨ AI-Powered Transit Insight
                        <span className="ml-2 px-2 py-1 bg-green-200 text-green-800 text-xs rounded-full">SMART</span>
                      </h3>
                      <p className="text-green-700 text-xl font-medium leading-relaxed mb-4">
                        {data.nudgeMessage}
                      </p>
                      <div className="flex items-center text-sm text-green-600">
                        <span className="flex items-center mr-4">
                          <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                          Real-time Analysis
                        </span>
                        <span className="flex items-center">
                          <span className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></span>
                          Personalized for You
                        </span>
                      </div>
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
                        <div className={`px-2 py-1 rounded text-sm font-medium ${ride.trafficDensity === 'Light' ? 'bg-green-100 text-green-800' :
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
