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

  // Shuffle mode
  let shuffleMode = $state(false);

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
    swipeAnimating = true;
    const bookmark = $filteredBookmarks[swipeIndex];
    swipeDeltaX = direction === 'right' ? window.innerWidth + 100 : -(window.innerWidth + 100);

    setTimeout(async () => {
      if (direction === 'right' && bookmark) {
        await sendToInstapaperDirect(bookmark);
      }
      finishAdvance(bookmark?.id);
    }, 250);
  }

  function finishAdvance(priorBookmarkId?: string) {
    swipeDeltaX = 0;
    swipeAnimating = false;
    const list = $filteredBookmarks;
    // Advance past the bookmark if it's still in the list (wasn't removed by the action)
    if (priorBookmarkId && list[swipeIndex]?.id === priorBookmarkId) {
      swipeIndex++;
    }
    // In shuffle mode, pick a random index from remaining items
    if (shuffleMode && list.length > 1 && swipeIndex < list.length) {
      let next: number;
      do {
        next = Math.floor(Math.random() * list.length);
      } while (next === swipeIndex);
      swipeIndex = next;
    }
    // Let swipeIndex go past the end — the template shows "All caught up" when
    // $filteredBookmarks[swipeIndex] is undefined, which is the correct behavior
    // for reaching the end of the list. Only clamp to 0 for empty lists.
    if (list.length === 0) {
      swipeIndex = 0;
    }
  }

  async function sendToInstapaperDirect(bookmark: any) {
    if (!bookmark) return;

    const dest = $destinations.find(d => d.type === 'instapaper');
    if (!dest) {
      showStatus('No Instapaper destination configured.');
      return;
    }

    try {
      await api.routeBookmarksBulk([bookmark.id], dest.id);
      showStatus('Sent to Instapaper');
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Instapaper failed:', err);
      showStatus('Failed to send to Instapaper');
    }
  }

  function skip() {
    if (swipeAnimating) return;
    completeSwipe('left');
  }

  async function deleteBookmark() {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark || swipeAnimating) return;

    try {
      await api.deleteBookmarks([bookmark.id], true);
      showStatus('Deleted & queued for unbookmark');
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishAdvance(bookmark.id);
    } catch (err) {
      console.error('Delete failed:', err);
      showStatus('Failed to delete');
    }
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

    try {
      await api.sendToGoogleDoc([bookmark.id], doc.id, doc.name, activeGoogleAccount);
      showStatus(`Sent to "${doc.name}"`);
      showDocPanel = false;
      docQuery = '';
      docResults = [];
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishAdvance(bookmark.id);
    } catch (err) {
      console.error('Send to doc failed:', err);
      showStatus('Failed to send to doc');
    }
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

    try {
      await api.sendToNotionPage([bookmark.id], page.id, page.title);
      showStatus(`Sent to "${page.title}"`);
      showNotionPanel = false;
      notionQuery = '';
      notionResults = [];
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishAdvance(bookmark.id);
    } catch (err) {
      console.error('Send to Notion failed:', err);
      showStatus('Failed to send to Notion');
    }
  }

  // Folder
  async function moveToFolder(folder: string | null) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    try {
      await api.moveToFolder([bookmark.id], folder);
      showStatus(folder ? `Moved to "${folder}"` : 'Removed from folder');
      showFolderPanel = false;
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Move to folder failed:', err);
      showStatus('Failed to move to folder');
    }
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
      {$filteredBookmarks.length > 0 ? Math.min(swipeIndex + 1, $filteredBookmarks.length) : 0} / {$filteredBookmarks.length}
    </span>
    <div class="flex-1"></div>
    <select
      value={$filters.folder || ''}
      onchange={(e) => { filters.update(f => ({ ...f, folder: (e.target as HTMLSelectElement).value || null })); swipeIndex = 0; }}
    >
      <option value="">All Folders</option>
      {#each $folders as folder}
        <option value={folder}>{folder}</option>
      {/each}
    </select>
    <select
      value={$filters.status}
      onchange={(e) => { filters.update(f => ({ ...f, status: (e.target as HTMLSelectElement).value as any })); swipeIndex = 0; }}
    >
      <option value="all">All</option>
      <option value="pending">Not routed</option>
      <option value="routed">Routed</option>
    </select>
    <button
      onclick={() => { shuffleMode = !shuffleMode; if (shuffleMode) { const list = $filteredBookmarks; if (list.length > 1) { swipeIndex = Math.floor(Math.random() * list.length); } } }}
      class="mode-toggle"
      style={shuffleMode ? 'background: var(--accent); color: white;' : ''}
      title={shuffleMode ? 'Shuffle: ON' : 'Shuffle: OFF'}
    >
      <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="vertical-align: middle;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
      </svg>
    </button>
    <button onclick={onShowImport} class="mode-toggle">Import</button>
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
        style="transform: translateX({swipeDeltaX}px) rotate({swipeDeltaX * 0.03}deg); {swipeAnimating ? 'transition: transform 250ms ease-out;' : ''}"
      >
        <!-- Swipe indicators -->
        {#if swipeDeltaX > 20}
          <div class="swipe-indicator right" style="opacity: {Math.min(swipeDeltaX / 100, 1)}">
            INSTAPAPER
          </div>
        {/if}
        {#if swipeDeltaX < -20}
          <div class="swipe-indicator left" style="opacity: {Math.min(Math.abs(swipeDeltaX) / 100, 1)}">
            SKIP
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
          <p class="text-sm leading-relaxed whitespace-pre-wrap" style="color: var(--text-primary);">{bookmark.text}</p>

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

  <!-- Action Buttons -->
  {#if $filteredBookmarks[swipeIndex]}
    <div class="swipe-actions">
      <button class="swipe-action-btn" onclick={skip} disabled={swipeAnimating}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>Skip</span>
      </button>
      {#if $destinations.some(d => d.type === 'instapaper')}
        <button class="swipe-action-btn primary" onclick={() => completeSwipe('right')} disabled={swipeAnimating}>
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
      <button class="swipe-action-btn danger" onclick={deleteBookmark} disabled={swipeAnimating}>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
        <span>Delete</span>
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
