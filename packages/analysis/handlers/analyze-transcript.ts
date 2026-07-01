/**
 * POST /api/projects/{projectId}/checkpoints/{checkpointId}/analyze
 * Analyze transcript via Bedrock AgentCore and write result
 * Source: analysis-architecture.md §3.1, §5, §7
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { invokeAnalysisAgent } from '../services/agent.service';
import { resolvePrompt } from '../services/prompt.service';
import type { AnalysisResponse, TranscriptAnalysisResult } from '../types';

const s3Client = new S3Client({});
const ssmClient = new SSMClient({});

interface CheckpointRow {
  checkpoint_name: string;
  checkpoint_type: string;
  transcript_url: string | null;
}

/**
 * Extract transcript text from S3 URL
 */
async function fetchTranscriptFromS3(s3Url: string): Promise<string> {
  const match = s3Url.match(/s3:\/\/([^/]+)\/(.+)/);
  if (!match) {
    throw new AppError(
      'INVALID_TRANSCRIPT_URL',
      'Invalid transcript URL format',
      400
    );
  }

  const [, bucket, key] = match;

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Uint8Array[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Uint8Array);
    }

    const buffer = Buffer.concat(chunks);
    return buffer.toString('utf-8');
  } catch (err) {
    log('TRANSCRIPT_RETRIEVAL_ERROR', { s3Url, error: String(err) });
    throw new AppError(
      'TRANSCRIPT_NOT_FOUND',
      'Failed to retrieve transcript from storage',
      502
    );
  }
}

/**
 * Generate human-readable summary from analysis result
 */
function generateResultDetail(result: TranscriptAnalysisResult): string {
  const topicCount = result.topics_covered.length + result.topics_missing.length;
  const covered = result.topics_covered.length;
  const coverage = topicCount > 0 ? Math.round((covered / topicCount) * 100) : 0;

  const missingList = result.topics_missing.length > 0
    ? `${result.topics_missing.length} missing: ${result.topics_missing.slice(0, 2).join(', ')}${result.topics_missing.length > 2 ? '...' : ''}`
    : 'none missing';

  return `${covered}/${topicCount} topics covered (${coverage}%) — ${missingList}. Confidence: ${(result.confidence * 100).toFixed(0)}%. ${result.passed ? 'PASSED' : 'NEEDS DISCUSSION'}`;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event: any) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      // Verify checkpoint exists and is correct type
      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT checkpoint_name, checkpoint_type, transcript_url 
         FROM macro_checkpoints 
         WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId]
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      if (checkpoint.checkpoint_type !== 'transcript_analysis') {
        throw new AppError(
          'INVALID_CHECKPOINT_TYPE',
          'This checkpoint is not a transcript analysis checkpoint',
          400
        );
      }

      if (!checkpoint.transcript_url) {
        throw new AppError(
          'NO_TRANSCRIPT',
          'Checkpoint has no transcript. Please fetch the transcript first.',
          400
        );
      }

      // Fetch transcript from S3
      const transcriptText = await fetchTranscriptFromS3(checkpoint.transcript_url);

      // Resolve prompt
      const prompt = await resolvePrompt(checkpoint.checkpoint_name);

      // Fetch agent configuration from SSM
      let agentId: string;
      let agentAliasId: string;

      try {
        const agentIdParam = await ssmClient.send(
          new GetParameterCommand({
            Name: '/deliverpro/config/agent-id',
          })
        );

        const agentAliasIdParam = await ssmClient.send(
          new GetParameterCommand({
            Name: '/deliverpro/config/agent-alias-id',
          })
        );

        agentId = agentIdParam.Parameter?.Value || '';
        agentAliasId = agentAliasIdParam.Parameter?.Value || '';

        if (!agentId || !agentAliasId) {
          throw new Error('Empty SSM parameter values');
        }
      } catch (err) {
        log('SSM_PARAMETER_ERROR', { error: String(err) });
        throw new AppError(
          'AGENT_UNAVAILABLE',
          'Failed to retrieve Bedrock agent configuration',
          502
        );
      }

      // Invoke analysis agent
      const sessionId = `${projectId}#${checkpointId}`;
      const analysisResult = await invokeAnalysisAgent(
        transcriptText,
        prompt,
        sessionId,
        agentId,
        agentAliasId
      );

      // Generate human-readable summary
      const resultDetail = generateResultDetail(analysisResult);

      // Update macro_checkpoints
      await queryOne(
        `UPDATE macro_checkpoints 
         SET 
           analysis_result = $1::jsonb,
           analysis_run_at = now(),
           reached_at = CASE WHEN reached_at IS NULL THEN now() ELSE reached_at END,
           result_detail = $2
         WHERE id = $3 AND project_id = $4`,
        [JSON.stringify(analysisResult), resultDetail, checkpointId, projectId]
      );

      // Create gate_evidence entry
      await queryOne(
        `INSERT INTO gate_evidence 
           (project_id, checkpoint_name, evidence_type, label, value, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          projectId,
          checkpoint.checkpoint_name,
          'ai_analysis',
          'Transcript Analysis Result',
          JSON.stringify(analysisResult),
          'system',
        ]
      );

      log('ANALYZE_TRANSCRIPT_COMPLETE', {
        projectId,
        checkpointId,
        passed: analysisResult.passed,
        confidence: analysisResult.confidence,
      });

      return ok({
        analysis_result: analysisResult,
        analysis_run_at: new Date().toISOString(),
        result_detail: resultDetail,
        transcript_s3_key: checkpoint.transcript_url,
      } as AnalysisResponse);
    } catch (err) {
      return handleError(err);
    }
  })
);
