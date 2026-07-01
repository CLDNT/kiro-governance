import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import clsx from 'clsx';

export interface Breadcrumb {
  label: string;
  /** Router path. Omit for the current (non-clickable) page. */
  href?: string;
}

export interface PageHeaderProps {
  /** Page title. */
  title: string;
  /** Optional subtitle below the title. */
  subtitle?: string;
  /** Optional breadcrumb trail rendered above the title. */
  breadcrumbs?: Breadcrumb[];
  /** Right-aligned actions slot (buttons, menus). */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions, className }: PageHeaderProps): JSX.Element {
  return (
    <header className={clsx('flex flex-col gap-3 pb-5', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-[var(--text-muted)]">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Fragment key={`${crumb.label}-${i}`}>
                  <li>
                    {crumb.href && !isLast ? (
                      <Link
                        to={crumb.href}
                        className="transition-colors hover:text-[var(--text-primary)]"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? 'page' : undefined} className={clsx(isLast && 'text-[var(--text-secondary)]')}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                  {!isLast && (
                    <li aria-hidden="true">
                      <ChevronRightIcon className="h-4 w-4" />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{title}</h1>
          {subtitle && <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export default PageHeader;
