import clsx from 'clsx';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerColor = 'primary' | 'white' | 'muted';

export interface SpinnerProps {
  /** Diameter preset. @default 'md' */
  size?: SpinnerSize;
  /** Stroke color. @default 'primary' */
  color?: SpinnerColor;
  /** Accessible label for screen readers. @default 'Loading' */
  label?: string;
  className?: string;
}

const sizeMap: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
};

const colorMap: Record<SpinnerColor, string> = {
  primary: 'border-[var(--color-primary-600)] border-t-transparent',
  white: 'border-white border-t-transparent',
  muted: 'border-[var(--text-muted)] border-t-transparent',
};

export function Spinner({ size = 'md', color = 'primary', label = 'Loading', className }: SpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx('inline-block animate-spin rounded-full', sizeMap[size], colorMap[color], className)}
    />
  );
}

export default Spinner;
