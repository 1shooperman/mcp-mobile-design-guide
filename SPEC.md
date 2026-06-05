## Overview

MCP server (stdio, Claude Code registered) backed by a sqlite-vec vector database. Stores chunked design guidelines from Apple HIG, Android Material Design, and per-app bespoke style guides. Exposes semantic search and lookup tools to Claude Code agents.

## Data Sources

| Source | Type | Scope |
|---|---|---|
| Apple HIG | crawled markdown | `platform=ios` |
| Android Design | crawled markdown | `platform=android` |
| Per-app style guide | ingested via script | `platform=custom`, `app_id=<name>` |

Crawled pages are cached as markdown under `.cache/{apple,android}/hig/` with an `index.json` slug→url map. Bespoke guides are drop-in markdown files ingested on demand.

## MCP Tools

```ts
search_guidelines(query: string, platform?: "ios" | "android" | "custom", app_id?: string, top_k?: number): string
list_topics(platform?: string, app_id?: string): string
get_guideline(slug: string): string
```

- `search_guidelines` — semantic search, optional platform/app filter, returns top_k chunks with metadata
- `list_topics` — returns distinct source slugs in the DB, optionally filtered
- `get_guideline` — returns all chunks for a specific slug (direct lookup, no embedding)

## Architecture

**Runtime:** TypeScript, FastMCP (stdio transport)  
**Vector DB:** sqlite-vec (same pattern as `~/workspace/mastermind-council/rag`)  
**Embeddings:** Voyage AI, `voyage-4`, `input_type="document"` on ingest / `"query"` on search  
**Embedding dim:** 1024

### DB Schema

```sql
CREATE TABLE chunks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL,        -- slug, e.g. "ios/buttons"
  platform  TEXT NOT NULL,        -- "ios" | "android" | "custom"
  app_id    TEXT,                 -- null for ios/android, app name for custom
  content   TEXT NOT NULL,
  content_hash TEXT NOT NULL,     -- sha256 of content, used for delta upsert
  metadata  TEXT NOT NULL         -- JSON: { url, section, chunk_i }
);
CREATE INDEX idx_chunks_platform ON chunks(platform);
CREATE INDEX idx_chunks_app ON chunks(app_id);
CREATE INDEX idx_chunks_source ON chunks(source);

CREATE VIRTUAL TABLE vec_items USING vec0(embedding float[1024]);
```

### Chunking

Split each crawled page on `##` headers. If a section exceeds 1800 chars, sub-split with 50-char overlap. Minimum chunk size: 100 chars. One chunk = one vector row.

### Ingestion & Delta Upsert

On each ingest run:
1. For each chunk, compute `sha256(content)`.
2. If `(source, content_hash)` already exists → skip (no re-embed).
3. If source exists but hash differs → delete old chunk + vec row, insert new.
4. If new → insert chunk + embed + insert vec row.

This avoids re-embedding unchanged content. Full re-ingest is a wipe + re-run.

Voyage rate-limit backoff: same pattern as reference (batch size 8, RPM delay, exponential backoff on `RateLimitError`).

## Scripts

```
scripts/
  crawl_apple.py      # already written, caches to .cache/apple/hig/
  crawl_android.py    # already written, caches to .cache/android/hig/
  ingest.ts           # ingest cached markdown + bespoke guides into DB
```

`ingest.ts` flags:
- `--platform ios|android` — ingest from cache
- `--custom <path> --app-id <name>` — ingest a bespoke markdown file

## Project Layout

```
.
├── .cache/
│   ├── apple/hig/        # crawled HIG markdown + index.json
│   └── android/hig/      # crawled Android markdown + index.json
├── data/
│   └── guidelines.db     # sqlite-vec DB
├── scripts/
│   ├── crawl_apple.py
│   └── crawl_android.py
├── src/
│   ├── server.ts         # MCP server, tool definitions
│   ├── db.ts             # DB open, schema init, query helpers
│   ├── ingest.ts         # ingestion CLI
│   └── embed.ts          # Voyage client wrapper with backoff
├── __tests__/
│   └── fixtures/         # stub chunks for unit tests
├── .env                  # VOYAGE_API_KEY
├── config.json
└── package.json
```

## Environment

```
VOYAGE_API_KEY=...
DB_PATH=./data/guidelines.db   # override for tests
```
