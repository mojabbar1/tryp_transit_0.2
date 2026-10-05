import type { CitationRef } from '@/lib/contracts/transit-insights';
import { buildFootnotes } from '@/lib/citations';
import { cn } from '@/lib/utils';

/**
 * "Sources" footnote for any page or result that shows sourced numbers: each entry names what it backs and the
 * source's attribution text. Renders nothing when there is nothing to cite. Text is rendered (escaped) by React,
 * and links open in a new tab without referrer or opener.
 */
export function Citations({
  sources,
  citations,
  title = 'Sources',
  className,
}: {
  sources?: readonly CitationRef[];
  citations?: readonly string[];
  title?: string;
  className?: string;
}) {
  const notes = buildFootnotes(sources, citations);
  if (notes.length === 0) return null;
  return (
    <footer className={cn('mt-4 text-left text-xs text-gray-600', className)} aria-label={title}>
      <h4 className="font-semibold text-gray-700">{title}</h4>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {notes.map((note) => (
          <li key={note.id}>
            <span className="font-medium">{note.label}</span>
            {note.attribution && <>: {note.url ? <a href={note.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{note.attribution}</a> : note.attribution}</>}
            {!note.attribution && note.url && <>: <a href={note.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">source</a></>}
            {note.retrieved && <span> (retrieved {note.retrieved})</span>}
          </li>
        ))}
      </ol>
    </footer>
  );
}
