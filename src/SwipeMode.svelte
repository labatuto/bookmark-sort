<script lang="ts">
  import { filteredBookmarks, filters, folders, destinations, bookmarks, stats } from './stores/bookmarks';
  import * as api from './lib/api';

  // Props
  let { onToggleMode = () => {}, onShowImport = () => {} }: { onToggleMode?: () => void; onShowImport?: () => void } = $props();

  // Swipe state
  let swipeIndex = $state(0);
  let swipeDeltaX = $state(0);
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;
  let isSwipeGesture = false;
  let swipeAnimating = $state(false);
  let dataReady = $state(false);

  // Reactive safety net: auto-clamp swipeIndex when the bookmark list changes
  // This prevents "All caught up" from ever showing when bookmarks exist
  $effect(() => {
    const len = $filteredBookmarks.length;
    if (len > 0 && swipeIndex >= len) {
      swipeIndex = 0;
    }
  });

  // Random mode is ON by default — bookmarks are shown in random order so
  // you're not stuck reviewing them in chronological order.
  let shuffleMode = $state(true);
  let shuffledIndices: number[] = $state([]);
  let shufflePos = $state(0);
  let shuffleInitialized = false;

  // Initialize the shuffle as soon as bookmarks become available
  $effect(() => {
    const list = $filteredBookmarks;
    if (!shuffleInitialized && shuffleMode && list.length > 0) {
      shuffleInitialized = true;
      shuffledIndices = buildShuffledIndices(list.length);
      shufflePos = 0;
      swipeIndex = shuffledIndices[0];
    }
  });

  // Fisher-Yates shuffle to build a randomized index order
  function buildShuffledIndices(length: number) {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  }

  function enableShuffle() {
    const list = $filteredBookmarks;
    if (list.length > 0) {
      shuffledIndices = buildShuffledIndices(list.length);
      shufflePos = 0;
      swipeIndex = shuffledIndices[0];
    }
  }

  // Pick a random next bookmark from the filtered list (for skip, etc.)
  function pickRandomNext() {
    const list = $filteredBookmarks;
    if (list.length <= 1) return;
    let next: number;
    do {
      next = Math.floor(Math.random() * list.length);
    } while (next === swipeIndex);
    swipeIndex = next;
  }

  // Bottom sheet panels
  let showDocPanel = $state(false);
  let showNotionPanel = $state(false);
  let showFolderPanel = $state(false);

  // Doc search
  let docQuery = $state('');
  let docResults: { id: string; name: string }[] = $state([]);
  let isDocSearching = $state(false);
  let docTimeout: ReturnType<typeof setTimeout>;

  // Notion search
  let notionQuery = $state('');
  let notionResults: { id: string; title: string; url: string }[] = $state([]);
  let isNotionSearching = $state(false);
  let notionTimeout: ReturnType<typeof setTimeout>;

  // Folder
  let newFolderInput = $state(false);
  let newFolderName = $state('');

  // Google account
  let googleAccounts: { id: string; name: string; email: string }[] = $state([]);
  let activeGoogleAccount = $state('');

  // Notion
  let notionConnected = $state(false);

  // Status toast
  let statusMessage = $state('');
  let statusTimeout: ReturnType<typeof setTimeout>;

  function showStatus(msg: string, duration = 3000) {
    clearTimeout(statusTimeout);
    statusMessage = msg;
    statusTimeout = setTimeout(() => { statusMessage = ''; }, duration);
  }

  // Load accounts on init
  async function init() {
    try {
      googleAccounts = await api.fetchGoogleAccounts();
      if (googleAccounts.length > 0) {
        const ifpAccount = googleAccounts.find(a => a.email === 'santi@ifp.org');
        activeGoogleAccount = ifpAccount?.id || googleAccounts[0].id;
      }
    } catch (err) {
      console.error('Failed to load Google accounts:', err);
    }

    try {
      const ns = await api.fetchNotionStatus();
      notionConnected = ns.connected;
    } catch (err) {
      console.error('Failed to load Notion status:', err);
    }

    dataReady = true;
  }

  init();

  function formatDate(dateStr: string | undefined) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  }

  // Touch handlers
  function onTouchStart(e: TouchEvent) {
    if (swipeAnimating) return;
    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeStartTime = Date.now();
    swipeDeltaX = 0;
    isSwipeGesture = false;
  }

  function onTouchMove(e: TouchEvent) {
    if (swipeAnimating) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;

    if (!isSwipeGesture && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      isSwipeGesture = Math.abs(deltaX) > Math.abs(deltaY);
      if (!isSwipeGesture) return;
    }

    if (isSwipeGesture) {
      e.preventDefault(); // Prevent any vertical scroll during horizontal swipe
      swipeDeltaX = deltaX;
    }
  }

  function onTouchEnd() {
    if (swipeAnimating || !isSwipeGesture) {
      swipeDeltaX = 0;
      return;
    }

    const elapsed = Math.max(Date.now() - swipeStartTime, 1);
    const velocity = Math.abs(swipeDeltaX) / elapsed;
    const threshold = 80;
    const velocityThreshold = 0.5;

    if (swipeDeltaX > threshold || (swipeDeltaX > 30 && velocity > velocityThreshold)) {
      completeSwipe('right');
    } else if (swipeDeltaX < -threshold || (swipeDeltaX < -30 && velocity > velocityThreshold)) {
      completeSwipe('left');
    } else {
      swipeDeltaX = 0;
    }
  }

  function completeSwipe(direction: 'left' | 'right') {
    const bookmark = $filteredBookmarks[swipeIndex];

    if (direction === 'left' && bookmark) {
      // Left swipe = snap card back and open folder picker
      swipeDeltaX = 0;
      closeAllPanels();
      showFolderPanel = true;
      return; // Don't advance — user picks a folder first
    }

    // Right swipe = delete & unbookmark (animate off-screen)
    swipeAnimating = true;
    swipeDeltaX = window.innerWidth + 100;

    setTimeout(() => {
      if (bookmark) {
        // Optimistic: remove from local store immediately so next card appears
        bookmarks.update(list => list.filter(b => b.id !== bookmark.id));
        showStatus('Deleted & queued for unbookmark');

        // Fire API call in background — don't wait for it
        api.deleteBookmarks([bookmark.id], true).catch(err => {
          console.error('Delete failed:', err);
          showStatus('Delete may have failed — refresh to check');
        });
      }
      finishAdvance(true);
    }, 150);
  }

  function finishAdvance(wasRemovedFromList: boolean) {
    swipeDeltaX = 0;
    swipeAnimating = false;
    const list = $filteredBookmarks;

    if (list.length === 0) {
      swipeIndex = 0;
      return;
    }

    if (shuffleMode) {
      // If the list size changed, rebuild the shuffle
      if (shuffledIndices.length !== list.length) {
        shuffledIndices = buildShuffledIndices(list.length);
        shufflePos = 0;
      } else {
        shufflePos++;
      }
      if (shufflePos < shuffledIndices.length) {
        swipeIndex = shuffledIndices[shufflePos] % list.length;
      } else {
        // Exhausted — reshuffle
        shuffledIndices = buildShuffledIndices(list.length);
        shufflePos = 0;
        swipeIndex = shuffledIndices[0];
      }
    } else {
      // Sequential mode:
      // If the bookmark was removed from the filtered list (deleted or moved out
      // of current filter), the list shifted — stay at same index to show next.
      // If the bookmark is still in the list, advance past it.
      if (!wasRemovedFromList) {
        swipeIndex++;
      }
    }

    // Always clamp to valid bounds
    if (swipeIndex >= list.length) {
      swipeIndex = 0;
    }
  }

  function sendToInstapaperAndAdvance() {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    const dest = $destinations.find(d => d.type === 'instapaper');
    if (!dest) {
      showStatus('No Instapaper destination configured.');
      return;
    }

    // Optimistic: mark as routed locally and advance immediately
    bookmarks.update(list => list.map(b =>
      b.id === bookmark.id ? { ...b, status: 'routed' as const } : b
    ));
    showStatus('Sent to Instapaper');
    finishAdvance(false);

    // Fire API in background
    api.routeBookmarksBulk([bookmark.id], dest.id).catch(err => {
      console.error('Instapaper failed:', err);
      showStatus('Instapaper send may have failed');
    });
  }

  function skip() {
    if (swipeAnimating) return;
    swipeAnimating = true;
    swipeDeltaX = -(window.innerWidth + 100);
    setTimeout(() => {
      finishAdvance(false); // bookmark still in list, advance past it
    }, 150);
  }

  // Doc search
  function handleDocSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    docQuery = value;
    clearTimeout(docTimeout);

    if (!value.trim() || value.length < 2) {
      docResults = [];
      isDocSearching = false;
      return;
    }

    isDocSearching = true;
    docTimeout = setTimeout(async () => {
      if (!activeGoogleAccount) { isDocSearching = false; return; }
      try {
        docResults = await api.searchGoogleDocs(value, activeGoogleAccount);
      } catch (err) {
        console.error('Doc search failed:', err);
        docResults = [];
      } finally {
        isDocSearching = false;
      }
    }, 300);
  }

  async function sendToDoc(doc: { id: string; name: string }) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    showDocPanel = false;
    docQuery = '';
    docResults = [];

    // Optimistic: mark routed and advance
    bookmarks.update(list => list.map(b =>
      b.id === bookmark.id ? { ...b, status: 'routed' as const } : b
    ));
    showStatus(`Sent to "${doc.name}"`);
    finishAdvance(false);

    // Fire API in background
    api.sendToGoogleDoc([bookmark.id], doc.id, doc.name, activeGoogleAccount).catch(err => {
      console.error('Send to doc failed:', err);
      showStatus('Failed to send to doc');
    });
  }

  // Notion search
  function handleNotionSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    notionQuery = value;
    clearTimeout(notionTimeout);

    if (!value.trim() || value.length < 2) {
      notionResults = [];
      isNotionSearching = false;
      return;
    }

    isNotionSearching = true;
    notionTimeout = setTimeout(async () => {
      try {
        notionResults = await api.searchNotionPages(value);
      } catch (err) {
        console.error('Notion search failed:', err);
        notionResults = [];
      } finally {
        isNotionSearching = false;
      }
    }, 300);
  }

  async function sendToNotion(page: { id: string; title: string }) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    showNotionPanel = false;
    notionQuery = '';
    notionResults = [];

    // Optimistic: mark routed and advance
    bookmarks.update(list => list.map(b =>
      b.id === bookmark.id ? { ...b, status: 'routed' as const } : b
    ));
    showStatus(`Sent to "${page.title}"`);
    finishAdvance(false);

    // Fire API in background
    api.sendToNotionPage([bookmark.id], page.id, page.title).catch(err => {
      console.error('Send to Notion failed:', err);
      showStatus('Failed to send to Notion');
    });
  }

  // Folder
  function moveToFolder(folder: string | null) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    // Check if the bookmark will leave the current folder filter
    const activeFolder = $filters.folder;
    const willLeaveFilter = activeFolder && folder !== activeFolder;

    // Optimistic: update folder locally and advance
    bookmarks.update(list => list.map(b =>
      b.id === bookmark.id ? { ...b, archivly_folder: folder } : b
    ));
    showStatus(folder ? `Moved to "${folder}"` : 'Removed from folder');
    showFolderPanel = false;
    finishAdvance(!!willLeaveFilter);

    // Fire API in background
    api.moveToFolder([bookmark.id], folder).catch(err => {
      console.error('Move to folder failed:', err);
      showStatus('Failed to move to folder');
    });
  }

  function closeAllPanels() {
    showDocPanel = false;
    showNotionPanel = false;
    showFolderPanel = false;
    docQuery = '';
    docResults = [];
    notionQuery = '';
    notionResults = [];
    newFolderInput = false;
    newFolderName = '';
  }
</script>

<div class="swipe-container">
  <!-- Toolbar -->
  <div class="swipe-toolbar">
    <span class="swipe-progress">
      {#if shuffleMode}
        {shufflePos + 1} / {$filteredBookmarks.length}
      {:else}
        {$filteredBookmarks.length > 0 ? Math.min(swipeIndex + 1, $filteredBookmarks.length) : 0} / {$filteredBookmarks.length}
      {/if}
    </span>
    <div class="flex-1"></div>
    <select
      value={$filters.folder || ''}
      onchange={(e) => { filters.update(f => ({ ...f, folder: (e.target as HTMLSelectElement).value || null })); if (shuffleMode) { setTimeout(enableShuffle, 0); } else { swipeIndex = 0; } }}
    >
      <option value="">All Folders</option>
      {#each $folders as folder}
        <option value={folder}>{folder}</option>
      {/each}
    </select>
    <select
      value={$filters.status}
      onchange={(e) => { filters.update(f => ({ ...f, status: (e.target as HTMLSelectElement).value as any })); if (shuffleMode) { setTimeout(enableShuffle, 0); } else { swipeIndex = 0; } }}
    >
      <option value="all">All</option>
      <option value="pending">Not routed</option>
      <option value="routed">Routed</option>
    </select>
    <button
      onclick={() => { shuffleMode = !shuffleMode; if (shuffleMode) { enableShuffle(); } else { swipeIndex = 0; } }}
      class="mode-toggle"
      style={shuffleMode ? 'background: var(--accent); color: white;' : ''}
      title={shuffleMode ? 'Shuffle: ON' : 'Shuffle: OFF'}
    >
      <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: middle;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
      </svg>
    </button>
    <button onclick={onShowImport} class="mode-toggle">Import</button>
    <button onclick={onToggleMode} class="mode-toggle" title="Switch to list view">
      <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: middle;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
    </button>
  </div>

  <!-- Swipe Area -->
  <div class="swipe-area">
    {#if $filteredBookmarks[swipeIndex]}
      {@const bookmark = $filteredBookmarks[swipeIndex]}
      <div
        class="swipe-card-wrapper"
        ontouchstart={onTouchStart}
        ontouchmove={onTouchMove}
        ontouchend={onTouchEnd}
        role="button"
        tabindex="0"
        style="transform: translateX({swipeDeltaX}px) rotate({swipeDeltaX * 0.03}deg); {swipeAnimating ? 'transition: transform 150ms ease-out;' : ''}touch-action: none;"
      >
        <!-- Swipe indicators -->
        {#if swipeDeltaX > 20}
          <div class="swipe-indicator right delete" style="opacity: {Math.min(swipeDeltaX / 100, 1)}">
            DELETE
          </div>
        {/if}
        {#if swipeDeltaX < -20}
          <div class="swipe-indicator left categorize" style="opacity: {Math.min(Math.abs(swipeDeltaX) / 100, 1)}">
            CATEGORIZE
          </div>
        {/if}

        <div class="swipe-card">
          <!-- Header -->
          <div class="flex items-center gap-2 mb-2">
            <span class="font-semibold" style="color: var(--text-primary);">@{bookmark.author_handle}</span>
            <span class="text-xs" style="color: var(--text-muted);">{formatDate(bookmark.created_at)}</span>
            {#if bookmark.archivly_folder}
              <span class="badge badge-muted ml-auto">{bookmark.archivly_folder}</span>
            {/if}
          </div>

          <!-- Routed badges -->
          {#if bookmark.routed_to && bookmark.routed_to.length > 0}
            <div class="flex flex-wrap gap-1 mb-2">
              {#each bookmark.routed_to as dest}
                <span class="badge badge-success">{dest.name}</span>
              {/each}
            </div>
          {/if}

          <!-- Text -->
          <p class="text-sm leading-relaxed whitespace-pre-wrap swipe-card-text" style="color: var(--text-primary);">{bookmark.text}</p>

          <!-- Quoted Tweet -->
          {#if bookmark.quoted_post_url}
            {@const quotedMatch = bookmark.quoted_post_url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/)}
            <a
              href={bookmark.quoted_post_url}
              target="_blank"
              rel="noopener"
              class="mt-2 block rounded-lg p-3"
              style="background: var(--bg-hover); border: 1px solid var(--border-light);"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-medium" style="color: var(--accent);">
                  @{(bookmark as any).quoted_tweet?.author_handle || quotedMatch?.[1] || 'unknown'}
                </span>
              </div>
              {#if (bookmark as any).quoted_tweet}
                <p class="text-xs leading-relaxed mt-1" style="color: var(--text-secondary);">
                  {(bookmark as any).quoted_tweet.text.length > 200 ? (bookmark as any).quoted_tweet.text.slice(0, 200) + '...' : (bookmark as any).quoted_tweet.text}
                </p>
              {:else}
                <span class="text-xs" style="color: var(--text-muted);">View quoted post</span>
              {/if}
            </a>
          {/if}

          <!-- Image -->
          {#if bookmark.media_urls && bookmark.media_urls.length > 0 && bookmark.media_urls[0].startsWith('http')}
            <img
              src={bookmark.media_urls[0]}
              alt=""
              class="mt-3 rounded w-full object-cover"
              style="max-height: 200px;"
            />
          {/if}

          <!-- Link -->
          {#if bookmark.urls.length > 0}
            <a
              href={bookmark.urls[0]}
              target="_blank"
              rel="noopener"
              class="mt-2 block rounded-lg p-2"
              style="background: var(--bg-hover); border: 1px solid var(--border-light);"
            >
              {#if bookmark.link_title}
                <div class="text-sm font-medium mb-1" style="color: var(--text-primary);">{bookmark.link_title}</div>
              {/if}
              <div class="text-xs truncate" style="color: var(--accent);">
                {bookmark.urls[0].replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}
              </div>
            </a>
          {/if}

          <!-- Footer -->
          <div class="mt-3 text-xs" style="color: var(--text-muted);">
            <a
              href="https://x.com/{bookmark.author_handle}/status/{bookmark.tweet_id}"
              target="_blank"
              rel="noopener"
              style="color: var(--accent);"
            >
              View on X
            </a>
          </div>
        </div>
      </div>
    {:else if $stats.total === 0 && !dataReady}
      <div class="swipe-done">
        <p style="font-size: 14px; color: var(--text-muted);">Loading bookmarks...</p>
      </div>
    {:else}
      <div class="swipe-done">
        <div style="font-size: 48px; margin-bottom: 16px; color: var(--success);">&#10003;</div>
        <h2 style="font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">All caught up!</h2>
        <p style="font-size: 14px; color: var(--text-muted);">No more bookmarks to sort.</p>
        <button onclick={() => { swipeIndex = 0; }} class="btn btn-secondary" style="margin-top: 16px; width: auto;">Start over</button>
      </div>
    {/if}
  </div>

  <!-- Action Buttons — always visible when bookmarks exist -->
  {#if $filteredBookmarks.length > 0}
    <div class="swipe-actions">
      <button class="swipe-action-btn" onclick={skip} disabled={swipeAnimating}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
        </svg>
        <span>Skip</span>
      </button>
      {#if $destinations.some(d => d.type === 'instapaper')}
        <button class="swipe-action-btn primary" onclick={sendToInstapaperAndAdvance} disabled={swipeAnimating}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
          </svg>
          <span>Read</span>
        </button>
      {/if}
      {#if googleAccounts.length > 0}
        <button class="swipe-action-btn" onclick={() => { closeAllPanels(); showDocPanel = true; }} disabled={swipeAnimating}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span>Doc</span>
        </button>
      {/if}
      {#if notionConnected}
        <button class="swipe-action-btn" onclick={() => { closeAllPanels(); showNotionPanel = true; }} disabled={swipeAnimating}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
          </svg>
          <span>Notion</span>
        </button>
      {/if}
      <button class="swipe-action-btn" onclick={() => { closeAllPanels(); showFolderPanel = true; }} disabled={swipeAnimating}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
        <span>Folder</span>
      </button>
    </div>
  {/if}
</div>

<!-- Bottom Sheet: Doc Search -->
{#if showDocPanel}
  <div class="bottom-sheet-backdrop" onclick={closeAllPanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllPanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
  <div class="bottom-sheet">
    <div class="bottom-sheet-handle"></div>
    <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Send to Google Doc</h3>
    <input
      type="text"
      placeholder="Search your docs..."
      value={docQuery}
      oninput={handleDocSearch}
      class="w-full mb-3"
    />
    {#if isDocSearching}
      <p class="text-sm" style="color: var(--text-muted);">Searching...</p>
    {:else if docResults.length > 0}
      <div class="space-y-1">
        {#each docResults as doc}
          <button
            onclick={() => sendToDoc(doc)}
            class="w-full text-left p-3 rounded-lg text-sm"
            style="color: var(--text-primary); border: 1px solid var(--border-light);"
          >
            {doc.name}
          </button>
        {/each}
      </div>
    {:else if docQuery.length >= 2}
      <p class="text-sm" style="color: var(--text-muted);">No docs found</p>
    {/if}
  </div>
{/if}

<!-- Bottom Sheet: Notion Search -->
{#if showNotionPanel}
  <div class="bottom-sheet-backdrop" onclick={closeAllPanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllPanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
  <div class="bottom-sheet">
    <div class="bottom-sheet-handle"></div>
    <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Send to Notion Page</h3>
    <input
      type="text"
      placeholder="Search Notion pages..."
      value={notionQuery}
      oninput={handleNotionSearch}
      class="w-full mb-3"
    />
    {#if isNotionSearching}
      <p class="text-sm" style="color: var(--text-muted);">Searching...</p>
    {:else if notionResults.length > 0}
      <div class="space-y-1">
        {#each notionResults as page}
          <button
            onclick={() => sendToNotion(page)}
            class="w-full text-left p-3 rounded-lg text-sm"
            style="color: var(--text-primary); border: 1px solid var(--border-light);"
          >
            {page.title}
          </button>
        {/each}
      </div>
    {:else if notionQuery.length >= 2}
      <p class="text-sm" style="color: var(--text-muted);">No pages found</p>
    {/if}
  </div>
{/if}

<!-- Bottom Sheet: Folder Picker -->
{#if showFolderPanel}
  <div class="bottom-sheet-backdrop" onclick={closeAllPanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllPanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
  <div class="bottom-sheet">
    <div class="bottom-sheet-handle"></div>
    <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Move to Folder</h3>
    <div class="space-y-1">
      {#if newFolderInput}
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={newFolderName}
            placeholder="New folder name..."
            class="flex-1"
            onkeydown={(e) => {
              if (e.key === 'Enter' && newFolderName.trim()) {
                moveToFolder(newFolderName.trim());
                newFolderInput = false;
                newFolderName = '';
              } else if (e.key === 'Escape') {
                newFolderInput = false;
                newFolderName = '';
              }
            }}
          />
          <button
            onclick={() => {
              if (newFolderName.trim()) moveToFolder(newFolderName.trim());
              newFolderInput = false;
              newFolderName = '';
            }}
            class="btn btn-primary" style="width: auto;"
          >Add</button>
        </div>
      {:else}
        <button
          onclick={() => { newFolderInput = true; }}
          class="w-full text-left p-3 rounded-lg text-sm font-medium"
          style="color: var(--accent); border: 1px dashed var(--accent);"
        >
          + New Folder
        </button>
      {/if}
      <button
        onclick={() => moveToFolder(null)}
        class="w-full text-left p-3 rounded-lg text-sm"
        style="color: var(--text-muted); border: 1px solid var(--border-light);"
      >
        Remove from folder
      </button>
      {#each $folders as folder}
        <button
          onclick={() => moveToFolder(folder)}
          class="w-full text-left p-3 rounded-lg text-sm"
          style="color: var(--text-primary); border: 1px solid var(--border-light);"
        >
          {folder}
        </button>
      {/each}
    </div>
  </div>
{/if}

<!-- Status Toast -->
{#if statusMessage}
  <div
    class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium text-white z-50"
    style="background: var(--success); box-shadow: var(--shadow-md);"
  >
    {statusMessage}
  </div>
{/if}
