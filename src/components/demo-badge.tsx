import { isDemoMode } from '@/lib/demo-mode';
import { cn } from '@/lib/utils';

/** The visible "Demo data" badge for any demo surface (D-17). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn('ml-2 rounded-full bg-purple-200 px-2 py-0.5 align-middle text-xs font-semibold text-purple-900', className)}>
      Demo data
    </span>
  );
}

/** App-wide banner while NEXT_PUBLIC_DEMO_MODE=true, so no demo figure can be mistaken for a live one. */
export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div role="status" className="bg-purple-100 px-4 py-2 text-center text-sm text-purple-900">
      <DemoBadge className="ml-0 mr-2" />
      Demo mode: scenarios, dashboard figures, and rewards marked &ldquo;Demo data&rdquo; are illustrative, not real.
    </div>
  );
}
