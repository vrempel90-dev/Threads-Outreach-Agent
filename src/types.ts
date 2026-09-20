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
  updated_at: string;
}
