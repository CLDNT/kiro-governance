/**
 * MicroArtifactItem — Level-2 provenance UI (CR-12 / FR-P2-042), spec §8 DoD row:
 *   "`kiro:` prefix → kiro badge + 'by Kiro (actor)'; non-prefixed complete → manual badge;
 *    override chip when `manual_override`; sync button admin/leadership only."
 *
 * These cover the UX-only role gates (the backend is the real RBAC + audit enforcer):
 *  - kiro auto-completion badge vs manual completion badge;
 *  - the manual-override chip;
 *  - admin/leadership-only visibility of the reset-to-auto (auto-sync) control + edit gating.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { MicroArtifact } from '@/types';
import type { Role } from '@/lib/linkage';

// The component calls useApiClient().patch(...) inside a react-query mutation.
// Mock the API client so no real axios instance is created and we can assert the PATCH body.
const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  useApiClient: () => ({ patch: patchMock }),
}));

import MicroArtifactItem from './MicroArtifactItem';

function makeArtifact(overrides: Partial<MicroArtifact> = {}): MicroArtifact {
  return {
    id: 1,
    artifact_name: 'Domain decomposition done',
    phase: 'phase2',
    phase_name: 'Phase 2 — Design & Review',
    status: 'complete',
    completed_at: '2026-07-07T10:00:00.000Z',
    completed_by: 'kiro:aws-architect',
    manual_override: false,
    ...overrides,
  };
}

function renderItem(artifact: MicroArtifact, role: Role | null | undefined): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MicroArtifactItem artifact={artifact} projectId="proj-1" role={role} />
    </QueryClientProvider>
  );
}

describe('<MicroArtifactItem /> — Level-2 provenance + RBAC (CR-12 / FR-P2-042)', () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockResolvedValue({ data: {} });
  });

  describe('kiro auto-completion vs manual completion badge', () => {
    it('renders the "kiro" source badge when completed_by starts with "kiro:"', () => {
      renderItem(makeArtifact({ completed_by: 'kiro:aws-architect' }), 'pm');

      expect(screen.getByTestId('kiro-badge')).toBeInTheDocument();
      expect(screen.getByTestId('kiro-badge')).toHaveTextContent('kiro');
      expect(screen.queryByTestId('manual-badge')).not.toBeInTheDocument();
    });

    it('labels the completion as "Kiro (actor)" for a kiro:-prefixed completed_by', () => {
      renderItem(makeArtifact({ completed_by: 'kiro:aws-architect' }), 'pm');

      const info = screen.getByTestId('completion-info');
      expect(info).toHaveTextContent(/Kiro \(aws-architect\)/);
    });

    it('renders the "Manual" badge (not kiro) for a non-prefixed completed row', () => {
      renderItem(
        makeArtifact({ completed_by: 'jane@example.com', manual_override: false }),
        'pm'
      );

      expect(screen.getByTestId('manual-badge')).toBeInTheDocument();
      expect(screen.queryByTestId('kiro-badge')).not.toBeInTheDocument();
      // Human email is surfaced verbatim, not relabelled as Kiro.
      expect(screen.getByTestId('completion-info')).toHaveTextContent('jane@example.com');
    });

    it('shows neither source badge while the artifact is not complete', () => {
      renderItem(
        makeArtifact({ status: 'pending', completed_at: null, completed_by: null }),
        'pm'
      );

      expect(screen.queryByTestId('kiro-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('manual-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('completion-info')).not.toBeInTheDocument();
    });
  });

  describe('manual-override chip', () => {
    it('renders the "Manual override" chip when manual_override is true', () => {
      renderItem(makeArtifact({ manual_override: true }), 'pm');
      expect(screen.getByTestId('override-badge')).toHaveTextContent(/manual override/i);
    });

    it('does not render the override chip when manual_override is false', () => {
      renderItem(makeArtifact({ manual_override: false }), 'pm');
      expect(screen.queryByTestId('override-badge')).not.toBeInTheDocument();
    });
  });

  describe('RBAC — edit (status toggle) gating (UX-only)', () => {
    it.each<Role>(['pm', 'sa', 'leadership', 'admin'])(
      'shows the status toggle group for %s',
      (role) => {
        renderItem(makeArtifact(), role);
        expect(
          screen.getByRole('group', { name: /set status for/i })
        ).toBeInTheDocument();
        expect(screen.queryByText(/view-only/i)).not.toBeInTheDocument();
      }
    );

    it('hides the status toggle group and shows the view-only notice for engineer', () => {
      renderItem(makeArtifact(), 'engineer');
      expect(
        screen.queryByRole('group', { name: /set status for/i })
      ).not.toBeInTheDocument();
      expect(screen.getByText(/view-only/i)).toBeInTheDocument();
    });

    it('is view-only when the role is missing', () => {
      renderItem(makeArtifact(), null);
      expect(
        screen.queryByRole('group', { name: /set status for/i })
      ).not.toBeInTheDocument();
      expect(screen.getByText(/view-only/i)).toBeInTheDocument();
    });
  });

  describe('RBAC — reset-to-auto (re-enable Kiro auto-sync) gating (UX-only)', () => {
    it.each<Role>(['admin', 'leadership'])(
      'shows the "Reset to auto" control for %s on an overridden row',
      (role) => {
        renderItem(makeArtifact({ manual_override: true }), role);
        expect(
          screen.getByRole('button', { name: /reset to auto/i })
        ).toBeInTheDocument();
      }
    );

    it.each<Role>(['pm', 'sa'])(
      'hides the "Reset to auto" control for %s even on an overridden row',
      (role) => {
        renderItem(makeArtifact({ manual_override: true }), role);
        expect(
          screen.queryByRole('button', { name: /reset to auto/i })
        ).not.toBeInTheDocument();
      }
    );

    it('does not show "Reset to auto" for admin when there is no manual override', () => {
      renderItem(makeArtifact({ manual_override: false }), 'admin');
      expect(
        screen.queryByRole('button', { name: /reset to auto/i })
      ).not.toBeInTheDocument();
    });

    it('PATCHes reset_to_auto when admin clicks "Reset to auto"', async () => {
      renderItem(makeArtifact({ manual_override: true, status: 'complete' }), 'admin');

      await userEvent.click(screen.getByRole('button', { name: /reset to auto/i }));

      expect(patchMock).toHaveBeenCalledWith('/api/projects/proj-1/artifacts/1', {
        status: 'complete',
        reset_to_auto: true,
      });
    });
  });
});
