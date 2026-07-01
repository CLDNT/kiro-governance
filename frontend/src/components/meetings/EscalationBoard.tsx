import { useState, FormEvent } from 'react';
import { useApiClient } from '@/lib/api';
import { Escalation } from '@/types';

interface EscalationBoardProps {
  projectId: string;
  escalations: Escalation[];
  isLoading: boolean;
  onRefresh: () => void;
}

type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ResolveModalState {
  isOpen: boolean;
  escalationId: number | null;
  resolvedDate: string;
  resolutionNotes: string;
}

function EscalationBoard({
  projectId,
  escalations,
  isLoading,
  onRefresh,
}: EscalationBoardProps): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<EscalationSeverity | 'all'>('all');
  const [resolveModal, setResolveModal] = useState<ResolveModalState>({
    isOpen: false,
    escalationId: null,
    resolvedDate: new Date().toISOString().split('T')[0],
    resolutionNotes: '',
  });
  const [formData, setFormData] = useState({
    raised_date: new Date().toISOString().split('T')[0],
    description: '',
    severity: 'high' as EscalationSeverity,
    raised_by: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [charCount, setCharCount] = useState(0);

  const client = useApiClient();

  // Filter escalations by severity
  const filteredEscalations = escalations.filter((e) =>
    severityFilter === 'all' ? true : e.severity === severityFilter
  );

  // Handle form submission for new escalation
  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (charCount > 2000) {
      setError('Description cannot exceed 2000 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await client.post(`/api/projects/${projectId}/escalations`, formData);
      setFormData({
        raised_date: new Date().toISOString().split('T')[0],
        description: '',
        severity: 'high',
        raised_by: '',
      });
      setCharCount(0);
      setShowForm(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create escalation');
    } finally {
      setLoading(false);
    }
  };

  // Handle resolve escalation
  const handleResolve = async (): Promise<void> => {
    if (!resolveModal.escalationId) return;

    setLoading(true);
    setError('');

    try {
      await client.patch(
        `/api/projects/${projectId}/escalations/${resolveModal.escalationId}`,
        {
          resolved_date: resolveModal.resolvedDate,
          resolution_notes: resolveModal.resolutionNotes || undefined,
        }
      );

      setResolveModal({
        isOpen: false,
        escalationId: null,
        resolvedDate: new Date().toISOString().split('T')[0],
        resolutionNotes: '',
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve escalation');
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: EscalationSeverity): string => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-500 text-red-900';
      case 'high':
        return 'bg-orange-100 border-orange-500 text-orange-900';
      case 'medium':
        return 'bg-yellow-100 border-yellow-500 text-yellow-900';
      case 'low':
        return 'bg-blue-100 border-blue-500 text-blue-900';
      default:
        return 'bg-gray-100 border-gray-500 text-gray-900';
    }
  };

  const getSeverityBadgeColor = (severity: EscalationSeverity): string => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500 text-white';
      case 'high':
        return 'bg-orange-500 text-white';
      case 'medium':
        return 'bg-yellow-500 text-white';
      case 'low':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Escalations</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancel' : 'Log Escalation'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* Log Escalation Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded border">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Raised Date *</label>
              <input
                type="date"
                required
                value={formData.raised_date}
                onChange={(e) => setFormData({ ...formData, raised_date: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity *</label>
              <select
                required
                value={formData.severity}
                onChange={(e) =>
                  setFormData({ ...formData, severity: e.target.value as EscalationSeverity })
                }
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Raised By *</label>
            <input
              type="text"
              required
              value={formData.raised_by}
              onChange={(e) =>
                setFormData({ ...formData, raised_by: e.target.value.slice(0, 200) })
              }
              maxLength={200}
              placeholder="Your name or role"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Description * ({charCount}/2000)
            </label>
            <textarea
              required
              value={formData.description}
              onChange={(e) => {
                const text = e.target.value.slice(0, 2000);
                setFormData({ ...formData, description: text });
                setCharCount(text.length);
              }}
              maxLength={2000}
              rows={4}
              placeholder="Describe the escalation issue"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading || charCount === 0}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 transition"
          >
            {loading ? 'Logging...' : 'Log Escalation'}
          </button>
        </form>
      )}

      {/* Severity Filter */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setSeverityFilter('all')}
          className={`px-3 py-1 rounded text-sm ${
            severityFilter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          All
        </button>
        {(['low', 'medium', 'high', 'critical'] as EscalationSeverity[]).map((severity) => (
          <button
            key={severity}
            onClick={() => setSeverityFilter(severity)}
            className={`px-3 py-1 rounded text-sm capitalize ${
              severityFilter === severity
                ? `${getSeverityBadgeColor(severity)}`
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {severity}
          </button>
        ))}
      </div>

      {/* Escalation List */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading escalations...</div>
      ) : filteredEscalations.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No escalations found</div>
      ) : (
        <div className="space-y-4">
          {filteredEscalations.map((escalation) => (
            <div
              key={escalation.id}
              className={`p-4 border-l-4 rounded ${getSeverityColor(escalation.severity)} ${
                escalation.status === 'open' ? 'border-l-red-500' : 'opacity-60'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold capitalize ${getSeverityBadgeColor(
                      escalation.severity
                    )}`}
                  >
                    {escalation.severity}
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      escalation.status === 'open'
                        ? 'bg-red-200 text-red-800'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    {escalation.status.toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-gray-600">{escalation.raised_date}</span>
              </div>

              <p className="mb-2 font-medium">Raised by: {escalation.raised_by}</p>
              <p className="mb-3 text-sm whitespace-pre-wrap">{escalation.description}</p>

              {escalation.status === 'open' && (
                <button
                  onClick={() =>
                    setResolveModal({
                      isOpen: true,
                      escalationId: escalation.id,
                      resolvedDate: new Date().toISOString().split('T')[0],
                      resolutionNotes: '',
                    })
                  }
                  className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition"
                >
                  Resolve
                </button>
              )}

              {escalation.status === 'resolved' && escalation.resolution_notes && (
                <p className="mt-2 text-sm bg-white bg-opacity-50 p-2 rounded">
                  <strong>Resolution:</strong> {escalation.resolution_notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resolve Modal */}
      {resolveModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Resolve Escalation</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Resolution Date *</label>
              <input
                type="date"
                required
                value={resolveModal.resolvedDate}
                onChange={(e) =>
                  setResolveModal({ ...resolveModal, resolvedDate: e.target.value })
                }
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                Resolution Notes (optional, max 2000 chars)
              </label>
              <textarea
                value={resolveModal.resolutionNotes}
                onChange={(e) =>
                  setResolveModal({
                    ...resolveModal,
                    resolutionNotes: e.target.value.slice(0, 2000),
                  })
                }
                maxLength={2000}
                rows={3}
                placeholder="How was this escalation resolved?"
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() =>
                  setResolveModal({
                    isOpen: false,
                    escalationId: null,
                    resolvedDate: new Date().toISOString().split('T')[0],
                    resolutionNotes: '',
                  })
                }
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? 'Resolving...' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EscalationBoard;
