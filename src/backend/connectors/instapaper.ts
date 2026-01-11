import type { Bookmark } from '../../lib/types.js';

export interface InstapaperCredentials {
  username: string;
  password: string;
}

/**
 * Check if a URL is likely an article (not a Twitter/X media or status URL)
 */
function isArticleUrl(url: string): boolean {
  // Skip t.co shortened links (not expanded)
  if (url.includes('t.co/')) return false;

  // Skip Twitter/X URLs (photos, videos, statuses)
  if (url.match(/(?:twitter\.com|x\.com)\/\w+\/status/)) return false;
  if (url.match(/(?:twitter\.com|x\.com).*\/photo/)) return false;
  if (url.match(/(?:twitter\.com|x\.com).*\/video/)) return false;

  return true;
}

/**
 * Send a bookmark to Instapaper using the Simple API
 * https://www.instapaper.com/api/simple
 */
export async function sendToInstapaper(
  bookmark: Bookmark,
  credentials: InstapaperCredentials
): Promise<{ success: boolean; error?: string }> {
  // Find the best URL to send - prefer actual article URLs
  const articleUrl = bookmark.urls.find(isArticleUrl);

  if (!articleUrl) {
    return {
      success: false,
      error: 'No article URL found in this tweet (only has media/tweet links)'
    };
  }

  const url = articleUrl;

  // Use the article's actual title if we have it, otherwise let Instapaper fetch it
  // The tweet text goes in "selection" (shows as a highlight/note in Instapaper)
  const params: Record<string, string> = {
    url,
    selection: `Via @${bookmark.author_handle}: ${bookmark.text}`,
  };

  // Only set title if we have the actual article title from unfurling
  if (bookmark.link_title) {
    params.title = bookmark.link_title;
  }
  // If no link_title, Instapaper will fetch the title from the page itself

  try {
    const response = await fetch('https://www.instapaper.com/api/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'),
      },
      body: new URLSearchParams(params),
    });

    if (response.status === 201) {
      return { success: true };
    } else if (response.status === 400) {
      return { success: false, error: 'Bad request or invalid URL' };
    } else if (response.status === 403) {
      return { success: false, error: 'Invalid username or password' };
    } else if (response.status === 500) {
      return { success: false, error: 'Instapaper service error' };
    } else {
      return { success: false, error: `Unexpected status: ${response.status}` };
    }
  } catch (err) {
    return { success: false, error: `Network error: ${err}` };
  }
}

/**
 * Test Instapaper credentials by attempting to add a test URL
 */
export async function testInstapaperCredentials(
  credentials: InstapaperCredentials
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://www.instapaper.com/api/authenticate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64'),
      },
    });

    if (response.status === 200) {
      return { valid: true };
    } else if (response.status === 403) {
      return { valid: false, error: 'Invalid username or password' };
    } else {
      return { valid: false, error: `Unexpected status: ${response.status}` };
    }
  } catch (err) {
    return { valid: false, error: `Network error: ${err}` };
  }
}
