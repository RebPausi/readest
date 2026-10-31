import { useCallback, useEffect, useRef } from 'react';
import { BookNote, ViewSettings } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { getSentenceRangeAtPoint } from '@/utils/sentenceRange';
import { applyWaspLine, clearWaspLine, isPdfPageDocument } from '@/utils/waspLine';
import { applyPdfBoldness } from '@/utils/pdfBoldness';
import { useLineGuide } from './useLineGuide';
import { nextBooknoteStamp } from '@/utils/booknoteStamp';
import { mergeRestyledAnnotation } from '../utils/annotatorUtil';
import { uniqueId } from '@/utils/misc';

/**
 * Reading aids added in this fork:
 *  - click a word to highlight its whole sentence (a normal Readest highlight,
 *    so it shows in the notebook and exports with the other notes);
 *  - WaspLine line gradients.
 *
 * `attachDoc` is called from the viewer's per-section load handler;
 * `refreshAll` after layout settles. Both features are self-contained here so
 * the rest of the reader only needs those two calls.
 */

const CLICK_SLOP_PX = 4;
const CLICK_MAX_MS = 700;
const SUPPRESS_CLICK_MS = 600;
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, img, video, audio, svg image, [role="button"], .annotationLayer *';

type PressState = { x: number; y: number; time: number };

export const useReadingAids = (bookKey: string) => {
  const { envConfig } = useEnv();
  const envRef = useRef(envConfig);
  envRef.current = envConfig;

  const attachedDocs = useRef(new WeakSet<Document>());
  const resizeObservers = useRef(new Map<Document, ResizeObserver>());
  const pendingTimers = useRef(new Map<Document, number>());

  const lineGuide = useLineGuide(bookKey);

  // ---------- WaspLine ----------

  const waspOptions = useCallback((vs: ViewSettings) => {
    return {
      colors: [vs.waspLineColor1, vs.waspLineColor2] as [string, string],
      darkColors: [vs.waspLineDarkColor1, vs.waspLineDarkColor2] as [string, string],
      intensity: Math.max(0.1, Math.min(1, vs.waspLineIntensity ?? 1)),
      isDark: useThemeStore.getState().isDarkMode,
    };
  }, []);

  const applyToDoc = useCallback(
    (doc: Document) => {
      const vs = useReaderStore.getState().getViewSettings(bookKey);
      if (!vs || !doc.body) return;
      try {
        applyWaspLine(doc, !!vs.waspLineEnabled, waspOptions(vs));
      } catch (err) {
        console.warn('WaspLine failed', err);
      }
      if (isPdfPageDocument(doc)) {
        try {
          applyPdfBoldness(doc, vs.pdfTextBoldness ?? 0, useThemeStore.getState().isDarkMode);
        } catch (err) {
          console.warn('PDF boldness failed', err);
        }
      }
    },
    [bookKey, waspOptions],
  );

  // Layout keeps moving for a moment after load (fonts, images, columns), so
  // colouring is debounced per document.
  const scheduleApply = useCallback(
    (doc: Document, delay = 250) => {
      const win = doc.defaultView;
      if (!win) return;
      const prev = pendingTimers.current.get(doc);
      if (prev) win.clearTimeout(prev);
      pendingTimers.current.set(
        doc,
        win.setTimeout(() => {
          pendingTimers.current.delete(doc);
          applyToDoc(doc);
        }, delay),
      );
    },
    [applyToDoc],
  );

  const getDocs = useCallback((): Document[] => {
    const view = useReaderStore.getState().getView(bookKey);
    const contents = view?.renderer?.getContents?.() ?? [];
    return contents.map((c: { doc?: Document }) => c.doc).filter(Boolean) as Document[];
  }, [bookKey]);

  const refreshAll = useCallback(() => {
    getDocs().forEach((doc) => scheduleApply(doc, 50));
  }, [getDocs, scheduleApply]);

  // Re-colour when the switches, colours or theme change. Subscribing to the
  // store (rather than relying on this component re-rendering) also catches
  // settings saved by mutating the view settings object in place.
  useEffect(() => {
    const signature = () => {
      const vs = useReaderStore.getState().getViewSettings(bookKey);
      if (!vs) return '';
      return [
        vs.waspLineEnabled,
        vs.waspLineIntensity,
        vs.waspLineColor1,
        vs.waspLineColor2,
        vs.waspLineDarkColor1,
        vs.waspLineDarkColor2,
        vs.applyThemeToPDF,
        vs.pdfTextBoldness,
        useThemeStore.getState().isDarkMode,
      ].join('|');
    };
    let last = signature();
    const onChange = () => {
      const next = signature();
      if (next === last) return;
      last = next;
      const vs = useReaderStore.getState().getViewSettings(bookKey);
      if (!vs?.waspLineEnabled) getDocs().forEach((doc) => clearWaspLine(doc));
      refreshAll();
    };
    const unsubReader = useReaderStore.subscribe(onChange);
    const unsubTheme = useThemeStore.subscribe(onChange);
    return () => {
      unsubReader();
      unsubTheme();
    };
  }, [bookKey, getDocs, refreshAll]);

  // ---------- click to highlight a sentence ----------

  const persistAnnotation = useCallback(
    (annotation: BookNote) => {
      const { getConfig, updateBooknotes, saveConfig } = useBookDataStore.getState();
      const { getProgress } = useReaderStore.getState();
      const { settings } = useSettingsStore.getState();
      const config = getConfig(bookKey);
      if (!config) return;
      const page = getProgress(bookKey)?.page;
      const booknotes = [...(config.booknotes ?? [])];
      const existingIndex = booknotes.findIndex(
        (a) => a.cfi === annotation.cfi && a.type === 'annotation' && a.style && !a.deletedAt,
      );
      if (existingIndex !== -1) {
        const existing = booknotes[existingIndex]!;
        booknotes[existingIndex] = {
          ...mergeRestyledAnnotation(existing, annotation),
          page,
          updatedAt: nextBooknoteStamp(existing),
        };
      } else {
        booknotes.push({ ...annotation, page });
      }
      const updated = updateBooknotes(bookKey, booknotes);
      if (updated) saveConfig(envRef.current, bookKey, updated, settings);
    },
    [bookKey],
  );

  const highlightSentence = useCallback(
    (doc: Document, index: number, x: number, y: number): boolean => {
      const { getView, getViewsById } = useReaderStore.getState();
      const view = getView(bookKey);
      if (!view) return false;

      // A click on an existing highlight keeps its usual behaviour (the
      // popup to recolour, annotate or delete it).
      const content = (view.renderer?.getContents?.() ?? []).find(
        (c: { doc?: Document }) => c.doc === doc,
      ) as { overlayer?: { hitTest: (p: { x: number; y: number }) => [string?] } } | undefined;
      const [hit] = content?.overlayer?.hitTest({ x, y }) ?? [];
      if (hit && !String(hit).startsWith('foliate-search:')) return false;

      const sentence = getSentenceRangeAtPoint(doc, x, y);
      if (!sentence || !sentence.text) return false;
      const cfi = view.getCFI(index, sentence.range);
      if (!cfi) return false;

      const { settings } = useSettingsStore.getState();
      const style = settings.globalReadSettings.highlightStyle;
      const color = settings.globalReadSettings.highlightStyles[style];
      const now = Date.now();
      const annotation: BookNote = {
        id: uniqueId(),
        type: 'annotation',
        cfi,
        style,
        color,
        text: sentence.text,
        note: '',
        createdAt: now,
        updatedAt: now,
      };
      getViewsById(bookKey.split('-')[0]!).forEach((v) => v?.addAnnotation(annotation));
      persistAnnotation(annotation);
      doc.getSelection()?.removeAllRanges();
      return true;
    },
    [bookKey, persistAnnotation],
  );

  // ---------- per-document wiring ----------

  const attachDoc = useCallback(
    (doc: Document, index: number) => {
      // Sections can be reloaded into a fresh document; colour every load.
      scheduleApply(doc, isPdfPageDocument(doc) ? 400 : 250);
      lineGuide.attachDoc(doc);

      if (attachedDocs.current.has(doc)) return;
      attachedDocs.current.add(doc);

      let press: PressState | null = null;
      let suppressClickUntil = 0;

      const sentenceMode = () =>
        useReaderStore.getState().getViewSettings(bookKey)?.sentenceClickMode ?? 'off';

      doc.addEventListener(
        'pointerdown',
        (ev: PointerEvent) => {
          press = null;
          if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
          if (sentenceMode() === 'off') return;
          press = { x: ev.clientX, y: ev.clientY, time: Date.now() };
        },
        true,
      );

      doc.addEventListener(
        'pointerup',
        (ev: PointerEvent) => {
          const start = press;
          press = null;
          if (!start || ev.pointerType !== 'mouse' || ev.button !== 0) return;
          const mode = sentenceMode();
          if (mode === 'off') return;
          if (mode === 'alt' ? !ev.altKey : ev.altKey) return;
          if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
          if (Date.now() - start.time > CLICK_MAX_MS) return;
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > CLICK_SLOP_PX) return;
          const target = ev.target as Element | null;
          if (target?.closest?.(INTERACTIVE_SELECTOR)) return;
          const sel = doc.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().trim()) return;
          if (highlightSentence(doc, index, ev.clientX, ev.clientY)) {
            // Swallow the click that follows, so it neither turns the page,
            // toggles the toolbars nor opens the new highlight's popup.
            suppressClickUntil = Date.now() + SUPPRESS_CLICK_MS;
          }
        },
        true,
      );

      doc.addEventListener(
        'click',
        (ev: MouseEvent) => {
          if (Date.now() < suppressClickUntil) {
            suppressClickUntil = 0;
            ev.preventDefault();
            ev.stopImmediatePropagation();
          }
        },
        true,
      );

      // Relayout (window resize, font changes) moves every line.
      const win = doc.defaultView as (Window & typeof globalThis) | null;
      if (win?.ResizeObserver && !isPdfPageDocument(doc)) {
        let lastWidth = 0;
        let lastHeight = 0;
        const ro = new win.ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect) return;
          if (Math.abs(rect.width - lastWidth) < 1 && Math.abs(rect.height - lastHeight) < 1)
            return;
          lastWidth = rect.width;
          lastHeight = rect.height;
          if (useReaderStore.getState().getViewSettings(bookKey)?.waspLineEnabled) {
            scheduleApply(doc, 300);
          }
        });
        ro.observe(doc.documentElement);
        resizeObservers.current.set(doc, ro);
        win.addEventListener('unload', () => {
          ro.disconnect();
          resizeObservers.current.delete(doc);
        });
      }
    },
    [bookKey, highlightSentence, scheduleApply, lineGuide],
  );

  useEffect(() => {
    const observers = resizeObservers.current;
    return () => {
      observers.forEach((ro) => ro.disconnect());
      observers.clear();
    };
  }, []);

  return { attachDoc, refreshAll };
};
