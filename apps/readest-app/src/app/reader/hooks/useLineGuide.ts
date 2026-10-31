import { useCallback, useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { clearGuide, drawGuide, getGuideLines, GuideLine, lineIndexAt } from '@/utils/lineGuide';
import { toParentViewportPoint } from '../utils/annotatorUtil';

/**
 * Line guide for faster reading.
 *
 *  - Hover mode: the line under the mouse is underlined.
 *  - Pacer mode: press G to start or pause. The underline grows along the
 *    line under the mouse (or the first line on screen) at the chosen speed,
 *    moves line by line, and turns the page at the bottom. [ and ] change the
 *    speed by 25 words per minute; Esc stops.
 */

const WPM_STEP = 25;
const MIN_WPM = 50;
const MAX_WPM = 1500;
const PAGE_TURN_SETTLE_MS = 650;

type Spot = { doc: Document; index: number };

export const useLineGuide = (bookKey: string) => {
  const { envConfig } = useEnv();
  const envRef = useRef(envConfig);
  envRef.current = envConfig;
  const hovered = useRef<Spot | null>(null);
  const drawnDoc = useRef<Document | null>(null);
  const pacer = useRef<{
    spot: Spot;
    lineStart: number;
    pausedAt: number | null;
    raf: number;
    turning: boolean;
  } | null>(null);
  const attached = useRef(new WeakSet<Document>());

  const settings = () => {
    const vs = useReaderStore.getState().getViewSettings(bookKey);
    return {
      mode: vs?.lineGuideMode ?? 'off',
      wpm: Math.max(MIN_WPM, Math.min(MAX_WPM, vs?.lineGuideWpm || 250)),
      color: vs?.lineGuideColor || '#f59e0b',
    };
  };

  const clearDrawn = useCallback(() => {
    if (drawnDoc.current) clearGuide(drawnDoc.current);
    drawnDoc.current = null;
  }, []);

  const draw = useCallback(
    (doc: Document, line: GuideLine, fraction: number) => {
      if (drawnDoc.current && drawnDoc.current !== doc) clearGuide(drawnDoc.current);
      drawnDoc.current = doc;
      drawGuide(doc, line, fraction, settings().color);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey],
  );

  // ---------- visibility and page turns ----------

  const viewRect = () => {
    const view = useReaderStore.getState().getView(bookKey) as unknown as HTMLElement | null;
    return view?.getBoundingClientRect?.() ?? null;
  };

  const isVisible = useCallback(
    (doc: Document, line: GuideLine) => {
      const rect = viewRect();
      if (!rect) return true;
      const a = toParentViewportPoint(doc, line.left + 1, (line.top + line.bottom) / 2);
      const b = toParentViewportPoint(doc, line.right - 1, (line.top + line.bottom) / 2);
      return a.x >= rect.left && b.x <= rect.right + 1 && a.y >= rect.top && a.y <= rect.bottom;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey],
  );

  const contentDocs = useCallback((): Document[] => {
    const view = useReaderStore.getState().getView(bookKey);
    const contents = (view?.renderer?.getContents?.() ?? []) as {
      doc?: Document;
      index?: number;
    }[];
    return contents
      .filter((c) => c.doc)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((c) => c.doc!) as Document[];
  }, [bookKey]);

  const firstVisible = useCallback((): Spot | null => {
    for (const doc of contentDocs()) {
      const lines = getGuideLines(doc);
      const index = lines.findIndex((l) => isVisible(doc, l));
      if (index >= 0) return { doc, index };
    }
    return null;
  }, [contentDocs, isVisible]);

  // ---------- pacer ----------

  const stopPacer = useCallback(
    (announce = false) => {
      const p = pacer.current;
      if (p) cancelAnimationFrame(p.raf);
      pacer.current = null;
      clearDrawn();
      if (announce) eventDispatcher.dispatch('toast', { message: 'Pacer stopped', type: 'info' });
    },
    [clearDrawn],
  );

  const lineDuration = (line: GuideLine) => {
    const words = Math.max(1, line.words.length);
    return (words / settings().wpm) * 60000;
  };

  const tick = useCallback(() => {
    const p = pacer.current;
    if (!p || p.pausedAt !== null || p.turning) return;
    const lines = getGuideLines(p.spot.doc);
    const line = lines[p.spot.index];
    if (!line) {
      stopPacer();
      return;
    }
    const fraction = (performance.now() - p.lineStart) / lineDuration(line);
    draw(p.spot.doc, line, Math.min(1, fraction));
    if (fraction >= 1) {
      const nextIndex = p.spot.index + 1;
      const next = lines[nextIndex];
      if (next && isVisible(p.spot.doc, next)) {
        p.spot = { doc: p.spot.doc, index: nextIndex };
        p.lineStart = performance.now();
      } else {
        // End of the page: turn it and carry on from its first line.
        p.turning = true;
        clearDrawn();
        const view = useReaderStore.getState().getView(bookKey);
        void Promise.resolve(view?.next?.()).then(() => {
          setTimeout(() => {
            const cur = pacer.current;
            if (!cur) return;
            const spot = firstVisible();
            if (!spot) {
              stopPacer();
              return;
            }
            cur.spot = spot;
            cur.lineStart = performance.now();
            cur.turning = false;
            cur.raf = requestAnimationFrame(tick);
          }, PAGE_TURN_SETTLE_MS);
        });
        return;
      }
    }
    p.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, draw, clearDrawn, firstVisible, isVisible, stopPacer]);

  const togglePacer = useCallback(() => {
    const p = pacer.current;
    if (p) {
      if (p.pausedAt === null) {
        p.pausedAt = performance.now();
        cancelAnimationFrame(p.raf);
      } else {
        p.lineStart += performance.now() - p.pausedAt;
        p.pausedAt = null;
        p.raf = requestAnimationFrame(tick);
      }
      return;
    }
    const start =
      hovered.current && getGuideLines(hovered.current.doc)[hovered.current.index]
        ? hovered.current
        : firstVisible();
    if (!start) return;
    pacer.current = {
      spot: start,
      lineStart: performance.now(),
      pausedAt: null,
      raf: requestAnimationFrame(tick),
      turning: false,
    };
    eventDispatcher.dispatch('toast', {
      message: `Pacer: ${settings().wpm} wpm (G pause, [ ] speed, Esc stop)`,
      type: 'info',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstVisible, tick]);

  const changeWpm = useCallback(
    async (delta: number) => {
      const { getViewSettings } = useReaderStore.getState();
      const vs = getViewSettings(bookKey);
      if (!vs) return;
      const wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, (vs.lineGuideWpm || 250) + delta));
      // Keep the current line's progress when the speed changes.
      const p = pacer.current;
      if (p && p.pausedAt === null) {
        const line = getGuideLines(p.spot.doc)[p.spot.index];
        if (line) {
          const done = (performance.now() - p.lineStart) / lineDuration(line);
          const words = Math.max(1, line.words.length);
          p.lineStart = performance.now() - done * ((words / wpm) * 60000);
        }
      }
      await saveViewSettings(envRef.current, bookKey, 'lineGuideWpm', wpm, false, false);
      eventDispatcher.dispatch('toast', { message: `${wpm} wpm`, type: 'info' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey],
  );

  // ---------- input ----------

  const onKeyDown = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const target = ev.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return;
      // W switches the WaspLine line colours on and off.
      if (ev.key === 'w' || ev.key === 'W') {
        const vs = useReaderStore.getState().getViewSettings(bookKey);
        const next = !vs?.waspLineEnabled;
        void saveViewSettings(envRef.current, bookKey, 'waspLineEnabled', next, false, false);
        eventDispatcher.dispatch('toast', {
          message: next ? 'WaspLine colours on' : 'WaspLine colours off',
          type: 'info',
        });
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (settings().mode !== 'pacer') return;
      if (ev.key === 'g' || ev.key === 'G') {
        togglePacer();
      } else if (ev.key === ']') {
        void changeWpm(WPM_STEP);
      } else if (ev.key === '[') {
        void changeWpm(-WPM_STEP);
      } else if (ev.key === 'Escape' && pacer.current) {
        stopPacer(true);
      } else {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [togglePacer, changeWpm, stopPacer],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onKeyDown]);

  const attachDoc = useCallback(
    (doc: Document) => {
      if (attached.current.has(doc)) return;
      attached.current.add(doc);
      let frame = 0;
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('mousemove', (ev: MouseEvent) => {
        const mode = settings().mode;
        if (mode === 'off') return;
        if (frame) return;
        const { clientX, clientY } = ev;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const index = lineIndexAt(getGuideLines(doc), clientX, clientY);
          hovered.current = index >= 0 ? { doc, index } : null;
          if (mode !== 'hover' || pacer.current) return;
          if (index >= 0) draw(doc, getGuideLines(doc)[index]!, 1);
          else if (drawnDoc.current === doc) clearDrawn();
        });
      });
      doc.addEventListener('mouseleave', () => {
        if (settings().mode === 'hover' && !pacer.current && drawnDoc.current === doc) clearDrawn();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onKeyDown, draw, clearDrawn],
  );

  // Switching modes or closing the book stops everything.
  const mode = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.lineGuideMode);
  useEffect(() => {
    stopPacer();
    clearDrawn();
  }, [mode, stopPacer, clearDrawn]);
  useEffect(() => () => stopPacer(), [stopPacer]);

  return { attachDoc };
};
