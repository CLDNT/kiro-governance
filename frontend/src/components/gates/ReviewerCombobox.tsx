import { useState } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useUsers } from '@/hooks/useUsers';

interface ReviewerComboboxProps {
  /** Current reviewed_by value (user email, user name, or legacy free-text). */
  value: string;
  /** Called with the value to persist as reviewed_by. */
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
}

// Shared look so the combobox trigger / loading state / free-text fallback are visually
// consistent with the other inputs in the modal (neutral Tailwind palette).
const fieldClasses =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 ' +
  'placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-600';

/**
 * Searchable reviewer picker. Fetches the user directory and renders a combobox
 * (Popover + Command). Falls back to a plain free-text field while loading fails, the
 * directory is empty, or the endpoint is unavailable — a reviewer can always be recorded.
 */
function ReviewerCombobox({ value, onChange, id, disabled }: ReviewerComboboxProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { data: users, isLoading, isError } = useUsers();

  if (isLoading) {
    return (
      <div
        className={cn(fieldClasses, 'flex items-center justify-between text-neutral-500')}
        aria-busy="true"
      >
        <span>Loading reviewers…</span>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // Requirement (5): degrade gracefully to free-text on error or empty directory.
  const canUseDirectory = !isError && !!users && users.length > 0;

  if (!canUseDirectory) {
    return (
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Reviewer name or email"
        disabled={disabled}
        className={fieldClasses}
      />
    );
  }

  const selected = users.find((u) => u.email === value || u.name === value);
  const triggerLabel = selected
    ? `${selected.name} (${selected.email})`
    : value || 'Select reviewer…';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="Reviewed by"
          disabled={disabled}
          className={cn(
            fieldClasses,
            'flex items-center justify-between text-left',
            !selected && !value && 'text-neutral-400',
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name or email…" />
          <CommandList>
            <CommandEmpty>No matching user.</CommandEmpty>
            <CommandGroup>
              {users.map((user) => {
                const isSelected = user.email === value || user.name === value;
                return (
                  <CommandItem
                    // cmdk filters on `value` — include both name and email so the search
                    // box matches either. Requirement (3).
                    key={user.email}
                    value={`${user.name} ${user.email}`}
                    onSelect={() => {
                      // reviewed_by is a free-text column; persist the email as the stable,
                      // unique identifier (matches the Cognito audit actor). Requirement (4).
                      onChange(user.email);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {user.name} <span className="text-neutral-500">({user.email})</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default ReviewerCombobox;
