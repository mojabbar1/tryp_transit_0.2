/**
 * Client-readable demo flag (default off). It controls demo scenarios and demo-only copy and never gates a secret.
 * Next.js inlines NEXT_PUBLIC_ values at build time, so the variable must be referenced literally.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}
