/**
 * Bedrock model integration service — direct model invocation via Converse API.
 *
 * Uses bedrock-runtime Converse (NOT Agents/InvokeAgent) to get strict JSON output
 * without the AgentCore orchestration layer's <answer> parser interfering.
 * This gives reliable structured output for a single-turn analysis task.
 *
 * Source: analysis-architecture.md §5 (adapted from AgentCore → direct model call)
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { AppError } from '@kiro-governance/shared/middleware/error-handler';
import { log } from '@kiro-governance/shared/middleware/logger';
import { TranscriptAnalysisResultSchema } from '../validation';
import type { TranscriptAnalysisResult } from '../types';

const bedrockClient = new BedrockRuntimeClient({});

// Model ID stored in env (set by CDK from /deliverpro/config/bedrock-model-id SSM).
// Falls back to Claude 3.5 Sonnet v2 which is confirmed available in this account.
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';

const SYSTEM_PROMPT = `You are a meeting transcript analyst. You MUST respond with ONLY a single valid JSON object and nothing else. No markdown code blocks, no explanation, no preamble.

Required JSON structure:
{"topics_covered":["topic1","topic2"],"topics_missing":["topic3"],"key_points":["point1","point2"],"disagreements":[],"passed":true,"confidence":0.85,"summary":"Brief 1-2 sentence summary."}

Field rules:
- topics_covered: topics actively discussed in the transcript
- topics_missing: expected topics not discussed
- key_points: 3-5 most important points
- disagreements: points of disagreement (empty array if none)
- passed: true if main expected topics were covered
- confidence: 0.0-1.0 float
- summary: plain text, 1-2 sentences

IMPORTANT: Return ONLY the JSON object. Start your response with { and end with }.`;

/**
 * Invoke Bedrock Converse (direct model call) with transcript and prompt.
 * The agentId/agentAliasId params are accepted for interface compatibility
 * but not used — the model is invoked directly.
 */
export async function invokeAnalysisAgent(
  transcript: string,
  prompt: string,
  sessionId: string,
  _agentId: string,
  _agentAliasId: string,
): Promise<TranscriptAnalysisResult> {
  // Truncate transcript if too long (~320 KB)
  const maxChars = 320_000;
  let inputTranscript = transcript;
  let wasTruncated = false;

  if (transcript.length > maxChars) {
    inputTranscript = transcript.slice(-maxChars);
    wasTruncated = true;
    log('warn', 'TRANSCRIPT_TRUNCATED', {
      originalLength: transcript.length,
      truncatedLength: maxChars,
    });
  }

  const userMessage = `${prompt}\n\n---TRANSCRIPT BEGIN---${
    wasTruncated ? '\n[Transcript truncated — showing final portion]\n' : '\n'
  }${inputTranscript}\n---TRANSCRIPT END---\n\nReturn ONLY the JSON object.`;

  const messages: Message[] = [{ role: 'user', content: [{ text: userMessage }] }];

  log('info', 'AGENT_INVOKE_START', { sessionId, modelId: MODEL_ID });

  let responseText: string;
  try {
    const response = await bedrockClient.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        inferenceConfig: {
          maxTokens: 1024,
          temperature: 0.1,   // low temperature for deterministic JSON
          // NOTE: topP intentionally omitted — newer Claude models (Sonnet 4.x+) reject
          // `temperature` and `top_p` being specified together. Keep only temperature.
        },
      }),
      { requestTimeout: 60_000 },
    );

    const block = response.output?.message?.content?.[0];
    responseText = block && 'text' in block ? (block.text ?? '') : '';

    if (!responseText.trim()) {
      throw new AppError('AGENT_UNAVAILABLE', 'Bedrock model returned empty response', 502);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'BEDROCK_CONVERSE_ERROR', { error: msg, sessionId });
    if (msg.includes('timeout') || msg.includes('timed out')) {
      throw new AppError('AGENT_UNAVAILABLE', 'Bedrock model timed out (60s)', 502);
    }
    throw new AppError('AGENT_UNAVAILABLE', `Bedrock invocation failed: ${msg}`, 502);
  }

  // Extract JSON — model may still wrap in a code block despite instructions
  const cleaned = responseText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log('warn', 'AGENT_NO_JSON', { responseText: responseText.slice(0, 300), sessionId });
    throw new AppError(
      'AGENT_UNAVAILABLE',
      'Failed to parse analysis result — model response contained no JSON',
      502,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    log('warn', 'AGENT_JSON_PARSE_FAIL', { jsonMatch: jsonMatch[0].slice(0, 200), sessionId });
    throw new AppError('AGENT_UNAVAILABLE', 'Model returned malformed JSON', 502);
  }

  const result = TranscriptAnalysisResultSchema.parse(parsed);

  log('info', 'AGENT_ANALYSIS_COMPLETE', {
    sessionId,
    passed: result.passed,
    confidence: result.confidence,
    topicsCovered: result.topics_covered.length,
    topicsMissing: result.topics_missing.length,
  });

  return result;
}
