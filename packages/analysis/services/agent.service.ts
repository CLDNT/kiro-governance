/**
 * Bedrock AgentCore integration service — invoke analysis agent
 * Source: analysis-architecture.md §5
 */

import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { AppError } from '@kiro-governance/shared/middleware/error-handler';
import { log } from '@kiro-governance/shared/middleware/logger';
import { TranscriptAnalysisResultSchema } from '../validation';
import type { TranscriptAnalysisResult } from '../types';

const bedrockAgentClient = new BedrockAgentRuntimeClient({});

/**
 * Collect streaming response from Bedrock agent into a complete string
 */
async function collectStreamResponse(
  completion: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }>
): Promise<string> {
  const chunks: string[] = [];

  for await (const event of completion) {
    if (event.chunk?.bytes) {
      chunks.push(new TextDecoder().decode(event.chunk.bytes));
    }
  }

  return chunks.join('');
}

/**
 * Invoke Bedrock AgentCore with transcript and prompt
 * Returns parsed JSON result
 * Timeout: 60 seconds
 * Source: analysis-architecture.md §5
 */
export async function invokeAnalysisAgent(
  transcript: string,
  prompt: string,
  sessionId: string,
  agentId: string,
  agentAliasId: string
): Promise<TranscriptAnalysisResult> {
  // Truncate transcript if too long (>80K tokens ≈ 320KB)
  const maxChars = 320_000;
  let truncatedTranscript = transcript;
  let wasTruncated = false;

  if (transcript.length > maxChars) {
    truncatedTranscript = transcript.slice(-maxChars);
    wasTruncated = true;
    log('TRANSCRIPT_TRUNCATED', { originalLength: transcript.length, truncatedLength: maxChars });
  }

  const inputText = `${prompt}\n\n---TRANSCRIPT BEGIN---${wasTruncated ? '\n[Transcript truncated — showing final portion]\n' : '\n'}${truncatedTranscript}\n---TRANSCRIPT END---`;

  try {
    const response = await bedrockAgentClient.send(
      new InvokeAgentCommand({
        agentId,
        agentAliasId,
        sessionId,
        inputText,
        endSession: true, // Ensures session closes after this invocation
      }),
      { requestTimeout: 60_000 }
    );

    if (!response.completion) {
      throw new AppError(
        'AGENT_UNAVAILABLE',
        'Bedrock agent returned empty response',
        502
      );
    }

    // Collect streaming response
    const responseText = await collectStreamResponse(response.completion);

    if (!responseText) {
      throw new AppError(
        'AGENT_UNAVAILABLE',
        'Bedrock agent response contained no data',
        502
      );
    }

    // Extract JSON from response (agent may wrap in markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log('AGENT_NO_JSON', { responseText: responseText.slice(0, 200) });
      throw new AppError(
        'AGENT_UNAVAILABLE',
        'Failed to parse analysis result — agent response contained no JSON',
        502
      );
    }

    const jsonStr = jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as unknown;

    // Validate result shape
    const result = TranscriptAnalysisResultSchema.parse(parsed);

    log('AGENT_ANALYSIS_COMPLETE', {
      sessionId,
      passed: result.passed,
      confidence: result.confidence,
    });

    return result;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    if (err instanceof Error) {
      if (err.message.includes('timeout') || err.message.includes('timed out')) {
        throw new AppError(
          'AGENT_UNAVAILABLE',
          'Bedrock analysis agent timed out (60s)',
          502
        );
      }

      if (err.message.includes('VALIDATION_ERROR') || err.message.includes('Validation')) {
        log('AGENT_VALIDATION_ERROR', { error: err.message });
        throw new AppError(
          'AGENT_UNAVAILABLE',
          'Analysis result validation failed',
          502
        );
      }

      log('AGENT_ERROR', { error: err.message });
      throw new AppError(
        'AGENT_UNAVAILABLE',
        `Bedrock invocation failed: ${err.message}`,
        502
      );
    }

    throw new AppError('AGENT_UNAVAILABLE', 'Unknown error during agent invocation', 502);
  }
}
