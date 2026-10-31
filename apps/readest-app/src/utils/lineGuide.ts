/**
 * Line guide for faster reading: an underline under one line of text, drawn
 * with the CSS Custom Highlight API so the document is never modified.
 *
 * Used two ways (see useLineGuide): following the mouse, underlining the
 * whole line under the pointer, or as a pacer that draws the underline from
 * the start of a line to its end at a set words-per-minute, then moves on.
 *
 * Works on reflowable sections and on PDF pages (their transparent text
 * layer still carries an underline in its own colour).
 */
import { collectWords, groupLines, Word } from './waspLine';

const HIGHLIGHT_NAME = 'readest-line-guide';
const STYLE_ID = 'readest-line-guide-style';

export interface GuideLine {
  words: Word[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Characters in the line's words, the pacer's unit of progress. */
  chars: number;
}

const cache = new WeakMap<Document, { key: string; lines: GuideLine[] }>();

// Cheap fingerprint of the layout: changes when the page re-renders or
// reflows, so cached line positions are thrown away.
const layoutKey = (doc: Document) => {
  const root = doc.documentElement;
  const layer = doc.querySelector('.textLayer');
  return [
    root.scrollWidth,
    root.scrollHeight,
    doc.body?.childElementCount ?? 0,
    layer ? layer.childElementCount : -1,
    layer ? (layer as HTMLElement).offsetWidth : -1,
  ].join('|');
};

export const getGuideLines = (doc: Document): GuideLine[] => {
  const key = layoutKey(doc);
  const cached = cache.get(doc);
  if (cached && cached.key === key) return cached.lines;
  const root = (doc.querySelector('.textLayer') as Element | null) ?? doc.body;
  const lines = groupLines(collectWords(doc, root)).map(({ words }) => ({
    words,
    left: Math.min(...words.map((w) => w.left)),
    right: Math.max(...words.map((w) => w.right)),
    top: Math.min(...words.map((w) => w.top)),
    bottom: Math.max(...words.map((w) => w.bottom)),
    chars: words.reduce((n, w) => n + (w.end - w.start), 0),
  }));
  cache.set(doc, { key, lines });
  return lines;
};

export const invalidateGuideLines = (doc: Document) => cache.delete(doc);

export const lineIndexAt = (lines: GuideLine[], x: number, y: number): number => {
  const slack = 2;
  return lines.findIndex(
    (l) => y >= l.top - slack && y <= l.bottom + slack && x >= l.left - 24 && x <= l.right + 24,
  );
};

const ensureStyle = (doc: Document, color: string) => {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  const css = `::highlight(${HIGHLIGHT_NAME}) {
    text-decoration-line: underline;
    text-decoration-style: solid;
    text-decoration-color: ${color};
    text-decoration-thickness: 3px;
    text-decoration-skip-ink: none;
  }`;
  if (style.textContent !== css) style.textContent = css;
};

/**
 * Underline `line` from its start to `fraction` (0..1) of its characters.
 * Returns false where the Highlight API is unavailable.
 */
export const drawGuide = (
  doc: Document,
  line: GuideLine,
  fraction: number,
  color: string,
): boolean => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const HighlightCtor = (win as unknown as { Highlight?: typeof Highlight } | null)?.Highlight;
  if (!win?.CSS?.highlights || !HighlightCtor || !line.words.length) return false;
  ensureStyle(doc, color);

  const first = line.words[0]!;
  let target = Math.round(Math.max(0, Math.min(1, fraction)) * line.chars);
  let endNode: Text = first.node;
  let endOffset = first.start;
  for (const w of line.words) {
    const len = w.end - w.start;
    endNode = w.node;
    if (target <= len) {
      endOffset = w.start + target;
      break;
    }
    endOffset = w.end;
    target -= len;
  }
  try {
    const range = doc.createRange();
    range.setStart(first.node, first.start);
    range.setEnd(endNode, endOffset);
    win.CSS.highlights.set(HIGHLIGHT_NAME, new HighlightCtor(range));
  } catch {
    return false;
  }
  return true;
};

export const clearGuide = (doc: Document) => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  win?.CSS?.highlights?.delete(HIGHLIGHT_NAME);
};
