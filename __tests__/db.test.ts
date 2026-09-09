import crypto from 'node:crypto';
import {
  chunkExists,
  deleteChunksBySource,
  getChunksBySource,
  getOldestSource,
  insertChunk,
  isSourceCurrent,
  listSources,
  openDb,
  recordSource,
} from '../src/db';
import { FIXTURE_CHUNKS } from './fixtures/chunks';

function fakeEmbedding(dim = 1024): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

const MEM = ':memory:';

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

describe('db helpers', () => {
  test('insertChunk and chunkExists', () => {
    const db = openDb(MEM);
    const chunk = FIXTURE_CHUNKS[0];
    const h = hash(chunk.content);

    expect(chunkExists(db, chunk.source, h)).toBe(false);
    insertChunk(db, { ...chunk, content_hash: h }, fakeEmbedding());
    expect(chunkExists(db, chunk.source, h)).toBe(true);

    db.close();
  });

  test('deleteChunksBySource removes chunk and vec row', () => {
    const db = openDb(MEM);
    const chunk = FIXTURE_CHUNKS[0];
    const h = hash(chunk.content);
    insertChunk(db, { ...chunk, content_hash: h }, fakeEmbedding());

    deleteChunksBySource(db, chunk.source);
    expect(chunkExists(db, chunk.source, h)).toBe(false);

    const vecCount = (db.prepare('SELECT COUNT(*) as n FROM vec_items').get() as { n: number }).n;
    expect(vecCount).toBe(0);

    db.close();
  });

  test('getChunksBySource returns correct chunks', () => {
    const db = openDb(MEM);
    const chunk = FIXTURE_CHUNKS[1];
    const h = hash(chunk.content);
    insertChunk(db, { ...chunk, content_hash: h }, fakeEmbedding());

    const results = getChunksBySource(db, chunk.source);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe(chunk.content);

    db.close();
  });

  test('listSources filters by platform', () => {
    const db = openDb(MEM);
    for (const chunk of FIXTURE_CHUNKS) {
      insertChunk(db, { ...chunk, content_hash: hash(chunk.content) }, fakeEmbedding());
    }

    const iosSources = listSources(db, 'ios');
    expect(iosSources).toContain('ios/buttons#0');
    expect(iosSources).not.toContain('android/buttons#0');

    const customSources = listSources(db, 'custom', 'my-app');
    expect(customSources).toContain('custom/my-app/brand#0');

    db.close();
  });

  test('isSourceCurrent and recordSource track whole-file provenance', () => {
    const db = openDb(MEM);
    const source = 'ios/buttons';

    expect(isSourceCurrent(db, source, 'hash-1')).toBe(false);

    recordSource(db, source, 'hash-1', {
      as_of: '2026-01-01',
      as_of_source: 'file-mtime',
      ingested_at: '2026-01-01T00:00:00Z',
    });
    expect(isSourceCurrent(db, source, 'hash-1')).toBe(true);
    expect(isSourceCurrent(db, source, 'hash-2')).toBe(false);

    // edited file re-recorded with a new hash replaces, not duplicates, the row
    recordSource(db, source, 'hash-2', {
      as_of: '2026-02-01',
      as_of_source: 'declared',
      ingested_at: '2026-02-01T00:00:00Z',
      commit_sha: 'abc123',
    });
    expect(isSourceCurrent(db, source, 'hash-1')).toBe(false);
    expect(isSourceCurrent(db, source, 'hash-2')).toBe(true);

    db.close();
  });

  test('getOldestSource returns the earliest as_of', () => {
    const db = openDb(MEM);
    recordSource(db, 'ios/newer', 'h1', { as_of: '2026-06-01', as_of_source: 'file-mtime', ingested_at: 'x' });
    recordSource(db, 'ios/older', 'h2', { as_of: '2025-01-15', as_of_source: 'file-mtime', ingested_at: 'x' });

    const oldest = getOldestSource(db);
    expect(oldest?.source).toBe('ios/older');
    expect(oldest?.as_of).toBe('2025-01-15');

    db.close();
  });
});
