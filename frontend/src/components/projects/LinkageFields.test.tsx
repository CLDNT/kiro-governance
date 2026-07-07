import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LinkageFields } from './LinkageFields';
import { EMPTY_LINKAGE_VALUES, type LinkageValues } from '@/lib/linkage';

function values(overrides: Partial<LinkageValues> = {}): LinkageValues {
  return { ...EMPTY_LINKAGE_VALUES, ...overrides };
}

describe('<LinkageFields />', () => {
  it('renders all four linkage inputs and the non-secret warning', () => {
    render(
      <LinkageFields mode="create" values={values()} errors={{}} onChange={() => {}} />
    );
    expect(screen.getByLabelText('GitHub repo')).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Slack micro-channel id')).toBeInTheDocument();
    expect(screen.getByLabelText('Slack macro-channel id')).toBeInTheDocument();
    expect(screen.getByText(/the workspace token is stored server-side only/i)).toBeInTheDocument();
  });

  it('renders a valid github_url as a safe external link (rel=noopener noreferrer)', () => {
    render(
      <LinkageFields
        mode="create"
        values={values({ github_url: 'https://github.com/org/repo' })}
        errors={{}}
        onChange={() => {}}
      />
    );
    const link = screen.getByRole('link', { name: /open repository/i });
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not render a link for an invalid github_url', () => {
    render(
      <LinkageFields
        mode="create"
        values={values({ github_url: 'http://evil.com/x' })}
        errors={{}}
        onChange={() => {}}
      />
    );
    expect(screen.queryByRole('link', { name: /open repository/i })).not.toBeInTheDocument();
  });

  it('shows an inline error with role=alert and marks the field invalid', () => {
    render(
      <LinkageFields
        mode="create"
        values={values({ github_repo: 'bad repo' })}
        errors={{ github_repo: 'Invalid characters' }}
        onChange={() => {}}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid characters');
    expect(screen.getByLabelText('GitHub repo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('fires onChange with the field name and value', async () => {
    const onChange = vi.fn();
    render(
      <LinkageFields mode="create" values={values()} errors={{}} onChange={onChange} />
    );
    await userEvent.type(screen.getByLabelText('GitHub repo'), 'x');
    expect(onChange).toHaveBeenCalledWith('github_repo', 'x');
  });

  it('shows the FR-P2-040 warning when re-pointing an existing repo (edit mode)', () => {
    render(
      <LinkageFields
        mode="edit"
        originalRepo="old-repo"
        values={values({ github_repo: 'new-repo' })}
        errors={{}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/historical-event visibility/i)).toBeInTheDocument();
    expect(screen.getByText(/re-pointing/i)).toBeInTheDocument();
  });

  it('shows a clearing-specific warning when the repo is cleared (edit mode)', () => {
    render(
      <LinkageFields
        mode="edit"
        originalRepo="old-repo"
        values={values({ github_repo: '' })}
        errors={{}}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/clearing the github repo/i)).toBeInTheDocument();
  });

  it('does not warn in create mode', () => {
    render(
      <LinkageFields
        mode="create"
        values={values({ github_repo: 'repo' })}
        errors={{}}
        onChange={() => {}}
      />
    );
    expect(screen.queryByText(/historical-event visibility/i)).not.toBeInTheDocument();
  });
});
