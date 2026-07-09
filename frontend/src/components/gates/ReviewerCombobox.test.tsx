/**
 * ReviewerCombobox — searchable reviewer picker with graceful free-text fallback.
 *
 * Covers:
 *  - directory success: renders a combobox, searches by name/email, selecting sends the email;
 *  - graceful degradation: API error and empty directory both fall back to a free-text field;
 *  - loading state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The hook under the component calls useApiClient().get(...). Mock the API client so no real
// axios instance is created and we can drive success / error / empty responses.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api', () => ({
  useApiClient: () => ({ get: getMock }),
}));

import ReviewerCombobox from './ReviewerCombobox';

const USERS = [
  { name: 'Jane Doe', email: 'jane@example.com', role: 'sa' },
  { name: 'John Smith', email: 'john@example.com', role: 'leadership' },
];

function renderCombobox(value = '', onChange = vi.fn()): { onChange: ReturnType<typeof vi.fn> } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewerCombobox value={value} onChange={onChange} id="reviewed_by" />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('<ReviewerCombobox />', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  describe('directory available', () => {
    beforeEach(() => {
      getMock.mockResolvedValue({ data: { users: USERS } });
    });

    it('renders a searchable combobox once users load', async () => {
      renderCombobox();
      expect(await screen.findByRole('combobox', { name: /reviewed by/i })).toBeInTheDocument();
    });

    it('searches by name/email and sends the selected user email to onChange', async () => {
      const user = userEvent.setup();
      const { onChange } = renderCombobox();

      const trigger = await screen.findByRole('combobox', { name: /reviewed by/i });
      await user.click(trigger);

      const search = await screen.findByPlaceholderText(/search by name or email/i);
      await user.type(search, 'john');

      const option = await screen.findByText(/john@example\.com/i);
      await user.click(option);

      expect(onChange).toHaveBeenCalledWith('john@example.com');
    });

    it('shows the current selection as "Name (email)"', async () => {
      renderCombobox('jane@example.com');
      expect(
        await screen.findByRole('combobox', { name: /reviewed by/i }),
      ).toHaveTextContent('Jane Doe (jane@example.com)');
    });
  });

  describe('graceful fallback', () => {
    it('falls back to a free-text input when the directory API fails', async () => {
      getMock.mockRejectedValue(new Error('network'));
      const { onChange } = renderCombobox();

      const input = await screen.findByPlaceholderText('Reviewer name or email');
      expect(input).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

      const user = userEvent.setup();
      await user.type(input, 'Manual Reviewer');
      // Free-text still records a reviewer.
      expect(onChange).toHaveBeenCalled();
    });

    it('falls back to a free-text input when the directory is empty', async () => {
      getMock.mockResolvedValue({ data: { users: [] } });
      renderCombobox();

      expect(await screen.findByPlaceholderText('Reviewer name or email')).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
  });

  describe('loading', () => {
    it('shows a loading state while the directory is being fetched', async () => {
      getMock.mockReturnValue(new Promise(() => {})); // never resolves
      renderCombobox();

      await waitFor(() => {
        expect(screen.getByText(/loading reviewers/i)).toBeInTheDocument();
      });
    });
  });
});
