import 'dotenv/config';
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { openDb, listSources, getChunksBySource, searchNearest } from './db';
import { embedQuery } from './embed';

const mcp = new FastMCP({ name: 'mobile-design-guide', version: '1.0.0' });
const db = openDb();

mcp.addTool({
  name: 'search_guidelines',
  description:
    'Semantic search over iOS, Android, and custom app design guidelines. Returns relevant chunks with source and metadata.',
  parameters: z.object({
    query: z.string().describe('Natural language search query'),
    platform: z
      .enum(['ios', 'android', 'custom'])
      .optional()
      .describe('Filter by platform'),
    app_id: z.string().optional().describe('Filter by app name (custom platform only)'),
    top_k: z.number().int().min(1).max(20).default(5).describe('Number of results'),
  }),
  execute: async ({ query, platform, app_id, top_k }) => {
    const queryEmbedding = await embedQuery(query);
    const rows = searchNearest(db, queryEmbedding, top_k, platform, app_id);

    if (rows.length === 0) return 'No relevant guidelines found.';

    return rows
      .map((r, i) => {
        const meta = JSON.parse(r.metadata);
        return `[${i + 1}] source=${r.source} | ${JSON.stringify(meta)}\n${r.content}`;
      })
      .join('\n\n---\n\n');
  },
});

mcp.addTool({
  name: 'list_topics',
  description: 'List available design guideline topics (source slugs) in the database.',
  parameters: z.object({
    platform: z
      .enum(['ios', 'android', 'custom'])
      .optional()
      .describe('Filter by platform'),
    app_id: z.string().optional().describe('Filter by app name'),
  }),
  execute: async ({ platform, app_id }) => {
    const sources = listSources(db, platform, app_id);
    if (sources.length === 0) return 'No topics found. Run ingest first.';
    return sources.join('\n');
  },
});

mcp.addTool({
  name: 'get_guideline',
  description: 'Fetch all content chunks for a specific guideline slug.',
  parameters: z.object({
    slug: z.string().describe('Source slug as returned by list_topics'),
  }),
  execute: async ({ slug }) => {
    const chunks = getChunksBySource(db, slug);
    if (chunks.length === 0) return `No content found for slug: ${slug}`;
    return chunks.map((c) => c.content).join('\n\n---\n\n');
  },
});

mcp.start({ transportType: 'stdio' });
