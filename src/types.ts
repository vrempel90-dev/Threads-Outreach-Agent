export type Language = 'ru' | 'kk';
export type AgentMode = 'review' | 'autonomous';

export interface ThreadsPost {
  id: string;
  text: string;
  username: string;
  permalink: string;
  timestamp: string;
}

export interface LeadScore {
  score: number;
  reasons: string[];
  language: Language;
  shouldEngage: boolean;
}

export interface LeadRow {
  username: string;
  score: number;
  stage: string;
  source_post_id: string | null;
  source_permalink: string | null;
  last_message: string | null;
  search_query: string | null;
  ai_category: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  officially_resolved: boolean;
  updated_at: string;
}
