import { useState } from 'react';
import { useApiClient } from '@/lib/api';
import { MicroArtifact } from '@/types';

interface MicroArtifactItemProps {
  artifact: MicroArtifact;
  projectId: string;
  canEdit: boolean;
  onStatusChange: () => void;
}

type ArtifactStatus = 'pending' | 'in_progress' | 'complete';

function MicroArtifactItem({
  artifact,
  projectId,
  canEdit,
  onStatusChange,
}: MicroArtifactItemProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const client = useApiClient();

  const handleStatusChange = async (newStatus: ArtifactStatus): Promise<void> => {
    setLoading(true);
    setError('');

    try {
      await client.patch(
        `/api/projects/${projectId}/artifacts/${artifact.id}`,
        { status: newStatus }
      );
      onStatusChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update artifact status');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: ArtifactStatus): string => {
    switch (status) {
      case 'pending':
        return 'bg-gray-100 border-gray-300 text-gray-700';
      case 'in_progress':
        return 'bg-yellow-100 border-yellow-300 text-yellow-700';
      case 'complete':
        return 'bg-green-100 border-green-300 text-green-700';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-700';
    }
  };

  const getStatusLabel = (status: ArtifactStatus): string => {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'in_progress':
        return 'In Progress';
      case 'complete':
        return 'Complete';
      default:
        return status;
    }
  };

  const statusOrder: ArtifactStatus[] = ['pending', 'in_progress', 'complete'];

  return (
    <div className={`p-4 border rounded-lg transition ${getStatusColor(artifact.status)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h4 className="font-semibold text-sm mb-1">{artifact.artifact_name}</h4>
          <p className="text-xs text-gray-600">Phase: {artifact.phase}</p>
        </div>

        {/* Status Badge */}
        <div className="ml-4 flex items-center gap-2">
          <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getStatusColor(artifact.status)}`}>
            {getStatusLabel(artifact.status)}
          </span>
        </div>
      </div>

      {/* Completion Info */}
      {artifact.status === 'complete' && artifact.completed_at && (
        <div className="mt-2 text-xs text-gray-600">
          <span>✓ Completed {new Date(artifact.completed_at).toLocaleDateString()}</span>
          {artifact.completed_by && <span> by {artifact.completed_by}</span>}
        </div>
      )}

      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Status Controls */}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          {statusOrder.map((status) => (
            <button
              key={status}
              onClick={() => handleStatusChange(status)}
              disabled={loading}
              className={`px-2 py-1 text-xs rounded transition ${
                artifact.status === status
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {status === 'pending' && '○ Pending'}
              {status === 'in_progress' && '⟳ In Progress'}
              {status === 'complete' && '✓ Complete'}
            </button>
          ))}
        </div>
      )}

      {!canEdit && (
        <div className="mt-2 text-xs text-gray-500 italic">
          View-only. Contact PM/SA to change status.
        </div>
      )}
    </div>
  );
}

export default MicroArtifactItem;
