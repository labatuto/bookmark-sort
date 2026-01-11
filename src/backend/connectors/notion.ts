// Notion API Connector
// Requires NOTION_INTEGRATION_TOKEN environment variable
// Pages must be shared with the integration to be accessible

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionConfig {
  token: string;
}

function getHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION,
  };
}

// Search for pages the integration has access to
export async function searchNotionPages(
  query: string,
  config: NotionConfig
): Promise<{ id: string; title: string; url: string }[]> {
  const response = await fetch(`${NOTION_API_BASE}/search`, {
    method: 'POST',
    headers: getHeaders(config.token),
    body: JSON.stringify({
      query,
      filter: {
        value: 'page',
        property: 'object',
      },
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: 20,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion search failed: ${error}`);
  }

  const data = await response.json();
  return data.results.map((page: any) => ({
    id: page.id,
    title: getPageTitle(page),
    url: page.url,
  }));
}

// Get page title from various title property locations
function getPageTitle(page: any): string {
  // Try different property types for title
  if (page.properties?.title?.title?.[0]?.plain_text) {
    return page.properties.title.title[0].plain_text;
  }
  if (page.properties?.Name?.title?.[0]?.plain_text) {
    return page.properties.Name.title[0].plain_text;
  }
  // Check all properties for a title type
  for (const prop of Object.values(page.properties || {})) {
    if ((prop as any).type === 'title' && (prop as any).title?.[0]?.plain_text) {
      return (prop as any).title[0].plain_text;
    }
  }
  return 'Untitled';
}

// Append a tweet to a Notion page
export async function appendTweetToPage(
  pageId: string,
  tweet: {
    tweetUrl: string;
    authorHandle: string;
    text: string;
    date: string;
    mediaUrls?: string[];
  },
  config: NotionConfig
): Promise<void> {
  // Build blocks to append
  const blocks: any[] = [
    // Divider
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
    // Author and date header
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: `@${tweet.authorHandle}`,
              link: { url: `https://twitter.com/${tweet.authorHandle}` },
            },
          },
          {
            type: 'text',
            text: { content: ` · ${tweet.date}` },
          },
        ],
      },
    },
    // Tweet text
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: tweet.text },
          },
        ],
      },
    },
    // Link to tweet
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: 'View tweet',
              link: { url: tweet.tweetUrl },
            },
            annotations: {
              color: 'blue',
            },
          },
        ],
      },
    },
  ];

  // Add images if available
  if (tweet.mediaUrls && tweet.mediaUrls.length > 0) {
    for (const url of tweet.mediaUrls) {
      // Only add images (not videos/gifs)
      if (url.match(/\.(jpg|jpeg|png|gif|webp)/i) || url.includes('pbs.twimg.com')) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: {
            type: 'external',
            external: { url },
          },
        });
      }
    }
  }

  const response = await fetch(`${NOTION_API_BASE}/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: getHeaders(config.token),
    body: JSON.stringify({ children: blocks }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to append to Notion: ${error}`);
  }
}

// Bulk append tweets with rate limiting (3 req/sec)
export async function appendTweetsToPage(
  pageId: string,
  tweets: Array<{
    tweetUrl: string;
    authorHandle: string;
    text: string;
    date: string;
    mediaUrls?: string[];
  }>,
  config: NotionConfig,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  success: number;
  failed: number;
  errors: string[];
}> {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < tweets.length; i++) {
    try {
      await appendTweetToPage(pageId, tweets[i], config);
      results.success++;
    } catch (err) {
      results.failed++;
      results.errors.push(`Tweet ${i + 1}: ${err}`);
    }

    if (onProgress) {
      onProgress(i + 1, tweets.length);
    }

    // Rate limiting: wait 350ms between requests (slightly under 3/sec)
    if (i < tweets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return results;
}

// Verify the integration token is valid
export async function verifyNotionToken(token: string): Promise<{
  valid: boolean;
  botName?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${NOTION_API_BASE}/users/me`, {
      headers: getHeaders(token),
    });

    if (!response.ok) {
      return { valid: false, error: await response.text() };
    }

    const data = await response.json();
    return {
      valid: true,
      botName: data.name || data.bot?.owner?.user?.name || 'Notion Integration',
    };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

export function isConfigured(): boolean {
  return Boolean(process.env.NOTION_INTEGRATION_TOKEN);
}

export function getToken(): string {
  return process.env.NOTION_INTEGRATION_TOKEN || '';
}
