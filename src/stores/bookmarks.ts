import { writable, derived } from 'svelte/store';
import type { Bookmark, SearchResult, Destination } from '../lib/types';

// All bookmarks loaded from database
export const bookmarks = writable<Bookmark[]>([]);

// Current search query
export const searchQuery = writable<string>('');

// Search results (when searching)
export const searchResults = writable<SearchResult[]>([]);

// Is currently searching
export const isSearching = writable<boolean>(false);

// Selected bookmark IDs for bulk operations
export const selectedIds = writable<Set<string>>(new Set());

// Filter state
export const filters = writable<{
  status: 'all' | 'pending' | 'routed' | 'archived';
  folder: string | null;
  tag: string | null;
}>({
  status: 'all',
  folder: null,
  tag: null,
});

// Configured destinations
export const destinations = writable<Destination[]>([]);

// Derived: filtered bookmarks (when not searching)
export const filteredBookmarks = derived(
  [bookmarks, filters, searchQuery, searchResults],
  ([$bookmarks, $filters, $searchQuery, $searchResults]) => {
    // If there's a search query, use search results
    if ($searchQuery.trim()) {
      return $searchResults;
    }

    // Otherwise filter the bookmarks
    let result = $bookmarks;

    if ($filters.status !== 'all') {
      result = result.filter(b => b.status === $filters.status);
    }

    if ($filters.folder) {
      result = result.filter(b => b.archivly_folder === $filters.folder);
    }

    if ($filters.tag) {
      const tag = $filters.tag;
      result = result.filter(b => b.tags.includes(tag));
    }

    return result;
  }
);

// Derived: unique folders from bookmarks
export const folders = derived(bookmarks, ($bookmarks) => {
  const folderSet = new Set<string>();
  $bookmarks.forEach(b => {
    if (b.archivly_folder) folderSet.add(b.archivly_folder);
  });
  return Array.from(folderSet).sort();
});

// Derived: unique tags from bookmarks
export const allTags = derived(bookmarks, ($bookmarks) => {
  const tagSet = new Set<string>();
  $bookmarks.forEach(b => {
    b.tags.forEach(t => tagSet.add(t));
  });
  return Array.from(tagSet).sort();
});

// Derived: stats
export const stats = derived(bookmarks, ($bookmarks) => ({
  total: $bookmarks.length,
  pending: $bookmarks.filter(b => b.status === 'pending').length,
  routed: $bookmarks.filter(b => b.status === 'routed').length,
  archived: $bookmarks.filter(b => b.status === 'archived').length,
}));
