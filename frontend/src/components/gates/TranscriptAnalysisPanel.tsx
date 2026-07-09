import { useState } from 'react';
import { AxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/Spinner';
import {
  AnalysisResponse,
  FetchTranscriptResponse,
  MacroCheckpoint,
  TranscriptAnalysisResult,
} from '@/types';

interface TranscriptAnalysisPanelProps {
  checkpoint: MacroCheckpoint;
  projectId: string;
}

interface ApiErrorBody {
  message?: string;
}

/** Pull a human-readable message off an Axios error, falling back to a default. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    return (err.response?.data as ApiErrorBody | undefined)?.message ?? err.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Render the passed/failed badge + structured metrics for a completed analysis. */
function AnalysisResultView({
  result,
  summary,
  runAt,
}: {
  result: TranscriptAnalysisResult;
  summary: string | null;
  runAt: string | null;
}): JSX.Element {
  const confidencePct = Math.round((result.confidence ?? 0) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={result.passed ? 'success' : 'danger'}>
          {result.passed ? 'Passed' : 'Failed'}
        </Badge>
        <Badge variant="neutral">Confidence {confidencePct}%</Badge>
        <Badge variant="info">{result.topics_covered.length} topics covered</Badge>
      </div>

      {result.topics_missing.length > 0 && (
        <div>
          <p className="text-sm font-medium text-neutral-700 mb-1">Topics missing</p>
          <ul className="list-disc list-inside text-sm text-neutral-600 space-y-0.5">
            {result.topics_missing.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <div>
          <p className="text-sm font-medium text-neutral-700 mb-1">Summary</p>
          <p className="text-sm text-neutral-600">{summary}</p>
        </div>
      )}

      {runAt && (
        <p className="text-xs text-neutral-500">
          Analyzed {new Date(runAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/**
 * Transcript analysis UI for `transcript_analysis` checkpoints.
 * Flow: Fetch Transcript (from meeting_link) → Run Analysis → result display.
 * If an analysis already exists it is shown with a Re-run option.
 */
function TranscriptAnalysisPanel({
  checkpoint,
  projectId,
}: TranscriptAnalysisPanelProps): JSX.Element {
  const client = useApiClient();
  const queryClient = useQueryClient();

  const [transcriptUrl, setTranscriptUrl] = useState<string | null>(
    checkpoint.transcript_url ?? null
  );
  const [charCount, setCharCount] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<TranscriptAnalysisResult | null>(
    checkpoint.analysis_result ?? null
  );
  const [summary, setSummary] = useState<string | null>(checkpoint.result_detail);
  const [runAt, setRunAt] = useState<string | null>(checkpoint.analysis_run_at ?? null);

  const [fetching, setFetching] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [showActions, setShowActions] = useState<boolean>(!checkpoint.analysis_result);
  const [actionError, setActionError] = useState<string>('');

  const base = `/api/projects/${projectId}/checkpoints/${checkpoint.id}`;

  const handleFetch = async (): Promise<void> => {
    setFetching(true);
    setActionError('');
    try {
      const { data } = await client.post<FetchTranscriptResponse>(`${base}/fetch-transcript`);
      setTranscriptUrl(data.transcript_url);
      setCharCount(data.char_count);
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to fetch transcript'));
    } finally {
      setFetching(false);
    }
  };

  const handleAnalyze = async (): Promise<void> => {
    setAnalyzing(true);
    setActionError('');
    try {
      const { data } = await client.post<AnalysisResponse>(`${base}/analyze`);
      setAnalysis(data.analysis_result);
      setSummary(data.result_detail);
      setRunAt(data.analysis_run_at);
      setShowActions(false);
      // reached_at may now be set — refresh the gate view.
      queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
    } catch (err) {
      setActionError(errorMessage(err, 'Failed to run analysis'));
    } finally {
      setAnalyzing(false);
    }
  };

  const hasMeetingLink = Boolean(checkpoint.meeting_link);
  const busy = fetching || analyzing;

  return (
    <div className="border border-neutral-200 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-neutral-900">Transcript Analysis</p>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Existing result — shown unless the user chose to re-run */}
      {analysis && !showActions && (
        <>
          <AnalysisResultView result={analysis} summary={summary} runAt={runAt} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowActions(true)}
          >
            Re-run analysis
          </Button>
        </>
      )}

      {showActions && (
        <div className="space-y-3">
          {/* Step 1 — Fetch transcript (needs a meeting link, not yet fetched) */}
          {!transcriptUrl && (
            <>
              {!hasMeetingLink && (
                <Alert>
                  <AlertDescription>
                    Attach a meeting link to this checkpoint before fetching a transcript.
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="button"
                onClick={handleFetch}
                disabled={busy || !hasMeetingLink}
              >
                {fetching && <Spinner size="sm" color="white" />}
                {fetching ? 'Fetching…' : 'Fetch Transcript'}
              </Button>
            </>
          )}

          {/* Fetch confirmation */}
          {transcriptUrl && charCount !== null && (
            <p className="text-sm text-neutral-600">
              Transcript fetched — {charCount.toLocaleString()} characters.
            </p>
          )}

          {/* Step 2 — Run analysis (enabled once a transcript exists) */}
          <Button
            type="button"
            onClick={handleAnalyze}
            disabled={busy || !transcriptUrl}
          >
            {analyzing && <Spinner size="sm" color="white" />}
            {analyzing ? 'Analyzing…' : 'Run Analysis'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default TranscriptAnalysisPanel;
