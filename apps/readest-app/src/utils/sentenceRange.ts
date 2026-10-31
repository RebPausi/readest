/**
 * Find the sentence under a point, as a DOM Range, for click-to-highlight.
 *
 * Works on reflowable sections (EPUB/MOBI/FB2/TXT) and on PDF pages, whose
 * text lives in pdf.js's `.textLayer` as one span per text run with a <br>
 * at each line end. The search is limited to the enclosing paragraph (or the
 * whole PDF page), the text is segmented with Intl.Segmenter, and the result
 * is mapped back to text-node offsets. Nothing in the document is modified.
 */

const PARAGRAPH_SELECTOR =
  'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, td, th, caption, figcaption, pre';
const BLOCK_SELECTOR = `${PARAGRAPH_SELECTOR}, div, section, article, aside, body`;
const SKIP_SELECTOR = 'rt, rp, script, style, noscript, .endOfContent';

// Abbreviations Intl.Segmenter treats as a sentence end ("Dr. Smith" → two
// sentences). A segment ending in one of these is merged with the next.
const ABBREVIATION_END =
  /(?:^|[\s(“"‘'])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|cf|Fig|fig|No|no|Vol|vol|pp|p|ch|Ch|approx|Inc|Ltd|Co|Corp|U\.S|[A-Z])\.\s*$/;

type TextEntry = { node: Text; start: number; end: number };

const getCaretPosition = (doc: Document, x: number, y: number) => {
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (anyDoc.caretPositionFromPoint) {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
};

/** True when (x, y) is over an actual glyph, not blank space beside a line. */
const isOverText = (doc: Document, node: Text, offset: number, x: number, y: number) => {
  const range = doc.createRange();
  const tolerance = 4;
  for (const o of [offset - 1, offset]) {
    if (o < 0 || o >= node.length) continue;
    range.setStart(node, o);
    range.setEnd(node, o + 1);
    for (const rect of Array.from(range.getClientRects())) {
      if (
        x >= rect.left - tolerance &&
        x <= rect.right + tolerance &&
        y >= rect.top - tolerance &&
        y <= rect.bottom + tolerance
      ) {
        return true;
      }
    }
  }
  return false;
};

const findRoot = (node: Node): Element | null => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  return (
    el.closest('.textLayer') ??
    el.closest(PARAGRAPH_SELECTOR) ??
    el.closest('div, section, article, aside') ??
    el.ownerDocument.body
  );
};

/**
 * The root's text as one string, with a newline for each <br> and block
 * boundary. Newlines belong to no text node; every other character maps to
 * exactly one entry.
 */
const collectText = (root: Element): { entries: TextEntry[]; text: string } => {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const entries: TextEntry[] = [];
  let text = '';
  let block: Element | null = null;
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.matches(SKIP_SELECTOR)) {
        // Skip the whole subtree.
        let next: Node | null = null;
        let cur: Node | null = el;
        while (cur && cur !== root && !next) {
          next = cur.nextSibling;
          cur = cur.parentNode;
        }
        if (!next) break;
        walker.currentNode = next;
        node = next;
        continue;
      }
      if (el.tagName === 'BR' && !text.endsWith('\n')) text += '\n';
    } else {
      const content = (node as Text).data;
      if (content) {
        const nodeBlock = (node.parentElement?.closest(BLOCK_SELECTOR) ?? null) as Element | null;
        if (block && nodeBlock !== block && !text.endsWith('\n')) text += '\n';
        block = nodeBlock;
        entries.push({ node: node as Text, start: text.length, end: text.length + content.length });
        text += content;
      }
    }
    node = walker.nextNode();
  }
  return { entries, text };
};

const offsetOf = (entries: TextEntry[], node: Node, offset: number): number | null => {
  const entry = entries.find((e) => e.node === node);
  return entry ? entry.start + Math.min(offset, entry.end - entry.start) : null;
};

const pointAt = (entries: TextEntry[], offset: number, isEnd: boolean) => {
  for (const e of entries) {
    const inside = isEnd
      ? e.start < offset && offset <= e.end
      : e.start <= offset && offset < e.end;
    if (inside) return { node: e.node, offset: offset - e.start };
  }
  return null;
};

type Segment = { start: number; end: number };

const segmentSentences = (text: string, locale?: string): Segment[] => {
  const flat = text.replace(/\s/g, ' ');
  let raw: Segment[];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    raw = Array.from(
      new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(flat),
      ({ index, segment }) => ({ start: index, end: index + segment.length }),
    );
  } else {
    // Fallback: split after . ! ? followed by whitespace.
    raw = [];
    const re = /[^.!?]*(?:[.!?]+["”’')\]]*\s+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) && m[0].length > 0) {
      raw.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  // Glue segments split after an abbreviation or an initial.
  const merged: Segment[] = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREVIATION_END.test(flat.slice(prev.start, prev.end))) {
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
};

export interface SentenceAtPoint {
  range: Range;
  /** The sentence text, with PDF line-break hyphenation joined back up. */
  text: string;
}

export const getSentenceRangeAtPoint = (
  doc: Document,
  x: number,
  y: number,
): SentenceAtPoint | null => {
  const caret = getCaretPosition(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const caretNode = caret.node as Text;
  if (!caretNode.data.trim()) return null;
  if (!isOverText(doc, caretNode, caret.offset, x, y)) return null;
  if (caretNode.parentElement?.closest(SKIP_SELECTOR)) return null;

  const root = findRoot(caretNode);
  if (!root) return null;
  const { entries, text } = collectText(root);
  const caretOffset = offsetOf(entries, caretNode, caret.offset);
  if (caretOffset === null) return null;

  const locale = doc.documentElement.lang || undefined;
  const segments = segmentSentences(text, locale);
  // A caret right after the last character of a sentence belongs to it.
  const probe = Math.min(caretOffset, text.length - 1);
  const seg =
    segments.find((s) => s.start <= probe && probe < s.end) ?? segments[segments.length - 1];
  if (!seg) return null;

  const slice = text.slice(seg.start, seg.end);
  const start = seg.start + slice.search(/\S|$/);
  const end = seg.end - (slice.length - slice.trimEnd().length);
  if (end <= start) return null;

  const startPoint = pointAt(entries, start, false);
  const endPoint = pointAt(entries, end, true);
  if (!startPoint || !endPoint) return null;

  const range = doc.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);

  const sentence = text
    .slice(start, end)
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return { range, text: sentence };
};
