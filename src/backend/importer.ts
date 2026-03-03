import { v4 as uuidv4 } from 'uuid';
import { insertBookmark } from './db.js';

interface ArchivlyBookmark {
  // ArchivlyX actual format
  "Tweets URL"?: string;
  "Folder"?: string;
  "Handle"?: string;
  "Content"?: string;
  "Image"?: string;
  "Video"?: string;
  "GIF"?: string;
  "Link"?: string;
  "Media URL"?: string;
  "Quoted Post"?: string;
  // Also support other common field names
  id?: string;
  tweet_id?: string;
  tweetId?: string;
  author?: string;
  author_handle?: string;
  authorHandle?: string;
  username?: string;
  author_name?: string;
  authorName?: string;
  name?: string;
  text?: string;
  content?: string;
  full_text?: string;
  fullText?: string;
  urls?: string[] | string;
  links?: string[] | string;
  media?: string[] | string;
  media_urls?: string[];
  created_at?: string;
  createdAt?: string;
  date?: string;
  bookmarked_at?: string;
  bookmarkedAt?: string;
  tags?: string[] | string;
  folder?: string;
  category?: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];
}

// Extract tweet ID from URL or use provided ID
function extractTweetId(bookmark: ArchivlyBookmark): string | null {
  // Check ArchivlyX "Tweets URL" field first
  const tweetsUrl = bookmark["Tweets URL"];
  if (tweetsUrl) {
    const match = tweetsUrl.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
    if (match) return match[1];
  }

  // Direct ID fields
  const directId = bookmark.tweet_id || bookmark.tweetId || bookmark.id;
  if (directId && /^\d+$/.test(String(directId))) {
    return String(directId);
  }

  // Try to extract from URLs
  const urls = parseArrayField(bookmark.urls) || parseArrayField(bookmark.links) || [];
  for (const url of urls) {
    const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
    if (match) return match[1];
  }

  return null;
}

// Parse a field that might be a string or array
function parseArrayField(field: string[] | string | undefined): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  // Try JSON parse
  try {
    const parsed = JSON.parse(field);
    return Array.isArray(parsed) ? parsed : [field];
  } catch {
    // Might be comma-separated
    return field.split(',').map(s => s.trim()).filter(Boolean);
  }
}

// Normalize a single bookmark from various ArchivlyX formats
interface NormalizedBookmark {
  id: string;
  tweet_id: string;
  author_handle: string;
  author_name: string;
  text: string;
  urls: string[];
  media_urls: string[];
  created_at: string | undefined;
  bookmarked_at: string | undefined;
  tags: string[];
  archivly_folder: string | undefined;
  quoted_post_url: string | undefined;
  link_title: string | undefined;
}

function normalizeBookmark(raw: ArchivlyBookmark): NormalizedBookmark | null {
  const tweet_id = extractTweetId(raw);
  if (!tweet_id) return null;

  // Get text - check ArchivlyX "Content" field first
  const text = raw["Content"] || raw.text || raw.content || raw.full_text || raw.fullText || '';
  if (!text.trim()) return null;

  // Get author handle - check ArchivlyX "Handle" field first
  const author_handle = raw["Handle"] || raw.author_handle || raw.authorHandle || raw.author || raw.username || 'unknown';
  const author_name = raw.author_name || raw.authorName || raw.name || author_handle;

  // Extract URLs from text if not provided
  let urls = parseArrayField(raw.urls) || parseArrayField(raw.links) || [];
  if (urls.length === 0) {
    const urlMatches = text.match(/https?:\/\/[^\s]+/g) || [];
    urls = urlMatches;
  }

  // Get media URLs - check ArchivlyX "Media URL" field (JSON string array)
  // Note: CSV parser lowercases field names, so check both cases
  const mediaUrlField = raw["Media URL"] || (raw as any)["media_url"] || (raw as any).media_url;
  let media_urls: string[] = [];

  if (mediaUrlField && typeof mediaUrlField === 'string' && mediaUrlField.startsWith('[')) {
    // Parse JSON array string like "[\"https://...\"]"
    try {
      const parsed = JSON.parse(mediaUrlField);
      if (Array.isArray(parsed)) {
        media_urls = parsed.filter(url => typeof url === 'string' && url.startsWith('http'));
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Fallback to other field names
  if (media_urls.length === 0) {
    media_urls = parseArrayField(raw.media) || parseArrayField(raw.media_urls) || [];
  }
  const tags = parseArrayField(raw.tags) || [];

  // Get folder - check ArchivlyX "Folder" field first
  const archivly_folder = raw["Folder"] || raw.folder || raw.category;

  // Get quoted post URL - check ArchivlyX "Quoted Post" field
  // CSV parser lowercases field names
  const quoted_post_url = raw["Quoted Post"] || (raw as any)["quoted_post"] || (raw as any).quoted_post || undefined;

  return {
    id: uuidv4(),
    tweet_id,
    author_handle: author_handle.replace(/^@/, ''),
    author_name,
    text,
    urls,
    media_urls,
    created_at: raw.created_at || raw.createdAt || raw.date,
    bookmarked_at: raw.bookmarked_at || raw.bookmarkedAt,
    tags,
    archivly_folder,
    quoted_post_url,
    link_title: undefined, // Will be populated during unfurling
  };
}

// Import from JSON array
export async function importFromJson(jsonData: ArchivlyBookmark[]): Promise<ImportResult> {
  const result: ImportResult = {
    total: jsonData.length,
    imported: 0,
    duplicates: 0,
    errors: 0,
    errorMessages: [],
  };

  for (const raw of jsonData) {
    try {
      const normalized = normalizeBookmark(raw);
      if (!normalized) {
        result.errors++;
        result.errorMessages.push(`Could not parse bookmark: ${JSON.stringify(raw).slice(0, 100)}`);
        continue;
      }

      await insertBookmark(normalized);
      result.imported++;
    } catch (err) {
      result.errors++;
      result.errorMessages.push(`Error importing: ${err}`);
    }
  }

  return result;
}

// Parse CSV to JSON
function parseCsv(csvContent: string): ArchivlyBookmark[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header
  const header = parseCsvLine(lines[0]);
  const records: ArchivlyBookmark[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const record: Record<string, string> = {};
    header.forEach((col, idx) => {
      record[col.toLowerCase().replace(/\s+/g, '_')] = values[idx] || '';
    });
    records.push(record as unknown as ArchivlyBookmark);
  }

  return records;
}

// Parse a single CSV line (handling quoted fields)
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

// Import from CSV
export async function importFromCsv(csvContent: string): Promise<ImportResult> {
  const records = parseCsv(csvContent);
  return importFromJson(records);
}

// Auto-detect format and import
export async function importBookmarks(content: string): Promise<ImportResult> {
  const trimmed = content.trim();

  // Try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      let data = JSON.parse(trimmed);
      // Handle single object vs array
      if (!Array.isArray(data)) {
        data = [data];
      }
      return importFromJson(data);
    } catch {
      // Not valid JSON, try CSV
    }
  }

  // Try CSV
  return importFromCsv(content);
}

// Parse content without importing (for async import with unfurling)
export function parseContent(content: string): NormalizedBookmark[] {
  const trimmed = content.trim();
  let rawData: ArchivlyBookmark[] = [];

  // Try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      let data = JSON.parse(trimmed);
      if (!Array.isArray(data)) {
        data = [data];
      }
      rawData = data;
    } catch {
      // Not valid JSON, try CSV
      rawData = parseCsv(content);
    }
  } else {
    rawData = parseCsv(content);
  }

  // Normalize all bookmarks
  return rawData.map(normalizeBookmark).filter((b): b is NonNullable<typeof b> => b !== null);
}

// Import with URL unfurling (async)
export async function importBookmarksWithUnfurling(
  content: string,
  onProgress?: (stage: string, current: number, total: number) => void
): Promise<ImportResult & { unfurled: number }> {
  // Dynamically import unfurl to avoid circular dependencies
  const { unfurlUrl, needsUnfurling } = await import('./unfurl.js');

  const result: ImportResult & { unfurled: number } = {
    total: 0,
    imported: 0,
    duplicates: 0,
    errors: 0,
    errorMessages: [],
    unfurled: 0,
  };

  // Parse all bookmarks first
  const bookmarks = parseContent(content);
  result.total = bookmarks.length;

  onProgress?.('parsing', bookmarks.length, bookmarks.length);

  // Collect all URLs that need unfurling
  const urlsToUnfurl: string[] = [];
  for (const bookmark of bookmarks) {
    for (const url of bookmark.urls) {
      if (needsUnfurling(url)) {
        urlsToUnfurl.push(url);
      }
    }
  }

  // Unfurl URLs in parallel batches
  const unfurlResults = new Map<string, { finalUrl: string; title?: string }>();
  const uniqueUrls = [...new Set(urlsToUnfurl)];

  if (uniqueUrls.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < uniqueUrls.length; i += batchSize) {
      const batch = uniqueUrls.slice(i, i + batchSize);
      onProgress?.('unfurling', i, uniqueUrls.length);

      const batchResults = await Promise.all(
        batch.map(async (url) => {
          try {
            const unfurled = await unfurlUrl(url);
            return { url, result: unfurled };
          } catch {
            return { url, result: { originalUrl: url, finalUrl: url } };
          }
        })
      );

      for (const { url, result: unfurled } of batchResults) {
        unfurlResults.set(url, { finalUrl: unfurled.finalUrl, title: unfurled.title });
        if (unfurled.finalUrl !== url) {
          result.unfurled++;
        }
      }
    }
  }

  onProgress?.('unfurling', uniqueUrls.length, uniqueUrls.length);

  // Import bookmarks with unfurled URLs
  for (let i = 0; i < bookmarks.length; i++) {
    const bookmark = bookmarks[i];
    onProgress?.('importing', i, bookmarks.length);

    try {
      // Replace t.co URLs with unfurled URLs
      const expandedUrls = bookmark.urls.map((url) => {
        const unfurled = unfurlResults.get(url);
        return unfurled?.finalUrl || url;
      });

      // Get title from first unfurled URL
      let linkTitle: string | undefined;
      for (const url of bookmark.urls) {
        const unfurled = unfurlResults.get(url);
        if (unfurled?.title) {
          linkTitle = unfurled.title;
          break;
        }
      }

      const bookmarkWithUnfurled = {
        ...bookmark,
        urls: expandedUrls,
        link_title: linkTitle,
      };

      await insertBookmark(bookmarkWithUnfurled);
      result.imported++;
    } catch (err) {
      result.errors++;
      result.errorMessages.push(`Error importing: ${err}`);
    }
  }

  onProgress?.('importing', bookmarks.length, bookmarks.length);

  return result;
}
