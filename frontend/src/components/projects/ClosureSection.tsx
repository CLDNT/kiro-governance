import { useState } from 'react';
import { useApiClient } from '@/lib/api';

interface ClosureSectionProps {
  projectId: string;
  projectStatus: string;
  onClosureComplete: () => void;
}

interface ClosureItem {
  id: string;
  label: string;
  completed: boolean;
}

interface ConfirmModalState {
  isOpen: boolean;
}

function ClosureSection({
  projectId,
  projectStatus,
  onClosureComplete,
}: ClosureSectionProps): JSX.Element {
  const [closureItems, setClosureItems] = useState<ClosureItem[]>([
    { id: 'knowledge-transfer', label: 'Knowledge transfer completed', completed: false },
    { id: 'documentation', label: 'Documentation finalized and handed off', completed: false },
    { id: 'stakeholder-signoff', label: 'Stakeholder sign-off received', completed: false },
    { id: 'final-handover', label: 'Final handover checklist completed', completed: false },
  ]);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ isOpen: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const client = useApiClient();

  // Check if all items are completed
  const allComplete = closureItems.every((item) => item.completed);

  const handleItemToggle = (itemId: string): void => {
    setClosureItems(
      closureItems.map((item) =>
        item.id === itemId ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const handleCloseProject = async (): Promise<void> => {
    if (!allComplete) {
      setError('All closure items must be completed before closing the project');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // This would call an endpoint to mark the project as Closed
      // For now, we'll show a success message
      await client.patch(`/api/projects/${projectId}`, {
        status: 'Closed',
      });

      setConfirmModal({ isOpen: false });
      onClosureComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close project');
    } finally {
      setLoading(false);
    }
  };

  // Show this component only if project status is not already closed
  if (projectStatus === 'Closed') {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-2xl font-bold mb-4">Project Closure</h2>
        <div className="p-4 bg-green-50 border border-green-200 rounded text-green-700">
          ✅ This project has been marked as closed.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Project Closure</h2>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded border border-red-200">
          {error}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4">Closure Checklist</h3>
        <p className="text-sm text-gray-600 mb-4">
          Complete all items below before you can close the project. This ensures a smooth handoff
          to the client or operations team.
        </p>

        <div className="space-y-3">
          {closureItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center p-3 border rounded hover:bg-gray-50 transition"
            >
              <input
                type="checkbox"
                id={item.id}
                checked={item.completed}
                onChange={() => handleItemToggle(item.id)}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <label
                htmlFor={item.id}
                className={`ml-3 text-sm cursor-pointer flex-1 ${
                  item.completed
                    ? 'text-gray-500 line-through'
                    : 'text-gray-700 font-medium'
                }`}
              >
                {item.label}
              </label>
              {item.completed && <span className="text-green-600 text-lg">✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">Completion Progress</span>
          <span className="text-sm text-gray-600">
            {closureItems.filter((i) => i.completed).length}/{closureItems.length}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              allComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{
              width: `${(closureItems.filter((i) => i.completed).length / closureItems.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Close Project Button */}
      {allComplete && (
        <div className="p-4 bg-green-50 border border-green-200 rounded mb-4">
          <p className="text-sm text-green-700 mb-3">
            ✅ All closure items are complete. You can now close this project.
          </p>
          <button
            onClick={() => setConfirmModal({ isOpen: true })}
            className="w-full px-4 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700 transition"
          >
            Close Project
          </button>
        </div>
      )}

      {!allComplete && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-sm text-yellow-700">
            ⚠️ Complete all closure items above before you can close the project.
          </p>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2">Close Project?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to close this project? This action marks the project as
              completed. You will not be able to add new checkpoints or status updates after closing.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModal({ isOpen: false })}
                disabled={loading}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 disabled:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseProject}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
              >
                {loading ? 'Closing...' : 'Yes, Close Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
        <strong>Final checklist:</strong> This closure checklist represents the final handoff
        requirements. Ensure all stakeholders are aligned before proceeding.
      </div>
    </div>
  );
}

export default ClosureSection;
