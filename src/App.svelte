<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { bookmarks, searchQuery, searchResults, isSearching, selectedIds, filters, filteredBookmarks, stats, destinations, folders } from './stores/bookmarks';
  import * as api from './lib/api';
  import type { Bookmark, Destination } from './lib/types';

  // View mode: 'swipe' for Tinder-style, 'list' for power user view
  let viewMode: 'swipe' | 'list' = 'list';
  let currentSwipeIndex = 0;
  let swipeDirection: 'left' | 'right' | null = null;
  let swipeOffset = 0;
  let isDragging = false;
  let startX = 0;
  let showRouteOptions = false;

  // Swipe route mode states
  let swipeNewFolderMode = false;
  let swipeNewFolderName = '';
  let showNewDocModalForSwipe = false;
  let swipeNewDocTitle = '';

  // Keyboard navigation
  let focusedIndex = -1;
  let searchInputRef: HTMLInputElement;

  // Find Similar feature
  let similarBookmarks: Bookmark[] = [];
  let showSimilarPanel = false;
  let similarSourceId: string | null = null;
  let isLoadingSimilar = false;

  // Quick filters
  let quickFilters = {
    hasLinks: false,
    hasImages: false,
    byAuthor: '' as string,
  };

  // Apply quick filters on top of store filters
  $: displayedBookmarks = $filteredBookmarks.filter(b => {
    if (quickFilters.hasLinks && (!b.urls || b.urls.length === 0)) return false;
    if (quickFilters.hasImages && (!b.media_urls || b.media_urls.length === 0)) return false;
    if (quickFilters.byAuthor && b.author_handle !== quickFilters.byAuthor) return false;
    return true;
  });

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

  // Loading state for initial load
  let isLoading = true;

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

  // Mobile filter panel
  let showFilterPanel = false;

  // Load data on mount
  onMount(async () => {
    try {
      // Load all data in parallel for fast startup
      const [bookmarkData, destData] = await Promise.all([
        api.fetchBookmarks(),
        api.fetchDestinations(),
      ]);
      bookmarks.set(bookmarkData);
      destinations.set(destData);

      // Load status checks in parallel (non-blocking)
      Promise.all([
        loadGoogleAccounts(),
        loadXStatus(),
        loadNotionStatus(),
      ]).catch(err => console.error('Failed to load status:', err));
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      isLoading = false;
    }

    // Add keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  // Keyboard shortcuts handler
  function handleKeyDown(e: KeyboardEvent) {
    // Skip if typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // But allow Escape to blur
      if (e.key === 'Escape') {
        target.blur();
        focusedIndex = -1;
      }
      return;
    }

    const bookmarkList = $filteredBookmarks;

    switch (e.key) {
      case 'j': // Next item
        e.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, bookmarkList.length - 1);
        scrollToFocused();
        break;
      case 'k': // Previous item
        e.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, 0);
        scrollToFocused();
        break;
      case ' ': // Toggle selection
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < bookmarkList.length) {
          toggleSelection(bookmarkList[focusedIndex].id);
        }
        break;
      case '/': // Focus search
        e.preventDefault();
        searchInputRef?.focus();
        break;
      case 'Escape': // Clear selection and close panels
        e.preventDefault();
        clearSelection();
        showSimilarPanel = false;
        focusedIndex = -1;
        break;
      case 's': // Find similar for focused item
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < bookmarkList.length) {
          findSimilar(bookmarkList[focusedIndex].id);
        }
        break;
      case 'a': // Select all
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          selectAll();
        }
        break;
    }
  }

  function scrollToFocused() {
    const element = document.querySelector(`[data-index="${focusedIndex}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Find similar bookmarks
  async function findSimilar(bookmarkId: string) {
    isLoadingSimilar = true;
    similarSourceId = bookmarkId;
    showSimilarPanel = true;
    try {
      similarBookmarks = await api.findSimilarBookmarks(bookmarkId, 8);
    } catch (err) {
      console.error('Find similar failed:', err);
      similarBookmarks = [];
    } finally {
      isLoadingSimilar = false;
    }
  }

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
        showStatus(`Sent to ${page.title}`);
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
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      importStatus = `Error: ${err}`;
    }
  }

  async function handleSyncFolders() {
    if (!importContent.trim()) return;
    importStatus = 'Syncing folders...';
    try {
      const result = await api.syncFolders(importContent);
      importStatus = result.message;
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
    } catch (err) {
      importStatus = `Error: ${err}`;
    }
  }

  // Selection
  function toggleSelection(id: string) {
    selectedIds.update(ids => {
      const newIds = new Set(ids);
      if (newIds.has(id)) {
        newIds.delete(id);
      } else {
        newIds.add(id);
      }
      return newIds;
    });
  }

  function selectAll() {
    const all = new Set($filteredBookmarks.map(b => b.id));
    selectedIds.set(all);
  }

  function clearSelection() {
    selectedIds.set(new Set());
  }

  // Routing
  async function bulkRoute(destinationId: string) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;
    try {
      await api.routeBookmarksBulk(ids, destinationId);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus(`Routed ${ids.length} bookmarks`);
    } catch (err) {
      console.error('Bulk route failed:', err);
    }
  }

  // Google Docs
  async function loadGoogleAccounts() {
    try {
      const accounts = await api.fetchGoogleAccounts();
      googleAccounts = accounts;
      if (accounts.length > 0 && !activeGoogleAccount) {
        activeGoogleAccount = accounts[0].id;
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

    isSearchingDocs = true;

    docSearchTimeout = setTimeout(async () => {
      try {
        const results = await api.searchGoogleDocs(value, activeGoogleAccount);
        docSearchResults = results.files || [];
        showDocDropdown = docSearchResults.length > 0;
      } catch (err) {
        console.error('Google Docs search failed:', err);
        docSearchResults = [];
      } finally {
        isSearchingDocs = false;
      }
    }, 400);
  }

  async function sendSelectedToDoc(doc: { id: string; name: string }) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;

    try {
      await api.sendToGoogleDoc(ids, doc.id, doc.name, activeGoogleAccount);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus(`Sent to ${doc.name}`);
      docSearchQuery = '';
      docSearchResults = [];
      showDocDropdown = false;
    } catch (err) {
      console.error('Send to Google Doc failed:', err);
      alert('Failed to send to Google Doc: ' + err);
    }
  }

  async function createNewDocWithSelected() {
    if (!newDocTitle.trim() || isCreatingDoc) return;
    isCreatingDoc = true;
    try {
      const ids = Array.from($selectedIds);
      const result = await api.createDocWithTweets(ids, newDocTitle, activeGoogleAccount);
      if (result.docUrl) {
        window.open(result.docUrl, '_blank');
      }
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showNewDocModal = false;
      newDocTitle = '';
      showStatus('Created new doc');
    } catch (err) {
      console.error('Create doc failed:', err);
      alert('Failed to create doc: ' + err);
    } finally {
      isCreatingDoc = false;
    }
  }

  // Folder management
  async function moveSelectedToFolder(folder: string | null) {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;
    try {
      await api.moveToFolder(ids, folder);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus(folder ? `Moved to ${folder}` : 'Removed from folder');
    } catch (err) {
      console.error('Move to folder failed:', err);
    }
  }

  // Delete
  async function deleteSelected() {
    const ids = Array.from($selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} bookmark${ids.length > 1 ? 's' : ''}?`)) return;
    try {
      await api.deleteBookmarks(ids, false);
      clearSelection();
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus(`Deleted ${ids.length} bookmarks`);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  function showStatus(message: string) {
    statusMessage = message;
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      statusMessage = '';
    }, 2500);
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Swipe handlers
  function handleTouchStart(e: TouchEvent) {
    if (viewMode !== 'swipe') return;
    isDragging = true;
    startX = e.touches[0].clientX;
    swipeOffset = 0;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging || viewMode !== 'swipe') return;
    const currentX = e.touches[0].clientX;
    swipeOffset = currentX - startX;

    if (swipeOffset > 50) {
      swipeDirection = 'right';
    } else if (swipeOffset < -50) {
      swipeDirection = 'left';
    } else {
      swipeDirection = null;
    }
  }

  function handleTouchEnd() {
    if (!isDragging || viewMode !== 'swipe') return;
    isDragging = false;

    const threshold = 100;
    const currentBookmark = $filteredBookmarks[currentSwipeIndex];

    if (swipeOffset > threshold && currentBookmark) {
      // Swipe right - Keep (show routing options)
      showRouteOptions = true;
    } else if (swipeOffset < -threshold && currentBookmark) {
      // Swipe left - Discard
      handleDiscard(currentBookmark);
    }

    swipeOffset = 0;
    swipeDirection = null;
  }

  async function handleDiscard(bookmark: Bookmark) {
    try {
      await api.deleteBookmarks([bookmark.id], false);
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus('Discarded');
      // Move to next card
      if (currentSwipeIndex >= $filteredBookmarks.length) {
        currentSwipeIndex = Math.max(0, $filteredBookmarks.length - 1);
      }
    } catch (err) {
      console.error('Discard failed:', err);
    }
  }

  async function handleKeepAndRoute(bookmark: Bookmark, destinationType: string, destinationId?: string) {
    showRouteOptions = false;
    try {
      if (destinationType === 'folder') {
        await api.moveToFolder([bookmark.id], destinationId || 'saved');
      } else if (destinationId) {
        await api.routeBookmarksBulk([bookmark.id], destinationId);
      }
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus('Saved!');
      // Move to next card
      currentSwipeIndex = Math.min(currentSwipeIndex + 1, $filteredBookmarks.length - 1);
    } catch (err) {
      console.error('Route failed:', err);
    }
  }

  function skipCard() {
    currentSwipeIndex = Math.min(currentSwipeIndex + 1, $filteredBookmarks.length - 1);
    showRouteOptions = false;
  }

  function previousCard() {
    currentSwipeIndex = Math.max(currentSwipeIndex - 1, 0);
    showRouteOptions = false;
  }

  // Send single bookmark to a Google Doc (for swipe mode)
  async function sendSwipeToDoc(bookmark: Bookmark, doc: { id: string; name: string }) {
    try {
      await api.sendToGoogleDoc([bookmark.id], doc.id, doc.name, activeGoogleAccount);
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showStatus(`Sent to ${doc.name}`);
      docSearchQuery = '';
      docSearchResults = [];
      currentSwipeIndex = Math.min(currentSwipeIndex + 1, $filteredBookmarks.length - 1);
    } catch (err) {
      console.error('Send to doc failed:', err);
      alert('Failed to send to doc');
    }
  }

  // Create new Google Doc with single bookmark (for swipe mode)
  async function createSwipeDoc(bookmark: Bookmark) {
    if (!swipeNewDocTitle.trim()) return;
    try {
      const result = await api.createDocWithTweets([bookmark.id], swipeNewDocTitle, activeGoogleAccount);
      if (result.docUrl) {
        window.open(result.docUrl, '_blank');
      }
      const data = await api.fetchBookmarks();
      bookmarks.set(data);
      showNewDocModalForSwipe = false;
      showRouteOptions = false;
      swipeNewDocTitle = '';
      showStatus('Created new doc');
      currentSwipeIndex = Math.min(currentSwipeIndex + 1, $filteredBookmarks.length - 1);
    } catch (err) {
      console.error('Create doc failed:', err);
      alert('Failed to create doc');
    }
  }

  // Get current filter label
  $: currentFilterLabel = $filters.folder || ($filters.status !== 'all' ? ($filters.status === 'pending' ? 'Not routed' : 'Routed') : 'All bookmarks');
</script>

<div class="app-container">
  <!-- Loading Overlay -->
  {#if isLoading}
    <div class="loading-overlay">
      <div class="loading-spinner"></div>
      <span class="loading-text">Loading bookmarks...</span>
    </div>
  {/if}

  <!-- Mobile Header -->
  <header class="mobile-header">
    <div class="header-content">
      <div class="header-left">
        <svg class="header-icon" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
        </svg>
        <span class="header-title">Bookmark Sort</span>
      </div>
      <div class="header-right">
        <button class="icon-btn" onclick={() => showSettingsModal = true} aria-label="Settings">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- View Mode Toggle -->
  <div class="view-toggle-bar">
    <button
      class="view-toggle-btn {viewMode === 'swipe' ? 'active' : ''}"
      onclick={() => { viewMode = 'swipe'; currentSwipeIndex = 0; }}
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
      </svg>
      Swipe
    </button>
    <button
      class="view-toggle-btn {viewMode === 'list' ? 'active' : ''}"
      onclick={() => viewMode = 'list'}
    >
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
      </svg>
      List
    </button>
  </div>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <button class="filter-chip {!$filters.folder && $filters.status === 'all' ? 'active' : ''}" onclick={() => { filters.set({ status: 'all', folder: null, tag: null }); showFilterPanel = false; }}>
      All
    </button>
    <button class="filter-chip" onclick={() => showFilterPanel = !showFilterPanel}>
      {currentFilterLabel}
      <svg class="filter-chevron {showFilterPanel ? 'open' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>
    </button>
    <button class="filter-chip" onclick={() => showImportModal = true}>
      + Import
    </button>
  </div>

  <!-- Filter Panel (Expandable) -->
  {#if showFilterPanel}
    <div class="filter-panel">
      <div class="filter-section">
        <span class="filter-label">Folders</span>
        <div class="filter-options">
          <button
            class="filter-option {!$filters.folder ? 'active' : ''}"
            onclick={() => { filters.update(f => ({ ...f, folder: null })); showFilterPanel = false; }}
          >
            All Folders
          </button>
          {#each $folders as folder}
            <button
              class="filter-option {$filters.folder === folder ? 'active' : ''}"
              onclick={() => { filters.update(f => ({ ...f, folder })); showFilterPanel = false; }}
            >
              {folder}
            </button>
          {/each}
        </div>
      </div>
      <div class="filter-section">
        <span class="filter-label">Status</span>
        <div class="filter-options">
          <button
            class="filter-option {$filters.status === 'all' ? 'active' : ''}"
            onclick={() => { filters.update(f => ({ ...f, status: 'all' })); showFilterPanel = false; }}
          >
            All
          </button>
          <button
            class="filter-option {$filters.status === 'pending' ? 'active' : ''}"
            onclick={() => { filters.update(f => ({ ...f, status: 'pending' })); showFilterPanel = false; }}
          >
            Not routed
          </button>
          <button
            class="filter-option {$filters.status === 'routed' ? 'active' : ''}"
            onclick={() => { filters.update(f => ({ ...f, status: 'routed' })); showFilterPanel = false; }}
          >
            Routed
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Context Bar -->
  <div class="context-bar">
    <span class="context-count">{$filteredBookmarks.length} bookmarks</span>
    {#if $filters.folder}
      <span class="context-folder">in {$filters.folder}</span>
    {/if}
    {#if viewMode === 'swipe' && $filteredBookmarks.length > 0}
      <span class="context-progress">{currentSwipeIndex + 1} of {$filteredBookmarks.length}</span>
    {/if}
  </div>

  <!-- Main Content -->
  <main class="main-content">
    {#if viewMode === 'swipe'}
      <!-- Swipe View -->
      <div class="swipe-container">
        {#if $filteredBookmarks.length === 0}
          <div class="empty-state">
            <p>No bookmarks to sort</p>
          </div>
        {:else}
          {@const currentBookmark = $filteredBookmarks[currentSwipeIndex]}
          {#if currentBookmark}
            <div
              class="swipe-card {swipeDirection}"
              style="transform: translateX({swipeOffset}px) rotate({swipeOffset * 0.02}deg);"
              ontouchstart={handleTouchStart}
              ontouchmove={handleTouchMove}
              ontouchend={handleTouchEnd}
            >
              <!-- Swipe Indicators -->
              <div class="swipe-indicator left {swipeDirection === 'left' ? 'active' : ''}">
                <span>DISCARD</span>
              </div>
              <div class="swipe-indicator right {swipeDirection === 'right' ? 'active' : ''}">
                <span>KEEP</span>
              </div>

              <!-- Card Content -->
              <div class="swipe-card-content">
                <div class="swipe-card-header">
                  <span class="author">@{currentBookmark.author_handle}</span>
                  <span class="date">{formatDate(currentBookmark.created_at)}</span>
                </div>
                {#if currentBookmark.archivly_folder}
                  <span class="folder-badge">{currentBookmark.archivly_folder}</span>
                {/if}
                <p class="tweet-text">{currentBookmark.text}</p>

                <!-- Media Images -->
                {#if currentBookmark.media_urls?.length > 0}
                  <div class="tweet-media {currentBookmark.media_urls.length > 1 ? 'media-grid' : ''}">
                    {#each currentBookmark.media_urls.filter(url => url.startsWith('http')).slice(0, 4) as mediaUrl, i}
                      <img src={mediaUrl} alt="" class="tweet-image" loading="lazy" />
                    {/each}
                  </div>
                {/if}

                <!-- Quoted Tweet (OP) -->
                {#if currentBookmark.quoted_tweet}
                  <div class="quoted-tweet">
                    <div class="quoted-header">
                      <span class="quoted-label">Quoting</span>
                      <span class="quoted-author">@{currentBookmark.quoted_tweet.author_handle}</span>
                    </div>
                    <p class="quoted-text">{currentBookmark.quoted_tweet.text}</p>
                  </div>
                {:else if currentBookmark.quoted_post_url}
                  <a href={currentBookmark.quoted_post_url} target="_blank" class="quoted-tweet-link">
                    <span class="quoted-label">Quoted tweet</span>
                    <span class="quoted-url">{currentBookmark.quoted_post_url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '')}</span>
                  </a>
                {/if}

                <!-- Link Preview -->
                {#if currentBookmark.urls?.length > 0 && !currentBookmark.quoted_post_url}
                  <a href={currentBookmark.urls[0]} target="_blank" class="tweet-link">
                    {#if currentBookmark.link_title}
                      <span class="link-title">{currentBookmark.link_title}</span>
                    {/if}
                    <span class="link-url">{currentBookmark.urls[0].replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</span>
                  </a>
                {/if}

                <a href="https://x.com/{currentBookmark.author_handle}/status/{currentBookmark.tweet_id}" target="_blank" class="view-on-x">
                  View on X →
                </a>
              </div>
            </div>

            <!-- Route Options Overlay -->
            {#if showRouteOptions}
              <div class="route-overlay" onclick={() => showRouteOptions = false}>
                <div class="route-panel" onclick={(e) => e.stopPropagation()}>
                  <h3>Route to:</h3>

                  <!-- Google Docs Search -->
                  {#if googleAccounts.length > 0}
                    <div class="route-section">
                      <input
                        type="text"
                        placeholder="Search Google Docs..."
                        class="route-search-input"
                        bind:value={docSearchQuery}
                        oninput={handleDocSearch}
                      />
                      {#if isSearchingDocs}
                        <div class="route-searching">Searching...</div>
                      {/if}
                      {#if docSearchResults.length > 0}
                        <div class="route-doc-results">
                          {#each docSearchResults as doc}
                            <button class="route-btn doc" onclick={() => { sendSwipeToDoc(currentBookmark, doc); showRouteOptions = false; }}>
                              📄 {doc.name}
                            </button>
                          {/each}
                        </div>
                      {/if}
                      <button class="route-btn new-doc" onclick={() => { showNewDocModalForSwipe = true; }}>
                        + New Google Doc
                      </button>
                    </div>
                  {/if}

                  <!-- Instapaper -->
                  <button class="route-btn instapaper" onclick={() => handleKeepAndRoute(currentBookmark, 'instapaper', 'default')}>
                    📖 Send to Instapaper
                  </button>

                  <!-- Folders -->
                  <div class="route-section-title">Move to folder:</div>
                  <div class="route-options">
                    {#each $folders as folder}
                      <button class="route-btn folder" onclick={() => handleKeepAndRoute(currentBookmark, 'folder', folder)}>
                        📁 {folder}
                      </button>
                    {/each}
                    <button class="route-btn new-folder" onclick={() => { swipeNewFolderMode = true; }}>
                      + New folder
                    </button>
                  </div>

                  <button class="route-cancel" onclick={() => showRouteOptions = false}>Cancel</button>
                </div>
              </div>
            {/if}

            <!-- New Folder Input for Swipe -->
            {#if swipeNewFolderMode}
              <div class="route-overlay" onclick={() => swipeNewFolderMode = false}>
                <div class="route-panel small" onclick={(e) => e.stopPropagation()}>
                  <h3>New Folder</h3>
                  <input
                    type="text"
                    placeholder="Folder name..."
                    class="route-search-input"
                    bind:value={swipeNewFolderName}
                    onkeydown={(e) => { if (e.key === 'Enter' && swipeNewFolderName.trim()) { handleKeepAndRoute(currentBookmark, 'folder', swipeNewFolderName.trim()); swipeNewFolderMode = false; swipeNewFolderName = ''; showRouteOptions = false; }}}
                  />
                  <div class="route-panel-actions">
                    <button class="route-cancel" onclick={() => swipeNewFolderMode = false}>Cancel</button>
                    <button class="route-confirm" onclick={() => { if (swipeNewFolderName.trim()) { handleKeepAndRoute(currentBookmark, 'folder', swipeNewFolderName.trim()); swipeNewFolderMode = false; swipeNewFolderName = ''; showRouteOptions = false; }}}>Create</button>
                  </div>
                </div>
              </div>
            {/if}

            <!-- New Doc Modal for Swipe -->
            {#if showNewDocModalForSwipe}
              <div class="route-overlay" onclick={() => showNewDocModalForSwipe = false}>
                <div class="route-panel small" onclick={(e) => e.stopPropagation()}>
                  <h3>New Google Doc</h3>
                  <input
                    type="text"
                    placeholder="Document title..."
                    class="route-search-input"
                    bind:value={swipeNewDocTitle}
                    onkeydown={(e) => { if (e.key === 'Enter' && swipeNewDocTitle.trim()) createSwipeDoc(currentBookmark); }}
                  />
                  <div class="route-panel-actions">
                    <button class="route-cancel" onclick={() => showNewDocModalForSwipe = false}>Cancel</button>
                    <button class="route-confirm" onclick={() => createSwipeDoc(currentBookmark)}>Create</button>
                  </div>
                </div>
              </div>
            {/if}

            <!-- Swipe Controls -->
            <div class="swipe-controls">
              <button class="swipe-btn discard" onclick={() => handleDiscard(currentBookmark)} aria-label="Discard bookmark">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
              <button class="swipe-btn skip" onclick={skipCard} aria-label="Skip to next">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                </svg>
              </button>
              <button class="swipe-btn keep" onclick={() => showRouteOptions = true} aria-label="Keep and route">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                </svg>
              </button>
            </div>
          {/if}
        {/if}
      </div>

    {:else}
      <!-- List View -->
      <div class="list-container">
        <!-- Search Bar -->
        <div class="search-bar">
          <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            placeholder="Search bookmarks..."
            value={searchInput}
            oninput={handleSearchInput}
            class="search-input"
          />
        </div>

        <!-- Selection Bar -->
        {#if $selectedIds.size > 0}
          <div class="selection-bar">
            <span class="selection-count">{$selectedIds.size} selected</span>
            <button class="selection-btn" onclick={clearSelection}>Clear</button>
            <button class="selection-btn" onclick={selectAll}>Select All</button>
          </div>
        {:else}
          <div class="selection-bar">
            <button class="selection-btn" onclick={selectAll}>Select All</button>
          </div>
        {/if}

        <!-- Bookmark Cards -->
        <div class="bookmark-list">
          {#each $filteredBookmarks as bookmark (bookmark.id)}
            <div
              class="bookmark-card {$selectedIds.has(bookmark.id) ? 'selected' : ''}"
              role="button"
              tabindex="0"
              onclick={() => toggleSelection(bookmark.id)}
              onkeydown={(e) => e.key === 'Enter' && toggleSelection(bookmark.id)}
            >
              <div class="bookmark-checkbox">
                <input
                  type="checkbox"
                  checked={$selectedIds.has(bookmark.id)}
                  onclick={(e) => e.stopPropagation()}
                  onchange={() => toggleSelection(bookmark.id)}
                />
              </div>
              <div class="bookmark-content">
                <div class="bookmark-header">
                  <span class="bookmark-author">@{bookmark.author_handle}</span>
                  <span class="bookmark-date">{formatDate(bookmark.created_at)}</span>
                  {#if bookmark.archivly_folder}
                    <span class="bookmark-folder">{bookmark.archivly_folder}</span>
                  {/if}
                </div>

                {#if bookmark.routed_to?.length > 0}
                  <div class="bookmark-routes">
                    {#each bookmark.routed_to as dest}
                      <span class="route-badge">{dest.name}</span>
                    {/each}
                  </div>
                {/if}

                <p class="bookmark-text">{bookmark.text}</p>

                <!-- Media Images -->
                {#if bookmark.media_urls?.length > 0}
                  <div class="tweet-media {bookmark.media_urls.length > 1 ? 'media-grid' : ''}">
                    {#each bookmark.media_urls.filter(url => url.startsWith('http')).slice(0, 4) as mediaUrl}
                      <img src={mediaUrl} alt="" class="bookmark-image" loading="lazy" />
                    {/each}
                  </div>
                {/if}

                <!-- Quoted Tweet (OP) -->
                {#if bookmark.quoted_tweet}
                  <div class="quoted-tweet">
                    <div class="quoted-header">
                      <span class="quoted-label">Quoting</span>
                      <span class="quoted-author">@{bookmark.quoted_tweet.author_handle}</span>
                    </div>
                    <p class="quoted-text">{bookmark.quoted_tweet.text}</p>
                  </div>
                {:else if bookmark.quoted_post_url}
                  <a href={bookmark.quoted_post_url} target="_blank" class="quoted-tweet-link" onclick={(e) => e.stopPropagation()}>
                    <span class="quoted-label">Quoted tweet</span>
                    <span class="quoted-url">{bookmark.quoted_post_url.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '')}</span>
                  </a>
                {/if}

                <!-- Link Preview -->
                {#if bookmark.urls?.length > 0 && !bookmark.quoted_post_url}
                  <a href={bookmark.urls[0]} target="_blank" class="bookmark-link" onclick={(e) => e.stopPropagation()}>
                    {#if bookmark.link_title}
                      <span class="link-title">{bookmark.link_title}</span>
                    {/if}
                    <span class="link-url">{bookmark.urls[0].replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}</span>
                  </a>
                {/if}

                <a
                  href="https://x.com/{bookmark.author_handle}/status/{bookmark.tweet_id}"
                  target="_blank"
                  class="bookmark-view-link"
                  onclick={(e) => e.stopPropagation()}
                >
                  View on X
                </a>
              </div>
            </div>
          {:else}
            <div class="empty-state">
              {#if $stats.total === 0}
                No bookmarks yet. Tap Import to add some.
              {:else}
                No bookmarks match your filters.
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </main>

  <!-- Sticky Action Bar (List View) -->
  {#if viewMode === 'list' && $selectedIds.size > 0}
    <div class="action-bar">
      <div class="action-bar-content">
        <span class="action-count">{$selectedIds.size} selected</span>

        <div class="action-buttons">
          <!-- Quick Actions -->
          {#each $destinations.filter(d => d.type === 'instapaper').slice(0, 1) as dest}
            <button class="action-btn primary" onclick={() => bulkRoute(dest.id)}>
              {dest.name}
            </button>
          {/each}

          <button class="action-btn" onclick={() => showNewDocModal = true}>
            + New Doc
          </button>

          <select
            class="action-select"
            onchange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === '__new__') {
                showNewFolderInput = true;
              } else if (val) {
                moveSelectedToFolder(val === '__none__' ? null : val);
              }
              (e.target as HTMLSelectElement).value = '';
            }}
          >
            <option value="">Move to folder</option>
            <option value="__none__">Remove folder</option>
            {#each $folders as folder}
              <option value={folder}>{folder}</option>
            {/each}
            <option value="__new__">+ New folder</option>
          </select>

          <button class="action-btn danger" onclick={deleteSelected}>
            Delete
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Import Modal -->
  {#if showImportModal}
    <div class="modal-backdrop" role="dialog" aria-modal="true" onclick={() => showImportModal = false} onkeydown={(e) => e.key === 'Escape' && (showImportModal = false)}>
      <div class="modal" role="document" onclick={(e) => e.stopPropagation()}>
        <h2 class="modal-title">Import Bookmarks</h2>
        <p class="modal-desc">Paste your ArchivlyX export (CSV or JSON):</p>
        <textarea
          bind:value={importContent}
          placeholder="Paste content here..."
          class="modal-textarea"
        ></textarea>
        {#if importStatus}
          <p class="modal-status">{importStatus}</p>
        {/if}
        <div class="modal-actions">
          <button onclick={handleSyncFolders} class="modal-btn secondary">Sync Folders Only</button>
          <div class="modal-actions-right">
            <button onclick={() => { showImportModal = false; importContent = ''; importStatus = ''; }} class="modal-btn secondary">Cancel</button>
            <button onclick={handleImport} class="modal-btn primary">Import</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Settings Modal -->
  {#if showSettingsModal}
    <div class="modal-backdrop" role="dialog" aria-modal="true" onclick={() => showSettingsModal = false} onkeydown={(e) => e.key === 'Escape' && (showSettingsModal = false)}>
      <div class="modal" role="document" onclick={(e) => e.stopPropagation()}>
        <h2 class="modal-title">Settings</h2>

        <h3 class="modal-section-title">Connected Accounts</h3>
        <ul class="settings-list">
          {#each googleAccounts as account}
            <li class="settings-item connected">✓ Google: {account.email}</li>
          {/each}
          {#if xStatus.connected}
            <li class="settings-item connected">✓ X: @{xStatus.username}</li>
          {:else}
            <li class="settings-item">X: Not connected</li>
          {/if}
          {#if notionStatus.connected}
            <li class="settings-item connected">✓ Notion: {notionStatus.botName || 'Connected'}</li>
          {:else}
            <li class="settings-item">Notion: Not connected</li>
          {/if}
        </ul>

        <h3 class="modal-section-title">Destinations</h3>
        {#if $destinations.filter(d => d.type !== 'x' && d.type !== 'google').length === 0}
          <p class="settings-empty">No saved destinations.</p>
        {:else}
          <ul class="settings-list">
            {#each $destinations.filter(d => d.type !== 'x' && d.type !== 'google') as dest}
              <li class="settings-item">
                <span>{dest.name}</span>
                <button
                  onclick={async () => {
                    await api.deleteDestination(dest.id);
                    const data = await api.fetchDestinations();
                    destinations.set(data);
                  }}
                  class="settings-remove"
                >
                  Remove
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="modal-actions">
          <button onclick={() => showSettingsModal = false} class="modal-btn secondary">Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- New Doc Modal -->
  {#if showNewDocModal}
    <div class="modal-backdrop" role="dialog" aria-modal="true" onclick={() => showNewDocModal = false} onkeydown={(e) => e.key === 'Escape' && (showNewDocModal = false)}>
      <div class="modal small" role="document" onclick={(e) => e.stopPropagation()}>
        <h2 class="modal-title">New Google Doc</h2>
        <p class="modal-desc">{$selectedIds.size} tweet{$selectedIds.size === 1 ? '' : 's'} will be added.</p>
        <input
          type="text"
          bind:value={newDocTitle}
          placeholder="Document title..."
          class="modal-input"
          onkeydown={(e) => { if (e.key === 'Enter') createNewDocWithSelected(); }}
        />
        <div class="modal-actions">
          <button onclick={() => { showNewDocModal = false; newDocTitle = ''; }} class="modal-btn secondary">Cancel</button>
          <button
            onclick={createNewDocWithSelected}
            disabled={isCreatingDoc || !newDocTitle.trim()}
            class="modal-btn primary"
          >
            {isCreatingDoc ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- New Folder Input Modal -->
  {#if showNewFolderInput}
    <div class="modal-backdrop" role="dialog" aria-modal="true" onclick={() => showNewFolderInput = false} onkeydown={(e) => e.key === 'Escape' && (showNewFolderInput = false)}>
      <div class="modal small" role="document" onclick={(e) => e.stopPropagation()}>
        <h2 class="modal-title">New Folder</h2>
        <input
          type="text"
          bind:value={newFolderName}
          placeholder="Folder name..."
          class="modal-input"
          onkeydown={(e) => {
            if (e.key === 'Enter' && newFolderName.trim()) {
              moveSelectedToFolder(newFolderName.trim());
              showNewFolderInput = false;
              newFolderName = '';
            }
          }}
        />
        <div class="modal-actions">
          <button onclick={() => { showNewFolderInput = false; newFolderName = ''; }} class="modal-btn secondary">Cancel</button>
          <button
            onclick={() => {
              if (newFolderName.trim()) {
                moveSelectedToFolder(newFolderName.trim());
                showNewFolderInput = false;
                newFolderName = '';
              }
            }}
            class="modal-btn primary"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Status Toast -->
  {#if statusMessage}
    <div class="toast">{statusMessage}</div>
  {/if}
</div>

<style>
  /* ===== CSS Variables ===== */
  :global(:root) {
    --bg-primary: #f8fafc;
    --bg-card: #ffffff;
    --bg-hover: #f1f5f9;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-muted: #94a3b8;
    --accent: #3b82f6;
    --accent-light: #dbeafe;
    --success: #10b981;
    --success-light: #d1fae5;
    --danger: #ef4444;
    --danger-light: #fee2e2;
    --border-light: #e2e8f0;
    --border-medium: #cbd5e1;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
    --shadow-lg: 0 10px 25px rgba(0,0,0,0.1);
  }

  /* ===== Base ===== */
  .app-container {
    min-height: 100vh;
    background: var(--bg-primary);
    padding-bottom: env(safe-area-inset-bottom);
  }

  /* ===== Loading ===== */
  .loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: var(--bg-primary);
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border-light);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    font-size: 14px;
    color: var(--text-muted);
  }

  /* ===== Header ===== */
  .mobile-header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-light);
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top));
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-icon {
    width: 24px;
    height: 24px;
    color: var(--accent);
  }

  .header-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: transparent;
    border: none;
    color: var(--text-secondary);
  }

  .icon-btn svg {
    width: 22px;
    height: 22px;
  }

  /* ===== View Toggle ===== */
  .view-toggle-bar {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-light);
  }

  .view-toggle-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--border-light);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .view-toggle-btn svg {
    width: 18px;
    height: 18px;
  }

  .view-toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  /* ===== Filter Bar ===== */
  .filter-bar {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-light);
  }

  .filter-bar::-webkit-scrollbar {
    display: none;
  }

  .filter-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 14px;
    border-radius: 20px;
    border: 1px solid var(--border-medium);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .filter-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .filter-chevron {
    width: 14px;
    height: 14px;
    transition: transform 0.2s;
  }

  .filter-chevron.open {
    transform: rotate(180deg);
  }

  /* ===== Filter Panel ===== */
  .filter-panel {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-light);
    padding: 16px;
  }

  .filter-section {
    margin-bottom: 16px;
  }

  .filter-section:last-child {
    margin-bottom: 0;
  }

  .filter-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .filter-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-option {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-light);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 13px;
    transition: all 0.2s;
  }

  .filter-option.active {
    background: var(--accent-light);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ===== Context Bar ===== */
  .context-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-size: 13px;
    color: var(--text-muted);
    background: var(--bg-primary);
  }

  .context-count {
    font-weight: 600;
    color: var(--text-primary);
  }

  .context-folder {
    color: var(--accent);
  }

  .context-progress {
    margin-left: auto;
    font-weight: 500;
  }

  /* ===== Main Content ===== */
  .main-content {
    padding-bottom: 100px;
  }

  /* ===== Swipe View ===== */
  .swipe-container {
    padding: 16px;
    min-height: calc(100vh - 280px);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .swipe-card {
    position: relative;
    width: 100%;
    max-width: 400px;
    background: var(--bg-card);
    border-radius: 16px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    touch-action: pan-y;
    user-select: none;
    transition: box-shadow 0.2s;
  }

  .swipe-card.left {
    box-shadow: -8px 0 30px rgba(239, 68, 68, 0.3);
  }

  .swipe-card.right {
    box-shadow: 8px 0 30px rgba(16, 185, 129, 0.3);
  }

  .swipe-indicator {
    position: absolute;
    top: 20px;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1px;
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.2s;
    z-index: 10;
  }

  .swipe-indicator.left {
    right: 20px;
    background: var(--danger-light);
    color: var(--danger);
    border: 2px solid var(--danger);
  }

  .swipe-indicator.right {
    left: 20px;
    background: var(--success-light);
    color: var(--success);
    border: 2px solid var(--success);
  }

  .swipe-indicator.active {
    opacity: 1;
    transform: scale(1);
  }

  .swipe-card-content {
    padding: 20px;
  }

  .swipe-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .swipe-card-header .author {
    font-weight: 600;
    color: var(--text-primary);
  }

  .swipe-card-header .date {
    font-size: 12px;
    color: var(--text-muted);
  }

  .folder-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
    background: var(--bg-hover);
    color: var(--text-secondary);
    margin-bottom: 12px;
  }

  .tweet-text {
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    margin-bottom: 12px;
  }

  /* Media Grid */
  .tweet-media {
    margin-bottom: 12px;
    border-radius: 12px;
    overflow: hidden;
  }

  .tweet-media.media-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px;
  }

  .tweet-image {
    width: 100%;
    max-height: 250px;
    object-fit: cover;
    display: block;
  }

  .tweet-media.media-grid .tweet-image {
    max-height: 150px;
    aspect-ratio: 16/9;
  }

  /* Quoted Tweet Styles */
  .quoted-tweet {
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-hover);
  }

  .quoted-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .quoted-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .quoted-author {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
  }

  .quoted-text {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .quoted-tweet-link {
    display: block;
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-hover);
    text-decoration: none;
  }

  .quoted-tweet-link .quoted-label {
    display: block;
    margin-bottom: 4px;
  }

  .quoted-tweet-link .quoted-url {
    font-size: 13px;
    color: var(--accent);
    word-break: break-all;
  }

  /* Link Preview */
  .tweet-link {
    display: block;
    padding: 12px;
    border-radius: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border-light);
    text-decoration: none;
    margin-bottom: 12px;
  }

  .tweet-link .link-title {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .tweet-link .link-url {
    display: block;
    font-size: 12px;
    color: var(--accent);
  }

  .view-on-x {
    font-size: 13px;
    color: var(--accent);
    text-decoration: none;
  }

  /* ===== Swipe Controls ===== */
  .swipe-controls {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 24px;
  }

  .swipe-btn {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-md);
    transition: all 0.2s;
  }

  .swipe-btn svg {
    width: 28px;
    height: 28px;
  }

  .swipe-btn.discard {
    background: var(--danger-light);
    color: var(--danger);
  }

  .swipe-btn.skip {
    background: var(--bg-card);
    color: var(--text-muted);
    width: 50px;
    height: 50px;
  }

  .swipe-btn.skip svg {
    width: 22px;
    height: 22px;
  }

  .swipe-btn.keep {
    background: var(--success-light);
    color: var(--success);
  }

  .swipe-btn:active {
    transform: scale(0.95);
  }

  /* ===== Route Overlay ===== */
  .route-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 60;
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
  }

  .route-panel {
    width: 100%;
    max-width: 400px;
    max-height: 80vh;
    background: var(--bg-card);
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .route-panel.small {
    max-height: auto;
  }

  .route-panel h3 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .route-section {
    margin-bottom: 16px;
    flex-shrink: 0;
  }

  .route-section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
    margin-top: 8px;
  }

  .route-search-input {
    width: 100%;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 15px;
    margin-bottom: 10px;
  }

  .route-search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .route-searching {
    font-size: 13px;
    color: var(--text-muted);
    padding: 8px 0;
  }

  .route-doc-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 150px;
    overflow-y: auto;
    margin-bottom: 10px;
  }

  .route-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
    max-height: 200px;
    overflow-y: auto;
    flex-shrink: 1;
  }

  .route-btn {
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 15px;
    text-align: left;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .route-btn:active {
    background: var(--bg-hover);
  }

  .route-btn.new-folder,
  .route-btn.new-doc {
    color: var(--accent);
    border-style: dashed;
  }

  .route-btn.instapaper {
    background: #fefce8;
    border-color: #fef08a;
  }

  .route-btn.doc {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .route-panel-actions {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }

  .route-panel-actions button {
    flex: 1;
  }

  .route-confirm {
    padding: 14px;
    border-radius: 12px;
    border: none;
    background: var(--accent);
    color: white;
    font-size: 15px;
    font-weight: 500;
  }

  .route-cancel {
    width: 100%;
    padding: 14px;
    border-radius: 12px;
    border: none;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 15px;
    font-weight: 500;
    flex-shrink: 0;
    margin-top: auto;
  }

  /* ===== List View ===== */
  .list-container {
    padding: 0 16px;
  }

  .search-bar {
    position: relative;
    margin-bottom: 12px;
  }

  .search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    color: var(--text-muted);
  }

  .search-input {
    width: 100%;
    padding: 14px 14px 14px 44px;
    border-radius: 12px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    font-size: 15px;
    color: var(--text-primary);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .selection-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 13px;
  }

  .selection-count {
    font-weight: 600;
    color: var(--text-primary);
  }

  .selection-btn {
    color: var(--accent);
    background: none;
    border: none;
    font-size: 13px;
    font-weight: 500;
  }

  /* ===== Bookmark Cards ===== */
  .bookmark-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bookmark-card {
    background: var(--bg-card);
    border-radius: 12px;
    padding: 14px;
    box-shadow: var(--shadow-sm);
    display: flex;
    gap: 12px;
    transition: all 0.2s;
  }

  .bookmark-card.selected {
    background: var(--accent-light);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .bookmark-checkbox {
    padding-top: 2px;
  }

  .bookmark-checkbox input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }

  .bookmark-content {
    flex: 1;
    min-width: 0;
  }

  .bookmark-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .bookmark-author {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .bookmark-date {
    font-size: 12px;
    color: var(--text-muted);
  }

  .bookmark-folder {
    margin-left: auto;
    padding: 3px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .bookmark-routes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .route-badge {
    padding: 3px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    background: var(--success-light);
    color: #065f46;
  }

  .bookmark-text {
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    margin-bottom: 10px;
  }

  .bookmark-image {
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border-radius: 10px;
    display: block;
  }

  /* Media grid for list view - reuse swipe view styling */
  .bookmark-content .tweet-media {
    margin-bottom: 10px;
    border-radius: 10px;
  }

  .bookmark-content .tweet-media.media-grid .bookmark-image {
    max-height: 120px;
    aspect-ratio: 16/9;
  }

  .bookmark-link {
    display: block;
    padding: 10px;
    border-radius: 8px;
    background: var(--bg-hover);
    border: 1px solid var(--border-light);
    text-decoration: none;
    margin-bottom: 10px;
  }

  .bookmark-link .link-title {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 2px;
  }

  .bookmark-link .link-url {
    display: block;
    font-size: 11px;
    color: var(--accent);
  }

  .bookmark-view-link {
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
  }

  /* ===== Action Bar ===== */
  .action-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-card);
    border-top: 1px solid var(--border-light);
    padding: 12px 16px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 50;
  }

  .action-bar-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .action-count {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .action-btn {
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
  }

  .action-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .action-btn.danger {
    background: var(--danger-light);
    border-color: var(--danger-light);
    color: var(--danger);
  }

  .action-select {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-light);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 13px;
  }

  /* ===== Empty State ===== */
  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 15px;
  }

  /* ===== Modals ===== */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal {
    width: 100%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--bg-card);
    border-radius: 16px;
    padding: 24px;
  }

  .modal.small {
    max-width: 360px;
  }

  .modal-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .modal-desc {
    font-size: 14px;
    color: var(--text-muted);
    margin-bottom: 16px;
  }

  .modal-textarea {
    width: 100%;
    height: 180px;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--border-light);
    background: var(--bg-primary);
    font-size: 12px;
    font-family: monospace;
    resize: none;
    margin-bottom: 12px;
  }

  .modal-input {
    width: 100%;
    padding: 14px;
    border-radius: 10px;
    border: 1px solid var(--border-light);
    font-size: 15px;
    margin-bottom: 16px;
  }

  .modal-status {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }

  .modal-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .modal-actions-right {
    display: flex;
    gap: 10px;
  }

  .modal-btn {
    padding: 12px 20px;
    border-radius: 10px;
    border: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .modal-btn.primary {
    background: var(--accent);
    color: white;
  }

  .modal-btn.secondary {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .modal-btn:disabled {
    opacity: 0.5;
  }

  .modal-section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 10px;
    margin-top: 20px;
  }

  .modal-section-title:first-of-type {
    margin-top: 0;
  }

  .settings-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-item {
    padding: 12px;
    border-radius: 10px;
    font-size: 14px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .settings-item.connected {
    background: var(--success-light);
    color: #065f46;
  }

  .settings-remove {
    font-size: 12px;
    color: var(--danger);
    background: none;
    border: none;
  }

  .settings-empty {
    font-size: 14px;
    color: var(--text-muted);
  }

  /* ===== Toast ===== */
  .toast {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    border-radius: 12px;
    background: var(--success);
    color: white;
    font-size: 14px;
    font-weight: 500;
    box-shadow: var(--shadow-lg);
    z-index: 200;
  }
</style>
