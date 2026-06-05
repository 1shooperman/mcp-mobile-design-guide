import crypto from 'node:crypto';
import { chunkExists, deleteChunksBySource, getChunksBySource, insertChunk, listSources, openDb } from '../src/db';
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
});
