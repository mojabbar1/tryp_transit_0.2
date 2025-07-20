'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function InvestorDashboard() {
  // Mock data for investor presentation
  const metrics = {
    activeUsers: 2847,
    timeSavedHours: 1250,
    avgSavingsPerUser: 23.50,
    carbonReduced: 4.2, // tons
    apiCalls: 15420,
    accuracy: 89.3,
    responseTime: 180,
    dataSources: 12
  };

  const growthData = [
    { month: 'Jan', users: 450 },
    { month: 'Feb', users: 680 },
    { month: 'Mar', users: 920 },
    { month: 'Apr', users: 1340 },
    { month: 'May', users: 1890 },
    { month: 'Jun', users: 2847 }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            📊 Tryp Transit - Investor Dashboard
          </h1>
          <p className="text-gray-600 mb-4">
            Real-time metrics showcasing market impact and growth potential
          </p>
          <Link href="/">
            <Button variant="outline" className="mb-6">
              ← Back to Demo
            </Button>
          </Link>
        </div>

        {/* Market Impact Metrics */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">🌍 Market Impact</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-green-800 text-sm">Active Commuters</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-700">
                  {metrics.activeUsers.toLocaleString()}
                </div>
                <p className="text-green-600 text-sm mt-1">+34% this month</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-blue-800 text-sm">Time Saved (Hours)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-700">
                  {metrics.timeSavedHours.toLocaleString()}
                </div>
                <p className="text-blue-600 text-sm mt-1">This month</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50 to-violet-50 border-purple-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-purple-800 text-sm">Avg Savings/User</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-purple-700">
                  ${metrics.avgSavingsPerUser}
                </div>
                <p className="text-purple-600 text-sm mt-1">Per month</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-emerald-800 text-sm">CO₂ Reduced (Tons)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-emerald-700">
                  {metrics.carbonReduced}
                </div>
                <p className="text-emerald-600 text-sm mt-1">This month</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Growth Trajectory */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">📈 Growth Trajectory</h2>
          <Card>
            <CardHeader>
              <CardTitle>User Growth (6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end space-x-4 h-40">
                {growthData.map((data, index) => (
                  <div key={data.month} className="flex flex-col items-center flex-1">
                    <div 
                      className="bg-gradient-to-t from-blue-500 to-blue-400 rounded-t w-full transition-all duration-1000 ease-out"
                      style={{ 
                        height: `${(data.users / Math.max(...growthData.map(d => d.users))) * 120}px`,
                        animationDelay: `${index * 200}ms`
                      }}
                    ></div>
                    <div className="text-sm font-medium text-gray-700 mt-2">{data.month}</div>
                    <div className="text-xs text-gray-500">{data.users}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-center">
                <span className="text-green-600 font-semibold">+532% growth</span> in 6 months
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Technical Excellence */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">⚡ Technical Excellence</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-gradient-to-br from-orange-50 to-red-50 border-orange-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-orange-800 text-sm">API Calls/Month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-700">
                  {metrics.apiCalls.toLocaleString()}
                </div>
                <p className="text-orange-600 text-sm mt-1">99.9% uptime</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-teal-800 text-sm">ML Accuracy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-teal-700">
                  {metrics.accuracy}%
                </div>
                <p className="text-teal-600 text-sm mt-1">Prediction accuracy</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-indigo-800 text-sm">Response Time</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-indigo-700">
                  {metrics.responseTime}ms
                </div>
                <p className="text-indigo-600 text-sm mt-1">Average API response</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-pink-800 text-sm">Data Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-pink-700">
                  {metrics.dataSources}
                </div>
                <p className="text-pink-600 text-sm mt-1">Real-time integrations</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Market Opportunity */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">🎯 Market Opportunity</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Addressable Market</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">US Transit Market (TAM)</span>
                    <span className="font-semibold">$79.1B</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Smart Transit Tech (SAM)</span>
                    <span className="font-semibold">$12.4B</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">AI-Powered Optimization (SOM)</span>
                    <span className="font-semibold text-green-600">$2.1B</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue Projections</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Year 1 (Current)</span>
                    <span className="font-semibold">$125K ARR</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Year 2 (Projected)</span>
                    <span className="font-semibold">$890K ARR</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Year 3 (Projected)</span>
                    <span className="font-semibold text-green-600">$3.2M ARR</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Competitive Advantages */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">🏆 Competitive Advantages</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader>
                <CardTitle className="text-blue-800">AI-First Approach</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Proprietary ML models for ridership prediction with 89.3% accuracy, 
                  delivering personalized insights that increase adoption by 34%.
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-green-500">
              <CardHeader>
                <CardTitle className="text-green-800">Real-Time Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  12 live data sources including traffic, weather, and events, 
                  providing sub-200ms response times for instant recommendations.
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="text-purple-800">Behavioral Psychology</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  AI-powered nudge messages using behavioral economics principles, 
                  achieving 67% higher engagement than traditional transit apps.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Call to Action */}
        <div className="text-center">
          <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold mb-4">Ready to Transform Urban Mobility?</h3>
              <p className="text-blue-100 mb-6">
                Join us in revolutionizing how people move through cities with AI-powered transit optimization.
              </p>
              <div className="flex justify-center space-x-4">
                <Link href="/">
                  <Button variant="secondary" size="lg">
                    Try Live Demo
                  </Button>
                </Link>
                <Button variant="outline" size="lg" className="text-white border-white hover:bg-white hover:text-blue-600">
                  Schedule Meeting
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}