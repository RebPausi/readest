import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BookNote } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { buildObsidianMarkdown, obsidianFileName } from '@/utils/obsidianExport';

const SYNC_DEBOUNCE_MS = 3000;

/**
 * Keeps `<vault folder>/<Book title>.md` in step with the book's highlights
 * and notes: written a few seconds after any change, and once when the book
 * opens. Desktop only; a no-op where the app can't write to local folders.
 */
export const useObsidianSync = (bookKey: string) => {
  const { appService } = useEnv();
  const lastWritten = useRef<string>('');
  const scopedFolder = useRef<string>('');

  const writeNow = useCallback(
    async (opts: { force?: boolean; announce?: boolean } = {}) => {
      const vs = useReaderStore.getState().getViewSettings(bookKey);
      if (!vs?.obsidianSyncEnabled || !vs.obsidianFolder) return;
      if (!appService?.isDesktopApp) return;
      const { getBookData, getConfig } = useBookDataStore.getState();
      const bookData = getBookData(bookKey);
      const book = bookData?.book;
      const config = getConfig(bookKey);
      if (!book || !config) return;

      const markdown = buildObsidianMarkdown(
        book,
        config.booknotes ?? [],
        bookData?.bookDoc?.toc ?? [],
      );
      // `updated:` changes daily; compare without it so an unchanged book
      // isn't rewritten just because the date moved.
      const signature = markdown.replace(/^updated: .*$/m, '');
      if (!opts.force && signature === lastWritten.current) return;

      const folder = vs.obsidianFolder.replace(/[\\/]+$/, '');
      try {
        if (scopedFolder.current !== folder) {
          await appService.allowPathsInScopes?.([folder], true);
          scopedFolder.current = folder;
        }
        await appService.writeFile(`${folder}/${obsidianFileName(book)}`, 'None', markdown);
        lastWritten.current = signature;
        if (opts.announce) {
          eventDispatcher.dispatch('toast', {
            message: `Highlights written to Obsidian: ${obsidianFileName(book)}`,
            type: 'success',
          });
        }
      } catch (err) {
        console.error('Obsidian sync failed', err);
        eventDispatcher.dispatch('toast', {
          message: `Obsidian sync failed: ${String(err)}`,
          type: 'error',
        });
      }
    },
    [bookKey, appService],
  );

  const debouncedWrite = useMemo(
    () => debounce(() => void writeNow(), SYNC_DEBOUNCE_MS),
    [writeNow],
  );

  // Write whenever this book's notes change.
  useEffect(() => {
    let prev: BookNote[] | undefined = useBookDataStore.getState().getConfig(bookKey)?.booknotes;
    const unsubscribe = useBookDataStore.subscribe((state) => {
      const next = state.getConfig(bookKey)?.booknotes;
      if (next !== prev) {
        prev = next;
        debouncedWrite();
      }
    });
    return () => {
      unsubscribe();
      debouncedWrite.cancel();
    };
  }, [bookKey, debouncedWrite]);

  // Write on open, and right away when sync is switched on or the folder changes.
  const viewSettings = useReaderStore((state) => state.viewStates[bookKey]?.viewSettings);
  const enabled = viewSettings?.obsidianSyncEnabled;
  const folder = viewSettings?.obsidianFolder;
  const firstRun = useRef(true);
  useEffect(() => {
    if (!enabled || !folder) return;
    const announce = !firstRun.current;
    firstRun.current = false;
    const timer = setTimeout(() => void writeNow({ force: true, announce }), 1500);
    return () => clearTimeout(timer);
  }, [enabled, folder, writeNow]);

  // Flush a pending write when the book closes.
  useEffect(() => () => void writeNow(), [writeNow]);
};
