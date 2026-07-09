/**
 * Analysis domain types — transcript analysis result, responses
 * Source: analysis-architecture.md §6
 */

export interface TranscriptAnalysisResult {
  topics_covered: string[];
  topics_missing: string[];
  key_points: string[];
  disagreements: string[];
  passed: boolean;
  confidence: number; // 0.0 – 1.0
}

export interface AnalysisResponse {
  analysis_result: TranscriptAnalysisResult;
  analysis_run_at: string; // ISO 8601
  result_detail: string; // human-readable summary
  transcript_s3_key: string; // where the transcript was stored
}

export interface FetchTranscriptResponse {
  transcript_url: string;
  char_count: number;
}

export interface AvomaTranscriptResponse {
  transcript_text: string;
  meeting_title?: string;
  meeting_date?: string;
  duration_minutes?: number;
  participants?: string[];
}

export interface LinkMetadata {
  meeting_title?: string;
  meeting_date?: string;
  duration_minutes?: number;
  participants?: string[];
}
