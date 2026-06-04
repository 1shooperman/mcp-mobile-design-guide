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
    const bigSection = '## Big Section\n' + 'word '.repeat(2000);
    const chunks = splitByHeaders(bigSection);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  test('splitByHeaders drops sections under 100 chars', () => {
    const md = '## Short\nToo short.\n\n## Long\n' + 'Enough content here. '.repeat(6);
    const chunks = splitByHeaders(md);
    expect(chunks.every((c) => c.length >= 100)).toBe(true);
  });
});
