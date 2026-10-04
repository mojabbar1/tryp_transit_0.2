import Link from 'next/link';
import { Citations } from '@/components/citations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isDemoMode } from '@/lib/demo-mode';
import { getEnv } from '@/lib/env';
import { formatStatValue } from '@/lib/stats/format';
import { loadStats } from '@/lib/stats/load';
import DemoDashboard from './demo-dashboard';

// Rendered per request from the shared, hourly stats cache (the same loader as GET /api/stats).
export const dynamic = 'force-dynamic';

/**
 * Live mode shows only headline stats backed by approved facts, each with its citation; with none available it
 * says so. The demo dashboard's illustrative figures render only with NEXT_PUBLIC_DEMO_MODE=true, badged (D-17).
 */
export default async function DashboardPage() {
  if (isDemoMode()) return <DemoDashboard />;
  const stats = await loadStats(getEnv());

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">📊 Charleston Transit Dashboard</h1>
          <p className="text-gray-600 mb-4">Headline figures from approved, cited sources only.</p>
          <Link href="/">
            <Button variant="outline" className="mb-6">← Back to trip planner</Button>
          </Link>
        </div>

        {stats.available ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {stats.items.map((stat) => (
              <Card key={stat.id} className="bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-gray-800 text-base">{stat.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-700">{formatStatValue(stat)}</div>
                  {(stat.period.start || stat.period.end) && (
                    <p className="text-sm text-gray-500 mt-1">
                      Period: {stat.period.start ?? '…'} to {stat.period.end ?? '…'}
                    </p>
                  )}
                  <Citations sources={stat.citations} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card role="status" className="bg-white">
            <CardHeader>
              <CardTitle>Data unavailable</CardTitle>
            </CardHeader>
            <CardContent className="text-gray-700 space-y-2">
              <p>No approved, cited headline figures are available right now, so none are shown.</p>
              <p className="text-sm text-gray-500">
                They come from the transit data agent (CARTA ridership from the National Transit Database, and the
                approved congestion headline) once those facts are approved and the service is enabled.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
