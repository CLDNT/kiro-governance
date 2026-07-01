import { FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { MacroCheckpoint } from '@/types';

interface EvidenceModalProps {
  checkpoint: MacroCheckpoint;
  projectId: string;
  onClose: () => void;
}

function EvidenceModal({ checkpoint, projectId, onClose }: EvidenceModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'link' | 'file' | 'url'>('link');
  const [meetingLink, setMeetingLink] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const client = useApiClient();
  const queryClient = useQueryClient();

  const validateMeetingLink = (link: string): boolean => {
    return link.startsWith('https://app.avoma.com/');
  };

  const handleLinkSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!validateMeetingLink(meetingLink)) {
      setError('Meeting link must be from https://app.avoma.com/');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await client.post(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/evidence`, {
        evidence_type: 'meeting_link',
        value: meetingLink,
      });

      queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add evidence');
    } finally {
      setLoading(false);
    }
  };

  const handleUrlSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await client.post(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/evidence`, {
        evidence_type: 'url',
        value: url,
      });

      queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add evidence');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      setError('File size must be less than 25MB');
      return;
    }

    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'text/plain',
      'text/markdown',
    ];

    if (!allowedTypes.includes(file.type)) {
      setError('File type not supported. Allowed: PDF, DOCX, XLSX, PNG, JPG, TXT, MD');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // In a real app, you would:
      // 1. Get presigned URL from backend
      // 2. Upload to S3
      // 3. Submit evidence with S3 key

      // For now, simulate the upload
      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      setUploadProgress(100);

      await client.post(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/evidence`, {
        evidence_type: 'file_upload',
        value: `s3://deliverpro-evidence/${projectId}/${file.name}`,
        label: file.name,
      });

      queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload file');
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-96 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-neutral-200 p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900">Add Evidence</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 pt-6">
          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b border-neutral-200">
            <button
              onClick={() => setActiveTab('link')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'link'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Meeting Link
            </button>
            <button
              onClick={() => setActiveTab('file')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'file'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              File Upload
            </button>
            <button
              onClick={() => setActiveTab('url')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'url'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              URL
            </button>
          </div>

          {error && (
            <div className="mb-4 bg-danger-100 border border-danger-300 rounded-lg p-3">
              <p className="text-danger-700 text-sm">{error}</p>
            </div>
          )}

          {/* Meeting Link Tab */}
          {activeTab === 'link' && (
            <form onSubmit={handleLinkSubmit} className="pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Avoma Meeting Link
                </label>
                <input
                  type="url"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="https://app.avoma.com/..."
                  required
                  className="w-full"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Must be from app.avoma.com domain
                </p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Adding...' : 'Add Evidence'}
              </button>
            </form>
          )}

          {/* File Upload Tab */}
          {activeTab === 'file' && (
            <form onSubmit={handleFileSubmit} className="pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  Choose File
                </label>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  accept=".pdf,.docx,.xlsx,.png,.jpg,.txt,.md"
                  className="w-full"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Max 25MB: PDF, DOCX, XLSX, PNG, JPG, TXT, MD
                </p>
              </div>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="w-full bg-neutral-200 rounded-full h-2">
                  <div
                    className="bg-primary-600 h-2 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              )}
              <button
                type="submit"
                disabled={loading || !file}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Uploading...' : 'Upload'}
              </button>
            </form>
          )}

          {/* URL Tab */}
          {activeTab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-2">
                  External URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  required
                  className="w-full"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? 'Adding...' : 'Add Evidence'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default EvidenceModal;
