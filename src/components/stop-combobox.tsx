'use client';

import { useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { filterStops, type StopOption } from '@/lib/stops/types';

// Rendering thousands of rows at once is slow; the rider narrows the list by typing.
export const MAX_VISIBLE_STOPS = 100;

export interface StopComboboxProps {
  /** Visible label text; also the accessible name of the trigger and the listbox. */
  label: string;
  placeholder: string;
  options: readonly StopOption[];
  value: StopOption | null;
  onChange: (option: StopOption | null) => void;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Id of an element describing an error, linked with aria-describedby. */
  errorId?: string;
  className?: string;
}

/**
 * A searchable stop picker (shadcn Popover + Command). The trigger is a labeled combobox; typing filters by stop
 * name, stop id, or route; arrows and Enter pick a stop; Escape closes. Filtering happens in the browser on the
 * list /api/stops already returned, so what a rider types is never sent anywhere.
 */
export function StopCombobox({ label, placeholder, options, value, onChange, loading, disabled, invalid, errorId, className }: StopComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const labelId = useId();
  const listId = useId();
  const visible = useMemo(() => filterStops(options, query, MAX_VISIBLE_STOPS), [options, query]);
  const truncated = visible.length === MAX_VISIBLE_STOPS && options.length > MAX_VISIBLE_STOPS;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={labelId} className={cn('text-sm font-medium', invalid ? 'text-red-700' : 'text-gray-700')}>
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-labelledby={labelId}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
            disabled={disabled || loading}
            className={cn('w-full justify-between font-normal', value ? 'text-black' : 'text-slate-500')}
          >
            <span className="truncate">{loading ? 'Loading stops…' : value ? value.name : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0" align="start">
          <Command shouldFilter={false} label={label}>
            <CommandInput placeholder="Search by stop name or route…" value={query} onValueChange={setQuery} aria-label={`Search ${label.toLowerCase()}`} />
            <CommandList id={listId} aria-labelledby={labelId}>
              <CommandEmpty>No stop matches.</CommandEmpty>
              <CommandGroup>
                {visible.map((option) => (
                  <CommandItem
                    key={option.key}
                    value={option.key}
                    onSelect={() => {
                      onChange(option.key === value?.key ? null : option);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <Check className={cn('h-4 w-4', option.key === value?.key ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    <span className="flex flex-col">
                      <span>{option.name}</span>
                      {option.routes.length > 0 && <span className="text-xs text-slate-500">Routes {option.routes.join(', ')}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {truncated && <p className="px-3 py-2 text-xs text-slate-500">Showing the first {MAX_VISIBLE_STOPS} matches; type to narrow the list.</p>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
