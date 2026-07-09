/**
 * Avoma API integration service — fetch transcripts.
 *
 * Correct two-step flow per Avoma docs:
 *   1. GET /v1/meetings/{meeting_uuid}/ → get transcription_uuid from response
 *   2. GET /v1/transcriptions/{transcription_uuid}/ → get the actual transcript
 *
 * Auth: Bearer token only — the raw API key value, not a key=value pair.
 * If the secret was stored as "AVOMA_API_KEY=abc123" we strip the prefix here.
 */

import { AppError } from '@kiro-governance/shared/middleware/error-handler';
import { log } from '@kiro-governance/shared/middleware/logger';
import type { AvomaTranscriptResponse } from '../types';

const AVOMA_BASE = 'https://api.avoma.com';
const TIMEOUT_MS = 30_000;

/** Extract meeting UUID from an Avoma meeting URL. */
function extractMeetingUuid(url: string): string {
  const match = url.match(/meetings\/([0-9a-f-]{36})/i);
  if (!match?.[1]) {
    throw new AppError(
      'INVALID_MEETING_LINK',
      'Could not parse meeting UUID from URL. Expected: https://app.avoma.com/meetings/{uuid}',
      400,
    );
  }
  return match[1];
}

/**
 * Strip any "KEY=value" .env-style prefix from the secret so only the raw token
 * is used in the Authorization header. If the stored value is just the token
 * (no '=') it is returned unchanged.
 */
function normalizeApiKey(raw: string): string {
  const trimmed = raw.trim();
  const eqIdx = trimmed.indexOf('=');
  // Only strip if the part before '=' looks like a plain env-var name (no spaces, no dots).
  if (eqIdx > 0) {
    const before = trimmed.slice(0, eqIdx);
    if (/^[A-Z_][A-Z0-9_]*$/.test(before)) {
      return trimmed.slice(eqIdx + 1).trim();
    }
  }
  return trimmed;
}

async function avomaGet<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${AVOMA_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AppError(
      'AVOMA_UNAVAILABLE',
      `Avoma API returned HTTP ${response.status} for ${path}`,
      502,
    );
  }

  return response.json() as Promise<T>;
}

interface AvomaGetMeetingResponse {
  uuid: string;
  transcription_uuid: string | null;
  transcript_ready: boolean;
  processing_status: string;
}

interface AvomaTranscriptionSegment {
  speaker_name: string;
  start_time: number;
  end_time: number;
  text: string;
}

interface AvomaGetTranscriptionResponse {
  uuid: string;
  meeting_uuid: string;
  transcript: AvomaTranscriptionSegment[];
}

/** Convert the structured transcript segments to plain text. */
function segmentsToText(segments: AvomaTranscriptionSegment[]): string {
  return segments
    .map((s) => `[${s.speaker_name ?? 'Unknown'}]: ${s.text}`)
    .join('\n');
}

/**
 * Fetch a transcript from Avoma using the two-step flow:
 *   1. Resolve the transcription_uuid via GET /v1/meetings/{meeting_uuid}/
 *   2. Fetch transcript via GET /v1/transcriptions/{transcription_uuid}/
 *
 * Single retry with 5-second back-off on transient errors.
 */
export async function fetchTranscriptFromAvoma(
  meetingLink: string,
  rawApiKey: string,
): Promise<AvomaTranscriptResponse> {
  const meetingUuid = extractMeetingUuid(meetingLink);
  const apiKey = normalizeApiKey(rawApiKey);

  log('info', 'AVOMA_FETCH_START', { meetingUuid });

  // ── Step 1: get the meeting to find its transcription_uuid ──
  let meeting: AvomaGetMeetingResponse;
  try {
    meeting = await avomaGet<AvomaGetMeetingResponse>(`/v1/meetings/${meetingUuid}/`, apiKey);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('AVOMA_UNAVAILABLE', `Failed to fetch Avoma meeting: ${String(err)}`, 502);
  }

  if (!meeting.transcript_ready || !meeting.transcription_uuid) {
    throw new AppError(
      'TRANSCRIPT_NOT_READY',
      `Avoma transcript not yet ready for this meeting (status: ${meeting.processing_status}). ` +
        'Please try again after the meeting has finished processing.',
      422,
    );
  }

  log('info', 'AVOMA_MEETING_RESOLVED', {
    meetingUuid,
    transcriptionUuid: meeting.transcription_uuid,
  });

  // ── Step 2: fetch the actual transcript ──
  let transcription: AvomaGetTranscriptionResponse;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      transcription = await avomaGet<AvomaGetTranscriptionResponse>(
        `/v1/transcriptions/${meeting.transcription_uuid}/`,
        apiKey,
      );
      break;
    } catch (err) {
      if (attempt === 0) {
        log('warn', 'AVOMA_TRANSCRIPTION_RETRY', { attempt, error: String(err) });
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      if (err instanceof AppError) throw err;
      throw new AppError(
        'AVOMA_UNAVAILABLE',
        `Failed to fetch Avoma transcription: ${String(err)}`,
        502,
      );
    }
  }

  // Convert segments to a plain-text transcript
  const transcriptText = segmentsToText(transcription!.transcript ?? []);

  if (!transcriptText.trim()) {
    throw new AppError(
      'EMPTY_TRANSCRIPT',
      'Avoma returned an empty transcript for this meeting.',
      422,
    );
  }

  log('info', 'AVOMA_TRANSCRIPT_FETCHED', {
    meetingUuid,
    transcriptionUuid: meeting.transcription_uuid,
    charCount: transcriptText.length,
    segmentCount: transcription!.transcript?.length ?? 0,
  });

  return { transcript_text: transcriptText };
}
