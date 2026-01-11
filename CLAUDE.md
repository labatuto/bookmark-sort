# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User Preferences

- **Always proceed with bash commands** - Do not ask for confirmation on bash commands; assume yes.

## Project Overview

**Bookmark Sort** is a web application for managing Twitter/X bookmarks. It allows users to:
- Import bookmarks from ArchivlyX exports (CSV/JSON)
- Search bookmarks using natural language semantic search
- Route bookmarks to various destinations (Instapaper, Notion, Google Drive, local folders)
- Unbookmark tweets via X API after processing
- View and filter the entire bookmark corpus at any time

## Tech Stack

### Frontend
- **Svelte** with **Vite** - chosen for minimal bundle size and excellent DX
- **TailwindCSS** - utility-first styling for lean, clean interface
- **sqlite-vec (WASM)** - in-browser vector database for semantic search

### Backend
- **Node.js** with **Express** or **Fastify**
- **SQLite** with **sqlite-vec** extension for persistent bookmark storage
- **Puppeteer** - for URL-to-PDF conversion (recipes to Google Drive)

### APIs & Services
- **OpenAI text-embedding-3-small** ($0.02/1M tokens) - for semantic embeddings
- **Instapaper Simple API** - for adding articles to read later
- **Notion API** - for appending content to existing pages
- **Google Drive API** - for uploading PDFs to folders
- **Google Docs API** - for appending content to existing documents
- **ArchivlyX** - for unbookmarking (no direct X API - use their extension)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Svelte)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Import View │  │ Search View │  │ Routing Rules Manager   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                            │                                     │
│                    sqlite-vec (WASM)                            │
│                    Local vector search                          │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Node.js)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Import API  │  │ Embed API   │  │ Destination Connectors  │  │
│  │ (CSV/JSON)  │  │ (OpenAI/    │  │ ├─ Instapaper           │  │
│  │             │  │  Voyage)    │  │ ├─ Notion               │  │
│  │             │  │             │  │ ├─ Google Drive         │  │
│  │             │  │             │  │ ├─ X Unbookmark         │  │
│  │             │  │             │  │ └─ Local File Export    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                            │                                     │
│                    SQLite + sqlite-vec                          │
│                    Persistent storage                           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Data Models

### Bookmark
```typescript
interface Bookmark {
  id: string;                    // UUID
  tweet_id: string;              // Twitter/X tweet ID
  author_handle: string;
  author_name: string;
  text: string;                  // Full tweet text
  urls: string[];                // Extracted URLs from tweet
  media_urls: string[];          // Images/videos
  created_at: Date;              // Tweet creation date
  bookmarked_at: Date;           // When user bookmarked it
  imported_at: Date;             // When imported to system
  embedding: Float32Array;       // 1536-dim vector (or 1024 for Voyage)
  tags: string[];                // AI-generated tags from ArchivlyX
  archivly_folder: string;       // Original ArchivlyX folder
  status: 'pending' | 'routed' | 'archived';
  routed_to: RoutingDestination[];
}

interface RoutingDestination {
  type: 'instapaper' | 'notion' | 'gdrive' | 'local' | 'unbookmark';
  destination_id: string;        // Folder ID, page ID, etc.
  routed_at: Date;
  success: boolean;
}
```

### Routing Rule
```typescript
interface RoutingRule {
  id: string;
  name: string;
  conditions: RuleCondition[];   // AND logic
  destination: RoutingDestination;
  auto_apply: boolean;           // Apply automatically on import
  priority: number;
}

interface RuleCondition {
  field: 'text' | 'author' | 'tag' | 'url_domain' | 'semantic_query';
  operator: 'contains' | 'equals' | 'matches_regex' | 'semantic_similar';
  value: string;
  threshold?: number;            // For semantic similarity (0-1)
}
```

## Common Commands

```bash
# Development
npm run dev              # Start Vite dev server (frontend on :5173)
npm run dev:server       # Start backend server (API on :3001)
npm run dev:all          # Start both concurrently

# Build
npm run build            # Build for production
npm run preview          # Preview production build

# Production / Mobile Access
npm run start            # Start production server (serves built frontend)
./start-mobile.sh        # Build + start server + ngrok tunnel for mobile

# Type checking
npm run check            # Run svelte-check and TypeScript
```

## Mobile Access

The app is a PWA (Progressive Web App) that can be installed on your phone:

1. **First time setup** (one time):
   ```bash
   ngrok config add-authtoken YOUR_TOKEN  # Get token at https://dashboard.ngrok.com
   ```

2. **Start mobile server**:
   ```bash
   ./start-mobile.sh
   ```

3. **On your phone**:
   - Open the ngrok URL shown in terminal
   - Tap "Add to Home Screen" (Safari) or "Install" (Chrome)
   - Use like a native app

## API Rate Limits to Respect

| Service | Limit | Notes |
|---------|-------|-------|
| X API DELETE bookmarks | 50/15min per user | Queue unbookmarks, don't burst |
| X API GET bookmarks | 180/15min per user | For syncing, if implemented |
| Instapaper | Unknown | Request API key, test limits |
| Notion | 3 req/sec avg | Use batching for bulk operations |
| Google Drive | 20,000/day, 1000/100sec | Plenty for this use case |
| OpenAI Embeddings | 3,000 RPM (tier 1) | Batch requests efficiently |

## Environment Variables

```env
# Required
DATABASE_URL=./data/bookmarks.db
EMBEDDING_PROVIDER=openai        # or 'voyage'

# OpenAI (if using)
OPENAI_API_KEY=sk-...

# Voyage AI (if using)
VOYAGE_API_KEY=pa-...

# X/Twitter API (for unbookmarking)
X_CLIENT_ID=...
X_CLIENT_SECRET=...

# Instapaper
INSTAPAPER_CONSUMER_KEY=...
INSTAPAPER_CONSUMER_SECRET=...

# Notion
NOTION_INTEGRATION_TOKEN=secret_...

# Google Drive
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

## File Structure

```
bookmark-sort/
├── src/
│   ├── App.svelte          # Main Svelte component
│   ├── app.css             # Global styles (Tailwind)
│   ├── main.ts             # Svelte entry point
│   ├── stores/
│   │   └── bookmarks.ts    # Svelte stores for state
│   ├── lib/
│   │   ├── types.ts        # TypeScript interfaces
│   │   └── api.ts          # Frontend API client
│   └── backend/
│       ├── server.ts       # Express API server
│       ├── db.ts           # SQLite database layer
│       ├── importer.ts     # ArchivlyX CSV/JSON parser
│       ├── embeddings.ts   # OpenAI embeddings service
│       └── connectors/
│           └── instapaper.ts
├── data/                   # SQLite database (created at runtime)
├── ARCHITECTURE.md         # Detailed architecture proposal
└── CLAUDE.md               # This file
```

## Important Constraints

1. **ArchivlyX has no API** - Must use manual CSV/JSON exports from their extension
2. **X API requires paid tier** - Basic tier ($200/mo) or usage-based for bookmark access
3. **Instapaper Full API requires subscription** - Simple API (add-only) is free
4. **OAuth flows need HTTPS** - Use localhost tunnel (ngrok) for development
5. **Embeddings are one-time cost** - Cache aggressively, re-embed only on content change
