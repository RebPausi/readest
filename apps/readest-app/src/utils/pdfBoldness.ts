/**
 * Make PDF text look bolder. A PDF page is an image (a canvas), so its font
 * can't be changed. Instead a gamma curve darkens the anti-aliased edge
 * pixels of the glyphs (brightens them, on a dark page): pure white and pure
 * black stay put, so the background is unchanged while strokes get heavier.
 * Unlike a morphology filter, this doesn't depend on the page's zoom.
 */
import { pageIsDark } from './waspLine';

const STYLE_ID = 'readest-pdf-bold-style';
const SVG_ID = 'readest-pdf-bold-svg';
// Gamma exponents per level; above 1 darkens mid-tones.
const GAMMAS = [1, 1.7, 2.6, 4];

export const applyPdfBoldness = (doc: Document, level: number, themeIsDark: boolean): void => {
  doc.getElementById(STYLE_ID)?.remove();
  doc.getElementById(SVG_ID)?.remove();
  const gamma = GAMMAS[Math.max(0, Math.min(3, Math.round(level)))] ?? 1;
  if (gamma === 1 || !doc.querySelector('#canvas')) return;

  // Dark page (light text): invert the curve so light strokes get brighter.
  const exponent = pageIsDark(doc, themeIsDark) ? 1 / gamma : gamma;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('id', SVG_ID);
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;pointer-events:none');
  const filter = doc.createElementNS(ns, 'filter');
  filter.setAttribute('id', 'readest-pdf-bold');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const transfer = doc.createElementNS(ns, 'feComponentTransfer');
  for (const channel of ['feFuncR', 'feFuncG', 'feFuncB']) {
    const fn = doc.createElementNS(ns, channel);
    fn.setAttribute('type', 'gamma');
    fn.setAttribute('amplitude', '1');
    fn.setAttribute('exponent', String(exponent));
    fn.setAttribute('offset', '0');
    transfer.appendChild(fn);
  }
  filter.appendChild(transfer);
  svg.appendChild(filter);
  doc.body.appendChild(svg);

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  // The selector keeps applying when pdf.js swaps in a freshly rendered canvas.
  style.textContent = '#canvas canvas { filter: url(#readest-pdf-bold); }';
  (doc.head ?? doc.documentElement).appendChild(style);
};
