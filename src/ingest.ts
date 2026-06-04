#!/usr/bin/env tsx
/**
 * Usage:
 *   npm run ingest -- --platform ios
 *   npm run ingest -- --platform android
 *   npm run ingest -- --custom ./path/to/guide.md --app-id my-app
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseArgs } from 'util';
import { openDb, insertChunk, chunkExists, deleteChunksBySource, ChunkInput } from './db.js';
import { embed } from './embed.js';
import { config } from './config.js';

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 200;

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

interface IndexJson {
  [slug: string]: string;
}

async function ingestPlatform(platform: 'ios' | 'android'): Promise<void> {
  const dir = path.join(config.cacheDir, platform === 'ios' ? 'apple' : 'android', 'hig');
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

    const markdown = fs.readFileSync(mdPath, 'utf8');
    const sections = splitByHeaders(markdown);

    // determine which chunks are new/changed vs unchanged
    const toEmbed: { section: string; hash: string; idx: number }[] = [];
    const toDelete: string[] = [];

    for (let i = 0; i < sections.length; i++) {
      const hash = sha256(sections[i]);
      const source = `${platform}/${slug}#${i}`;
      if (!chunkExists(db, source, hash)) {
        toDelete.push(source);
        toEmbed.push({ section: sections[i], hash, idx: i });
      }
    }

    if (toEmbed.length === 0) {
      console.log(`  skip (unchanged): ${slug}`);
      continue;
    }

    console.log(`  ingest: ${slug} (${toEmbed.length} new/changed chunks)`);
    for (const source of toDelete) deleteChunksBySource(db, source);

    const embeddings = await embed(toEmbed.map((t) => t.section));

    for (let j = 0; j < toEmbed.length; j++) {
      const { section, hash, idx } = toEmbed[j];
      const source = `${platform}/${slug}#${idx}`;
      const chunk: ChunkInput = {
        source,
        platform,
        app_id: null,
        content: section,
        content_hash: hash,
        metadata: { url, slug, chunk_i: idx },
      };
      insertChunk(db, chunk, embeddings[j]);
    }
  }

  const total = (db.prepare('SELECT COUNT(*) as n FROM chunks').get() as { n: number }).n;
  console.log(`\nDone. Total chunks in DB: ${total}`);
  db.close();
}

async function ingestCustom(filePath: string, appId: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(filePath, 'utf8');
  const sections = splitByHeaders(markdown);
  const db = openDb();

  const toEmbed: { section: string; hash: string; idx: number }[] = [];
  const toDelete: string[] = [];
  const slug = path.basename(filePath, path.extname(filePath));

  for (let i = 0; i < sections.length; i++) {
    const hash = sha256(sections[i]);
    const source = `custom/${appId}/${slug}#${i}`;
    if (!chunkExists(db, source, hash)) {
      toDelete.push(source);
      toEmbed.push({ section: sections[i], hash, idx: i });
    }
  }

  if (toEmbed.length === 0) {
    console.log(`  skip (unchanged): ${slug}`);
    db.close();
    return;
  }

  console.log(`  ingest: ${slug} app=${appId} (${toEmbed.length} new/changed chunks)`);
  for (const source of toDelete) deleteChunksBySource(db, source);

  const embeddings = await embed(toEmbed.map((t) => t.section));

  for (let j = 0; j < toEmbed.length; j++) {
    const { section, hash, idx } = toEmbed[j];
    const source = `custom/${appId}/${slug}#${idx}`;
    const chunk: ChunkInput = {
      source,
      platform: 'custom',
      app_id: appId,
      content: section,
      content_hash: hash,
      metadata: { file: filePath, slug, chunk_i: idx },
    };
    insertChunk(db, chunk, embeddings[j]);
  }

  const total = (db.prepare('SELECT COUNT(*) as n FROM chunks').get() as { n: number }).n;
  console.log(`\nDone. Total chunks in DB: ${total}`);
  db.close();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      custom: { type: 'string' },
      'app-id': { type: 'string' },
    },
  });

  if (values.platform) {
    const p = values.platform as string;
    if (p !== 'ios' && p !== 'android') {
      console.error('--platform must be ios or android');
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
    console.error('Usage: --platform ios|android  OR  --custom <path> --app-id <name>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
