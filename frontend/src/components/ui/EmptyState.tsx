import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface EmptyStateProps {
  /** Icon or illustration rendered above the title. */
  icon?: ReactNode;
  /** Primary message. */
  title: string;
  /** Optional supporting description. */
  description?: string;
  /** Optional call-to-action (typically a Button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps): JSX.Element {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-color)] px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center text-[var(--text-muted)] [&>svg]:h-12 [&>svg]:w-12">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export default EmptyState;
