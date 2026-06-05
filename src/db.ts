import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { config } from './config';

export const EMBED_DIM = 1024;

export interface Chunk {
  id: number;
  vec_rowid: number;
  source: string;
  platform: string;
  app_id: string | null;
  content: string;
  content_hash: string;
  metadata: string;
}

export interface ChunkInput {
  source: string;
  platform: string;
  app_id: string | null;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
}

export function openDb(dbPath?: string): Database.Database {
  dbPath = dbPath ?? config.dbPath;
  const db = new Database(dbPath);
  sqliteVec.load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vec_rowid     INTEGER,
      source        TEXT NOT NULL,
      platform      TEXT NOT NULL,
      app_id        TEXT,
      content       TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      metadata      TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_platform ON chunks(platform);
    CREATE INDEX IF NOT EXISTS idx_chunks_app_id   ON chunks(app_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_source   ON chunks(source);
    CREATE INDEX IF NOT EXISTS idx_chunks_hash     ON chunks(source, content_hash);

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0(
      embedding float[${EMBED_DIM}]
    );
  `);

  return db;
}

export function serialize(v: number[]): Float32Array {
  return new Float32Array(v);
}

export function chunkExists(
  db: Database.Database,
  source: string,
  contentHash: string,
): boolean {
  const row = db
    .prepare('SELECT 1 FROM chunks WHERE source = ? AND content_hash = ? LIMIT 1')
    .get(source, contentHash);
  return row !== undefined;
}

export function deleteChunksBySource(db: Database.Database, source: string): void {
  const rows = db
    .prepare('SELECT id, vec_rowid FROM chunks WHERE source = ?')
    .all(source) as { id: number; vec_rowid: number | null }[];
  const delChunk = db.prepare('DELETE FROM chunks WHERE id = ?');
  const delVec = db.prepare('DELETE FROM vec_items WHERE rowid = ?');
  for (const { id, vec_rowid } of rows) {
    delChunk.run(id);
    if (vec_rowid != null) delVec.run(vec_rowid);
  }
}

export function insertChunk(
  db: Database.Database,
  chunk: ChunkInput,
  embedding: number[],
): void {
  // Insert vec first (auto rowid), then insert chunk with the vec rowid stored
  const vecResult = db
    .prepare('INSERT INTO vec_items(embedding) VALUES(?)')
    .run(serialize(embedding));
  const vecRowid = Number(vecResult.lastInsertRowid);

  db.prepare(
    `INSERT INTO chunks (vec_rowid, source, platform, app_id, content, content_hash, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    vecRowid,
    chunk.source,
    chunk.platform,
    chunk.app_id ?? null,
    chunk.content,
    chunk.content_hash,
    JSON.stringify(chunk.metadata),
  );
}

export function getChunksBySource(db: Database.Database, source: string): Chunk[] {
  return db
    .prepare('SELECT * FROM chunks WHERE source = ? OR source LIKE ? ORDER BY source')
    .all(source, `${source}#%`) as Chunk[];
}

export function listSources(
  db: Database.Database,
  platform?: string,
  appId?: string,
): string[] {
  let sql = 'SELECT DISTINCT source FROM chunks';
  const params: (string | null)[] = [];
  const conditions: string[] = [];
  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }
  if (appId) {
    conditions.push('app_id = ?');
    params.push(appId);
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' ORDER BY source';
  return (db.prepare(sql).all(...params) as { source: string }[]).map((r) => r.source);
}

export function searchNearest(
  db: Database.Database,
  queryEmbedding: number[],
  topK: number,
  platform?: string,
  appId?: string,
): Array<{ source: string; content: string; metadata: string; distance: number }> {
  // sqlite-vec does not support WHERE on virtual tables directly with joined filters,
  // so we fetch topK * 4 candidates then filter in JS.
  const candidates = topK * 4;
  const rows = db
    .prepare(
      `SELECT c.source, c.content, c.metadata, c.platform, c.app_id, v.distance
       FROM vec_items v
       JOIN chunks c ON c.vec_rowid = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`,
    )
    .all(serialize(queryEmbedding), candidates) as Array<{
    source: string;
    content: string;
    metadata: string;
    platform: string;
    app_id: string | null;
    distance: number;
  }>;

  return rows
    .filter((r) => {
      if (platform && r.platform !== platform) return false;
      if (appId && r.app_id !== appId) return false;
      return true;
    })
    .slice(0, topK);
}
