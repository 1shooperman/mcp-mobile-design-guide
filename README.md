# mcp-mobile-design-guide

MCP server (stdio) backed by a sqlite-vec vector database. Stores chunked mobile design guidelines from Apple HIG, Android Material Design, and per-app bespoke style guides. Exposes semantic search and lookup tools to Claude Code agents.

## Setup

```bash
# TypeScript deps
npm install

# Python deps (crawlers)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Env
cp .env.example .env   # set VOYAGE_API_KEY
```

## Usage

### Crawl design docs

```bash
.venv/bin/python scripts/crawl_apple.py
.venv/bin/python scripts/crawl_android.py
```

Caches markdown to `.cache/{apple,android}/hig/`.

### Ingest into DB

```bash
npm run ingest -- --platform ios
npm run ingest -- --platform android
npm run ingest -- --custom path/to/guide.md --app-id myapp
```

### Run MCP server

```bash
npm start           # production (requires npm run build first)
npm run dev         # tsx watch mode
```

### Register with Claude Code

Project-level (`.mcp.json` in this repo — no key needed if `.env` is present):

```bash
# from the repo root
claude mcp add --scope project --transport stdio mobile-design-guide \
  -- /bin/sh ./run-mcp.sh
```

User-level (persists across all projects, pass key explicitly):

```bash
claude mcp add --scope user --transport stdio \
  --env VOYAGE_API_KEY=<your-key> \
  mobile-design-guide \
  -- /bin/sh /path/to/mcp-mobile-design-guide/run-mcp.sh
```

## MCP Tools

| Tool | Description |
|---|---|
| `search_guidelines` | Semantic search, optional platform/app_id filter |
| `list_topics` | List distinct source slugs in DB |
| `get_guideline` | Direct chunk lookup by slug |

## Development

```bash
npm test            # Jest (TypeScript)
.venv/bin/pytest    # pytest (Python crawlers)
npm run lint        # Biome
npm run validate    # tsc --noEmit
```

## Environment

```
VOYAGE_API_KEY=...
DB_PATH=./data/guidelines.db   # optional override
```

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
│   ├── db.ts             # DB helpers, schema init
│   ├── ingest.ts         # ingestion CLI
│   ├── embed.ts          # Voyage client wrapper
│   └── config.ts
├── __tests__/            # TypeScript unit tests
├── tests/                # Python unit tests
└── package.json
```
