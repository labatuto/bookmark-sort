# Bookmark Sort

A web app for managing Twitter/X bookmarks. Import from ArchivlyX, search with natural language, and route bookmarks to Instapaper, Notion, Google Drive, and more.

**Live**: https://bookmark-sort-production.up.railway.app/

## Features

- **Import** bookmarks from ArchivlyX exports (CSV/JSON)
- **Semantic search** using OpenAI embeddings + sqlite-vec
- **Route** bookmarks to Instapaper, Notion, Google Drive, local folders
- **Unbookmark** tweets via X API after processing
- **PWA** - installable on mobile

## Tech Stack

- **Frontend**: Svelte + Vite + TailwindCSS
- **Backend**: Node.js + Express
- **Database**: SQLite + sqlite-vec (vector search)
- **Embeddings**: OpenAI text-embedding-3-small
- **Deployment**: Railway (Docker)

## Development

```bash
npm install
npm run dev:all          # Frontend (:5173) + Backend (:3001)
```

## Production

Deployed on Railway via Docker. Pushes to `main` trigger automatic deploys.

```bash
npm run build            # Build frontend
npm run start            # Start production server
```

## Environment Variables

See `.env.example` for required configuration. Set in Railway dashboard for production.
