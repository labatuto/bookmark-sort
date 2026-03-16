// Core bookmark type
export interface Bookmark {
  id: string;
  tweet_id: string;
  author_handle: string;
  author_name: string;
  text: string;
  urls: string[];
  media_urls: string[];
  created_at: string;
  bookmarked_at: string;
  imported_at: string;
  tags: string[];
  archivly_folder: string;
  quoted_post_url?: string;
  quoted_tweet?: {
    text: string;
    author_handle: string;
    media_urls?: string[];
  };
  link_title?: string;
  status: 'pending' | 'routed' | 'archived';
  embedding?: number[];
  routed_to?: Array<{ type: string; name: string }>;
}

// Routing destination types
export type DestinationType = 'instapaper' | 'notion_page' | 'gdrive_folder' | 'gdrive_doc' | 'local' | 'x' | 'google';

export interface Destination {
  id: string;
  type: DestinationType;
  name: string;
  config: Record<string, string>;
  created_at: string;
}

export interface RoutingHistory {
  id: string;
  bookmark_id: string;
  destination_id: string;
  destination_type: DestinationType;
  status: 'queued' | 'success' | 'failed';
  error_message?: string;
  created_at: string;
}

// Search result with similarity score
export interface SearchResult extends Bookmark {
  similarity: number;
}

// Import stats
export interface ImportStats {
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
}
