<script lang="ts">
  import { onMount } from 'svelte';
  import { bookmarks, searchQuery, searchResults, isSearching, selectedIds, filters, filteredBookmarks, stats, destinations, folders } from './stores/bookmarks';
  import * as api from './lib/api';
  import type { Bookmark, Destination } from './lib/types';

  let showImportModal = false;
  let showSettingsModal = false;
  let importContent = '';
  let importStatus = '';
  let searchInput = '';
  let searchTimeout: number;

  // Google Drive state
  let googleAccounts: { id: string; name: string; email: string }[] = [];
  let activeGoogleAccount: string = '';
  let docSearchQuery = '';
  let docSearchResults: { id: string; name: string }[] = [];
  let isSearchingDocs = false;
  let docSearchTimeout: number;
  let showDocDropdown = false;

  // New doc modal
  let showNewDocModal = false;
  let newDocTitle = '';
  let isCreatingDoc = false;

  // New folder input
  let showNewFolderInput = false;
  let newFolderName = '';

  // Status toast
  let statusMessage = '';
  let statusTimeout: number;

  // X/Twitter state
  let xStatus: { configured: boolean; connected: boolean; username: string | null } = {
    configured: false,
    connected: false,
    username: null,
  };

  // Notion state
  let notionStatus: { configured: boolean; connected: boolean; botName?: string } = {
    configured: false,
    connected: false,
  };
  let notionSearchQuery = '';
  let notionSearchResults: { id: string; title: string; url: string }[] = [];
  let isSearchingNotion = false;
  let notionSearchTimeout: number;
  let showNotionDropdown = false;

  // Swipe mode state
  let swipeMode = false;
  let swipeIndex = 0;
  let swipeDeltaX = 0;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;
  let isSwipeGesture = false;
  let swipeAnimating = false;

  // Swipe mode bottom sheet panels
  let showSwipeDocPanel = false;
  let showSwipeNotionPanel = false;
  let showSwipeFolderPanel = false;
  let swipeDocQuery = '';
  let swipeDocResults: { id: string; name: string }[] = [];
  let isSwipeDocSearching = false;
  let swipeDocTimeout: number;
  let swipeNotionQuery = '';
  let swipeNotionResults: { id: string; title: string; url: string }[] = [];
  let isSwipeNotionSearching = false;
  let swipeNotionTimeout: number;
  let swipeNewFolderInput = false;
  let swipeNewFolderName = '';

  // Load data on mount
  onMount(async () => {
    // Auto-enable swipe mode on mobile
    if (window.innerWidth <= 768) {
      swipeMode = true;
    }
    try {
      const [bookmarkData, destData] = await Promise.all([
        api.fetchBookmarks(),
        api.fetchDestinations(),
      ]);
      bookmarks.set(bookmarkData);
      destinations.set(destData);
      // Pre-load Google accounts (await to ensure ready)
      await loadGoogleAccounts();
      // Load X status
      await loadXStatus();
      // Load Notion status
      await loadNotionStatus();
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  });

  async function loadXStatus() {
    try {
      xStatus = await api.fetchXStatus();
    } catch (err) {
      console.error('Failed to load X status:', err);
    }
  }

  async function loadNotionStatus() {
    try {
      notionStatus = await api.fetchNotionStatus();
    } catch (err) {
      console.error('Failed to load Notion status:', err);
    }
  }

  function handleNotionSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    notionSearchQuery = value;
    clearTimeout(notionSearchTimeout);

    if (!value.trim() || value.length < 2) {
      notionSearchResults = [];
      showNotionDropdown = false;
      isSearchingNotion = false;
      return;
    }

    isSearchingNotion = true;

    notionSearchTimeout = setTimeout(async () => {
      try {
        const results = await api.searchNotionPages(value);
        notionSearchResults = results;
        showNotionDropdown = results.length > 0;
      } catch (err) {
        console.error('Notion search failed:', err);
        notionSearchResults = [];
      } finally {
        isSearchingNotion = false;
      }
    }, 300);
  }

  async function sendSelectedToNotion(page: { id: string; title: string }) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;

    try {
      const result = await api.sendToNotionPage(ids, page.id, page.title);
      if (result.success > 0) {
        clearSelection();
        const data = await api.fetchBookmarks();
        bookmarks.set(data);
      }
      notionSearchQuery = '';
      notionSearchResults = [];
      showNotionDropdown = false;
    } catch (err) {
      console.error('Send to Notion failed:', err);
      alert('Failed to send to Notion: ' + err);
    }
  }

  // Debounced search
  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchInput = value;
    clearTimeout(searchTimeout);

    if (!value.trim()) {
      searchQuery.set('');
      searchResults.set([]);
      return;
    }

    searchTimeout = setTimeout(async () => {
      isSearching.set(true);
      try {
        const results = await api.searchBookmarks(value);
        searchQuery.set(value);
        searchResults.set(results);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        isSearching.set(false);
      }
    }, 300);
  }

  // Import handling
  async function handleImport() {
    if (!importContent.trim()) return;
    importStatus = 'Importing...';
    try {
      const result = await api.importBookmarks(importContent);
      importStatus = `Imported ${result.imported}, ${result.duplicates} duplicates, ${result.errors} errors. Done!`;
      // Refresh bookmarks
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      importStatus = `Error: ${err}`;
    }
  }

  // Sync folders only (won't re-add deleted tweets)
  async function handleSyncFolders() {
    if (!importContent.trim()) return;
    importStatus = 'Syncing folders...';
    try {
      const result = await api.syncFolders(importContent);
      importStatus = result.message;
      // Refresh bookmarks to show updated folders
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      importStatus = `Error: ${err}`;
    }
  }

  // Selection
  function toggleSelection(id: string) {
    selectedIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  function selectAll() {
    selectedIds.set(new Set($filteredBookmarks.map(b => b.id)));
  }

  function clearSelection() {
    selectedIds.set(new Set());
  }

  // Routing
  async function routeToDestination(bookmarkId: string, destId: string) {
    try {
      await api.routeBookmark(bookmarkId, destId);
      // Refresh
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Route failed:', err);
    }
  }

  async function bulkRoute(destId: string) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;
    try {
      await api.routeBookmarksBulk(ids, destId);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Bulk route failed:', err);
    }
  }

  function formatDate(dateStr: string | undefined) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  // Google Drive functions
  async function loadGoogleAccounts() {
    try {
      googleAccounts = await api.fetchGoogleAccounts();
      if (googleAccounts.length > 0) {
        // Prefer santi@ifp.org (has full Drive access), fallback to first
        const ifpAccount = googleAccounts.find(a => a.email === 'santi@ifp.org');
        activeGoogleAccount = ifpAccount?.id || googleAccounts[0].id;
      }
    } catch (err) {
      console.error('Failed to load Google accounts:', err);
    }
  }

  function handleDocSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    docSearchQuery = value;
    clearTimeout(docSearchTimeout);

    if (!value.trim() || value.length < 2) {
      docSearchResults = [];
      showDocDropdown = false;
      isSearchingDocs = false;
      return;
    }

    // Set searching immediately so UI doesn't flash "No docs found"
    isSearchingDocs = true;

    docSearchTimeout = setTimeout(async () => {
      if (!activeGoogleAccount) {
        await loadGoogleAccounts();
      }
      if (!activeGoogleAccount) {
        isSearchingDocs = false;
        return;
      }

      try {
        const results = await api.searchGoogleDocs(value, activeGoogleAccount);
        docSearchResults = results;
        showDocDropdown = results.length > 0;
      } catch (err) {
        console.error('Doc search failed:', err);
        docSearchResults = [];
      } finally {
        isSearchingDocs = false;
      }
    }, 300);
  }

  function showStatus(msg: string, duration = 3000) {
    clearTimeout(statusTimeout);
    statusMessage = msg;
    statusTimeout = setTimeout(() => { statusMessage = ''; }, duration);
  }

  async function sendSelectedToDoc(doc: { id: string; name: string }) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;

    // Check for bookmarks already sent to this doc
    const selectedBookmarks = $bookmarks.filter(b => ids.includes(b.id));
    const alreadySent = selectedBookmarks.filter(b =>
      b.routed_to?.some((r: { type: string; name: string }) => r.name === `📄 ${doc.name}` || r.name === doc.name)
    );

    if (alreadySent.length > 0) {
      const proceed = confirm(
        `${alreadySent.length} of ${ids.length} bookmark(s) have already been sent to "${doc.name}". Send anyway?`
      );
      if (!proceed) return;
    }

    try {
      const result = await api.sendToGoogleDoc(ids, doc.id, doc.name, activeGoogleAccount);
      if (result.success > 0) {
        showStatus(`Sent ${result.success} bookmark(s) to "${doc.name}"`);
        clearSelection();
        const data = await api.fetchBookmarks();
        bookmarks.set(data);
      }
      docSearchQuery = '';
      docSearchResults = [];
      showDocDropdown = false;
    } catch (err) {
      console.error('Send to doc failed:', err);
      alert('Failed to send to doc: ' + err);
    }
  }

  async function createNewDocWithSelected() {
    const ids = Array.from($selectedIds);
    if (ids.length === 0 || !newDocTitle.trim()) return;

    isCreatingDoc = true;
    try {
      const result = await api.createDocWithTweets(ids, newDocTitle.trim(), activeGoogleAccount);
      if (result.success > 0) {
        clearSelection();
        const data = await api.fetchBookmarks();
        bookmarks.set(data);
        // Open the new doc in a new tab
        window.open(result.docUrl, '_blank');
      }
      showNewDocModal = false;
      newDocTitle = '';
    } catch (err) {
      console.error('Create doc failed:', err);
      alert('Failed to create doc: ' + err);
    } finally {
      isCreatingDoc = false;
    }
  }

  async function moveSelectedToFolder(folder: string | null) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;

    try {
      await api.moveToFolder(ids, folder);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Move to folder failed:', err);
      alert('Failed to move to folder: ' + err);
    }
  }

  // Delete from Bookmark Sort and queue for unbookmarking from Twitter
  function deleteSelected() {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;

    api.deleteBookmarks(ids, true)
      .then(() => {
        clearSelection();
        return api.fetchBookmarks();
      })
      .then(data => bookmarks.set(data))
      .catch(err => {
        console.error('Delete failed:', err);
        alert('Failed to delete: ' + err);
      });
  }

  // === Swipe Mode Functions ===

  function toggleSwipeMode() {
    swipeMode = !swipeMode;
    if (swipeMode) {
      swipeIndex = 0;
      swipeDeltaX = 0;
      clearSelection();
      closeAllSwipePanels();
    }
  }

  function onSwipeTouchStart(e: TouchEvent) {
    if (swipeAnimating) return;
    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeStartTime = Date.now();
    swipeDeltaX = 0;
    isSwipeGesture = false;
  }

  function onSwipeTouchMove(e: TouchEvent) {
    if (swipeAnimating) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;

    if (!isSwipeGesture && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      isSwipeGesture = Math.abs(deltaX) > Math.abs(deltaY);
      if (!isSwipeGesture) return;
    }

    if (isSwipeGesture) {
      e.preventDefault();
      swipeDeltaX = deltaX;
    }
  }

  function onSwipeTouchEnd() {
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
    swipeDeltaX = direction === 'right' ? window.innerWidth + 100 : -(window.innerWidth + 100);

    setTimeout(async () => {
      if (direction === 'right') {
        await swipeSendToInstapaper();
      }
      finishSwipeAdvance();
    }, 250);
  }

  function finishSwipeAdvance() {
    swipeDeltaX = 0;
    swipeAnimating = false;
    const list = $filteredBookmarks;
    if (swipeIndex >= list.length && list.length > 0) {
      swipeIndex = list.length - 1;
    }
  }

  async function swipeSendToInstapaper() {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    const instapaperDest = $destinations.find(d => d.type === 'instapaper');
    if (!instapaperDest) {
      showStatus('No Instapaper destination configured. Add one in Settings.');
      return;
    }

    try {
      await api.routeBookmarksBulk([bookmark.id], instapaperDest.id);
      showStatus('Sent to Instapaper');
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Instapaper route failed:', err);
      showStatus('Failed to send to Instapaper');
    }
  }

  function swipeSkip() {
    if (swipeAnimating) return;
    completeSwipe('left');
  }

  async function swipeDelete() {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark || swipeAnimating) return;

    try {
      await api.deleteBookmarks([bookmark.id], true);
      showStatus('Deleted & queued for unbookmark');
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishSwipeAdvance();
    } catch (err) {
      console.error('Delete failed:', err);
      showStatus('Failed to delete');
    }
  }

  function handleSwipeDocSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    swipeDocQuery = value;
    clearTimeout(swipeDocTimeout);

    if (!value.trim() || value.length < 2) {
      swipeDocResults = [];
      isSwipeDocSearching = false;
      return;
    }

    isSwipeDocSearching = true;
    swipeDocTimeout = setTimeout(async () => {
      if (!activeGoogleAccount) await loadGoogleAccounts();
      if (!activeGoogleAccount) { isSwipeDocSearching = false; return; }
      try {
        swipeDocResults = await api.searchGoogleDocs(value, activeGoogleAccount);
      } catch (err) {
        console.error('Doc search failed:', err);
        swipeDocResults = [];
      } finally {
        isSwipeDocSearching = false;
      }
    }, 300);
  }

  async function swipeSendToDoc(doc: { id: string; name: string }) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    try {
      await api.sendToGoogleDoc([bookmark.id], doc.id, doc.name, activeGoogleAccount);
      showStatus(`Sent to "${doc.name}"`);
      showSwipeDocPanel = false;
      swipeDocQuery = '';
      swipeDocResults = [];
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishSwipeAdvance();
    } catch (err) {
      console.error('Send to doc failed:', err);
      showStatus('Failed to send to doc');
    }
  }

  function handleSwipeNotionSearch(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    swipeNotionQuery = value;
    clearTimeout(swipeNotionTimeout);

    if (!value.trim() || value.length < 2) {
      swipeNotionResults = [];
      isSwipeNotionSearching = false;
      return;
    }

    isSwipeNotionSearching = true;
    swipeNotionTimeout = setTimeout(async () => {
      try {
        swipeNotionResults = await api.searchNotionPages(value);
      } catch (err) {
        console.error('Notion search failed:', err);
        swipeNotionResults = [];
      } finally {
        isSwipeNotionSearching = false;
      }
    }, 300);
  }

  async function swipeSendToNotion(page: { id: string; title: string }) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    try {
      await api.sendToNotionPage([bookmark.id], page.id, page.title);
      showStatus(`Sent to "${page.title}"`);
      showSwipeNotionPanel = false;
      swipeNotionQuery = '';
      swipeNotionResults = [];
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      finishSwipeAdvance();
    } catch (err) {
      console.error('Send to Notion failed:', err);
      showStatus('Failed to send to Notion');
    }
  }

  async function swipeMoveToFolder(folder: string | null) {
    const bookmark = $filteredBookmarks[swipeIndex];
    if (!bookmark) return;

    try {
      await api.moveToFolder([bookmark.id], folder);
      showStatus(folder ? `Moved to "${folder}"` : 'Removed from folder');
      showSwipeFolderPanel = false;
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      console.error('Move to folder failed:', err);
      showStatus('Failed to move to folder');
    }
  }

  function closeAllSwipePanels() {
    showSwipeDocPanel = false;
    showSwipeNotionPanel = false;
    showSwipeFolderPanel = false;
    swipeDocQuery = '';
    swipeDocResults = [];
    swipeNotionQuery = '';
    swipeNotionResults = [];
    swipeNewFolderInput = false;
    swipeNewFolderName = '';
  }
</script>

<div class="min-h-screen" style="background: var(--bg-primary);">
  <!-- Header -->
  <header class="bg-white border-b" style="border-color: var(--border-light);">
    <div class="flex items-center justify-between max-w-5xl mx-auto px-5 py-3">
      <div class="flex items-center gap-2">
        <svg class="w-5 h-5" style="color: var(--accent);" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
        </svg>
        <span class="font-semibold" style="color: var(--text-primary);">Bookmark Sort</span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick={toggleSwipeMode} class="mode-toggle">
          {swipeMode ? 'Grid' : 'Cards'}
        </button>
        <button onclick={() => showSettingsModal = true} class="btn btn-secondary">
          Settings
        </button>
      </div>
    </div>
  </header>

  {#if !swipeMode}
  <main class="max-w-5xl mx-auto px-5 py-6">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 mb-5">
      <div class="flex-1 relative">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style="color: var(--text-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input
          type="text"
          placeholder="Search bookmarks..."
          value={searchInput}
          oninput={handleSearchInput}
          class="w-full pl-9 pr-3"
        />
      </div>
      <select
        value={$filters.folder || ''}
        onchange={(e) => filters.update(f => ({ ...f, folder: (e.target as HTMLSelectElement).value || null }))}
      >
        <option value="">All Folders</option>
        {#each $folders as folder}
          <option value={folder}>{folder}</option>
        {/each}
      </select>
      <select
        value={$filters.status}
        onchange={(e) => filters.update(f => ({ ...f, status: (e.target as HTMLSelectElement).value as any }))}
      >
        <option value="all">All</option>
        <option value="pending">Not routed</option>
        <option value="routed">Routed</option>
      </select>
      <button onclick={() => showImportModal = true} class="btn btn-primary">
        Import
      </button>
    </div>

    <!-- Stats row -->
    <div class="flex items-center gap-3 mb-4 text-sm" style="color: var(--text-secondary);">
      <span style="color: var(--text-primary); font-weight: 500;">{$filteredBookmarks.length} bookmarks</span>
      <span style="color: var(--border-medium);">·</span>
      <button onclick={selectAll} class="hover:underline" style="color: var(--accent);">Select all</button>
      {#if $selectedIds.size > 0}
        <span style="color: var(--border-medium);">·</span>
        <span>{$selectedIds.size} selected</span>
        <button onclick={clearSelection} class="hover:underline" style="color: var(--text-muted);">Clear</button>
      {/if}
    </div>

    <!-- Bulk Actions (inline - hidden when sticky bar shows) -->
    {#if $selectedIds.size > 0 && $selectedIds.size <= 0}
      <div class="action-bar flex items-center gap-3 mb-6 p-4 flex-wrap">
        <span class="text-sm font-medium" style="color: var(--text-primary);">Send {$selectedIds.size} selected to:</span>

        <!-- Existing destinations -->
        {#each $destinations.filter(d => d.type === 'instapaper') as dest}
          <button
            onclick={() => bulkRoute(dest.id)}
            class="px-3 py-1.5 text-sm font-medium text-white rounded-lg"
            style="background: var(--accent);"
          >
            {dest.name}
          </button>
        {/each}

        <!-- Google Doc search -->
        <div class="relative">
          <input
            type="text"
            placeholder="Search Google Docs..."
            value={docSearchQuery}
            oninput={handleDocSearch}
            onfocus={() => { if (docSearchResults.length > 0) showDocDropdown = true; }}
            class="px-3 py-1.5 rounded-lg text-sm w-52"
            style="border: 1px solid var(--border-medium); background: white;"
          />
          {#if isSearchingDocs}
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style="color: var(--text-muted);">...</span>
          {/if}

          <!-- Dropdown results -->
          {#if showDocDropdown && docSearchResults.length > 0}
            <div class="dropdown absolute top-full left-0 mt-2 z-50 max-h-64 overflow-auto" style="width: 400px;">
              {#each docSearchResults as doc}
                <button
                  onclick={() => sendSelectedToDoc(doc)}
                  class="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0"
                  style="border-color: var(--border-light); white-space: normal; line-height: 1.4;"
                  title={doc.name}
                >
                  {doc.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        {#if docSearchQuery && docSearchResults.length === 0 && !isSearchingDocs}
          <span class="text-xs" style="color: var(--text-muted);">No docs found</span>
        {/if}

        <!-- Notion search (if configured) -->
        {#if notionStatus.connected}
          <div class="relative">
            <input
              type="text"
              placeholder="Search Notion pages..."
              value={notionSearchQuery}
              oninput={handleNotionSearch}
              onfocus={() => { if (notionSearchResults.length > 0) showNotionDropdown = true; }}
              class="px-3 py-1.5 rounded-lg text-sm w-52"
              style="border: 1px solid var(--border-medium); background: white;"
            />
            {#if isSearchingNotion}
              <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style="color: var(--text-muted);">...</span>
            {/if}

            <!-- Dropdown results -->
            {#if showNotionDropdown && notionSearchResults.length > 0}
              <div class="dropdown absolute top-full left-0 mt-2 w-80 z-50 max-h-64 overflow-auto">
                {#each notionSearchResults as page}
                  <button
                    onclick={() => sendSelectedToNotion(page)}
                    class="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0"
                    style="border-color: var(--border-light);"
                  >
                    {page.title}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          {#if notionSearchQuery && notionSearchResults.length === 0 && !isSearchingNotion}
            <span class="text-xs" style="color: var(--text-muted);">No pages found</span>
          {/if}
        {/if}

        <!-- Create New Doc button -->
        <button
          onclick={() => showNewDocModal = true}
          class="px-3 py-1.5 text-sm font-medium text-white rounded-lg"
          style="background: var(--success);"
        >
          + New Doc
        </button>
      </div>
    {/if}

    <!-- Bookmark List -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-24">
      {#each $filteredBookmarks as bookmark (bookmark.id)}
        <div
          class="card cursor-pointer {$selectedIds.has(bookmark.id) ? 'selected' : ''}"
          onclick={() => toggleSelection(bookmark.id)}
          style="padding: 12px;"
        >
          <div class="flex gap-3">
            <input
              type="checkbox"
              checked={$selectedIds.has(bookmark.id)}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleSelection(bookmark.id)}
              style="margin-top: 2px;"
            />

            <div class="flex-1 min-w-0">
              <!-- Header -->
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm" style="color: var(--text-primary);">@{bookmark.author_handle}</span>
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
                  onclick={(e) => e.stopPropagation()}
                  class="mt-2 block rounded-lg p-3"
                  style="background: var(--bg-hover); border: 1px solid var(--border-light);"
                >
                  <div class="flex items-center gap-2 mb-1">
                    <svg class="w-3 h-3" style="color: var(--text-muted);" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H18a2.5 2.5 0 0 1 2.5 2.5v14.25a.75.75 0 0 1-.75.75H5.5a1 1 0 0 0 1 1h14.25a.75.75 0 0 1 0 1.5H6.5A2.5 2.5 0 0 1 4 19.5V4.5Zm4.75 4a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm-.75 4.75a.75.75 0 0 0 .75.75h6.5a.75.75 0 0 0 0-1.5h-6.5a.75.75 0 0 0-.75.75Z"/>
                    </svg>
                    <span class="text-xs font-medium" style="color: var(--accent);">
                      @{bookmark.quoted_tweet?.author_handle || quotedMatch?.[1] || 'unknown'}
                    </span>
                  </div>
                  {#if bookmark.quoted_tweet}
                    <p class="text-xs leading-relaxed mt-1" style="color: var(--text-secondary);">
                      {bookmark.quoted_tweet.text.length > 200 ? bookmark.quoted_tweet.text.slice(0, 200) + '...' : bookmark.quoted_tweet.text}
                    </p>
                  {:else}
                    <span class="text-xs" style="color: var(--text-muted);">View quoted post →</span>
                  {/if}
                </a>
              {/if}

              <!-- Image -->
              {#if bookmark.media_urls && bookmark.media_urls.length > 0 && bookmark.media_urls[0].startsWith('http')}
                <img
                  src={bookmark.media_urls[0]}
                  alt=""
                  class="mt-3 rounded w-full object-cover cursor-pointer"
                  style="max-height: 140px;"
                  onclick={(e) => { e.stopPropagation(); window.open(bookmark.media_urls[0], '_blank'); }}
                />
              {/if}

              <!-- Link with title -->
              {#if bookmark.urls.length > 0}
                <a
                  href={bookmark.urls[0]}
                  target="_blank"
                  rel="noopener"
                  class="mt-2 block rounded-lg p-2"
                  style="background: var(--bg-hover); border: 1px solid var(--border-light);"
                  onclick={(e) => e.stopPropagation()}
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
              <div class="mt-3 flex items-center gap-4 text-xs" style="color: var(--text-muted);">
                <a
                  href="https://x.com/{bookmark.author_handle}/status/{bookmark.tweet_id}"
                  target="_blank"
                  rel="noopener"
                  class="hover:underline"
                  style="color: var(--accent);"
                  onclick={(e) => e.stopPropagation()}
                >
                  View on X
                </a>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="col-span-full text-center py-16" style="color: var(--text-muted);">
          {#if $stats.total === 0}
            No bookmarks yet. Click Import to add some.
          {:else}
            No bookmarks match your filters.
          {/if}
        </div>
      {/each}
    </div>
  </main>

  <!-- Sticky Action Bar -->
  {#if $selectedIds.size > 0}
    <div class="action-bar fixed bottom-0 left-0 right-0 z-40">
      <div class="max-w-5xl mx-auto px-5 py-3 flex items-center gap-3 flex-wrap">
        <!-- Selection count -->
        <span class="text-sm font-medium" style="color: var(--text-primary);">{$selectedIds.size} selected</span>

        <div class="action-divider"></div>

        <!-- Route section -->
        <span class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">Route</span>
        {#each $destinations.filter(d => d.type === 'instapaper') as dest}
          <button onclick={() => bulkRoute(dest.id)} class="btn btn-primary">{dest.name}</button>
        {/each}
        <div class="relative">
          <input
            type="text"
            placeholder="Search docs..."
            value={docSearchQuery}
            oninput={handleDocSearch}
            onfocus={() => { if (docSearchResults.length > 0) showDocDropdown = true; }}
            style="width: 130px;"
          />
          {#if showDocDropdown && docSearchResults.length > 0}
            <div class="dropdown absolute bottom-full mb-1 left-0 max-h-64 overflow-auto" style="width: 350px;">
              {#each docSearchResults as doc}
                <button
                  class="w-full text-left px-3 py-2 text-sm"
                  style="color: var(--text-primary); white-space: normal; line-height: 1.4;"
                  title={doc.name}
                  onmouseenter={(e) => (e.target as HTMLElement).style.background = 'var(--bg-hover)'}
                  onmouseleave={(e) => (e.target as HTMLElement).style.background = 'transparent'}
                  onclick={() => sendSelectedToDoc(doc)}
                >
                  {doc.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <button onclick={() => showNewDocModal = true} class="btn btn-secondary">+ New Doc</button>

        <div class="action-divider"></div>

        <!-- Organize section -->
        <span class="text-xs uppercase tracking-wide" style="color: var(--text-muted);">Organize</span>
        {#if showNewFolderInput}
          <input
            type="text"
            bind:value={newFolderName}
            placeholder="Folder name..."
            class="px-2 py-1 text-sm rounded"
            style="width: 120px; border: 1px solid var(--border-light);"
            onkeydown={(e) => {
              if (e.key === 'Enter' && newFolderName.trim()) {
                moveSelectedToFolder(newFolderName.trim());
                showNewFolderInput = false;
                newFolderName = '';
              } else if (e.key === 'Escape') {
                showNewFolderInput = false;
                newFolderName = '';
              }
            }}
            autofocus
          />
          <button
            onclick={() => {
              if (newFolderName.trim()) {
                moveSelectedToFolder(newFolderName.trim());
              }
              showNewFolderInput = false;
              newFolderName = '';
            }}
            class="btn btn-secondary"
          >OK</button>
        {:else}
          <select
            onchange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === '__new__') {
                showNewFolderInput = true;
              } else if (val) {
                moveSelectedToFolder(val === '__none__' ? null : val);
              }
              (e.target as HTMLSelectElement).value = '';
            }}
            style="width: 130px;"
          >
            <option value="">Move to folder</option>
            <option value="__new__">+ New folder</option>
            <option value="__none__">Remove folder</option>
            {#each $folders as folder}
              <option value={folder}>{folder}</option>
            {/each}
          </select>
        {/if}

        <div class="action-divider"></div>

        <!-- Delete -->
        <button onclick={() => deleteSelected()} class="btn btn-danger">Delete</button>
      </div>
    </div>
  {/if}

  {:else}
    <!-- Swipe Mode -->
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
        <button onclick={() => showImportModal = true} class="mode-toggle">Import</button>
      </div>

      <!-- Swipe Area -->
      <div class="swipe-area">
        {#if $filteredBookmarks[swipeIndex]}
          {@const bookmark = $filteredBookmarks[swipeIndex]}
          <div
            class="swipe-card-wrapper"
            ontouchstart={onSwipeTouchStart}
            ontouchmove={onSwipeTouchMove}
            ontouchend={onSwipeTouchEnd}
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
                      @{bookmark.quoted_tweet?.author_handle || quotedMatch?.[1] || 'unknown'}
                    </span>
                  </div>
                  {#if bookmark.quoted_tweet}
                    <p class="text-xs leading-relaxed mt-1" style="color: var(--text-secondary);">
                      {bookmark.quoted_tweet.text.length > 200 ? bookmark.quoted_tweet.text.slice(0, 200) + '...' : bookmark.quoted_tweet.text}
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
        {:else}
          <!-- All caught up -->
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
          <button class="swipe-action-btn" onclick={swipeSkip} disabled={swipeAnimating}>
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
            <button class="swipe-action-btn" onclick={() => { closeAllSwipePanels(); showSwipeDocPanel = true; }} disabled={swipeAnimating}>
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <span>Doc</span>
            </button>
          {/if}
          {#if notionStatus.connected}
            <button class="swipe-action-btn" onclick={() => { closeAllSwipePanels(); showSwipeNotionPanel = true; }} disabled={swipeAnimating}>
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
              </svg>
              <span>Notion</span>
            </button>
          {/if}
          <button class="swipe-action-btn" onclick={() => { closeAllSwipePanels(); showSwipeFolderPanel = true; }} disabled={swipeAnimating}>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            <span>Folder</span>
          </button>
          <button class="swipe-action-btn danger" onclick={swipeDelete} disabled={swipeAnimating}>
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            <span>Delete</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Import Modal -->
  {#if showImportModal}
    <div class="modal-backdrop fixed inset-0 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-5 max-w-xl w-full mx-4 max-h-[80vh] overflow-auto" style="box-shadow: var(--shadow-md);">
        <h2 class="text-base font-semibold mb-1" style="color: var(--text-primary);">Import Bookmarks</h2>
        <p class="text-sm mb-4" style="color: var(--text-muted);">
          Paste your ArchivlyX export (CSV or JSON):
        </p>
        <textarea
          bind:value={importContent}
          placeholder="Paste content here..."
          class="w-full h-48 p-3 rounded font-mono text-xs"
          style="border: 1px solid var(--border-light); resize: none;"
        ></textarea>
        {#if importStatus}
          <p class="mt-2 text-sm" style="color: var(--text-secondary);">{importStatus}</p>
        {/if}
        <div class="mt-4 flex justify-between">
          <button onclick={() => handleSyncFolders()} class="btn btn-secondary" title="Update folders for existing tweets without re-adding deleted ones">
            Sync Folders Only
          </button>
          <div class="flex gap-2">
            <button onclick={() => { showImportModal = false; importContent = ''; importStatus = ''; }} class="btn btn-secondary">Cancel</button>
            <button onclick={handleImport} class="btn btn-primary">Import</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings Modal -->
  {#if showSettingsModal}
    <div class="modal-backdrop fixed inset-0 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-5 max-w-md w-full mx-4" style="box-shadow: var(--shadow-md);">
        <h2 class="text-base font-semibold mb-4" style="color: var(--text-primary);">Settings</h2>

        <h3 class="text-xs uppercase tracking-wide mb-2" style="color: var(--text-muted);">Connected Accounts</h3>
        <ul class="mb-4 space-y-1">
          {#each googleAccounts as account}
            <li class="p-2 rounded text-sm flex items-center gap-2" style="background: var(--success-light); color: #065f46;">
              ✓ Google: {account.email}
            </li>
          {/each}
          {#if xStatus.connected}
            <li class="p-2 rounded text-sm" style="background: var(--success-light); color: #065f46;">
              ✓ X: @{xStatus.username}
            </li>
          {:else}
            <li class="p-2 rounded text-sm" style="background: var(--bg-hover); color: var(--text-muted);">
              X: Not connected
            </li>
          {/if}
          {#if notionStatus.connected}
            <li class="p-2 rounded text-sm" style="background: var(--success-light); color: #065f46;">
              ✓ Notion: {notionStatus.botName || 'Connected'}
            </li>
          {:else}
            <li class="p-2 rounded text-sm" style="background: var(--bg-hover); color: var(--text-muted);">
              Notion: Not connected
            </li>
          {/if}
        </ul>

        <h3 class="text-xs uppercase tracking-wide mb-2" style="color: var(--text-muted);">Destinations</h3>
        {#if $destinations.filter(d => d.type !== 'x' && d.type !== 'google').length === 0}
          <p class="text-sm mb-4" style="color: var(--text-muted);">No saved destinations.</p>
        {:else}
          <ul class="mb-4 space-y-1">
            {#each $destinations.filter(d => d.type !== 'x' && d.type !== 'google') as dest}
              <li class="flex items-center justify-between p-2 rounded text-sm" style="background: var(--bg-hover);">
                <span style="color: var(--text-primary);">{dest.name}</span>
                <button
                  onclick={async () => {
                    await api.deleteDestination(dest.id);
                    const data = await api.fetchDestinations();
                    destinations.set(data);
                  }}
                  class="text-xs hover:underline"
                  style="color: var(--danger);"
                >
                  Remove
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="flex justify-end mt-4">
          <button onclick={() => showSettingsModal = false} class="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- New Doc Modal -->
  {#if showNewDocModal}
    <div class="modal-backdrop fixed inset-0 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-5 max-w-sm w-full mx-4" style="box-shadow: var(--shadow-md);">
        <h2 class="text-base font-semibold mb-1" style="color: var(--text-primary);">New Google Doc</h2>
        <p class="text-sm mb-4" style="color: var(--text-muted);">
          {$selectedIds.size} tweet{$selectedIds.size === 1 ? '' : 's'} will be added.
        </p>
        <input
          type="text"
          bind:value={newDocTitle}
          placeholder="Document title..."
          class="w-full mb-4"
          onkeydown={(e) => { if (e.key === 'Enter') createNewDocWithSelected(); }}
        />
        <div class="flex justify-end gap-2">
          <button onclick={() => { showNewDocModal = false; newDocTitle = ''; }} class="btn btn-secondary">Cancel</button>
          <button
            onclick={createNewDocWithSelected}
            disabled={isCreatingDoc || !newDocTitle.trim()}
            class="btn btn-primary disabled:opacity-50"
          >
            {isCreatingDoc ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Swipe Mode: Doc Search Bottom Sheet -->
  {#if showSwipeDocPanel}
    <div class="bottom-sheet-backdrop" onclick={closeAllSwipePanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllSwipePanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
    <div class="bottom-sheet">
      <div class="bottom-sheet-handle"></div>
      <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Send to Google Doc</h3>
      <input
        type="text"
        placeholder="Search your docs..."
        value={swipeDocQuery}
        oninput={handleSwipeDocSearch}
        class="w-full mb-3"
      />
      {#if isSwipeDocSearching}
        <p class="text-sm" style="color: var(--text-muted);">Searching...</p>
      {:else if swipeDocResults.length > 0}
        <div class="space-y-1">
          {#each swipeDocResults as doc}
            <button
              onclick={() => swipeSendToDoc(doc)}
              class="w-full text-left p-3 rounded-lg text-sm"
              style="color: var(--text-primary); border: 1px solid var(--border-light);"
            >
              {doc.name}
            </button>
          {/each}
        </div>
      {:else if swipeDocQuery.length >= 2}
        <p class="text-sm" style="color: var(--text-muted);">No docs found</p>
      {/if}
    </div>
  {/if}

  <!-- Swipe Mode: Notion Search Bottom Sheet -->
  {#if showSwipeNotionPanel}
    <div class="bottom-sheet-backdrop" onclick={closeAllSwipePanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllSwipePanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
    <div class="bottom-sheet">
      <div class="bottom-sheet-handle"></div>
      <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Send to Notion Page</h3>
      <input
        type="text"
        placeholder="Search Notion pages..."
        value={swipeNotionQuery}
        oninput={handleSwipeNotionSearch}
        class="w-full mb-3"
      />
      {#if isSwipeNotionSearching}
        <p class="text-sm" style="color: var(--text-muted);">Searching...</p>
      {:else if swipeNotionResults.length > 0}
        <div class="space-y-1">
          {#each swipeNotionResults as page}
            <button
              onclick={() => swipeSendToNotion(page)}
              class="w-full text-left p-3 rounded-lg text-sm"
              style="color: var(--text-primary); border: 1px solid var(--border-light);"
            >
              {page.title}
            </button>
          {/each}
        </div>
      {:else if swipeNotionQuery.length >= 2}
        <p class="text-sm" style="color: var(--text-muted);">No pages found</p>
      {/if}
    </div>
  {/if}

  <!-- Swipe Mode: Folder Picker Bottom Sheet -->
  {#if showSwipeFolderPanel}
    <div class="bottom-sheet-backdrop" onclick={closeAllSwipePanels} onkeydown={(e) => { if (e.key === 'Escape') closeAllSwipePanels(); }} role="button" tabindex="-1" aria-label="Close panel"></div>
    <div class="bottom-sheet">
      <div class="bottom-sheet-handle"></div>
      <h3 class="text-sm font-semibold mb-3" style="color: var(--text-primary);">Move to Folder</h3>
      <div class="space-y-1">
        {#if swipeNewFolderInput}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={swipeNewFolderName}
              placeholder="New folder name..."
              class="flex-1"
              onkeydown={(e) => {
                if (e.key === 'Enter' && swipeNewFolderName.trim()) {
                  swipeMoveToFolder(swipeNewFolderName.trim());
                  swipeNewFolderInput = false;
                  swipeNewFolderName = '';
                } else if (e.key === 'Escape') {
                  swipeNewFolderInput = false;
                  swipeNewFolderName = '';
                }
              }}
            />
            <button
              onclick={() => {
                if (swipeNewFolderName.trim()) swipeMoveToFolder(swipeNewFolderName.trim());
                swipeNewFolderInput = false;
                swipeNewFolderName = '';
              }}
              class="btn btn-primary" style="width: auto;"
            >Add</button>
          </div>
        {:else}
          <button
            onclick={() => { swipeNewFolderInput = true; }}
            class="w-full text-left p-3 rounded-lg text-sm font-medium"
            style="color: var(--accent); border: 1px dashed var(--accent);"
          >
            + New Folder
          </button>
        {/if}
        <button
          onclick={() => swipeMoveToFolder(null)}
          class="w-full text-left p-3 rounded-lg text-sm"
          style="color: var(--text-muted); border: 1px solid var(--border-light);"
        >
          Remove from folder
        </button>
        {#each $folders as folder}
          <button
            onclick={() => swipeMoveToFolder(folder)}
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
</div>
