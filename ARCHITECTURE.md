# Bookmark Sort - Architecture Proposal

## Executive Summary

This document outlines the architecture for **Bookmark Sort**, a web application that transforms your Twitter/X bookmark management workflow. The core value proposition: **import once, route anywhere, with intelligent natural language search**.

Your current pain points:
1. ArchivlyX collects bookmarks but routing them elsewhere is manual
2. No way to search bookmarks by meaning/concept rather than exact keywords
3. Sending to Instapaper, Notion, Google Drive requires opening each service
4. Unbookmarking after processing is tedious

The solution: A web app (deployed on Railway) that imports your ArchivlyX exports, embeds them for semantic search, and lets you route them to any destination with a few clicks or automated rules.

---

## System Architecture

### High-Level Design

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Import    │  │    Search    │  │   Bookmark   │  │    Rules      │  │
│  │    Panel    │  │     Bar      │  │    Cards     │  │   Manager     │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         LOCAL STATE LAYER                                 │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Svelte Stores + IndexedDB (for offline capability)                │  │
│  │  ├── bookmarkStore: all loaded bookmarks with embeddings          │  │
│  │  ├── filterStore: current search/filter state                     │  │
│  │  ├── rulesStore: routing rules configuration                      │  │
│  │  └── destinationStore: configured OAuth tokens & endpoints        │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          BACKEND SERVICES                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Import    │  │  Embedding  │  │   Routing   │  │  Destination    │  │
│  │   Service   │  │   Service   │  │   Engine    │  │   Connectors    │  │
│  │             │  │             │  │             │  │                 │  │
│  │ Parse CSV/  │  │ OpenAI or   │  │ Apply rules │  │ ├─ Instapaper   │  │
│  │ JSON from   │  │ Voyage AI   │  │ to bookmark │  │ ├─ Notion       │  │
│  │ ArchivlyX   │  │ embeddings  │  │ corpus      │  │ ├─ Google Drive │  │
│  │             │  │             │  │             │  │ ├─ X Unbookmark │  │
│  │             │  │             │  │             │  │ └─ Local Export │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    SQLite + sqlite-vec                             │  │
│  │  ├── bookmarks table (with vector column for embeddings)          │  │
│  │  ├── routing_rules table                                          │  │
│  │  ├── routing_history table (audit trail)                          │  │
│  │  └── destinations table (OAuth tokens, folder IDs)                │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

**SQLite-Based Design**: The entire bookmark corpus lives in SQLite (persistent volume on Railway). This means:
- You own your data (single-file database, easy to back up)
- Fast search (SQLite + sqlite-vec, no separate vector DB needed)
- Privacy: data stays in your Railway instance, not shared with third parties

**Svelte + Vite Frontend**:
- Smallest bundle size of major frameworks (matters for a "lean, sleek interface")
- No virtual DOM overhead - direct DOM manipulation
- Reactive stores integrate naturally with real-time search
- Vite provides instant HMR during development

**SQLite with sqlite-vec**:
- Single-file database, easy to backup/migrate
- sqlite-vec brings vector similarity search to SQLite
- No need for separate vector database (Pinecone, Weaviate, etc.)
- Handles 100k+ bookmarks efficiently on any laptop

---

## Data Flow

### 1. Import Flow

```
ArchivlyX Export (CSV/JSON)
         │
         ▼
┌─────────────────────────────────────┐
│         Import Service              │
│  1. Parse file format               │
│  2. Deduplicate by tweet_id         │
│  3. Extract URLs from tweet text    │
│  4. Preserve ArchivlyX tags/folders │
│  5. Insert into SQLite              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│        Embedding Service            │
│  1. Batch unembedded bookmarks      │
│  2. Call embedding API              │
│  3. Store vectors in sqlite-vec     │
│  4. Mark as ready for search        │
└─────────────────────────────────────┘
```

**Estimated embedding cost for 800 bookmarks**:
- Average tweet: ~50 tokens
- 800 tweets × 50 tokens = 40,000 tokens
- OpenAI text-embedding-3-small: 40,000 / 1M × $0.02 = **$0.0008** (less than 1 cent)
- Even with 10,000 bookmarks: ~$0.01

### 2. Search Flow

```
User types: "recipes with chicken"
         │
         ▼
┌─────────────────────────────────────┐
│        Search Pipeline              │
│  1. Embed query string              │
│  2. Vector similarity search        │  ◄── sqlite-vec KNN query
│  3. Optional: keyword filter (AND)  │
│  4. Optional: tag/folder filter     │
│  5. Return ranked results           │
└─────────────────────────────────────┘
         │
         ▼
Display bookmark cards sorted by relevance
```

The magic here: "recipes with chicken" finds tweets about chicken recipes even if the tweet says "dinner idea: lemon herb grilled poultry" because the embeddings capture semantic meaning.

### 3. Routing Flow

```
User selects bookmarks → clicks "Send to..."
         │
         ▼
┌─────────────────────────────────────┐
│        Routing Engine               │
│  1. Determine destination type      │
│  2. Transform content as needed     │
│  3. Call destination connector      │
│  4. Log success/failure             │
│  5. Optionally unbookmark on X      │
└─────────────────────────────────────┘
         │
         ├── Instapaper: POST URL to Simple API
         ├── Notion: Create page with tweet content
         ├── Google Drive: Generate PDF → upload
         ├── Local: Export as JSON/Markdown
         └── X Unbookmark: DELETE API call
```

---

## User Interface Design

### Core Principles

1. **One-screen workflow**: Everything visible without page navigation
2. **Bulk operations first**: Select many, act once
3. **Keyboard-friendly**: Power users shouldn't need mouse
4. **Progressive disclosure**: Simple by default, power features accessible

### Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [Logo] Bookmark Sort                            [@rsanti97] [Settings ⚙]  │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 🔍 Search bookmarks...                          [Import ▼] [Rules ▼] │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  Filters: [All ▼] [Unrouted ▼] [Tag: recipes ×] [Folder: Tech ×]          │
│                                                                            │
│  ─────────────────────────────────────────────────────────────────────────│
│  □ Select All (247 shown)                              [Send to... ▼]     │
│  ─────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ □  @chefjohnsmith · 2h ago                                    [⋮]  │   │
│  │    Amazing lemon herb chicken recipe that takes only 20 minutes!   │   │
│  │    https://t.co/abc123                                             │   │
│  │    ┌─────────────────────────────────────────────────────────┐     │   │
│  │    │ [thumbnail of recipe image]                             │     │   │
│  │    └─────────────────────────────────────────────────────────┘     │   │
│  │    Tags: #recipes #cooking     Folder: Food                        │   │
│  │    ────────────────────────────────────────────────────────────    │   │
│  │    [📖 Instapaper] [📝 Notion] [📁 Drive] [🗑 Unbookmark]          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ □  @techwriter · 5h ago                                       [⋮]  │   │
│  │    Thread on the future of AI in journalism...                     │   │
│  │    [1/12] 🧵                                                       │   │
│  │    Tags: #ai #journalism     Folder: Tech                          │   │
│  │    ────────────────────────────────────────────────────────────    │   │
│  │    [📖 Instapaper] [📝 Notion] [📁 Drive] [🗑 Unbookmark]          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  [Load more...]                                                           │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  247 bookmarks · 189 unrouted · Last import: 2 hours ago                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Key Interactions

**Natural Language Search**:
- Type anything: "articles about immigration policy"
- Results ranked by semantic similarity
- Combine with filters: search "recipes" + filter by tag "italian"

**Quick Actions** (per bookmark):
- Single-click icons for each destination
- Hover shows destination name
- Success feedback: icon turns green checkmark

**Bulk Operations**:
- Checkbox selection (Shift+click for range)
- "Send to..." dropdown for selected items
- Progress indicator for batch operations

**Keyboard Shortcuts**:
- `/` - Focus search
- `j/k` - Navigate up/down
- `x` - Toggle selection
- `i` - Send to Instapaper
- `n` - Send to Notion
- `d` - Send to Drive
- `u` - Unbookmark

---

## Destination Connectors

### 1. Instapaper

**API**: Simple API (no subscription required for adding)
- Endpoint: `https://www.instapaper.com/api/add`
- Auth: HTTP Basic with username/password (or OAuth for Full API)
- Payload: `url`, `title` (optional), `selection` (optional)

**What we send**: The URL extracted from the tweet (if present). If tweet has no URL, we send the tweet permalink.

**Implementation**:
```typescript
async function sendToInstapaper(bookmark: Bookmark, credentials: InstapaperCreds) {
  const url = bookmark.urls[0] || `https://twitter.com/i/status/${bookmark.tweet_id}`;
  const response = await fetch('https://www.instapaper.com/api/add', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
    },
    body: new URLSearchParams({
      url,
      title: `${bookmark.author_handle}: ${bookmark.text.slice(0, 50)}...`,
      selection: bookmark.text
    })
  });
  return response.status === 201;
}
```

### 2. Notion

**API**: REST API with integration token
- Requires: Creating a Notion integration and sharing target pages/databases
- Creates: New page in specified database or as child of page

**What we send**: Tweet content formatted as blocks (paragraph, embedded links, images)

**Implementation**:
```typescript
async function sendToNotion(bookmark: Bookmark, config: NotionConfig) {
  const response = await notion.pages.create({
    parent: { database_id: config.database_id },
    properties: {
      'Name': { title: [{ text: { content: bookmark.text.slice(0, 100) } }] },
      'Author': { rich_text: [{ text: { content: bookmark.author_handle } }] },
      'URL': { url: `https://twitter.com/i/status/${bookmark.tweet_id}` },
      'Tags': { multi_select: bookmark.tags.map(t => ({ name: t })) },
      'Date': { date: { start: bookmark.created_at.toISOString() } }
    },
    children: [
      {
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: bookmark.text } }] }
      },
      ...bookmark.urls.map(url => ({
        type: 'bookmark',
        bookmark: { url }
      }))
    ]
  });
  return response.id;
}
```

### 3. Google Drive (PDF Export)

**API**: Drive API v3 + Puppeteer for PDF generation
- Requires: OAuth consent + Drive scope
- Creates: PDF file in specified folder

**Use case**: Recipes! A URL like a recipe blog post gets:
1. Rendered by Puppeteer (headless Chrome)
2. Printed to PDF
3. Uploaded to Google Drive folder

**Implementation**:
```typescript
async function sendToGoogleDrive(bookmark: Bookmark, config: DriveConfig) {
  // 1. Generate PDF from URL
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(bookmark.urls[0], { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();

  // 2. Upload to Drive
  const drive = google.drive({ version: 'v3', auth: config.oauth2Client });
  const response = await drive.files.create({
    requestBody: {
      name: `${bookmark.author_handle}_${bookmark.tweet_id}.pdf`,
      parents: [config.folder_id]
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(pdfBuffer)
    }
  });
  return response.data.id;
}
```

### 4. X/Twitter Unbookmark

**API**: X API v2 DELETE endpoint
- Requires: OAuth 2.0 PKCE flow, `bookmark.write` scope
- Rate limit: 50 requests per 15 minutes

**Important**: This is where ArchivlyX's value comes in. They have OAuth set up. We need to:
- Either get our own X API access (Basic tier: $200/mo or usage-based)
- Or use ArchivlyX's unbookmark feature via their extension

**Recommended approach**: Focus on the unbookmark-via-ArchivlyX workflow initially. Your ArchivlyX subscription already has this capability. We can add direct X API integration as a future enhancement.

**If implementing directly**:
```typescript
async function unbookmarkOnX(bookmark: Bookmark, xAuth: XAuthConfig) {
  const response = await fetch(
    `https://api.x.com/2/users/${xAuth.user_id}/bookmarks/${bookmark.tweet_id}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${xAuth.access_token}`
      }
    }
  );
  return response.status === 200;
}
```

### 5. Local Export

**Options**: JSON, Markdown, or HTML
- No API needed
- User specifies output directory
- Useful for backup or moving to other systems

---

## Routing Rules Engine

Allow users to define rules that automatically route bookmarks based on conditions.

### Rule Examples

```yaml
# Auto-send recipe links to Google Drive
- name: "Recipes to Drive"
  conditions:
    - field: tag
      operator: contains
      value: "recipes"
    - field: url_domain
      operator: matches
      value: "*.seriouseats.com|*.bonappetit.com|*.nytimes.com/cooking"
  destination:
    type: gdrive
    folder_id: "1abc..."
  auto_apply: true

# Send long-form articles to Instapaper
- name: "Articles to Read Later"
  conditions:
    - field: url_domain
      operator: not_equals
      value: "twitter.com"
  destination:
    type: instapaper
  auto_apply: false  # Manual trigger via button

# Research threads to Notion
- name: "Research to Notion"
  conditions:
    - field: semantic_query
      operator: similar_to
      value: "academic research, papers, studies, data analysis"
      threshold: 0.7
  destination:
    type: notion
    database_id: "..."
  auto_apply: true
```

### Rule Processing

```
On Import:
  for each bookmark:
    for each rule (sorted by priority):
      if all conditions match:
        if auto_apply:
          queue routing action
        else:
          tag bookmark with suggested rule

On Manual Trigger:
  apply selected rule to selected bookmarks
  respect rate limits via queue
```

---

## Database Schema

```sql
-- Core bookmark storage
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  author_handle TEXT NOT NULL,
  author_name TEXT,
  text TEXT NOT NULL,
  urls TEXT,  -- JSON array
  media_urls TEXT,  -- JSON array
  created_at DATETIME,
  bookmarked_at DATETIME,
  imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  tags TEXT,  -- JSON array (from ArchivlyX)
  archivly_folder TEXT,
  status TEXT DEFAULT 'pending',  -- pending, routed, archived
  embedding BLOB  -- Float32 vector, 1536 dimensions
);

-- Vector index for semantic search
CREATE VIRTUAL TABLE bookmark_vectors USING vec0(
  bookmark_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Routing rules
CREATE TABLE routing_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  conditions TEXT NOT NULL,  -- JSON
  destination TEXT NOT NULL,  -- JSON
  auto_apply INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Routing history (audit log)
CREATE TABLE routing_history (
  id TEXT PRIMARY KEY,
  bookmark_id TEXT NOT NULL,
  rule_id TEXT,
  destination_type TEXT NOT NULL,
  destination_id TEXT,
  status TEXT NOT NULL,  -- queued, success, failed
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id)
);

-- OAuth tokens and destination configs
CREATE TABLE destinations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- instapaper, notion, gdrive, x
  name TEXT NOT NULL,  -- User-friendly name
  config TEXT NOT NULL,  -- JSON (encrypted tokens, folder IDs, etc.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Implementation Phases

### Phase 1: Core Foundation (MVP)
**Goal**: Import, search, manual routing to Instapaper

1. Set up Svelte + Vite project structure
2. Implement CSV/JSON import parser for ArchivlyX
3. SQLite database with basic bookmark schema
4. OpenAI embedding integration (batch processing)
5. sqlite-vec setup for vector search
6. Basic UI: import, search, list view
7. Instapaper Simple API connector
8. Local JSON export

**Deliverable**: Working app that imports bookmarks, searches semantically, and sends to Instapaper.

### Phase 2: Additional Destinations
**Goal**: Full routing capability

1. Notion API integration (OAuth flow)
2. Google Drive integration (OAuth + PDF generation)
3. Destination configuration UI (manage tokens, folders)
4. Bulk selection and routing UI

**Deliverable**: Route to any destination with a few clicks.

### Phase 3: Automation & Polish
**Goal**: Rules engine and production quality

1. Routing rules engine
2. Rules management UI
3. Keyboard shortcuts
4. Rate limit handling (queue system)
5. Error handling and retry logic
6. Settings/preferences persistence

**Deliverable**: Automated workflows, power-user features.

### Phase 4: X Integration (Optional)
**Goal**: Direct unbookmarking without ArchivlyX

1. X API OAuth 2.0 PKCE flow
2. Unbookmark endpoint integration
3. Optional: Direct bookmark sync (bypass ArchivlyX)

**Note**: This phase is optional because:
- X API costs money ($200/mo or usage-based)
- ArchivlyX already provides this functionality
- May not be worth the cost for a personal tool

---

## Cost Analysis

### One-Time Setup
- Railway deployment (free tier or ~$5/month for persistent volume)

### Recurring Costs

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| OpenAI Embeddings | 800 tweets/month × 50 tokens | ~$0.01 |
| OpenAI Embeddings | 10,000 tweets/month × 50 tokens | ~$0.10 |
| X API (if direct) | Basic tier | $200 |
| X API (if direct) | Usage-based (50 unbookmarks/day) | ~$5-10 |

**Recommendation**: Skip direct X API integration initially. Use ArchivlyX's built-in unbookmark feature, which you're already paying for. The embedding costs are negligible.

---

## Security Considerations

1. **OAuth tokens**: Store encrypted in SQLite, never log
2. **API keys**: Environment variables (Railway dashboard), not hardcoded
3. **Data isolation**: Tweets stay in your Railway instance
4. **No telemetry**: This is a personal tool, no analytics
5. **HTTPS**: Provided by Railway in production; use ngrok for local dev

---

## Decisions Made

1. **Embedding provider**: OpenAI text-embedding-3-small
2. **X API**: Skip direct integration - use ArchivlyX's unbookmark feature
3. **Recipe handling**: Full PDF render via Puppeteer (Option B)
4. **Notion**: Append to existing pages (e.g., "Gifts to give people", "Homeschooling ideas")
5. **Google**: Two modes:
   - **PDF to Drive folders**: For recipes and articles
   - **Append to Google Docs**: For adding content to existing docs
6. **Priority**: Instapaper → Google Drive/Docs → Notion

---

## Revised Destination Architecture

### Google Integration (Two Modes)

**Mode 1: PDF Upload to Drive Folder**
- Use case: Recipes, articles you want to preserve as-is
- Flow: URL → Puppeteer render → PDF → Upload to folder
- API: Google Drive API v3

**Mode 2: Append to Google Doc**
- Use case: Collecting ideas into running documents
- Flow: Tweet content → Append as new section in existing Doc
- API: Google Docs API v1
- Format: Heading (author + date) + paragraph (tweet text) + links

```typescript
async function appendToGoogleDoc(bookmark: Bookmark, config: DocConfig) {
  const docs = google.docs({ version: 'v1', auth: config.oauth2Client });

  // Get current doc length to know where to insert
  const doc = await docs.documents.get({ documentId: config.doc_id });
  const endIndex = doc.data.body.content.slice(-1)[0].endIndex - 1;

  await docs.documents.batchUpdate({
    documentId: config.doc_id,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: endIndex },
            text: `\n\n---\n@${bookmark.author_handle} · ${bookmark.created_at.toLocaleDateString()}\n${bookmark.text}\n${bookmark.urls.join('\n')}`
          }
        }
      ]
    }
  });
}
```

### Notion Integration (Append to Pages)

Instead of creating new pages in a database, append content blocks to existing pages:

```typescript
async function appendToNotionPage(bookmark: Bookmark, config: NotionPageConfig) {
  await notion.blocks.children.append({
    block_id: config.page_id,
    children: [
      {
        type: 'divider',
        divider: {}
      },
      {
        type: 'heading_3',
        heading_3: {
          rich_text: [{ text: { content: `@${bookmark.author_handle} · ${bookmark.created_at.toLocaleDateString()}` } }]
        }
      },
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: bookmark.text } }]
        }
      },
      ...bookmark.urls.map(url => ({
        type: 'bookmark' as const,
        bookmark: { url }
      }))
    ]
  });
}
```

---

## Destination Configuration UI

Since you have multiple docs/pages to route to, the UI needs a "Destinations" settings panel:

```
┌─────────────────────────────────────────────────────────────────┐
│  Destinations                                         [+ Add]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INSTAPAPER                                                     │
│  └─ Default (rsanti97@...)                              [Edit] │
│                                                                 │
│  GOOGLE DRIVE (PDF)                                             │
│  ├─ Recipes Folder                                      [Edit] │
│  └─ Articles Folder                                     [Edit] │
│                                                                 │
│  GOOGLE DOCS (Append)                                           │
│  ├─ Gift Ideas                                          [Edit] │
│  └─ Research Notes                                      [Edit] │
│                                                                 │
│  NOTION PAGES                                                   │
│  ├─ Gifts to give people                                [Edit] │
│  └─ Homeschooling ideas                                 [Edit] │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

When routing, user picks from their configured destinations:

```
[Send to...] → Instapaper
              → Google Drive: Recipes Folder
              → Google Drive: Articles Folder
              → Google Doc: Gift Ideas
              → Notion: Gifts to give people
              → Notion: Homeschooling ideas
```
