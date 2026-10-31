import * as CFI from 'foliate-js/epubcfi.js';
import { Book, BookNote } from '@/types/book';
import { TOCItem } from '@/libs/document';
import { findTocItemBS } from '@/services/nav';
import { buildAnnotationAppUrl } from '@/utils/deeplink';

/**
 * One Markdown note per book for an Obsidian vault: front matter, then the
 * highlights grouped by chapter in reading order. Each highlight carries a
 * block id (`^rd-<id>`) so it can be linked or embedded from other notes
 * (`[[Book#^rd-abc123]]`), and a link that opens it in Readest.
 *
 * The file is rewritten on every sync, so it mirrors the book exactly:
 * edits and deletions in Readest show up in Obsidian. Write your own notes
 * in a separate note that links to this one.
 */

const yamlString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const quote = (text: string) =>
  text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');

export const obsidianFileName = (book: Book) => {
  const name = (book.title || 'Untitled')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${name || 'Untitled'}.md`;
};

export const buildObsidianMarkdown = (book: Book, booknotes: BookNote[], toc: TOCItem[]) => {
  const notes = booknotes.filter(
    (n) => !n.deletedAt && n.type === 'annotation' && (n.text?.trim() || n.note?.trim()),
  );

  const groups = new Map<string, { id: number; label: string; notes: BookNote[] }>();
  for (const note of notes) {
    const item = findTocItemBS(toc, note.cfi);
    const key = item?.href || '';
    if (!groups.has(key))
      groups.set(key, { id: item?.id ?? 0, label: item?.label || '', notes: [] });
    groups.get(key)!.notes.push(note);
  }
  const ordered = [...groups.values()].sort((a, b) => a.id - b.id);
  ordered.forEach((g) =>
    g.notes.sort((a, b) => {
      try {
        return CFI.compare(a.cfi, b.cfi);
      } catch {
        return a.createdAt - b.createdAt;
      }
    }),
  );

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    '---',
    `title: ${yamlString(book.title || '')}`,
    `author: ${yamlString(book.author || '')}`,
    `format: ${book.format}`,
    'source: readest',
    `highlights: ${notes.length}`,
    `updated: ${today}`,
    'tags:',
    '  - readest',
    '---',
    '',
    `# ${book.title || 'Untitled'}`,
  ];
  if (book.author) lines.push('', `*${book.author}*`);

  for (const group of ordered) {
    lines.push('', `## ${group.label || 'Highlights'}`);
    for (const note of group.notes) {
      const link = buildAnnotationAppUrl({ bookHash: book.hash, noteId: note.id, cfi: note.cfi });
      const meta = [note.page ? `p. ${note.page}` : '', note.color || '', `[open](${link})`]
        .filter(Boolean)
        .join(' · ');
      lines.push('');
      if (note.text?.trim()) {
        lines.push(quote(note.text), `> ${meta} ^rd-${note.id}`);
      } else {
        lines.push(`${meta} ^rd-${note.id}`);
      }
      if (note.note?.trim()) lines.push('', note.note.trim());
    }
  }
  lines.push('');
  return lines.join('\n');
};
