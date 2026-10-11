import { Citations } from '@/components/citations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getEnv } from '@/lib/env';
import { getApprovedFacts } from '@/lib/facts/approved';
import { costRows, factOriginNote } from '@/lib/facts/pages';

export const dynamic = 'force-dynamic';

const COST_KEYS = [
  'drive.fuel_price_usd_per_gal',
  'drive.mpg',
  'drive.maintenance_usd_per_mile',
  'drive.total_cost_usd_per_mile',
  'parking.downtown_usd',
  'transit.base_fare_usd',
] as const;

/**
 * Safety: no approved crash or injury facts exist yet (NHTSA FARS, catalog S-18, is a P3.9 follow-up), so the
 * section says the data is unavailable instead of showing uncited percentages. Cost: approved facts with
 * citations, plus the marginal per-mile cost computed from them. The old percentage table had no sources and is gone.
 */
export default async function SafetyCostComparisonPage() {
  const approved = await getApprovedFacts(getEnv(), COST_KEYS);
  const rows = costRows(approved.facts);
  const note = factOriginNote(approved.facts);
  const sources = COST_KEYS.flatMap((key) => approved.facts[key]?.citations ?? []);

  return (
    <>
      <h2 className="text-3xl md:text-5xl font-bold w-full bg-secondary p-6 text-center">Safety and Cost Comparison</h2>
      <div className="p-6 text-secondary-foreground text-center">
        <Card role="status" className="w-full max-w-4xl mx-auto bg-primary-foreground rounded-lg overflow-hidden shadow-2xl mb-8">
          <CardHeader className="bg-primary p-6">
            <CardTitle className="text-secondary text-2xl font-semibold">Safety Comparison</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-primary-foreground text-left">
            <p className="text-lg font-medium text-secondary-foreground mb-2">Data unavailable</p>
            <p className="text-secondary-foreground">
              No approved, cited crash or injury figures for Charleston-area driving and bus travel exist yet, so none
              are shown. They will come from the NHTSA Fatality Analysis Reporting System once that source is
              connected and its figures are approved.
            </p>
          </CardContent>
        </Card>

        <Card className="w-full max-w-4xl mx-auto bg-primary-foreground rounded-lg overflow-hidden shadow-2xl">
          <CardHeader className="bg-primary p-6">
            <CardTitle className="text-secondary text-2xl font-semibold">Cost of driving vs. the bus</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-primary-foreground">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="text-start">
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.value ?? 'Data unavailable'}</TableCell>
                    <TableCell className="text-sm">{row.basis}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 text-left text-sm">
              Trip comparisons use the marginal cost (gasoline and maintenance). Parking applies only to some trips, and
              which ones is not approved yet, so trip comparisons leave it out.
            </p>
            {note && <p className="mt-2 text-left text-sm text-amber-800">{note}</p>}
            <Citations sources={sources} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
