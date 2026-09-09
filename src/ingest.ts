#!/usr/bin/env tsx
/**
 * Usage:
 *   npm run ingest -- --platform ios
 *   npm run ingest -- --platform android
 *   npm run ingest -- --platform google-search
 *   npm run ingest -- --custom ./path/to/guide.md --app-id my-app
 *   npm run ingest -- --platform ios --force   # re-embed everything, ignoring hashes
 */

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from './config';
import {
  type ChunkInput,
  chunkExists,
  deleteChunksBySource,
  getOldestSource,
  insertChunk,
  isSourceCurrent,
  openDb,
  recordSource,
  type SourceProvenance,
} from './db';
import { embed } from './embed';

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 200;

// Set by --force: skip the whole-file and per-chunk unchanged checks.
let FORCE = false;

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = start + CHUNK_SIZE;
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 100) chunks.push(chunk);
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function splitByHeaders(markdown: string): string[] {
  const sections = markdown.split(/\n(?=## )/);
  const out: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.length < 100) continue;
    if (trimmed.length > CHUNK_SIZE) {
      out.push(...splitText(trimmed));
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

/** The "## Heading" a chunk starts with, if any (chunks split right before headers). */
function chunkSection(chunk: string): string | undefined {
  const firstLine = chunk.split('\n')[0].trim();
  return firstLine.startsWith('## ') ? firstLine.slice(3).trim() : undefined;
}

/**
 * Parse a leading '---\n key: value ... \n---' block. Flat keys only; `tags`
 * is treated as a comma-separated list. Returns ({}, text) if absent. Lets a
 * custom guide self-declare metadata — most usefully `as_of` and `tags` —
 * rather than relying only on file mtime.
 */
function parseFrontmatter(text: string): [Record<string, string | string[]>, string] {
  if (!text.startsWith('---\n')) return [{}, text];
  const end = text.indexOf('\n---', 4);
  if (end === -1) return [{}, text];

  const raw = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const meta: Record<string, string | string[]> = {};
  for (const line of raw.split('\n')) {
    const sepIdx = line.indexOf(':');
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim();
    const val = line.slice(sepIdx + 1).trim();
    meta[key] = key === 'tags' ? val.split(',').map((t) => t.trim()).filter(Boolean) : val;
  }
  return [meta, body];
}

let commitShaCache: string | null | undefined;

/** Short sha of the repo the corpus was ingested from, or undefined. Resolved once. */
function repoCommitSha(): string | undefined {
  if (commitShaCache === undefined) {
    try {
      commitShaCache = execFileSync('git', ['-C', path.resolve(__dirname, '..'), 'rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      commitShaCache = null;
    }
  }
  return commitShaCache ?? undefined;
}

function defaultAsOf(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

/**
 * Freshness metadata stamped onto every chunk and the file's `sources` row.
 * A retrieved chunk should carry its own age — `as_of` comes from a declared
 * frontmatter value when present, else the file's mtime.
 */
function provenance(mtimeMs: number, frontmatter: Record<string, string | string[]>): SourceProvenance {
  const declared = frontmatter.as_of;
  const asOf = typeof declared === 'string' && declared ? declared : defaultAsOf(mtimeMs);
  const prov: SourceProvenance = {
    as_of: asOf,
    as_of_source: typeof declared === 'string' && declared ? 'declared' : 'file-mtime',
    ingested_at: new Date().toISOString(),
  };
  const sha = repoCommitSha();
  if (sha) prov.commit_sha = sha;
  return prov;
}

interface IndexJson {
  [slug: string]: string;
}

async function embedAndStore(
  db: ReturnType<typeof openDb>,
  docSource: string,
  sections: string[],
  buildChunk: (section: string, idx: number, hash: string) => ChunkInput,
): Promise<number> {
  const toEmbed: { section: string; hash: string; idx: number }[] = [];
  const toDelete = new Set<string>();

  for (let i = 0; i < sections.length; i++) {
    const hash = sha256(sections[i]);
    const chunkSource = `${docSource}#${i}`;
    if (FORCE || !chunkExists(db, chunkSource, hash)) {
      toDelete.add(chunkSource);
      toEmbed.push({ section: sections[i], hash, idx: i });
    }
  }

  if (toEmbed.length === 0) return 0;

  // Embed first — if this throws, DB is untouched
  const embeddings = await embed(toEmbed.map((t) => t.section));

  db.transaction(() => {
    for (const chunkSource of toDelete) deleteChunksBySource(db, chunkSource);
    for (let j = 0; j < toEmbed.length; j++) {
      const { section, hash, idx } = toEmbed[j];
      insertChunk(db, buildChunk(section, idx, hash), embeddings[j]);
    }
  })();

  return toEmbed.length;
}

const PLATFORM_DIRS: Record<string, string> = {
  ios: 'apple',
  android: 'android',
  'google-search': 'google-search',
};

async function ingestPlatform(platform: string): Promise<void> {
  const dir = path.join(config.cacheDir, PLATFORM_DIRS[platform], 'hig');
  const indexPath = path.join(dir, 'index.json');

  if (!fs.existsSync(indexPath)) {
    console.error(`index.json not found at ${indexPath} — run the crawler first`);
    process.exit(1);
  }

  const index: IndexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const db = openDb();

  for (const [slug, url] of Object.entries(index)) {
    const mdPath = path.join(dir, `${slug}.md`);
    if (!fs.existsSync(mdPath)) {
      console.warn(`  missing: ${mdPath}`);
      continue;
    }

    const docSource = `${platform}/${slug}`;
    const markdown = fs.readFileSync(mdPath, 'utf8');
    const fileHash = sha256(markdown);

    if (!FORCE && isSourceCurrent(db, docSource, fileHash)) {
      console.log(`  skip (unchanged): ${slug}`);
      continue;
    }

    const [frontmatter, body] = parseFrontmatter(markdown);
    const prov = provenance(fs.statSync(mdPath).mtimeMs, frontmatter);
    const sections = splitByHeaders(body);

    const changed = await embedAndStore(db, docSource, sections, (section, idx, hash) => ({
      source: `${docSource}#${idx}`,
      platform,
      app_id: null,
      content: section,
      content_hash: hash,
      metadata: { url, slug, chunk_i: idx, section: chunkSection(section), ...frontmatter, ...prov },
    }));

    console.log(changed > 0 ? `  ingest: ${slug} (${changed} new/changed chunks)` : `  unchanged content, refreshing provenance: ${slug}`);
    recordSource(db, docSource, fileHash, prov);
  }

  const total = (db.prepare('SELECT COUNT(*) as n FROM chunks').get() as { n: number }).n;
  console.log(`\nDone. Total chunks in DB: ${total}`);
  const oldest = getOldestSource(db);
  if (oldest) console.log(`Oldest source: ${oldest.source} (as_of ${oldest.as_of})`);
  db.close();
}

async function ingestCustom(filePath: string, appId: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const slug = path.basename(filePath, path.extname(filePath));
  const docSource = `custom/${appId}/${slug}`;
  const raw = fs.readFileSync(filePath, 'utf8');
  const fileHash = sha256(raw);
  const db = openDb();

  if (!FORCE && isSourceCurrent(db, docSource, fileHash)) {
    console.log(`  skip (unchanged): ${slug}`);
    db.close();
    return;
  }

  const [frontmatter, body] = parseFrontmatter(raw);
  const prov = provenance(fs.statSync(filePath).mtimeMs, frontmatter);
  const sections = splitByHeaders(body);

  const changed = await embedAndStore(db, docSource, sections, (section, idx, hash) => ({
    source: `${docSource}#${idx}`,
    platform: 'custom',
    app_id: appId,
    content: section,
    content_hash: hash,
    metadata: { file: filePath, slug, chunk_i: idx, section: chunkSection(section), ...frontmatter, ...prov },
  }));

  console.log(
    changed > 0
      ? `  ingest: ${slug} app=${appId} (${changed} new/changed chunks)`
      : `  unchanged content, refreshing provenance: ${slug}`,
  );
  recordSource(db, docSource, fileHash, prov);

  const total = (db.prepare('SELECT COUNT(*) as n FROM chunks').get() as { n: number }).n;
  console.log(`\nDone. Total chunks in DB: ${total}`);
  const oldest = getOldestSource(db);
  if (oldest) console.log(`Oldest source: ${oldest.source} (as_of ${oldest.as_of})`);
  db.close();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      custom: { type: 'string' },
      'app-id': { type: 'string' },
      force: { type: 'boolean' },
    },
  });

  FORCE = values.force === true;
  if (FORCE) console.log('[--force] re-embedding every source, ignoring content hashes');

  if (values.platform) {
    const p = values.platform as string;
    if (!(p in PLATFORM_DIRS)) {
      console.error(`--platform must be one of: ${Object.keys(PLATFORM_DIRS).join(', ')}`);
      process.exit(1);
    }
    await ingestPlatform(p);
  } else if (values.custom) {
    const appId = values['app-id'];
    if (!appId) {
      console.error('--app-id is required with --custom');
      process.exit(1);
    }
    await ingestCustom(values.custom, appId);
  } else {
    console.error(`Usage: --platform ${Object.keys(PLATFORM_DIRS).join('|')}  OR  --custom <path> --app-id <name>  [--force]`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
