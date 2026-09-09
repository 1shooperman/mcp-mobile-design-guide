// Tests for the chunking logic extracted from ingest.ts
// We test the pure functions inline here to avoid importing the full CLI.

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 200;

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

function chunkSection(chunk: string): string | undefined {
  const firstLine = chunk.split('\n')[0].trim();
  return firstLine.startsWith('## ') ? firstLine.slice(3).trim() : undefined;
}

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

describe('chunkSection', () => {
  test('extracts the heading a chunk starts with', () => {
    expect(chunkSection('## Buttons\nContent here.')).toBe('Buttons');
  });

  test('returns undefined when chunk has no leading header', () => {
    expect(chunkSection('Just prose, no header.')).toBeUndefined();
  });
});

describe('parseFrontmatter', () => {
  test('parses declared as_of and comma-separated tags', () => {
    const text = '---\nas_of: 2026-03-01\ntags: nav, buttons\n---\n## Body\ncontent';
    const [meta, body] = parseFrontmatter(text);
    expect(meta.as_of).toBe('2026-03-01');
    expect(meta.tags).toEqual(['nav', 'buttons']);
    expect(body.startsWith('## Body')).toBe(true);
  });

  test('returns empty metadata when no frontmatter block is present', () => {
    const [meta, body] = parseFrontmatter('## Body\ncontent');
    expect(meta).toEqual({});
    expect(body).toBe('## Body\ncontent');
  });

  test('returns empty metadata when the closing --- is missing', () => {
    const [meta, body] = parseFrontmatter('---\nas_of: 2026-03-01\n## Body');
    expect(meta).toEqual({});
    expect(body).toBe('---\nas_of: 2026-03-01\n## Body');
  });
});

describe('chunking', () => {
  test('splitByHeaders splits on ## boundaries', () => {
    const md = [
      '# Page Title',
      '',
      '## Section One',
      'Content for section one. '.repeat(5),
      '',
      '## Section Two',
      'Content for section two. '.repeat(5),
    ].join('\n');

    const chunks = splitByHeaders(md);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.includes('Section One'))).toBe(true);
    expect(chunks.some((c) => c.includes('Section Two'))).toBe(true);
  });

  test('splitByHeaders sub-splits oversized sections', () => {
    const bigSection = `## Big Section\n${'word '.repeat(2000)}`;
    const chunks = splitByHeaders(bigSection);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  test('splitByHeaders drops sections under 100 chars', () => {
    const md = `## Short\nToo short.\n\n## Long\n${'Enough content here. '.repeat(6)}`;
    const chunks = splitByHeaders(md);
    expect(chunks.every((c) => c.length >= 100)).toBe(true);
  });
});
