import { describe, expect, it } from 'vitest';
import { buildObsidianMarkdown, obsidianFileName } from '@/utils/obsidianExport';
import type { Book, BookNote } from '@/types/book';

const book = {
  hash: 'abc123',
  title: 'Trading: In "the" Zone',
  author: 'Mark Douglas',
  format: 'EPUB',
} as unknown as Book;

const note = (over: Partial<BookNote>): BookNote =>
  ({
    id: 'n1',
    type: 'annotation',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
    text: 'First sentence.',
    note: '',
    color: 'yellow',
    style: 'highlight',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as BookNote;

describe('buildObsidianMarkdown', () => {
  it('writes front matter, a quote, a block id and a Readest link', () => {
    const md = buildObsidianMarkdown(book, [note({ page: 12 })], []);
    expect(md).toContain('title: "Trading: In \\"the\\" Zone"');
    expect(md).toContain('> First sentence.');
    expect(md).toMatch(
      /> p\. 12 · yellow · \[open\]\(readest:\/\/book\/abc123\/annotation\/n1\?cfi=.+\) \^rd-n1/,
    );
  });

  it('skips deleted notes and bookmarks, keeps notes under their quote', () => {
    const md = buildObsidianMarkdown(
      book,
      [
        note({ id: 'a', note: 'my thought' }),
        note({ id: 'b', deletedAt: 5 }),
        note({ id: 'c', type: 'bookmark' }),
      ],
      [],
    );
    expect(md).toContain('^rd-a\n\nmy thought');
    expect(md).not.toContain('^rd-b');
    expect(md).not.toContain('^rd-c');
    expect(md).toContain('highlights: 1');
  });

  it('makes a safe file name', () => {
    expect(obsidianFileName(book)).toBe('Trading In the Zone.md');
  });
});
