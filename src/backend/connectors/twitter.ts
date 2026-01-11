import { refreshAccessToken } from '../x-auth.js';

interface XConfig {
  access_token: string;
  refresh_token: string;
  user_id: string;
}

// Get a valid access token (refresh if needed)
async function getAccessToken(config: XConfig): Promise<{ access_token: string; refresh_token: string }> {
  // Try the existing token first
  try {
    const response = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${config.access_token}` },
    });
    if (response.ok) {
      return { access_token: config.access_token, refresh_token: config.refresh_token };
    }
  } catch {}

  // Refresh the token
  const newTokens = await refreshAccessToken(config.refresh_token);
  return {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token || config.refresh_token,
  };
}

// Remove a bookmark from Twitter/X
export async function unbookmarkTweet(
  tweetId: string,
  config: XConfig
): Promise<{ success: boolean; newTokens?: { access_token: string; refresh_token: string } }> {
  const tokens = await getAccessToken(config);

  // DELETE /2/users/:id/bookmarks/:tweet_id
  const response = await fetch(
    `https://api.twitter.com/2/users/${config.user_id}/bookmarks/${tweetId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    // 404 means already unbookmarked - consider this a success
    if (response.status === 404) {
      return { success: true, newTokens: tokens };
    }
    throw new Error(`Failed to unbookmark: ${error}`);
  }

  const data = await response.json();
  return {
    success: data.data?.bookmarked === false,
    newTokens: tokens,
  };
}

// Bulk unbookmark with rate limiting
// X API limit: 50 requests per 15 minutes for DELETE bookmarks
export async function unbookmarkTweetsBulk(
  tweetIds: string[],
  config: XConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  success: number;
  failed: number;
  errors: string[];
  newTokens?: { access_token: string; refresh_token: string };
}> {
  const results = { success: 0, failed: 0, errors: [] as string[] };
  let currentTokens = { access_token: config.access_token, refresh_token: config.refresh_token };

  for (let i = 0; i < tweetIds.length; i++) {
    const tweetId = tweetIds[i];

    try {
      const result = await unbookmarkTweet(tweetId, {
        ...config,
        access_token: currentTokens.access_token,
        refresh_token: currentTokens.refresh_token,
      });

      if (result.newTokens) {
        currentTokens = result.newTokens;
      }

      if (result.success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push(`${tweetId}: Unknown error`);
      }
    } catch (err) {
      results.failed++;
      results.errors.push(`${tweetId}: ${err}`);

      // If rate limited, stop and return partial results
      if (String(err).includes('429') || String(err).includes('rate limit')) {
        results.errors.push('Rate limit reached. Try again in 15 minutes.');
        break;
      }
    }

    if (onProgress) {
      onProgress(i + 1, tweetIds.length);
    }

    // Small delay between requests to be respectful of rate limits
    if (i < tweetIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return {
    ...results,
    newTokens: currentTokens,
  };
}
