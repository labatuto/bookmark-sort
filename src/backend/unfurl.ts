/**
 * URL unfurling utility - follows redirects and extracts page titles
 */

import puppeteer, { Browser } from 'puppeteer';

// Shared browser instance for efficiency
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export interface UnfurlResult {
  originalUrl: string;
  finalUrl: string;
  title?: string;
  error?: string;
}

/**
 * Unfurl a single URL - follow redirects and get page title
 */
export async function unfurlUrl(url: string): Promise<UnfurlResult> {
  const result: UnfurlResult = {
    originalUrl: url,
    finalUrl: url,
  };

  try {
    // Follow redirects to get final URL
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BookmarkSort/1.0)',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    result.finalUrl = response.url;

    // Only try to parse HTML for successful responses
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const html = await response.text();
        // Extract title from HTML
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          result.title = decodeHtmlEntities(titleMatch[1].trim());
        }
        // Also try og:title which is often better
        const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
        if (ogTitleMatch) {
          result.title = decodeHtmlEntities(ogTitleMatch[1].trim());
        }
      }
    }
  } catch (err: any) {
    result.error = err.message || String(err);
  }

  return result;
}

/**
 * Unfurl a URL using Puppeteer (bypasses Cloudflare and bot detection)
 */
export async function unfurlUrlWithPuppeteer(url: string): Promise<UnfurlResult> {
  const result: UnfurlResult = {
    originalUrl: url,
    finalUrl: url,
  };

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Get final URL after redirects
    result.finalUrl = page.url();

    // Try to get og:title first (usually better quality)
    const ogTitle = await page.$eval(
      'meta[property="og:title"]',
      (el) => el.getAttribute('content')
    ).catch(() => null);

    if (ogTitle) {
      result.title = ogTitle.trim();
    } else {
      // Fall back to <title> tag
      const title = await page.title();
      if (title && !title.includes('Cloudflare') && !title.includes('Attention Required')) {
        result.title = title.trim();
      }
    }
  } catch (err: any) {
    result.error = err.message || String(err);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }

  return result;
}

/**
 * Unfurl multiple URLs in parallel with concurrency limit
 */
export async function unfurlUrls(
  urls: string[],
  options: { concurrency?: number; onProgress?: (completed: number, total: number) => void } = {}
): Promise<Map<string, UnfurlResult>> {
  const { concurrency = 5, onProgress } = options;
  const results = new Map<string, UnfurlResult>();

  // Deduplicate URLs
  const uniqueUrls = [...new Set(urls)];
  let completed = 0;

  // Process in batches
  for (let i = 0; i < uniqueUrls.length; i += concurrency) {
    const batch = uniqueUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(unfurlUrl));

    for (const result of batchResults) {
      results.set(result.originalUrl, result);
    }

    completed += batch.length;
    onProgress?.(completed, uniqueUrls.length);
  }

  return results;
}

/**
 * Check if a URL is a Twitter/X shortened link that needs unfurling
 */
export function needsUnfurling(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 't.co' ||
           parsed.hostname === 'bit.ly' ||
           parsed.hostname === 'tinyurl.com' ||
           parsed.hostname === 'ow.ly' ||
           parsed.hostname === 'goo.gl';
  } catch {
    return false;
  }
}

/**
 * Decode HTML entities in a string
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}
