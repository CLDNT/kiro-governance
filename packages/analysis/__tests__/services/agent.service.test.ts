/**
 * agent.service.test.ts
 * Unit tests for Bedrock AgentCore integration
 */

import { TranscriptAnalysisResultSchema } from '../../validation';

describe('Agent Service', () => {
  it('should validate analysis result schema', () => {
    const validResult = {
      topics_covered: ['topic1', 'topic2'],
      topics_missing: ['topic3'],
      key_points: ['point1'],
      disagreements: [],
      passed: true,
      confidence: 0.95,
    };

    const parsed = TranscriptAnalysisResultSchema.parse(validResult);
    expect(parsed).toEqual(validResult);
  });

  it('should reject invalid confidence', () => {
    const invalidResult = {
      topics_covered: ['topic1'],
      topics_missing: [],
      key_points: [],
      disagreements: [],
      passed: true,
      confidence: 1.5, // Invalid: > 1.0
    };

    expect(() => {
      TranscriptAnalysisResultSchema.parse(invalidResult);
    }).toThrow();
  });

  it('should truncate long transcripts', () => {
    // Test would verify transcript truncation to 320KB
    // and that truncation notice is added to prompt
  });
});
