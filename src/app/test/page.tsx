'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@/types/interfaces';

type HealthResult =
  | { ok: true; httpStatus: number; data: HealthResponse }
  | { ok: false; httpStatus: number | null; error: string };

export default function TestPage() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const runHealthCheck = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) {
        setResult({
          ok: false,
          httpStatus: response.status,
          error: `Health check returned HTTP ${response.status}`,
        });
        return;
      }
      const data: HealthResponse = await response.json();
      setResult({ ok: true, httpStatus: response.status, data });
    } catch (error) {
      setResult({
        ok: false,
        httpStatus: null,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">System Health</h1>

      <div className="space-y-4 mb-8">
        <button
          onClick={runHealthCheck}
          disabled={loading}
          className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Checking health...' : 'Run Health Check'}
        </button>
      </div>

      {result && (
        <div className="border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-2">
            /api/health
            <span
              className={`ml-2 px-2 py-1 rounded text-sm ${
                result.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              Status: {result.httpStatus ?? 'ERROR'}
            </span>
          </h2>

          <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
            {result.ok ? JSON.stringify(result.data, null, 2) : result.error}
          </pre>
        </div>
      )}

      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
        <h3 className="font-semibold text-yellow-800 mb-2">What this checks:</h3>
        <ol className="list-decimal list-inside text-yellow-700 space-y-1">
          <li>The web app is running and its API routes respond</li>
          <li>Whether the ridership prediction service is reachable (up or down)</li>
          <li>Whether the LLM and traffic API keys are configured (yes/no only; values are never shown)</li>
          <li>Check the server logs for detailed error messages</li>
        </ol>
      </div>
    </div>
  );
}
