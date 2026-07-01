/**
 * Prompt resolution service — fetch admin-configured or generic prompts
 * Source: analysis-architecture.md §10
 */

import { queryOne } from '@kiro-governance/shared/db/pool';
import { log } from '@kiro-governance/shared/middleware/logger';

interface PromptRow {
  prompt_text: string;
}

const GENERIC_FALLBACK_PROMPT = `Analyze this meeting transcript and determine if the key discussion topics for a meeting were covered. Evaluate comprehensively and return a JSON object with the following fields:
- topics_covered: array of strings (topics that were discussed)
- topics_missing: array of strings (topics that were NOT discussed)
- key_points: array of strings (important points from the meeting)
- disagreements: array of strings (areas where attendees disagreed or had concerns)
- passed: boolean (true if all expected topics were covered)
- confidence: number between 0 and 1 (how confident you are in this assessment)

Return ONLY the JSON object, no additional text.`;

/**
 * Resolve prompt for checkpoint name
 * Falls back to generic prompt if admin hasn't configured one
 * Source: analysis-architecture.md §10
 */
export async function resolvePrompt(checkpointName: string): Promise<string> {
  try {
    const result = await queryOne<PromptRow>(
      'SELECT prompt_text FROM analysis_prompts WHERE checkpoint_name = $1 AND is_active = true',
      [checkpointName]
    );

    if (result) {
      log('PROMPT_RESOLVED', { source: 'admin', checkpointName });
      return result.prompt_text;
    }

    log('PROMPT_RESOLVED', { source: 'fallback', checkpointName });
    return GENERIC_FALLBACK_PROMPT;
  } catch (err) {
    log('PROMPT_RESOLUTION_ERROR', { checkpointName, error: String(err) });
    // On DB error, return fallback
    return GENERIC_FALLBACK_PROMPT;
  }
}
