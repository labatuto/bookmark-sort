const API_BASE = 'http://localhost:3001/api';

// Bookmarks
export async function fetchBookmarks() {
  const res = await fetch(`${API_BASE}/bookmarks`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateBookmarkStatus(id: string, status: 'pending' | 'routed' | 'archived') {
  const res = await fetch(`${API_BASE}/bookmarks/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Import
export async function importBookmarks(content: string) {
  const res = await fetch(`${API_BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Sync folders only (no re-adding deleted tweets)
export async function syncFolders(content: string) {
  const res = await fetch(`${API_BASE}/sync-folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Search
export async function searchBookmarks(query: string, limit = 50) {
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Embeddings
export async function generateEmbeddings() {
  const res = await fetch(`${API_BASE}/embeddings/generate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Destinations
export async function fetchDestinations() {
  const res = await fetch(`${API_BASE}/destinations`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createDestination(type: string, name: string, config: Record<string, string>) {
  const res = await fetch(`${API_BASE}/destinations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name, config }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteDestination(id: string) {
  const res = await fetch(`${API_BASE}/destinations/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function testInstapaperCredentials(username: string, password: string) {
  const res = await fetch(`${API_BASE}/destinations/test/instapaper`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Routing
export async function routeBookmark(bookmarkId: string, destinationId: string) {
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmark_id: bookmarkId, destination_id: destinationId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function routeBookmarksBulk(bookmarkIds: string[], destinationId: string) {
  const res = await fetch(`${API_BASE}/route/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmark_ids: bookmarkIds, destination_id: destinationId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Google Drive
export async function fetchGoogleAccounts() {
  const res = await fetch(`${API_BASE}/google/accounts`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listGoogleFolder(folderUrl: string, destinationId: string) {
  const res = await fetch(`${API_BASE}/google/list-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder_url: folderUrl, destination_id: destinationId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addGoogleDocDestination(googleAccountId: string, docId: string, docName: string) {
  const res = await fetch(`${API_BASE}/google/add-doc-destination`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_account_id: googleAccountId, doc_id: docId, doc_name: docName }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function searchGoogleDocs(query: string, googleAccountId: string) {
  const res = await fetch(`${API_BASE}/google/search-docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, google_account_id: googleAccountId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendToGoogleDoc(
  bookmarkIds: string[],
  docId: string,
  docName: string,
  googleAccountId: string
) {
  const res = await fetch(`${API_BASE}/google/send-to-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookmark_ids: bookmarkIds,
      doc_id: docId,
      doc_name: docName,
      google_account_id: googleAccountId,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createDocWithTweets(
  bookmarkIds: string[],
  docTitle: string,
  googleAccountId: string
) {
  const res = await fetch(`${API_BASE}/google/create-doc-with-tweets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookmark_ids: bookmarkIds,
      doc_title: docTitle,
      google_account_id: googleAccountId,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// X/Twitter
export async function fetchXStatus() {
  const res = await fetch(`${API_BASE}/x/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchXAccounts() {
  const res = await fetch(`${API_BASE}/x/accounts`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startXAuth() {
  const res = await fetch(`${API_BASE}/x/auth/start`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function unbookmarkFromX(bookmarkId: string) {
  const res = await fetch(`${API_BASE}/x/unbookmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmark_id: bookmarkId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function unbookmarkFromXBulk(bookmarkIds: string[]) {
  const res = await fetch(`${API_BASE}/x/unbookmark/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmark_ids: bookmarkIds }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Notion
export async function fetchNotionStatus() {
  const res = await fetch(`${API_BASE}/notion/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function searchNotionPages(query: string) {
  const res = await fetch(`${API_BASE}/notion/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendToNotionPage(bookmarkIds: string[], pageId: string, pageTitle: string) {
  const res = await fetch(`${API_BASE}/notion/send-to-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookmark_ids: bookmarkIds,
      page_id: pageId,
      page_title: pageTitle,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Folder management
export async function moveToFolder(bookmarkIds: string[], folder: string | null) {
  const res = await fetch(`${API_BASE}/bookmarks/move-to-folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarkIds, folder }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Delete bookmarks
export async function deleteBookmarks(bookmarkIds: string[], alsoUnbookmark: boolean = false) {
  const res = await fetch(`${API_BASE}/bookmarks/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarkIds, alsoUnbookmark }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
