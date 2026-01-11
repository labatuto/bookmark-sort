// Twitter content fetching via vxtwitter API (no auth required)

interface TweetData {
  tweet_id: string;
  author_handle: string;
  author_name: string;
  text: string;
}

// Extract tweet ID and handle from a Twitter/X URL
export function parseTweetUrl(url: string): { handle: string; tweet_id: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  if (!match) return null;
  return { handle: match[1], tweet_id: match[2] };
}

// Fetch tweet content from vxtwitter API
export async function fetchTweet(url: string): Promise<TweetData | null> {
  const parsed = parseTweetUrl(url);
  if (!parsed) return null;

  try {
    const apiUrl = `https://api.vxtwitter.com/${parsed.handle}/status/${parsed.tweet_id}`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!response.ok) {
      console.error(`Failed to fetch tweet ${parsed.tweet_id}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.error(`Non-JSON response for tweet ${parsed.tweet_id}`);
      return null;
    }

    const data = await response.json();

    if (!data.text) {
      console.error(`No text in response for tweet ${parsed.tweet_id}`);
      return null;
    }

    return {
      tweet_id: parsed.tweet_id,
      author_handle: data.user_screen_name || parsed.handle,
      author_name: data.user_name || data.user_screen_name || parsed.handle,
      text: data.text,
    };
  } catch (error) {
    console.error(`Error fetching tweet ${parsed.tweet_id}:`, error);
    return null;
  }
}

// Batch fetch multiple tweets with rate limiting
export async function fetchTweetsBatch(
  urls: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, TweetData>> {
  const results = new Map<string, TweetData>();
  const uniqueUrls = [...new Set(urls)];

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    const tweet = await fetchTweet(url);
    if (tweet) {
      results.set(tweet.tweet_id, tweet);
    }
    onProgress?.(i + 1, uniqueUrls.length);

    // Small delay to avoid rate limiting
    if (i < uniqueUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
