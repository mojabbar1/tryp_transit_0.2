'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { busStopCoordinates } from '@/app/data/busStopCoordinates';

interface TransitResponse {
  travelTime: number;
  trafficDensity: string;
  costSavingsPerTrip: string;
  additionalRides: Array<{
    travelTime: number;
    trafficDensity: string;
  }>;
}

export default function TransitInsightsPage() {
  const [departureStop, setDepartureStop] = useState('');
  const [destinationStop, setDestinationStop] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [response, setResponse] = useState<TransitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResponse(null);

    // Validate inputs
    if (!departureStop || !destinationStop || !arrivalTime) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    // Get coordinates from bus stop names
    const departureCoords = busStopCoordinates[departureStop];
    const destinationCoords = busStopCoordinates[destinationStop];

    if (!departureCoords || !destinationCoords) {
      setError('Invalid bus stop names. Please select from the available stops.');
      setLoading(false);
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
        throw new Error('Failed to fetch transit insights');
      }

      const data = await response.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

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
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? 'Getting Insights...' : 'Get Transit Insights'}
                </Button>
              </form>
          </CardContent>
        </Card>

        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {response && (
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-800">Transit Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <h3 className="font-semibold text-gray-800 mb-2">
                      🕒 Travel Time
                    </h3>
                    <p className="text-2xl font-bold text-blue-600">
                      {response.travelTime} minutes
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <h3 className="font-semibold text-gray-800 mb-2">
                      🚦 Traffic Density
                    </h3>
                    <p className="text-2xl font-bold text-orange-600">
                      {response.trafficDensity}
                    </p>
                  </div>

                  <div className="bg-white p-4 rounded-lg shadow-sm">
                    <h3 className="font-semibold text-gray-800 mb-2">
                      💰 Cost Savings
                    </h3>
                    <p className="text-2xl font-bold text-green-600">
                      {response.costSavingsPerTrip}
                    </p>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow-sm">
                  <h3 className="font-semibold text-gray-800 mb-4">
                    🚌 Alternative Routes
                  </h3>
                  <div className="space-y-3">
                    {response.additionalRides.map((ride, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-3 bg-gray-50 rounded"
                      >
                        <span className="text-gray-600">
                          Route {index + 1}
                        </span>
                        <div className="text-right">
                          <p className="font-medium">{ride.travelTime} min</p>
                          <p className="text-sm text-gray-500">
                            {ride.trafficDensity} traffic
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
