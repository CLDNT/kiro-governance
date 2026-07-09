import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { MacroCheckpoint } from '@/types';
import ReviewerCombobox from './ReviewerCombobox';
import TranscriptAnalysisPanel from './TranscriptAnalysisPanel';

interface CheckpointModalProps {
  checkpoint: MacroCheckpoint;
  projectId: string;
  onClose: () => void;
}

function CheckpointModal({ checkpoint, projectId, onClose }: CheckpointModalProps): JSX.Element {
  const [formData, setFormData] = useState({
    reviewed_by: checkpoint.reviewed_by || '',
    occurred: checkpoint.occurred || false,
    meeting_date: checkpoint.meeting_date || '',
    meeting_link: checkpoint.meeting_link || '',
    result_detail: checkpoint.result_detail || '',
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const client = useApiClient();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {};

      if (checkpoint.checkpoint_type === 'human_review' && formData.reviewed_by) {
        payload.reviewed_by = formData.reviewed_by;
      }

      if (checkpoint.checkpoint_type === 'meeting') {
        if (formData.occurred) payload.occurred = true;
        if (formData.meeting_date) payload.meeting_date = formData.meeting_date;
        if (formData.meeting_link) payload.meeting_link = formData.meeting_link;
      }

      if (formData.result_detail) {
        payload.result_detail = formData.result_detail;
      }

      await client.patch(
        `/api/projects/${projectId}/checkpoints/${checkpoint.id}`,
        payload
      );

      queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update checkpoint');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-96 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-200 p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900">Mark Complete</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-danger-100 border border-danger-300 rounded-lg p-3">
              <p className="text-danger-700 text-sm">{error}</p>
            </div>
          )}

          <div>
            <p className="font-medium text-neutral-900 mb-1">{checkpoint.checkpoint_name}</p>
            <p className="text-sm text-neutral-600">{checkpoint.checkpoint_type}</p>
          </div>

          {checkpoint.checkpoint_type === 'human_review' && (
            <div>
              <label
                htmlFor="reviewed_by"
                className="block text-sm font-medium text-neutral-700 mb-2"
              >
                Reviewed By
              </label>
              <ReviewerCombobox
                id="reviewed_by"
                value={formData.reviewed_by}
                onChange={(reviewedBy) =>
                  setFormData({ ...formData, reviewed_by: reviewedBy })
                }
              />
            </div>
          )}

          {checkpoint.checkpoint_type === 'meeting' && (
            <>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.occurred}
                  onChange={(e) =>
                    setFormData({ ...formData, occurred: e.target.checked })
                  }
                  className="w-4 h-4 border-neutral-300 rounded cursor-pointer"
                />
                <span className="text-sm font-medium text-neutral-900">Meeting Occurred</span>
              </label>

              {formData.occurred && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Meeting Date
                    </label>
                    <input
                      type="date"
                      value={formData.meeting_date}
                      onChange={(e) =>
                        setFormData({ ...formData, meeting_date: e.target.value })
                      }
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Meeting Link (Optional)
                    </label>
                    <input
                      type="url"
                      value={formData.meeting_link}
                      onChange={(e) =>
                        setFormData({ ...formData, meeting_link: e.target.value })
                      }
                      placeholder="https://app.avoma.com/..."
                      className="w-full"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {checkpoint.checkpoint_type === 'transcript_analysis' && (
            <TranscriptAnalysisPanel checkpoint={checkpoint} projectId={projectId} />
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Result / Notes (Optional)
            </label>
            <textarea
              value={formData.result_detail}
              onChange={(e) =>
                setFormData({ ...formData, result_detail: e.target.value })
              }
              placeholder="Add any details about the checkpoint..."
              rows={3}
              className="w-full resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-neutral-200">
            <button
              type="submit"
              disabled={
                loading ||
                (checkpoint.checkpoint_type === 'human_review' && !formData.reviewed_by)
              }
              className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CheckpointModal;
