import { ensureProductionBuild } from './next-app';

/** Jest global setup for `npm run test:integration`: one production build (or a verified reuse) before any scenario. */
export default async function globalSetup(): Promise<void> {
  await ensureProductionBuild();
}
