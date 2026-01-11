import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { importBookmarks, importBookmarksWithUnfurling, parseContent } from './importer.js';
import { initOpenAI, embedUnprocessedBookmarks, searchBookmarks } from './embeddings.js';
import { sendToInstapaper, testInstapaperCredentials } from './connectors/instapaper.js';
import {
  listFilesInFolder,
  appendToGoogleDoc,
  extractFolderId,
  extractDocId,
  searchDocs,
  createGoogleDoc,
} from './connectors/google-drive.js';
import { startAuthFlow as startXAuthFlow, isConfigured as isXConfigured } from './x-auth.js';
import { unbookmarkTweet, unbookmarkTweetsBulk } from './connectors/twitter.js';
import {
  searchNotionPages,
  appendTweetToPage as appendToNotionPage,
  verifyNotionToken,
  isConfigured as isNotionConfigured,
  getToken as getNotionToken,
} from './connectors/notion.js';
import { fetchTweet, parseTweetUrl } from './twitter.js';
import { unfurlUrlWithPuppeteer, closeBrowser } from './unfurl.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize OpenAI if API key is provided
if (process.env.OPENAI_API_KEY) {
  initOpenAI(process.env.OPENAI_API_KEY);
  console.log('OpenAI initialized for semantic search');
} else {
  console.log('Running without OpenAI - basic text search only');
}

// ============== BOOKMARKS ==============

// Get all bookmarks
app.get('/api/bookmarks', async (req, res) => {
  try {
    const bookmarks = await db.getAllBookmarks();
    res.json(bookmarks);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single bookmark
app.get('/api/bookmarks/:id', async (req, res) => {
  try {
    const bookmark = await db.getBookmarkById(req.params.id);
    if (!bookmark) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }
    res.json(bookmark);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update bookmark status
app.patch('/api/bookmarks/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'routed', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await db.updateBookmarkStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== IMPORT ==============

// Import bookmarks from ArchivlyX export (with URL unfurling by default)
app.post('/api/import', async (req, res) => {
  try {
    const { content, skipUnfurling } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'No content provided' });
    }

    if (skipUnfurling) {
      // Fast import without unfurling
      const result = importBookmarks(content);
      res.json(result);
    } else {
      // Full import with URL unfurling (slower but gets link titles)
      const result = await importBookmarksWithUnfurling(content);
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== EMBEDDINGS ==============

// Trigger embedding generation for unprocessed bookmarks
app.post('/api/embeddings/generate', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });
    }
    const result = await embedUnprocessedBookmarks();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== SEARCH ==============

// Search (hybrid: exact text matches first, then semantic)
app.post('/api/search', async (req, res) => {
  try {
    const { query, limit = 50, minSimilarity = 0.2 } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'No query provided' });
    }

    const allBookmarks = await db.getAllBookmarks();
    const lowerQuery = query.toLowerCase();

    // First: find exact text matches (author, text, tags)
    const exactMatches = allBookmarks.filter(b =>
      b.text.toLowerCase().includes(lowerQuery) ||
      b.author_handle.toLowerCase().includes(lowerQuery) ||
      b.author_name?.toLowerCase().includes(lowerQuery) ||
      b.tags.some((t: string) => t.toLowerCase().includes(lowerQuery)) ||
      b.link_title?.toLowerCase().includes(lowerQuery)
    ).map(b => ({ ...b, similarity: 1.0, matchType: 'exact' }));

    // If OpenAI is configured, also do semantic search
    let semanticMatches: any[] = [];
    if (process.env.OPENAI_API_KEY) {
      const semanticResults = await searchBookmarks(query, allBookmarks, limit * 2);
      semanticMatches = semanticResults
        .filter(r => r.similarity >= minSimilarity)
        .map(r => ({ ...r, matchType: 'semantic' }));
    }

    // Combine: exact matches first, then semantic (deduplicated)
    const exactIds = new Set(exactMatches.map(b => b.id));
    const combined = [
      ...exactMatches,
      ...semanticMatches.filter(b => !exactIds.has(b.id))
    ].slice(0, limit);

    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== DESTINATIONS ==============

// Get all destinations
app.get('/api/destinations', async (req, res) => {
  try {
    const destinations = await db.getAllDestinations();
    // Don't send sensitive config data
    const safe = destinations.map(d => ({
      ...d,
      config: { ...d.config, password: d.config.password ? '***' : undefined },
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Add destination
app.post('/api/destinations', async (req, res) => {
  try {
    const { type, name, config } = req.body;
    if (!type || !name || !config) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = uuidv4();
    await db.insertDestination({ id, type, name, config });
    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Delete destination
app.delete('/api/destinations/:id', async (req, res) => {
  try {
    await db.deleteDestination(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Test Instapaper credentials
app.post('/api/destinations/test/instapaper', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await testInstapaperCredentials({ username, password });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== GOOGLE DRIVE ==============

// List files in a Google Drive folder
app.post('/api/google/list-folder', async (req, res) => {
  try {
    const { folder_url, destination_id } = req.body;

    // Get the Google account credentials from the destination
    const destinations = await db.getAllDestinations();
    const googleDest = destinations.find(d => d.id === destination_id && d.type === 'google');

    if (!googleDest) {
      return res.status(404).json({ error: 'Google destination not found' });
    }

    const folderId = extractFolderId(folder_url);
    if (!folderId) {
      return res.status(400).json({ error: 'Invalid Google Drive folder URL' });
    }

    const files = await listFilesInFolder(folderId, {
      access_token: googleDest.config.access_token,
      refresh_token: googleDest.config.refresh_token,
    });

    // Separate folders and docs
    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const docs = files.filter(f => f.mimeType === 'application/vnd.google-apps.document');
    const other = files.filter(f =>
      f.mimeType !== 'application/vnd.google-apps.folder' &&
      f.mimeType !== 'application/vnd.google-apps.document'
    );

    res.json({ folders, docs, other, folderId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get all Google accounts (for folder browsing)
app.get('/api/google/accounts', async (req, res) => {
  try {
    const destinations = await db.getAllDestinations();
    const googleAccounts = destinations
      .filter(d => d.type === 'google')
      .map(d => ({
        id: d.id,
        name: d.name,
        email: d.config.email,
      }));
    res.json(googleAccounts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Add a Google Doc as a destination
app.post('/api/google/add-doc-destination', async (req, res) => {
  try {
    const { google_account_id, doc_id, doc_name } = req.body;

    // Get the Google account to copy credentials
    const destinations = await db.getAllDestinations();
    const googleAccount = destinations.find(d => d.id === google_account_id && d.type === 'google');

    if (!googleAccount) {
      return res.status(404).json({ error: 'Google account not found' });
    }

    const id = uuidv4();
    await db.insertDestination({
      id,
      type: 'google-doc',
      name: `📄 ${doc_name}`,
      config: {
        doc_id,
        doc_name,
        email: googleAccount.config.email,
        access_token: googleAccount.config.access_token,
        refresh_token: googleAccount.config.refresh_token,
      },
    });

    res.json({ id, success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Search Google Docs across Drive
app.post('/api/google/search-docs', async (req, res) => {
  try {
    const { query, google_account_id } = req.body;

    if (!query || query.length < 2) {
      return res.json([]);
    }

    const destinations = await db.getAllDestinations();
    const googleAccount = destinations.find(d => d.id === google_account_id && d.type === 'google');

    if (!googleAccount) {
      return res.status(404).json({ error: 'Google account not found' });
    }

    const docs = await searchDocs(query, {
      access_token: googleAccount.config.access_token,
      refresh_token: googleAccount.config.refresh_token,
    });

    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Send bookmark(s) directly to a Google Doc (no pre-setup needed)
app.post('/api/google/send-to-doc', async (req, res) => {
  try {
    const { bookmark_ids, doc_id, doc_name, google_account_id } = req.body;

    const destinations = await db.getAllDestinations();
    const googleAccount = destinations.find(d => d.id === google_account_id && d.type === 'google');

    if (!googleAccount) {
      return res.status(404).json({ error: 'Google account not found' });
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const bookmarkId of bookmark_ids) {
      const bookmark = await db.getBookmarkById(bookmarkId);
      if (!bookmark) {
        results.failed++;
        results.errors.push(`Bookmark ${bookmarkId} not found`);
        continue;
      }

      try {
        const tweetUrl = `https://twitter.com/${bookmark.author_handle}/status/${bookmark.tweet_id}`;
        await appendToGoogleDoc(
          doc_id,
          {
            tweetUrl,
            authorHandle: bookmark.author_handle,
            text: bookmark.text,
            date: bookmark.created_at || new Date().toISOString().split('T')[0],
            mediaUrls: bookmark.media_urls || [],
          },
          {
            access_token: googleAccount.config.access_token,
            refresh_token: googleAccount.config.refresh_token,
          }
        );

        // Log to history
        await db.insertRoutingHistory({
          id: uuidv4(),
          bookmark_id: bookmarkId,
          destination_id: `gdoc:${doc_id}`,
          destination_type: 'google-doc',
          status: 'success',
        });

        await db.updateBookmarkStatus(bookmarkId, 'routed');
        // Queue for unbookmarking via Chrome extension
        queueForUnbookmark(bookmarkId, bookmark.tweet_id, bookmark.author_handle);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${bookmarkId}: ${err}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Create a new Google Doc and add selected tweets to it
app.post('/api/google/create-doc-with-tweets', async (req, res) => {
  try {
    const { bookmark_ids, doc_title, google_account_id } = req.body;

    const destinations = await db.getAllDestinations();
    const googleAccount = destinations.find(d => d.id === google_account_id && d.type === 'google');

    if (!googleAccount) {
      return res.status(404).json({ error: 'Google account not found' });
    }

    // Create the new doc
    const newDoc = await createGoogleDoc(doc_title, null, {
      access_token: googleAccount.config.access_token,
      refresh_token: googleAccount.config.refresh_token,
    });

    const results = { success: 0, failed: 0, errors: [] as string[], docId: newDoc.id, docUrl: `https://docs.google.com/document/d/${newDoc.id}` };

    // Add each tweet to the doc
    for (const bookmarkId of bookmark_ids) {
      const bookmark = await db.getBookmarkById(bookmarkId);
      if (!bookmark) {
        results.failed++;
        results.errors.push(`Bookmark ${bookmarkId} not found`);
        continue;
      }

      try {
        const tweetUrl = `https://twitter.com/${bookmark.author_handle}/status/${bookmark.tweet_id}`;
        await appendToGoogleDoc(
          newDoc.id,
          {
            tweetUrl,
            authorHandle: bookmark.author_handle,
            text: bookmark.text,
            date: bookmark.created_at || new Date().toISOString().split('T')[0],
            mediaUrls: bookmark.media_urls || [],
          },
          {
            access_token: googleAccount.config.access_token,
            refresh_token: googleAccount.config.refresh_token,
          }
        );

        await db.insertRoutingHistory({
          id: uuidv4(),
          bookmark_id: bookmarkId,
          destination_id: `gdoc:${newDoc.id}`,
          destination_type: 'google-doc',
          status: 'success',
        });

        await db.updateBookmarkStatus(bookmarkId, 'routed');
        // Queue for unbookmarking via Chrome extension
        queueForUnbookmark(bookmarkId, bookmark.tweet_id, bookmark.author_handle);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${bookmarkId}: ${err}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== NOTION ==============

// Check if Notion is configured
app.get('/api/notion/status', async (req, res) => {
  const configured = isNotionConfigured();
  if (!configured) {
    return res.json({ configured: false, connected: false });
  }

  try {
    const result = await verifyNotionToken(getNotionToken());
    res.json({
      configured: true,
      connected: result.valid,
      botName: result.botName,
      error: result.error,
    });
  } catch (err) {
    res.json({ configured: true, connected: false, error: String(err) });
  }
});

// Search Notion pages
app.post('/api/notion/search', async (req, res) => {
  try {
    if (!isNotionConfigured()) {
      return res.status(400).json({ error: 'Notion not configured. Set NOTION_INTEGRATION_TOKEN.' });
    }

    const { query } = req.body;
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const pages = await searchNotionPages(query, { token: getNotionToken() });
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Send bookmark(s) to a Notion page
app.post('/api/notion/send-to-page', async (req, res) => {
  try {
    if (!isNotionConfigured()) {
      return res.status(400).json({ error: 'Notion not configured' });
    }

    const { bookmark_ids, page_id, page_title } = req.body;

    if (!Array.isArray(bookmark_ids) || bookmark_ids.length === 0) {
      return res.status(400).json({ error: 'No bookmark IDs provided' });
    }

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const bookmarkId of bookmark_ids) {
      const bookmark = await db.getBookmarkById(bookmarkId);
      if (!bookmark) {
        results.failed++;
        results.errors.push(`Bookmark ${bookmarkId} not found`);
        continue;
      }

      try {
        const tweetUrl = `https://twitter.com/${bookmark.author_handle}/status/${bookmark.tweet_id}`;
        await appendToNotionPage(
          page_id,
          {
            tweetUrl,
            authorHandle: bookmark.author_handle,
            text: bookmark.text,
            date: bookmark.created_at || new Date().toISOString().split('T')[0],
            mediaUrls: bookmark.media_urls || [],
          },
          { token: getNotionToken() }
        );

        // Log to history
        await db.insertRoutingHistory({
          id: uuidv4(),
          bookmark_id: bookmarkId,
          destination_id: `notion:${page_id}`,
          destination_type: 'notion',
          status: 'success',
        });

        await db.updateBookmarkStatus(bookmarkId, 'routed');
        // Queue for unbookmarking via Chrome extension
        queueForUnbookmark(bookmarkId, bookmark.tweet_id, bookmark.author_handle);
        results.success++;

        // Rate limiting for Notion (3 req/sec)
        if (bookmark_ids.indexOf(bookmarkId) < bookmark_ids.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${bookmarkId}: ${err}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== X/TWITTER ==============

// Check if X API is configured
app.get('/api/x/status', async (req, res) => {
  const configured = isXConfigured();
  const destinations = await db.getAllDestinations();
  const xAccount = destinations.find(d => d.type === 'x');

  res.json({
    configured,
    connected: Boolean(xAccount),
    username: xAccount?.config?.username || null,
  });
});

// Get X accounts (there should only be one)
app.get('/api/x/accounts', async (req, res) => {
  try {
    const destinations = await db.getAllDestinations();
    const xAccounts = destinations
      .filter(d => d.type === 'x')
      .map(d => ({
        id: d.id,
        username: d.config.username,
        user_id: d.config.user_id,
      }));
    res.json(xAccounts);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start X OAuth flow (run from CLI)
app.post('/api/x/auth/start', async (req, res) => {
  try {
    if (!isXConfigured()) {
      return res.status(400).json({
        error: 'X API not configured. Set X_CLIENT_ID and X_CLIENT_SECRET environment variables.',
      });
    }

    // This will open a browser for OAuth
    const result = await startXAuthFlow();

    // Save the X account as a destination
    const id = uuidv4();
    await db.insertDestination({
      id,
      type: 'x',
      name: `X @${result.username}`,
      config: {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        user_id: result.user_id,
        username: result.username,
      },
    });

    res.json({
      success: true,
      username: result.username,
      id,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Unbookmark a single tweet
app.post('/api/x/unbookmark', async (req, res) => {
  try {
    const { bookmark_id } = req.body;

    const bookmark = await db.getBookmarkById(bookmark_id);
    if (!bookmark) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    const destinations = await db.getAllDestinations();
    const xAccount = destinations.find(d => d.type === 'x');

    if (!xAccount) {
      return res.status(400).json({ error: 'No X account connected' });
    }

    const result = await unbookmarkTweet(bookmark.tweet_id, {
      access_token: xAccount.config.access_token,
      refresh_token: xAccount.config.refresh_token,
      user_id: xAccount.config.user_id,
    });

    // Update tokens if refreshed
    if (result.newTokens) {
      await db.updateDestinationConfig(xAccount.id, {
        ...xAccount.config,
        access_token: result.newTokens.access_token,
        refresh_token: result.newTokens.refresh_token,
      });
    }

    res.json({ success: result.success });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Bulk unbookmark tweets
app.post('/api/x/unbookmark/bulk', async (req, res) => {
  try {
    const { bookmark_ids } = req.body;

    if (!Array.isArray(bookmark_ids) || bookmark_ids.length === 0) {
      return res.status(400).json({ error: 'No bookmark IDs provided' });
    }

    const destinations = await db.getAllDestinations();
    const xAccount = destinations.find(d => d.type === 'x');

    if (!xAccount) {
      return res.status(400).json({ error: 'No X account connected' });
    }

    // Get tweet IDs from bookmark IDs
    const tweetIds: string[] = [];
    for (const bookmarkId of bookmark_ids) {
      const bookmark = await db.getBookmarkById(bookmarkId);
      if (bookmark) {
        tweetIds.push(bookmark.tweet_id);
      }
    }

    const result = await unbookmarkTweetsBulk(tweetIds, {
      access_token: xAccount.config.access_token,
      refresh_token: xAccount.config.refresh_token,
      user_id: xAccount.config.user_id,
    });

    // Update tokens if refreshed
    if (result.newTokens) {
      await db.updateDestinationConfig(xAccount.id, {
        ...xAccount.config,
        access_token: result.newTokens.access_token,
        refresh_token: result.newTokens.refresh_token,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== UNBOOKMARK QUEUE (for Chrome Extension) ==============

// Get the unbookmark queue
app.get('/api/unbookmark-queue', async (req, res) => {
  try {
    const queue = await db.getUnbookmarkQueue();
    res.json({ queue });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Remove a tweet from the queue (called by extension after successful unbookmark)
app.post('/api/unbookmark-queue/remove', async (req, res) => {
  try {
    const { tweet_id } = req.body;
    if (!tweet_id) {
      return res.status(400).json({ error: 'tweet_id required' });
    }
    await db.removeFromUnbookmarkQueue(tweet_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Clear the entire queue
app.post('/api/unbookmark-queue/clear', async (req, res) => {
  try {
    await db.clearUnbookmarkQueue();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== QUOTED TWEETS ==============

// Get status of quoted tweets (how many are missing)
app.get('/api/quoted-tweets/status', async (req, res) => {
  try {
    const missing = await db.getBookmarksWithMissingQuotedTweets();
    res.json({
      missing: missing.length,
      urls: missing.map(m => m.quoted_post_url),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Fetch and cache missing quoted tweets
app.post('/api/quoted-tweets/fetch', async (req, res) => {
  try {
    const missing = await db.getBookmarksWithMissingQuotedTweets();

    if (missing.length === 0) {
      return res.json({ fetched: 0, failed: 0, message: 'All quoted tweets already cached' });
    }

    const results = { fetched: 0, failed: 0, errors: [] as string[] };

    for (const bookmark of missing) {
      const parsed = parseTweetUrl(bookmark.quoted_post_url);
      if (!parsed) {
        results.failed++;
        results.errors.push(`Invalid URL: ${bookmark.quoted_post_url}`);
        continue;
      }

      try {
        const tweet = await fetchTweet(bookmark.quoted_post_url);
        if (tweet) {
          await db.insertCachedTweet(tweet);
          results.fetched++;
          console.log(`Cached quoted tweet ${tweet.tweet_id} by @${tweet.author_handle}`);
        } else {
          results.failed++;
          results.errors.push(`Failed to fetch: ${bookmark.quoted_post_url}`);
        }

        // Rate limit - 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        results.failed++;
        results.errors.push(`${bookmark.quoted_post_url}: ${err}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== ROUTING ==============

// Helper function to queue tweet for unbookmarking after successful routing
async function queueForUnbookmark(bookmarkId: string, tweetId: string, authorHandle: string): void {
  try {
    await db.addToUnbookmarkQueue({
      id: uuidv4(),
      tweet_id: tweetId,
      bookmark_id: bookmarkId,
      author_handle: authorHandle,
    });
    console.log(`Queued tweet ${tweetId} for unbookmarking`);
  } catch (err) {
    console.error(`Failed to queue tweet ${tweetId} for unbookmarking:`, err);
  }
}

// Legacy function for X API unbookmarking (if configured)
async function tryUnbookmarkAfterRoute(tweetId: string): Promise<void> {
  try {
    const destinations = await db.getAllDestinations();
    const xAccount = destinations.find(d => d.type === 'x');

    if (!xAccount) return; // No X account connected, skip API unbookmarking

    const result = await unbookmarkTweet(tweetId, {
      access_token: xAccount.config.access_token,
      refresh_token: xAccount.config.refresh_token,
      user_id: xAccount.config.user_id,
    });

    // Update tokens if refreshed
    if (result.newTokens) {
      await db.updateDestinationConfig(xAccount.id, {
        ...xAccount.config,
        access_token: result.newTokens.access_token,
        refresh_token: result.newTokens.refresh_token,
      });
    }

    if (result.success) {
      console.log(`Unbookmarked tweet ${tweetId} from X via API`);
    }
  } catch (err) {
    console.error(`Failed to unbookmark tweet ${tweetId}:`, err);
    // Don't throw - unbookmarking is a secondary action
  }
}

// Send bookmark to destination
app.post('/api/route', async (req, res) => {
  try {
    const { bookmark_id, destination_id } = req.body;

    const bookmark = await db.getBookmarkById(bookmark_id);
    if (!bookmark) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    const destinations = await db.getAllDestinations();
    const destination = destinations.find(d => d.id === destination_id);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found' });
    }

    let result: { success: boolean; error?: string };

    switch (destination.type) {
      case 'instapaper':
        result = await sendToInstapaper(bookmark as any, {
          username: destination.config.username,
          password: destination.config.password,
        });
        break;

      case 'google-doc': {
        // Append tweet content to a Google Doc
        const tweetUrl = `https://twitter.com/${bookmark.author_handle}/status/${bookmark.tweet_id}`;
        await appendToGoogleDoc(
          destination.config.doc_id,
          {
            tweetUrl,
            authorHandle: bookmark.author_handle,
            text: bookmark.text,
            date: bookmark.created_at || new Date().toISOString().split('T')[0],
            mediaUrls: bookmark.media_urls || [],
          },
          {
            access_token: destination.config.access_token,
            refresh_token: destination.config.refresh_token,
          }
        );
        result = { success: true };
        break;
      }

      default:
        result = { success: false, error: `Unsupported destination type: ${destination.type}` };
    }

    // Log to routing history
    await db.insertRoutingHistory({
      id: uuidv4(),
      bookmark_id,
      destination_id,
      destination_type: destination.type,
      status: result.success ? 'success' : 'failed',
      error_message: result.error,
    });

    // Update bookmark status if successful
    if (result.success) {
      await db.updateBookmarkStatus(bookmark_id, 'routed');
      // Queue for unbookmarking via Chrome extension
      queueForUnbookmark(bookmark_id, bookmark.tweet_id, bookmark.author_handle);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Bulk route bookmarks
app.post('/api/route/bulk', async (req, res) => {
  try {
    const { bookmark_ids, destination_id } = req.body;

    if (!Array.isArray(bookmark_ids) || bookmark_ids.length === 0) {
      return res.status(400).json({ error: 'No bookmark IDs provided' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const bookmark_id of bookmark_ids) {
      try {
        // Reuse the single route logic via internal call
        const bookmark = await db.getBookmarkById(bookmark_id);
        if (!bookmark) {
          results.failed++;
          results.errors.push(`Bookmark ${bookmark_id} not found`);
          continue;
        }

        const destinations = await db.getAllDestinations();
        const destination = destinations.find(d => d.id === destination_id);
        if (!destination) {
          results.failed++;
          results.errors.push(`Destination ${destination_id} not found`);
          break; // Same destination for all, so break
        }

        let result: { success: boolean; error?: string };

        switch (destination.type) {
          case 'instapaper':
            result = await sendToInstapaper(bookmark as any, {
              username: destination.config.username,
              password: destination.config.password,
            });
            break;
          case 'google-doc': {
            const tweetUrl = `https://twitter.com/${bookmark.author_handle}/status/${bookmark.tweet_id}`;
            await appendToGoogleDoc(
              destination.config.doc_id,
              {
                tweetUrl,
                authorHandle: bookmark.author_handle,
                text: bookmark.text,
                date: bookmark.created_at || new Date().toISOString().split('T')[0],
                mediaUrls: bookmark.media_urls || [],
              },
              {
                access_token: destination.config.access_token,
                refresh_token: destination.config.refresh_token,
              }
            );
            result = { success: true };
            break;
          }
          default:
            result = { success: false, error: `Unsupported destination type: ${destination.type}` };
        }

        await db.insertRoutingHistory({
          id: uuidv4(),
          bookmark_id,
          destination_id,
          destination_type: destination.type,
          status: result.success ? 'success' : 'failed',
          error_message: result.error,
        });

        if (result.success) {
          await db.updateBookmarkStatus(bookmark_id, 'routed');
          // Queue for unbookmarking via Chrome extension
          queueForUnbookmark(bookmark_id, bookmark.tweet_id, bookmark.author_handle);
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`${bookmark_id}: ${result.error}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${bookmark_id}: ${err}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== FOLDER MANAGEMENT ==============

app.post('/api/bookmarks/move-to-folder', (req, res) => {
  try {
    const { bookmarkIds, folder } = req.body;
    if (!Array.isArray(bookmarkIds)) {
      return res.status(400).json({ error: 'bookmarkIds must be an array' });
    }
    db.updateBookmarksFolderBulk(bookmarkIds, folder || null);
    res.json({ success: true, moved: bookmarkIds.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== DELETE BOOKMARKS ==============

app.post('/api/bookmarks/delete', (req, res) => {
  try {
    const { bookmarkIds, alsoUnbookmark } = req.body;
    console.log(`[DELETE] Request: ${bookmarkIds?.length} bookmarks, alsoUnbookmark=${alsoUnbookmark}`);

    if (!Array.isArray(bookmarkIds)) {
      return res.status(400).json({ error: 'bookmarkIds must be an array' });
    }

    // Optionally queue for unbookmarking before deleting
    if (alsoUnbookmark) {
      console.log(`[DELETE] Queueing for unbookmark...`);
      for (const id of bookmarkIds) {
        const bookmark = await db.getBookmarkById(id);
        console.log(`[DELETE] Bookmark ${id}: ${bookmark ? `tweet_id=${bookmark.tweet_id}` : 'NOT FOUND'}`);
        if (bookmark) {
          queueForUnbookmark(id, bookmark.tweet_id, bookmark.author_handle);
        }
      }
      // Check queue after adding
      const queue = await db.getUnbookmarkQueue();
      console.log(`[DELETE] Queue now has ${queue.length} items`);
    }

    // Pass keepQueue=true if we just added to the queue
    await db.deleteBookmarks(bookmarkIds, alsoUnbookmark);
    res.json({ success: true, deleted: bookmarkIds.length });
  } catch (err) {
    console.error('[DELETE] Error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ============== ROUTING HISTORY ==============

app.get('/api/bookmarks/:id/history', (req, res) => {
  try {
    const history = db.getRoutingHistoryForBookmark(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== LINK TITLE BACKFILL ==============

// Helper to check if URL is likely an article (not Twitter media)
function isBackfillableUrl(url: string): boolean {
  if (url.includes('t.co/')) return false;
  if (url.match(/(?:twitter\.com|x\.com)\/\w+\/status/)) return false;
  if (url.match(/(?:twitter\.com|x\.com).*\/photo/)) return false;
  if (url.match(/(?:twitter\.com|x\.com).*\/video/)) return false;
  return true;
}

// Get status of link_title backfill
app.get('/api/backfill/link-titles/status', (req, res) => {
  try {
    const bookmarks = db.getBookmarksWithoutLinkTitles();
    // Filter to only those with actual article URLs
    const needsBackfill = bookmarks.filter(b =>
      b.urls.some((u: string) => isBackfillableUrl(u))
    );
    res.json({
      total: needsBackfill.length,
      bookmarks: needsBackfill.slice(0, 10).map(b => ({
        id: b.id,
        text: b.text.slice(0, 100),
        urls: b.urls,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Run link_title backfill
app.post('/api/backfill/link-titles', async (req, res) => {
  try {
    const { limit = 50 } = req.body;
    const bookmarks = db.getBookmarksWithoutLinkTitles();

    // Filter to only those with actual article URLs
    const needsBackfill = bookmarks
      .filter(b => b.urls.some((u: string) => isBackfillableUrl(u)))
      .slice(0, limit);

    if (needsBackfill.length === 0) {
      return res.json({ processed: 0, updated: 0, message: 'No bookmarks need backfilling' });
    }

    console.log(`[BACKFILL] Processing ${needsBackfill.length} bookmarks...`);

    let updated = 0;
    const errors: string[] = [];

    for (const bookmark of needsBackfill) {
      // Find the first backfillable URL
      const articleUrl = bookmark.urls.find((u: string) => isBackfillableUrl(u));
      if (!articleUrl) continue;

      try {
        const result = await unfurlUrlWithPuppeteer(articleUrl);
        if (result.title) {
          db.updateBookmarkLinkTitle(bookmark.id, result.title);
          updated++;
          console.log(`[BACKFILL] Updated ${bookmark.id}: "${result.title}"`);
        }
      } catch (err) {
        errors.push(`${bookmark.id}: ${err}`);
      }

      // Small delay to avoid hammering servers
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Close browser when done
    await closeBrowser();

    res.json({
      processed: needsBackfill.length,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    await closeBrowser();
    res.status(500).json({ error: String(err) });
  }
});

// ============== FOLDER SYNC (UPDATE ONLY, NO RE-ADD) ==============

// Sync folders from ArchivlyX export without re-adding deleted tweets
app.post('/api/sync-folders', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'No content provided' });
    }

    // Parse the import content
    const bookmarks = parseContent(content);

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const bookmark of bookmarks) {
      // Check if this tweet exists in our database
      const existing = db.getBookmarkByTweetId(bookmark.tweet_id);

      if (!existing) {
        // Tweet was deleted or never imported - skip it
        notFound++;
        continue;
      }

      // Only update if the new folder is not 'unsorted' and different from current
      if (bookmark.archivly_folder &&
          bookmark.archivly_folder !== 'unsorted' &&
          bookmark.archivly_folder !== existing.archivly_folder) {
        db.updateBookmarkFolder(existing.id, bookmark.archivly_folder);
        updated++;
        console.log(`[SYNC] Updated folder for ${bookmark.tweet_id}: "${existing.archivly_folder}" -> "${bookmark.archivly_folder}"`);
      } else {
        skipped++;
      }
    }

    res.json({
      total: bookmarks.length,
      updated,
      skipped,
      notFound,
      message: `Updated ${updated} folders. ${notFound} tweets not found (already deleted). ${skipped} unchanged.`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============== HEALTH CHECK ==============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============== STATIC FILE SERVING (Production) ==============

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '../../dist');

// Serve static files from the dist folder
app.use(express.static(distPath));

// SPA fallback - serve index.html for all non-API routes
app.get('/{*splat}', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

// ============== START SERVER ==============

// Initialize database and start server
(async () => {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`Bookmark Sort API running on http://localhost:${PORT}`);
  });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await closeBrowser();
  db.closeDb();
  process.exit(0);
});
