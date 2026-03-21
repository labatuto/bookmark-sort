import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production (Railway), use the persistent volume mount at /data.
// Locally, fall back to the relative data/ directory.
const DB_PATH = process.env.DATABASE_PATH
  || (process.env.NODE_ENV === 'production' ? '/data/bookmarks.db' : path.join(__dirname, '../../data/bookmarks.db'));

let localDb: Database.Database | null = null;

// Initialize database connection
export async function initDb(): Promise<void> {
  console.log('Using local SQLite database');
  localDb = new Database(DB_PATH);
  localDb.pragma('journal_mode = WAL');
  initSchema();
}

function initSchema() {
  if (!localDb) return;

  localDb.exec(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      author_handle TEXT NOT NULL,
      author_name TEXT,
      text TEXT NOT NULL,
      urls TEXT DEFAULT '[]',
      media_urls TEXT DEFAULT '[]',
      created_at TEXT,
      bookmarked_at TEXT,
      imported_at TEXT DEFAULT (datetime('now')),
      tags TEXT DEFAULT '[]',
      archivly_folder TEXT,
      quoted_post_url TEXT,
      link_title TEXT,
      status TEXT DEFAULT 'pending',
      embedding BLOB
    );

    CREATE TABLE IF NOT EXISTS destinations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routing_history (
      id TEXT PRIMARY KEY,
      bookmark_id TEXT NOT NULL,
      destination_id TEXT NOT NULL,
      destination_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS unbookmark_queue (
      id TEXT PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      bookmark_id TEXT,
      author_handle TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cached_tweets (
      tweet_id TEXT PRIMARY KEY,
      author_handle TEXT NOT NULL,
      author_name TEXT,
      text TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(archivly_folder);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_tweet_id ON bookmarks(tweet_id);
  `);

  // Migration: Add quoted_post_url column if it doesn't exist
  try {
    localDb.exec(`ALTER TABLE bookmarks ADD COLUMN quoted_post_url TEXT`);
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // Migration: Add link_title column if it doesn't exist
  try {
    localDb.exec(`ALTER TABLE bookmarks ADD COLUMN link_title TEXT`);
  } catch (e: any) {
    if (!e.message.includes('duplicate column name')) throw e;
  }

  // Migration: Add unique index on tweet_id in unbookmark_queue to prevent duplicates
  try {
    localDb.exec(`
      DELETE FROM unbookmark_queue
      WHERE id NOT IN (
        SELECT MIN(id) FROM unbookmark_queue GROUP BY tweet_id
      )
    `);
    localDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_unbookmark_queue_tweet_unique ON unbookmark_queue(tweet_id)`);
  } catch (e: any) {
    if (!e.message.includes('already exists')) {
      console.error('Migration error:', e.message);
    }
  }

  // Migration: Remove foreign key from unbookmark_queue
  try {
    const tableInfo = localDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='unbookmark_queue'").get() as any;
    if (tableInfo?.sql?.includes('FOREIGN KEY')) {
      console.log('Migrating unbookmark_queue to remove foreign key...');
      localDb.exec(`
        CREATE TABLE IF NOT EXISTS unbookmark_queue_new (
          id TEXT PRIMARY KEY,
          tweet_id TEXT NOT NULL,
          bookmark_id TEXT,
          author_handle TEXT,
          added_at TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO unbookmark_queue_new SELECT * FROM unbookmark_queue;
        DROP TABLE unbookmark_queue;
        ALTER TABLE unbookmark_queue_new RENAME TO unbookmark_queue;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unbookmark_queue_tweet_unique ON unbookmark_queue(tweet_id);
      `);
      console.log('Migration complete');
    }
  } catch (e: any) {
    console.error('Migration error (remove FK):', e.message);
  }
}

// Helper to parse bookmark row
function parseBookmarkRow(row: any) {
  return {
    id: row.id,
    tweet_id: row.tweet_id,
    author_handle: row.author_handle,
    author_name: row.author_name,
    text: row.text,
    urls: JSON.parse(row.urls || '[]'),
    media_urls: JSON.parse(row.media_urls || '[]'),
    created_at: row.created_at,
    bookmarked_at: row.bookmarked_at,
    imported_at: row.imported_at,
    tags: JSON.parse(row.tags || '[]'),
    archivly_folder: row.archivly_folder,
    quoted_post_url: row.quoted_post_url,
    link_title: row.link_title,
    status: row.status,
    embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer)) : undefined,
  };
}

// Bookmark operations
export async function insertBookmark(bookmark: {
  id: string;
  tweet_id: string;
  author_handle: string;
  author_name?: string;
  text: string;
  urls?: string[];
  media_urls?: string[];
  created_at?: string;
  bookmarked_at?: string;
  tags?: string[];
  archivly_folder?: string;
  quoted_post_url?: string;
  link_title?: string;
}) {
  if (!localDb) return;
  const urls = JSON.stringify(bookmark.urls || []);
  const media_urls = JSON.stringify(bookmark.media_urls || []);
  const tags = JSON.stringify(bookmark.tags || []);

  const stmt = localDb.prepare(`
    INSERT INTO bookmarks
    (id, tweet_id, author_handle, author_name, text, urls, media_urls, created_at, bookmarked_at, tags, archivly_folder, quoted_post_url, link_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tweet_id) DO UPDATE SET
      media_urls = CASE WHEN excluded.media_urls != '[]' THEN excluded.media_urls ELSE media_urls END,
      urls = CASE WHEN excluded.urls != '[]' THEN excluded.urls ELSE urls END,
      quoted_post_url = CASE WHEN excluded.quoted_post_url IS NOT NULL THEN excluded.quoted_post_url ELSE quoted_post_url END,
      link_title = CASE WHEN excluded.link_title IS NOT NULL THEN excluded.link_title ELSE link_title END,
      archivly_folder = CASE WHEN excluded.archivly_folder IS NOT NULL AND excluded.archivly_folder != 'unsorted' THEN excluded.archivly_folder ELSE archivly_folder END
  `);
  stmt.run(
    bookmark.id,
    bookmark.tweet_id,
    bookmark.author_handle,
    bookmark.author_name || '',
    bookmark.text,
    urls,
    media_urls,
    bookmark.created_at || null,
    bookmark.bookmarked_at || null,
    tags,
    bookmark.archivly_folder || null,
    bookmark.quoted_post_url || null,
    bookmark.link_title || null
  );
}

export async function getAllBookmarks() {
  if (!localDb) return [];

  const rows = localDb.prepare('SELECT * FROM bookmarks ORDER BY imported_at DESC').all() as any[];
  const historyRows = localDb.prepare(`
    SELECT rh.bookmark_id, rh.destination_type, rh.status, d.name as destination_name
    FROM routing_history rh
    LEFT JOIN destinations d ON rh.destination_id = d.id
    WHERE rh.status = 'success'
    ORDER BY rh.created_at DESC
  `).all() as any[];

  const bookmarks = rows.map(parseBookmarkRow);

  // Group history by bookmark_id
  const historyByBookmark = new Map<string, Array<{ type: string; name: string }>>();
  for (const row of historyRows) {
    if (!historyByBookmark.has(row.bookmark_id)) {
      historyByBookmark.set(row.bookmark_id, []);
    }
    historyByBookmark.get(row.bookmark_id)!.push({
      type: row.destination_type,
      name: row.destination_name || row.destination_type,
    });
  }

  // Build tweet_id -> bookmark map for quoted tweet lookups
  const tweetIdToBookmark = new Map<string, { text: string; author_handle: string; media_urls?: string[] }>();
  for (const b of bookmarks) {
    tweetIdToBookmark.set(b.tweet_id, { text: b.text, author_handle: b.author_handle, media_urls: b.media_urls });
  }

  const extractTweetId = (url: string): string | null => {
    const match = url.match(/\/status\/(\d+)/);
    return match ? match[1] : null;
  };

  // Collect missing quoted tweet IDs
  const missingQuotedTweetIds: string[] = [];
  for (const b of bookmarks) {
    if (b.quoted_post_url) {
      const quotedTweetId = extractTweetId(b.quoted_post_url);
      if (quotedTweetId && !tweetIdToBookmark.has(quotedTweetId)) {
        missingQuotedTweetIds.push(quotedTweetId);
      }
    }
  }

  const cachedTweets = await getCachedTweetsByIds(missingQuotedTweetIds);

  return bookmarks.map(b => {
    let quoted_tweet = undefined;
    if (b.quoted_post_url) {
      const quotedTweetId = extractTweetId(b.quoted_post_url);
      if (quotedTweetId) {
        const quotedBookmark = tweetIdToBookmark.get(quotedTweetId) || cachedTweets.get(quotedTweetId);
        if (quotedBookmark) {
          quoted_tweet = {
            text: quotedBookmark.text,
            author_handle: quotedBookmark.author_handle,
            media_urls: quotedBookmark.media_urls || [],
          };
        }
      }
    }
    return {
      ...b,
      routed_to: historyByBookmark.get(b.id) || [],
      quoted_tweet,
    };
  });
}

export async function getBookmarkById(id: string) {
  if (!localDb) return null;
  const row = localDb.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as any;
  return row ? parseBookmarkRow(row) : null;
}

export async function getBookmarkByTweetId(tweetId: string) {
  if (!localDb) return null;
  const row = localDb.prepare('SELECT * FROM bookmarks WHERE tweet_id = ?').get(tweetId) as any;
  return row ? parseBookmarkRow(row) : null;
}

export async function updateBookmarkStatus(id: string, status: 'pending' | 'routed' | 'archived') {
  if (!localDb) return;
  localDb.prepare('UPDATE bookmarks SET status = ? WHERE id = ?').run(status, id);
}

export async function updateBookmarkFolder(id: string, folder: string | null) {
  if (!localDb) return;
  localDb.prepare('UPDATE bookmarks SET archivly_folder = ? WHERE id = ?').run(folder, id);
}

export async function updateBookmarksFolderBulk(ids: string[], folder: string | null) {
  if (!localDb) return;
  const stmt = localDb.prepare('UPDATE bookmarks SET archivly_folder = ? WHERE id = ?');
  const updateMany = localDb.transaction((ids: string[]) => {
    for (const id of ids) {
      stmt.run(folder, id);
    }
  });
  updateMany(ids);
}

export async function deleteBookmarks(ids: string[], keepQueue: boolean = false) {
  if (!localDb) return;
  const deleteHistory = localDb.prepare('DELETE FROM routing_history WHERE bookmark_id = ?');
  const deleteQueue = localDb.prepare('DELETE FROM unbookmark_queue WHERE bookmark_id = ?');
  const deleteBookmark = localDb.prepare('DELETE FROM bookmarks WHERE id = ?');
  const deleteMany = localDb.transaction((ids: string[]) => {
    for (const id of ids) {
      deleteHistory.run(id);
      if (!keepQueue) {
        deleteQueue.run(id);
      }
      deleteBookmark.run(id);
    }
  });
  deleteMany(ids);
}

export async function updateBookmarkEmbedding(id: string, embedding: number[]) {
  if (!localDb) return;
  const buffer = Buffer.from(new Float32Array(embedding).buffer);
  localDb.prepare('UPDATE bookmarks SET embedding = ? WHERE id = ?').run(buffer, id);
}

export async function getBookmarksWithoutEmbeddings() {
  if (!localDb) return [];
  const rows = localDb.prepare('SELECT * FROM bookmarks WHERE embedding IS NULL').all() as any[];
  return rows.map(parseBookmarkRow);
}

export async function updateBookmarkLinkTitle(id: string, linkTitle: string | null) {
  if (!localDb) return;
  localDb.prepare('UPDATE bookmarks SET link_title = ? WHERE id = ?').run(linkTitle, id);
}

export async function getBookmarksWithoutLinkTitles() {
  if (!localDb) return [];
  const rows = localDb.prepare(`SELECT * FROM bookmarks WHERE link_title IS NULL AND urls != '[]' AND urls NOT LIKE '%t.co%'`).all() as any[];
  return rows.map(parseBookmarkRow);
}

// Destination operations
export async function insertDestination(dest: { id: string; type: string; name: string; config: Record<string, string> }) {
  if (!localDb) return;
  const config = JSON.stringify(dest.config);
  localDb.prepare('INSERT INTO destinations (id, type, name, config) VALUES (?, ?, ?, ?)').run(dest.id, dest.type, dest.name, config);
}

export async function getAllDestinations() {
  if (!localDb) return [];
  const rows = localDb.prepare('SELECT * FROM destinations ORDER BY created_at').all() as any[];
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    config: JSON.parse(row.config as string),
    created_at: row.created_at,
  }));
}

export async function deleteDestination(id: string) {
  if (!localDb) return;
  localDb.prepare('DELETE FROM destinations WHERE id = ?').run(id);
}

export async function updateDestinationConfig(id: string, config: Record<string, string>) {
  if (!localDb) return;
  const configJson = JSON.stringify(config);
  localDb.prepare('UPDATE destinations SET config = ? WHERE id = ?').run(configJson, id);
}

// Routing history
export async function insertRoutingHistory(entry: {
  id: string;
  bookmark_id: string;
  destination_id: string;
  destination_type: string;
  status: string;
  error_message?: string;
}) {
  if (!localDb) return;
  localDb.prepare('INSERT INTO routing_history (id, bookmark_id, destination_id, destination_type, status, error_message) VALUES (?, ?, ?, ?, ?, ?)').run(
    entry.id, entry.bookmark_id, entry.destination_id, entry.destination_type, entry.status, entry.error_message || null
  );
}

export async function getRoutingHistoryForBookmark(bookmarkId: string) {
  if (!localDb) return [];
  return localDb.prepare('SELECT * FROM routing_history WHERE bookmark_id = ? ORDER BY created_at DESC').all(bookmarkId);
}

// Unbookmark queue operations
export async function addToUnbookmarkQueue(entry: {
  id: string;
  tweet_id: string;
  bookmark_id: string;
  author_handle?: string;
}) {
  if (!localDb) return;
  localDb.prepare('INSERT OR IGNORE INTO unbookmark_queue (id, tweet_id, bookmark_id, author_handle) VALUES (?, ?, ?, ?)').run(
    entry.id, entry.tweet_id, entry.bookmark_id, entry.author_handle || null
  );
}

export async function getUnbookmarkQueue() {
  if (!localDb) return [];
  return localDb.prepare('SELECT * FROM unbookmark_queue ORDER BY added_at ASC').all();
}

export async function removeFromUnbookmarkQueue(tweetId: string) {
  if (!localDb) return;
  localDb.prepare('DELETE FROM unbookmark_queue WHERE tweet_id = ?').run(tweetId);
}

export async function clearUnbookmarkQueue() {
  if (!localDb) return;
  localDb.prepare('DELETE FROM unbookmark_queue').run();
}

// Cached tweet operations
export async function insertCachedTweet(tweet: {
  tweet_id: string;
  author_handle: string;
  author_name?: string;
  text: string;
}) {
  if (!localDb) return;
  localDb.prepare('INSERT OR REPLACE INTO cached_tweets (tweet_id, author_handle, author_name, text) VALUES (?, ?, ?, ?)').run(
    tweet.tweet_id, tweet.author_handle, tweet.author_name || tweet.author_handle, tweet.text
  );
}

export async function getCachedTweet(tweetId: string) {
  if (!localDb) return undefined;
  return localDb.prepare('SELECT * FROM cached_tweets WHERE tweet_id = ?').get(tweetId) as {
    tweet_id: string; author_handle: string; author_name: string; text: string; fetched_at: string;
  } | undefined;
}

export async function getCachedTweetsByIds(tweetIds: string[]) {
  const map = new Map<string, { text: string; author_handle: string; media_urls?: string[] }>();
  if (tweetIds.length === 0 || !localDb) return map;

  const placeholders = tweetIds.map(() => '?').join(',');
  const rows = localDb.prepare(`SELECT * FROM cached_tweets WHERE tweet_id IN (${placeholders})`).all(...tweetIds) as any[];
  for (const row of rows) {
    map.set(row.tweet_id, { text: row.text, author_handle: row.author_handle });
  }
  return map;
}

export async function getBookmarksWithMissingQuotedTweets() {
  if (!localDb) return [];
  const sql = `
    SELECT b.id, b.quoted_post_url
    FROM bookmarks b
    WHERE b.quoted_post_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookmarks b2
        WHERE b2.tweet_id = SUBSTR(b.quoted_post_url, INSTR(b.quoted_post_url, '/status/') + 8)
      )
      AND NOT EXISTS (
        SELECT 1 FROM cached_tweets ct
        WHERE ct.tweet_id = SUBSTR(b.quoted_post_url, INSTR(b.quoted_post_url, '/status/') + 8)
      )
  `;
  return localDb.prepare(sql).all() as { id: string; quoted_post_url: string }[];
}

export function closeDb() {
  if (localDb) {
    localDb.close();
  }
}

export function getDb(): Database.Database {
  if (!localDb) {
    throw new Error('Local database not initialized. Call initDb() first.');
  }
  return localDb;
}
