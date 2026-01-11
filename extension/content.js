// Content script - runs on Twitter bookmarks page
// Unbookmarks tweets by simulating clicks on the UI

(async function() {
  // Create a visible status overlay so user can see what's happening
  const overlay = document.createElement('div');
  overlay.id = 'bookmark-sort-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #1da1f2;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    max-width: 300px;
  `;
  document.body.appendChild(overlay);

  function updateStatus(msg) {
    console.log('[Bookmark Sort] ' + msg);
    overlay.textContent = msg;
  }

  updateStatus('Loading...');

  // Get the queue from storage
  const { unbookmarkQueue } = await chrome.storage.local.get('unbookmarkQueue');

  if (!unbookmarkQueue || unbookmarkQueue.length === 0) {
    updateStatus('No tweets in queue');
    setTimeout(() => overlay.remove(), 3000);
    return;
  }

  updateStatus(`Queue: ${unbookmarkQueue.length} tweets to unbookmark`);
  console.log('[Bookmark Sort] Tweet IDs to find:', unbookmarkQueue.map(t => t.tweet_id));

  // Convert queue to a Set of tweet IDs for fast lookup
  const tweetIdsToRemove = new Set(unbookmarkQueue.map(t => String(t.tweet_id)));

  let removed = 0;
  const total = tweetIdsToRemove.size;

  // Helper: sleep
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Helper: wait for element
  async function waitForElement(selector, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    throw new Error(`Timeout waiting for ${selector}`);
  }

  // Helper: find tweet ID from article element - try multiple methods
  function getTweetIdFromArticle(article) {
    // Method 1: Look for status links
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
      const match = link.href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }

    // Method 2: Check time element's parent link
    const timeEl = article.querySelector('time');
    if (timeEl) {
      let parent = timeEl.parentElement;
      while (parent && parent !== article) {
        if (parent.href) {
          const match = parent.href.match(/\/status\/(\d+)/);
          if (match) return match[1];
        }
        parent = parent.parentElement;
      }
    }

    // Method 3: Check any link in the article
    const allLinks = article.querySelectorAll('a');
    for (const link of allLinks) {
      const match = link.href?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }

    return null;
  }

  // Helper: unbookmark a single tweet
  async function unbookmarkTweet(article, tweetId) {
    try {
      // Find the bookmark button - Twitter uses different test IDs
      const selectors = [
        '[data-testid="removeBookmark"]',
        '[data-testid="bookmark"]',
        '[aria-label*="Remove from Bookmarks"]',
        '[aria-label*="Remove bookmark"]',
        '[aria-label*="Bookmark"]'
      ];

      let bookmarkBtn = null;
      for (const sel of selectors) {
        bookmarkBtn = article.querySelector(sel);
        if (bookmarkBtn) {
          console.log(`[Bookmark Sort] Found button with selector: ${sel}`);
          break;
        }
      }

      // Fallback: find by icon/SVG
      if (!bookmarkBtn) {
        const buttons = article.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const label = btn.getAttribute('aria-label') || '';
          if (label.toLowerCase().includes('bookmark')) {
            bookmarkBtn = btn;
            console.log(`[Bookmark Sort] Found button by aria-label: ${label}`);
            break;
          }
        }
      }

      if (!bookmarkBtn) {
        console.log(`[Bookmark Sort] Could not find bookmark button for ${tweetId}`);
        // Debug: log what buttons exist
        const btns = article.querySelectorAll('button, [role="button"]');
        console.log(`[Bookmark Sort] Available buttons (${btns.length}):`);
        btns.forEach((b, i) => {
          console.log(`  ${i}: testid=${b.getAttribute('data-testid')}, label=${b.getAttribute('aria-label')}`);
        });
        return false;
      }

      // Scroll the button into view
      bookmarkBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(200);

      // Click it
      console.log(`[Bookmark Sort] Clicking bookmark button for ${tweetId}`);
      bookmarkBtn.click();
      await sleep(1000);

      return true;
    } catch (err) {
      console.error(`[Bookmark Sort] Error unbookmarking ${tweetId}:`, err);
      return false;
    }
  }

  // Notify backend to remove tweet from queue
  async function notifyBackend(tweetId) {
    try {
      const response = await fetch('http://localhost:3001/api/unbookmark-queue/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweet_id: tweetId })
      });
      if (response.ok) {
        console.log(`[Bookmark Sort] Backend notified: removed ${tweetId}`);
      } else {
        console.error(`[Bookmark Sort] Backend error: ${response.status}`);
      }
    } catch (e) {
      console.error('[Bookmark Sort] Failed to notify backend:', e);
    }
  }

  // Main unbookmarking loop
  async function processBookmarks() {
    try {
      updateStatus('Waiting for tweets to load...');
      await waitForElement('article[data-testid="tweet"]');
      await sleep(1500);

      // First, scroll to top
      window.scrollTo(0, 0);
      await sleep(500);

      let noMatchStreak = 0;
      const maxNoMatchStreak = 30; // Give up after 30 scrolls without finding anything
      let lastScrollY = -1;
      let stuckCount = 0;

      while (tweetIdsToRemove.size > 0 && noMatchStreak < maxNoMatchStreak) {
        updateStatus(`Scanning... ${removed}/${total} done, ${tweetIdsToRemove.size} left`);

        // Get all visible tweet articles
        const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));

        // Build a map of visible tweet IDs
        const visibleTweets = new Map();
        for (const article of articles) {
          const id = getTweetIdFromArticle(article);
          if (id) visibleTweets.set(id, article);
        }

        console.log(`[Bookmark Sort] Visible: ${visibleTweets.size} tweets. Looking for: ${Array.from(tweetIdsToRemove).slice(0, 3).join(', ')}...`);

        // Check for matches
        let foundOne = false;
        for (const [tweetId, article] of visibleTweets) {
          if (tweetIdsToRemove.has(tweetId)) {
            foundOne = true;
            noMatchStreak = 0;

            updateStatus(`Unbookmarking tweet ${tweetId}...`);
            const success = await unbookmarkTweet(article, tweetId);

            if (success) {
              tweetIdsToRemove.delete(tweetId);
              removed++;
              await notifyBackend(tweetId);

              // Notify popup
              try {
                chrome.runtime.sendMessage({
                  type: 'UNBOOKMARK_PROGRESS',
                  completed: removed,
                  total: total
                });
              } catch (e) {}

              // Wait for DOM to update
              await sleep(800);
            }

            // Re-scan after each removal since DOM changed
            break;
          }
        }

        if (foundOne) {
          continue; // Re-scan immediately
        }

        // No matches - scroll down slowly
        noMatchStreak++;
        const scrollAmount = Math.min(400, window.innerHeight * 0.5);
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        await sleep(800);

        // Check if we're stuck (can't scroll anymore)
        if (window.scrollY === lastScrollY) {
          stuckCount++;
          if (stuckCount >= 3) {
            console.log('[Bookmark Sort] Reached end of page, cannot scroll further');
            break;
          }
        } else {
          stuckCount = 0;
        }
        lastScrollY = window.scrollY;

        // Log progress periodically
        if (noMatchStreak % 5 === 0) {
          console.log(`[Bookmark Sort] Scrolled ${noMatchStreak} times without match. Still looking for ${tweetIdsToRemove.size} tweets.`);
        }
      }

      // Done
      const notFound = Array.from(tweetIdsToRemove);
      if (notFound.length > 0) {
        console.log(`[Bookmark Sort] Could not find these tweets (may already be unbookmarked): ${notFound.join(', ')}`);
      }

      updateStatus(`Done! Removed ${removed}/${total}`);

      // Clear the queue from storage
      await chrome.storage.local.remove('unbookmarkQueue');

      // Notify popup
      try {
        chrome.runtime.sendMessage({
          type: 'UNBOOKMARK_COMPLETE',
          success: removed,
          total: total
        });
      } catch (e) {}

      // Remove overlay after a delay
      setTimeout(() => overlay.remove(), 5000);

    } catch (err) {
      console.error('[Bookmark Sort] Error:', err);
      updateStatus(`Error: ${err.message}`);
      try {
        chrome.runtime.sendMessage({
          type: 'UNBOOKMARK_ERROR',
          error: err.message
        });
      } catch (e) {}
    }
  }

  // Start processing
  processBookmarks();
})();
