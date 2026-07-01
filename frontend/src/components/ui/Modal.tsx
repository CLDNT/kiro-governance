import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  /** Controls visibility. */
  isOpen: boolean;
  /** Called on ESC, backdrop click, or close-button click. */
  onClose: () => void;
  /** Optional header title. */
  title?: ReactNode;
  /** Optional footer slot (typically action buttons). */
  footer?: ReactNode;
  /** Width preset. @default 'md' */
  size?: ModalSize;
  /** Close when the backdrop is clicked. @default true */
  closeOnBackdrop?: boolean;
  children?: ReactNode;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Modal({
  isOpen,
  onClose,
  title,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  children,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusFirst = (): void => {
      const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusable && focusable.length > 0 ? focusable[0] : panel)?.focus();
    };
    focusFirst();

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="ds-animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={clsx(
          'ds-animate-slide-up w-full rounded-[var(--radius-lg)] border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] focus:outline-none',
          sizeClasses[size],
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-[var(--radius-md)] p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
        </div>
        <div className="px-5 py-4 text-[var(--text-secondary)]">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
