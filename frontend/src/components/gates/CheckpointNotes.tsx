import { useState, FormEvent } from 'react';
import { useApiClient } from '@/lib/api';
import { GateNote } from '@/types';

interface CheckpointNotesProps {
  projectId: string;
  checkpointId: number;
  checkpointName: string;
  notes: GateNote[];
  isLoading: boolean;
  onRefresh: () => void;
}

function CheckpointNotes({
  projectId,
  checkpointId,
  checkpointName: _checkpointName,
  notes,
  isLoading,
  onRefresh,
}: CheckpointNotesProps): JSX.Element {
  const [noteText, setNoteText] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const client = useApiClient();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    if (!noteText.trim()) {
      setError('Note cannot be empty');
      return;
    }

    if (charCount > 4000) {
      setError('Note cannot exceed 4000 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await client.post(
        `/api/projects/${projectId}/checkpoints/${checkpointId}/notes`,
        {
          note_text: noteText.trim(),
        }
      );

      setNoteText('');
      setCharCount(0);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h3 className="text-xl font-bold mb-4">Checkpoint Notes</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded border border-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Add Note Form */}
      <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded border">
        <label className="block text-sm font-medium mb-2">
          Add a note ({charCount}/4000)
        </label>
        <textarea
          value={noteText}
          onChange={(e) => {
            const text = e.target.value.slice(0, 4000);
            setNoteText(text);
            setCharCount(text.length);
          }}
          maxLength={4000}
          rows={3}
          placeholder="Add checkpoint notes (append-only audit trail)"
          className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end mt-2">
          <button
            type="submit"
            disabled={loading || charCount === 0 || charCount > 4000}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition text-sm"
          >
            {loading ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </form>

      {/* Notes List */}
      {isLoading ? (
        <div className="text-center py-6 text-gray-500">Loading notes...</div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6 text-gray-500 bg-gray-50 rounded">No notes yet</div>
      ) : (
        <div className="space-y-3">
          {[...notes].reverse().map((note) => (
            <div
              key={note.id}
              className="p-3 border-l-4 border-gray-400 bg-gray-50 rounded hover:bg-gray-100 transition"
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-sm font-medium text-gray-900">{note.author}</span>
                <span className="text-xs text-gray-500">
                  {new Date(note.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.note_text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
        <strong>Append-only:</strong> All notes are permanent and maintain a complete audit trail. This
        ensures full transparency on checkpoint progress and decisions.
      </div>
    </div>
  );
}

export default CheckpointNotes;
