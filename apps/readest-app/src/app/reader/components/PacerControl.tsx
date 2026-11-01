import React, { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { MdAdd, MdPause, MdPlayArrow, MdRemove, MdStop } from 'react-icons/md';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import { PACER_COMMAND_EVENT, PacerCommand, usePacerStore } from '../hooks/useLineGuide';

/**
 * Small floating control for the reading pacer, shown while the line guide is
 * in pacer mode: play/pause, stop, and the speed. Scroll the mouse wheel over
 * it to change the speed.
 */
const PacerControl: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const mode = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.lineGuideMode);
  const savedWpm = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.lineGuideWpm);
  const status = usePacerStore((s) => s.status[bookKey] ?? 'idle');
  const wpm = usePacerStore((s) => s.wpm[bookKey]) || savedWpm || 250;
  const ref = useRef<HTMLDivElement>(null);

  const send = (command: PacerCommand) =>
    void eventDispatcher.dispatch(PACER_COMMAND_EVENT, { bookKey, command });

  // A native listener, so the wheel can be stopped from also turning pages.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.deltaY === 0) return;
      void eventDispatcher.dispatch(PACER_COMMAND_EVENT, {
        bookKey,
        command: ev.deltaY < 0 ? 'faster' : 'slower',
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [bookKey, mode]);

  if (mode !== 'pacer') return null;

  const iconButton =
    'flex h-7 w-7 items-center justify-center rounded-full hover:bg-base-300 focus-visible:outline-hidden';
  return (
    <div
      ref={ref}
      title='Pacer: G play/pause, Esc stop. Scroll here (or Alt + scroll on the page) to change speed'
      className={clsx(
        'bg-base-200/90 text-base-content absolute bottom-1 left-4 z-20 flex select-none items-center gap-0.5',
        'rounded-full px-1 py-0.5 text-sm shadow-md backdrop-blur transition-opacity',
        status === 'playing' ? 'opacity-40 hover:opacity-100' : 'opacity-80 hover:opacity-100',
      )}
    >
      <button
        type='button'
        className={iconButton}
        aria-label={status === 'playing' ? 'Pause pacer' : 'Start pacer'}
        onClick={() => send('toggle')}
      >
        {status === 'playing' ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
      </button>
      {status !== 'idle' && (
        <button
          type='button'
          className={iconButton}
          aria-label='Stop pacer'
          onClick={() => send('stop')}
        >
          <MdStop size={18} />
        </button>
      )}
      <button
        type='button'
        className={iconButton}
        aria-label='Slower'
        onClick={() => send('slower')}
      >
        <MdRemove size={16} />
      </button>
      <span className='min-w-[4.5rem] text-center tabular-nums'>{wpm} wpm</span>
      <button
        type='button'
        className={iconButton}
        aria-label='Faster'
        onClick={() => send('faster')}
      >
        <MdAdd size={16} />
      </button>
    </div>
  );
};

export default PacerControl;
