import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * D184: while SES waits for the server or FileMaker on a step that must not run twice (the FileMaker check after a scan, "send",
 * the branch-units lookup), the whole page stops taking clicks and keys. Nothing gets pressed twice, and the dimmed screen with
 * a spinner shows the page is working, not broken. Everything under it is `inert`: no clicks, no focus, no typing.
 *
 * A quick answer (most FileMaker checks take 0.1 s) only locks: the screen dims after SHOW_AFTER_MS, so it does not flash on
 * every scan. A wait past SLOW_AFTER_MS offers a reload, so a request that never comes back cannot leave the page stuck.
 * A barcode scanner types into the window, not a box, so it still reaches listeners on the window: those check
 * `#root.inert` before acting (SerialScan).
 */
const SHOW_AFTER_MS = 300;
const SLOW_AFTER_MS = 20_000;

/** Overlays up at once (a check still running when "send" starts): the page stays inert until the last one ends. */
let locks = 0;
let focusBefore: HTMLElement | null = null;

function lock() {
  locks += 1;
  if (locks > 1) return;
  focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = document.getElementById('root');
  if (root) root.inert = true;
  focusBefore?.blur();
}

function unlock() {
  locks = Math.max(0, locks - 1);
  if (locks > 0) return;
  const root = document.getElementById('root');
  if (root) root.inert = false;
  // the scan box that had the focus gets it back, so the scanner goes on where it was
  if (focusBefore?.isConnected) focusBefore.focus();
  focusBefore = null;
}

export function BusyOverlay({ show, text, note }: { show: boolean; text: string; note?: ReactNode }) {
  const [stage, setStage] = useState<'locked' | 'shown' | 'slow'>('locked');

  useEffect(() => {
    if (!show) return;
    lock();
    const shown = window.setTimeout(() => setStage('shown'), SHOW_AFTER_MS);
    const slow = window.setTimeout(() => setStage('slow'), SLOW_AFTER_MS);
    return () => {
      window.clearTimeout(shown);
      window.clearTimeout(slow);
      setStage('locked');
      unlock();
    };
  }, [show]);

  if (!show) return null;
  return createPortal(
    <div className={`busy-overlay ${stage === 'locked' ? '' : 'shown'}`} role="alert" aria-busy="true">
      {stage !== 'locked' && (
        <div className="busy-overlay-card">
          <span className="spinner" aria-hidden="true" />
          <span>{text}</span>
          {note && <div className="busy-overlay-note">{note}</div>}
          {stage === 'slow' && (
            <div className="busy-overlay-slow">
              รอนานกว่าปกติ ถ้ายังไม่ไปต่อ โหลดหน้าใหม่ได้ (ข้อมูลที่บันทึกแล้วไม่หาย)
              <button type="button" onClick={() => window.location.reload()}>
                โหลดหน้าใหม่
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
