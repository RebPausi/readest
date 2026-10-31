/**
 * WaspLine / BeeLine-style line gradients.
 *
 * Each line of text fades into a colour towards one end, alternating so the
 * end of one line and the start of the next share a colour, which guides the
 * eye to the next line:
 *   line 0: colour 1 at the end      line 1: colour 1 at the start
 *   line 2: colour 2 at the end      line 3: colour 2 at the start
 * The pattern restarts with every paragraph, as in the WaspLine extension.
 *
 * Reflowable books are coloured with the CSS Custom Highlight API, so the
 * document is never modified: CFIs, highlights and search keep working.
 * PDF pages are a canvas under a transparent text layer, so there the text
 * layer only supplies line positions and the colour comes from one blended
 * gradient strip per line (`lighten` on light pages: white stays white and
 * dark glyphs take the colour; `darken` on dark pages).
 */

export interface WaspLineOptions {
  colors: [string, string];
  darkColors: [string, string];
  /** 0.1 .. 1 */
  intensity: number;
  /** Theme is dark (light text on dark background). */
  isDark: boolean;
}

const STEPS = 10;
const HIGHLIGHT_PREFIX = 'readest-wl';
const STYLE_ID = 'readest-waspline-style';
const OVERLAY_CLASS = 'readest-waspline-overlay';
const SKIP_SELECTOR = 'rt, rp, script, style, noscript, svg, math';
const BLOCK_SELECTOR =
  'p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6, td, th, caption, figcaption, pre, div, section, article, aside, body';

type State = {
  names: string[];
  observer?: MutationObserver;
  timer?: number;
};
const states = new WeakMap<Document, State>();

// ---------- colour helpers ----------

type RGB = [number, number, number];

const parseColor = (color: string): RGB | null => {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
};

const mix = (a: RGB, b: RGB, t: number): string => {
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

const luminance = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** The gradient weight (0..1) at fraction `f` across line `j`, and its colour slot. */
const weightAt = (j: number, f: number): { slot: 0 | 1; t: number } => {
  const kind = j % 4;
  const slot = (kind < 2 ? 0 : 1) as 0 | 1;
  const atEnd = kind % 2 === 0;
  const t = atEnd ? (f > 0.5 ? (f - 0.5) / 0.5 : 0) : f < 0.5 ? (0.5 - f) / 0.5 : 0;
  return { slot, t: Math.max(0, Math.min(1, t)) };
};

// ---------- clearing ----------

export const clearWaspLine = (doc: Document): void => {
  const state = states.get(doc);
  if (state) {
    state.observer?.disconnect();
    if (state.timer) doc.defaultView?.clearTimeout(state.timer);
    const highlights = (doc.defaultView as (Window & typeof globalThis) | null)?.CSS?.highlights;
    state.names.forEach((name) => highlights?.delete(name));
    states.delete(doc);
  }
  doc.getElementById(STYLE_ID)?.remove();
  doc.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
};

// ---------- reflowable (Highlight API) ----------

type Word = {
  node: Text;
  start: number;
  end: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  block: Element | null;
};

const collectWords = (doc: Document): Word[] => {
  const root = doc.body;
  if (!root) return [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const words: Word[] = [];
  const range = doc.createRange();
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest(SKIP_SELECTOR) && /\S/.test(node.data)) {
      const block = parent.closest(BLOCK_SELECTOR);
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.data))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects();
        const rect = rects[0];
        if (!rect || (rect.width === 0 && rect.height === 0)) continue;
        // A word broken over two lines (hyphenation) gives two rects; the
        // first one decides its line.
        words.push({
          node,
          start: m.index,
          end: m.index + m[0].length,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          block,
        });
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return words;
};

const groupLines = (words: Word[]): { words: Word[]; lineInBlock: number }[] => {
  const lines: { words: Word[]; lineInBlock: number }[] = [];
  let current: Word[] = [];
  let lineInBlock = 0;
  for (const w of words) {
    const prev = current[current.length - 1];
    const sameBlock = !!prev && prev.block === w.block;
    const wMid = (w.top + w.bottom) / 2;
    // Same line: same paragraph, vertically inside the previous word's box,
    // and further right (a column change in paginated layout jumps back up).
    const sameLine =
      sameBlock && wMid > prev.top - 1 && wMid < prev.bottom + 1 && w.left >= prev.left - 1;
    if (sameLine) {
      current.push(w);
    } else {
      if (current.length) lines.push({ words: current, lineInBlock });
      lineInBlock = sameBlock ? lineInBlock + 1 : 0;
      current = [w];
    }
  }
  if (current.length) lines.push({ words: current, lineInBlock });
  return lines;
};

const applyReflowable = (doc: Document, opts: WaspLineOptions, state: State) => {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const HighlightCtor = (win as unknown as { Highlight?: typeof Highlight } | null)?.Highlight;
  if (!win?.CSS?.highlights || !HighlightCtor) return;

  const base =
    parseColor(win.getComputedStyle(doc.body).color) ?? (opts.isDark ? [230, 230, 230] : [0, 0, 0]);
  const isDark = opts.isDark || luminance(base) > 0.5;
  const pair = isDark ? opts.darkColors : opts.colors;
  const targets = pair.map((c) => parseColor(c)).filter(Boolean) as RGB[];
  if (targets.length < 2) return;

  // One highlight per colour slot and step.
  const buckets: Range[][][] = [[], []].map(() => Array.from({ length: STEPS + 1 }, () => []));
  const lines = groupLines(collectWords(doc));
  for (const { words, lineInBlock } of lines) {
    const left = Math.min(...words.map((w) => w.left));
    const right = Math.max(...words.map((w) => w.right));
    const width = Math.max(1, right - left);
    for (const w of words) {
      // Characters inside a word are spread evenly over its width.
      const len = w.end - w.start;
      let runStart = w.start;
      let runKey = -1;
      let runSlot: 0 | 1 = 0;
      const flush = (endOffset: number) => {
        if (runKey > 0 && endOffset > runStart) {
          const r = doc.createRange();
          r.setStart(w.node, runStart);
          r.setEnd(w.node, endOffset);
          buckets[runSlot]![runKey]!.push(r);
        }
      };
      for (let i = 0; i < len; i++) {
        const x = w.left + ((w.right - w.left) * (i + 0.5)) / len;
        const { slot, t } = weightAt(lineInBlock, (x - left) / width);
        const step = Math.round(t * opts.intensity * STEPS);
        if (step !== runKey || slot !== runSlot) {
          flush(w.start + i);
          runStart = w.start + i;
          runKey = step;
          runSlot = slot;
        }
      }
      flush(w.end);
    }
  }

  let css = '';
  buckets.forEach((steps, slot) => {
    steps.forEach((ranges, step) => {
      if (!ranges.length || step === 0) return;
      const name = `${HIGHLIGHT_PREFIX}-${slot}-${step}`;
      win.CSS.highlights.set(name, new HighlightCtor(...ranges));
      state.names.push(name);
      css += `::highlight(${name}) { color: ${mix(base, targets[slot]!, step / STEPS)}; }\n`;
    });
  });
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  (doc.head ?? doc.documentElement).appendChild(style);
};

// ---------- PDF (blended overlay) ----------

const pageIsDark = (doc: Document, fallback: boolean): boolean => {
  const canvas = doc.querySelector('#canvas canvas') as HTMLCanvasElement | null;
  try {
    const ctx = canvas?.getContext('2d', { willReadFrequently: false });
    if (ctx && canvas!.width > 4 && canvas!.height > 4) {
      const d = ctx.getImageData(2, 2, 1, 1).data;
      return luminance([d[0]!, d[1]!, d[2]!]) < 0.5;
    }
  } catch {
    // tainted or unavailable canvas: fall back to the theme
  }
  return fallback;
};

const applyPdf = (doc: Document, opts: WaspLineOptions) => {
  const layer = doc.querySelector('.textLayer') as HTMLElement | null;
  if (!layer) return;
  doc.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());

  const dark = pageIsDark(doc, opts.isDark);
  const pair = dark ? opts.darkColors : opts.colors;
  const targets = pair.map((c) => parseColor(c)).filter(Boolean) as RGB[];
  if (targets.length < 2) return;
  const neutral: RGB = dark ? [255, 255, 255] : [0, 0, 0];

  type Box = { left: number; right: number; top: number; bottom: number };
  const spans = Array.from(layer.querySelectorAll('span')).filter(
    (s) => !s.querySelector('span') && /\S/.test(s.textContent ?? ''),
  );
  const boxes: Box[] = spans
    .map((s) => s.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));

  // Group runs into lines in reading order. A new paragraph starts after a
  // vertical gap larger than one line, which restarts the colour pattern.
  const lines: (Box & { lineInBlock: number })[] = [];
  for (const b of boxes) {
    const last = lines[lines.length - 1];
    const mid = (b.top + b.bottom) / 2;
    if (last && mid > last.top && mid < last.bottom && b.left >= last.left - 2) {
      last.left = Math.min(last.left, b.left);
      last.right = Math.max(last.right, b.right);
      last.top = Math.min(last.top, b.top);
      last.bottom = Math.max(last.bottom, b.bottom);
    } else {
      const h = b.bottom - b.top;
      const gap = last ? b.top - last.bottom : Infinity;
      const newBlock = !last || gap > h * 0.9 || gap < -h * 2 || b.left < last.left - h * 4;
      lines.push({ ...b, lineInBlock: newBlock ? 0 : last!.lineInBlock + 1 });
    }
  }

  const overlay = doc.createElement('div');
  overlay.className = OVERLAY_CLASS;
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    // No z-index: a stacking context would isolate the strips and the blend
    // would no longer reach the canvas underneath.
  });
  const scrollX = doc.defaultView?.scrollX ?? 0;
  const scrollY = doc.defaultView?.scrollY ?? 0;
  const neutralCss = `rgb(${neutral.join(', ')})`;
  for (const line of lines) {
    const kind = line.lineInBlock % 4;
    const target = targets[kind < 2 ? 0 : 1]!;
    const color = mix(neutral, target, opts.intensity);
    const atEnd = kind % 2 === 0;
    const strip = doc.createElement('div');
    Object.assign(strip.style, {
      position: 'absolute',
      left: `${line.left + scrollX}px`,
      top: `${line.top + scrollY}px`,
      width: `${line.right - line.left}px`,
      height: `${line.bottom - line.top}px`,
      mixBlendMode: dark ? 'darken' : 'lighten',
      background: atEnd
        ? `linear-gradient(to right, ${neutralCss} 0%, ${neutralCss} 50%, ${color} 100%)`
        : `linear-gradient(to right, ${color} 0%, ${neutralCss} 50%, ${neutralCss} 100%)`,
    });
    overlay.appendChild(strip);
  }
  // Right above the canvas, below the text layer, so selection is untouched.
  const canvasHost = doc.getElementById('canvas');
  if (canvasHost?.parentNode) canvasHost.parentNode.insertBefore(overlay, canvasHost.nextSibling);
  else doc.body.appendChild(overlay);
};

// ---------- entry point ----------

export const isPdfPageDocument = (doc: Document): boolean => !!doc.querySelector('.textLayer');

/**
 * Colour (or re-colour) every line in a section or PDF page. Idempotent: it
 * clears its previous output first. Call after layout settles and whenever
 * the layout, theme or settings change.
 */
export const applyWaspLine = (doc: Document, enabled: boolean, opts: WaspLineOptions): void => {
  clearWaspLine(doc);
  if (!enabled || !doc.body) return;
  const state: State = { names: [] };
  states.set(doc, state);

  if (isPdfPageDocument(doc)) {
    applyPdf(doc, opts);
    // pdf.js re-renders the text layer on zoom and page re-render; redraw
    // the strips once it has settled.
    const layer = doc.querySelector('.textLayer');
    if (layer && doc.defaultView) {
      const win = doc.defaultView;
      state.observer = new win.MutationObserver(() => {
        if (state.timer) win.clearTimeout(state.timer);
        state.timer = win.setTimeout(() => applyPdf(doc, opts), 150);
      });
      state.observer.observe(layer, { childList: true });
    }
  } else {
    applyReflowable(doc, opts, state);
  }
};
