/**
 * extract-metadata.ts
 * Async metadata extraction for evidence links
 * Called fire-and-forget after evidence creation (non-blocking)
 * Source: analysis-architecture.md §DP-39
 */

import { SQSHandler } from 'aws-lambda';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { log } from '@kiro-governance/shared/middleware/logger';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { LinkMetadata } from '../types';

const secretsClient = new SecretsManagerClient({});

interface EvidenceRecord {
  id: number;
  value: string; // URL
  evidence_type: string;
}

/**
 * Extract meeting ID from various Avoma URL formats
 */
function extractAvomaId(url: string): string | null {
  const match = url.match(/meetings\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch Avoma meeting metadata
 */
async function fetchAvomaMetadata(meetingLink: string, apiKey: string): Promise<LinkMetadata | null> {
  try {
    const meetingId = extractAvomaId(meetingLink);
    if (!meetingId) return null;

    const response = await fetch(`https://api.avoma.com/v1/transcriptions/${meetingId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      meeting_title?: string;
      meeting_date?: string;
      duration_minutes?: number;
      participants?: string[];
    };

    return {
      meeting_title: data.meeting_title,
      meeting_date: data.meeting_date,
      duration_minutes: data.duration_minutes,
      participants: data.participants,
    };
  } catch (err) {
    log('error', 'AVOMA_METADATA_ERROR', { error: String(err) });
    return null;
  }
}

/**
 * Parse Teams/SharePoint URL for available metadata
 */
function parseTeamsMetadata(url: string): LinkMetadata {
  const metadata: LinkMetadata = {};

  // Teams meeting URLs: https://teams.microsoft.com/l/meetup-join/...
  if (url.includes('teams.microsoft.com')) {
    // Extract meeting title from URL param or use generic
    const match = url.match(/(?:title|subject)=([^&]+)/i);
    if (match) {
      metadata.meeting_title = decodeURIComponent(match[1]);
    }
  }

  // SharePoint document URLs: https://sharepoint.com/teams/.../...
  if (url.includes('sharepoint.com')) {
    metadata.meeting_title = url.split('/').pop() || 'SharePoint Document';
  }

  return metadata;
}

/**
 * Extract metadata from evidence link
 * Silently fails — catches all errors with no retry
 */
async function extractMetadata(evidence: EvidenceRecord): Promise<LinkMetadata | null> {
  try {
    const { value: url, evidence_type } = evidence;

    if (evidence_type === 'meeting_link') {
      // Try Avoma first
      if (url.includes('avoma.com')) {
        let apiKey: string;
        try {
          const secretResponse = await secretsClient.send(
            new GetSecretValueCommand({
              SecretId: process.env.AVOMA_SECRET_ARN || '/deliverpro/avoma-api-key',
            })
          );
          apiKey = secretResponse.SecretString || '';
        } catch {
          // No API key, try generic parsing
          return parseTeamsMetadata(url);
        }

        const metadata = await fetchAvomaMetadata(url, apiKey);
        if (metadata) return metadata;
      }

      // Try Teams/SharePoint generic parsing
      if (url.includes('teams.microsoft.com') || url.includes('sharepoint.com')) {
        return parseTeamsMetadata(url);
      }
    }

    return null;
  } catch (err) {
    log('error', 'METADATA_EXTRACTION_ERROR', { error: String(err) });
    return null;
  }
}

/**
 * SQS handler for async metadata extraction
 * Receives: { evidenceId: number, projectId: string }
 */
export const handler: SQSHandler = async (event) => {
  const failures: Array<{ messageId: string; error: string }> = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body) as { evidenceId: number; projectId: string };
      const { evidenceId } = body;

      // Fetch evidence record
      const evidence = await queryOne<EvidenceRecord>(
        `SELECT id, value, evidence_type FROM gate_evidence WHERE id = $1`,
        [evidenceId]
      );

      if (!evidence) {
        log('warn', 'EVIDENCE_NOT_FOUND', { evidenceId });
        failures.push({ messageId: record.messageId, error: 'Evidence not found' });
        continue;
      }

      // Extract metadata
      const metadata = await extractMetadata(evidence);

      if (metadata && Object.keys(metadata).length > 0) {
        // Update evidence record with metadata
        await queryOne(
          `UPDATE gate_evidence SET link_metadata = $1 WHERE id = $2`,
          [JSON.stringify(metadata), evidenceId]
        );

        log('info', 'METADATA_EXTRACTED', {
          evidenceId,
          hasTitle: !!metadata.meeting_title,
          hasDate: !!metadata.meeting_date,
        });
      }
    } catch (err) {
      log('error', 'METADATA_EXTRACTION_HANDLER_ERROR', { error: String(err) });
      failures.push({ messageId: record.messageId, error: String(err) });
    }
  }

  // Return batch failures (SQS will retry these)
  return {
    batchItemFailures: failures.map((f) => ({
      itemIdentifier: f.messageId,
    })),
  };
};
