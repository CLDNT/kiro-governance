/**
 * Avoma API integration service — fetch transcripts
 * Source: analysis-architecture.md §4
 */

import { AppError } from '@kiro-governance/shared/middleware/error-handler';
import { log } from '@kiro-governance/shared/middleware/logger';
import type { AvomaTranscriptResponse } from '../types';

/**
 * Extract meeting ID from various Avoma URL formats
 * Handles: https://app.avoma.com/meetings/{meetingId}
 */
function extractMeetingId(url: string): string {
  const match = url.match(/meetings\/([a-zA-Z0-9_-]+)/);
  if (!match || !match[1]) {
    throw new AppError(
      'INVALID_MEETING_LINK',
      'Could not parse meeting ID from URL. Expected format: https://app.avoma.com/meetings/{meetingId}',
      400
    );
  }
  return match[1];
}

/**
 * Fetch transcript from Avoma API with single retry
 * Timeout: 30 seconds
 * Source: analysis-architecture.md §4.2
 */
export async function fetchTranscriptFromAvoma(
  meetingLink: string,
  apiKey: string
): Promise<AvomaTranscriptResponse> {
  const meetingId = extractMeetingId(meetingLink);

  let lastError: Error | undefined;

  // Single retry with 5s backoff
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`https://api.avoma.com/v1/transcriptions/${meetingId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        log('AVOMA_API_ERROR', {
          attempt: attempt + 1,
          status: response.status,
          meetingId,
        });

        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        throw new AppError(
          'AVOMA_UNAVAILABLE',
          `Avoma API returned ${response.status}`,
          502
        );
      }

      const data = await response.json() as AvomaTranscriptResponse;
      log('AVOMA_TRANSCRIPT_FETCHED', { meetingId, charCount: data.transcript_text.length });
      return data;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      if (err instanceof TypeError && err.message.includes('timeout')) {
        if (attempt === 0) {
          log('AVOMA_TIMEOUT', { attempt: attempt + 1, meetingId });
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        throw new AppError(
          'AVOMA_UNAVAILABLE',
          'Avoma service timed out (30s)',
          502
        );
      }

      lastError = err as Error;
      if (attempt === 0) {
        log('AVOMA_ERROR', { attempt: attempt + 1, error: String(err) });
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      throw new AppError(
        'AVOMA_UNAVAILABLE',
        `Failed to fetch transcript: ${lastError?.message || 'Unknown error'}`,
        502
      );
    }
  }

  throw lastError || new AppError('AVOMA_UNAVAILABLE', 'Failed to fetch transcript', 502);
}
