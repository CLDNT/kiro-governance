import { useState, FormEvent } from 'react';
import { useApiClient } from '@/lib/api';
import { DiscoverySession } from '@/types';

interface DiscoverySessionsProps {
  projectId: string;
  sessions: DiscoverySession[];
  isLoading: boolean;
  onRefresh: () => void;
}

interface FormData {
  session_date: string;
  meeting_link: string;
  participants: string;
  notes: string;
}

function DiscoverySessionsSection({
  projectId,
  sessions,
  isLoading,
  onRefresh,
}: DiscoverySessionsProps): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    session_date: new Date().toISOString().split('T')[0],
    meeting_link: '',
    participants: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notesCharCount, setNotesCharCount] = useState(0);

  const client = useApiClient();

  // Sort sessions by session_number ascending (oldest first)
  const sortedSessions = [...sessions].sort((a, b) => a.session_number - b.session_number);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    if (!formData.participants.trim()) {
      setError('Participants field is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await client.post(`/api/projects/${projectId}/discovery-sessions`, {
        session_date: formData.session_date,
        meeting_link: formData.meeting_link || undefined,
        participants: formData.participants,
        notes: formData.notes || undefined,
      });

      // Reset form
      setFormData({
        session_date: new Date().toISOString().split('T')[0],
        meeting_link: '',
        participants: '',
        notes: '',
      });
      setNotesCharCount(0);
      setShowForm(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log discovery session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Discovery Sessions</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          {showForm ? 'Cancel' : 'Log Session'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* Log Session Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded border">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Session Date *</label>
              <input
                type="date"
                required
                value={formData.session_date}
                onChange={(e) => setFormData({ ...formData, session_date: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Session Number</label>
              <div className="px-3 py-2 bg-gray-100 rounded text-gray-600">
                Auto-assigned #{sortedSessions.length + 1}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Meeting Link (optional)</label>
            <input
              type="url"
              placeholder="https://app.avoma.com/... or Zoom URL"
              value={formData.meeting_link}
              onChange={(e) => setFormData({ ...formData, meeting_link: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Participants *</label>
            <input
              type="text"
              required
              value={formData.participants}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  participants: e.target.value.slice(0, 1000),
                })
              }
              maxLength={1000}
              placeholder="e.g., John (PM), Jane (SA), Client Lead"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">{formData.participants.length}/1000</p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Notes (optional, {notesCharCount}/4000)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => {
                const text = e.target.value.slice(0, 4000);
                setFormData({ ...formData, notes: text });
                setNotesCharCount(text.length);
              }}
              maxLength={4000}
              rows={4}
              placeholder="Key discussion points, decisions, action items"
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !formData.participants.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 transition"
          >
            {loading ? 'Logging...' : 'Log Discovery Session'}
          </button>
        </form>
      )}

      {/* Sessions List */}
      {isLoading ? (
        <div className="text-center py-8 text-gray-500">Loading discovery sessions...</div>
      ) : sortedSessions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No discovery sessions logged yet</div>
      ) : (
        <div className="space-y-4">
          {sortedSessions.map((session) => (
            <div
              key={session.id}
              className="p-4 border-l-4 border-blue-500 rounded bg-blue-50 hover:bg-blue-100 transition"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <span className="inline-block px-3 py-1 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    Session #{session.session_number}
                  </span>
                  <span className="text-sm text-gray-600">{session.session_date}</span>
                </div>
                <span className="text-xs text-gray-500">
                  Logged: {new Date(session.created_at).toLocaleDateString()}
                </span>
              </div>

              <div className="mb-2">
                <p className="text-sm font-medium text-gray-700">
                  <strong>Participants:</strong> {session.participants}
                </p>
              </div>

              {session.meeting_link && (
                <div className="mb-2">
                  <a
                    href={session.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    📹 {session.meeting_link}
                  </a>
                </div>
              )}

              {session.notes && (
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <p className="text-sm whitespace-pre-wrap bg-white bg-opacity-50 p-2 rounded">
                    {session.notes}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state hint */}
      {!showForm && sortedSessions.length === 0 && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          Discovery sessions are foundational kickoff meetings. Use this section to track and document your
          discovery process with the client.
        </div>
      )}
    </div>
  );
}

export default DiscoverySessionsSection;
