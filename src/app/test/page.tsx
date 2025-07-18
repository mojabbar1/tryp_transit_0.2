'use client';

import { useState } from 'react';

export default function TestPage() {
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState<string | null>(null);

  const runTest = async (testName: string, endpoint: string) => {
    setLoading(testName);
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      setResults(prev => ({
        ...prev,
        [testName]: {
          status: response.status,
          data: data
        }
      }));
    } catch (error) {
      setResults(prev => ({
        ...prev,
        [testName]: {
          status: 'ERROR',
          data: { error: error instanceof Error ? error.message : String(error) }
        }
      }));
    } finally {
      setLoading(null);
    }
  };

  const runAllTests = async () => {
    await runTest('environment', '/api/test-env');
    await runTest('gemini', '/api/test-gemini');
    await runTest('tomtom', '/api/test-tomtom');
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">API Integration Tests</h1>
      
      <div className="space-y-4 mb-8">
        <button
          onClick={runAllTests}
          disabled={!!loading}
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? `Running ${loading}...` : 'Run All Tests'}
        </button>
        
        <div className="flex space-x-4">
          <button
            onClick={() => runTest('environment', '/api/test-env')}
            disabled={!!loading}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50"
          >
            Test Environment
          </button>
          
          <button
            onClick={() => runTest('gemini', '/api/test-gemini')}
            disabled={!!loading}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:opacity-50"
          >
            Test Gemini
          </button>
          
          <button
            onClick={() => runTest('tomtom', '/api/test-tomtom')}
            disabled={!!loading}
            className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 disabled:opacity-50"
          >
            Test TomTom
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {Object.entries(results).map(([testName, result]: [string, any]) => (
          <div key={testName} className="border rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-2 capitalize">
              {testName} Test Results
              <span className={`ml-2 px-2 py-1 rounded text-sm ${
                result.status === 200 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                Status: {result.status}
              </span>
            </h2>
            
            <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
      
      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-semibold text-yellow-800 mb-2">Instructions:</h3>
        <ol className="list-decimal list-inside text-yellow-700 space-y-1">
          <li>Run the Environment test first to verify all API keys are loaded</li>
          <li>Run the Gemini test to check if the Gemini API is working</li>
          <li>Run the TomTom test to verify traffic data API access</li>
          <li>Check the browser console and server logs for detailed error messages</li>
        </ol>
      </div>
    </div>
  );
}