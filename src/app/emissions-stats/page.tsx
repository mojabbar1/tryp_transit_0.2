import { Citations } from '@/components/citations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getEnv } from '@/lib/env';
import { getApprovedFacts } from '@/lib/facts/approved';
import { emissionsRows, factOriginNote } from '@/lib/facts/pages';

export const dynamic = 'force-dynamic';

const KEYS = ['co2.car_g_per_mile', 'co2.car_occupancy', 'co2.bus_g_per_passenger_mile'] as const;

/**
 * CO2 per mile from approved facts only, with the derived per-passenger-mile figures computed from them. A row
 * without its approved inputs says "Data unavailable"; no figure is uncited. The old hard-coded table (including
 * its inconsistent bus figure and an unapproved commute length and day count) is gone.
 */
export default async function EmissionsStatsPage() {
  const approved = await getApprovedFacts(getEnv(), KEYS);
  const rows = emissionsRows(approved.facts);
  const note = factOriginNote(approved.facts);
  const sources = KEYS.flatMap((key) => approved.facts[key]?.citations ?? []);

  return (
    <>
      <h2 className="text-3xl md:text-5xl font-bold w-full bg-secondary p-6 text-center">CO2 Emissions Comparison</h2>
      <div className="p-6 text-secondary-foreground text-center">
        <Card className="w-full max-w-4xl mx-auto bg-primary-foreground rounded-lg overflow-hidden shadow-2xl">
          <CardHeader className="bg-primary p-6">
            <CardTitle className="text-secondary text-2xl font-semibold">CO2 per mile: car vs. bus</CardTitle>
          </CardHeader>
          <CardContent className="p-6 bg-primary-foreground">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
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
              The bus figure is a historical national average for buses, used as a proxy; it is not a CARTA
              measurement. A CARTA-specific figure (catalog S-14b) will replace it once its source data is confirmed.
            </p>
            {note && <p className="mt-2 text-left text-sm text-amber-800">{note}</p>}
            <Citations sources={sources} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
