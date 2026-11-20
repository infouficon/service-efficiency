import { useEffect, useState } from 'react';

/**
 * D182: a tab left open across a deploy keeps running the old screens against the new API. When the API starts asking for
 * something the old screens never show (D146: discount type + customer source), STAFF gets an error they cannot fix from
 * that page. This banner tells them a new version is out, so they reload before it bites.
 *
 * How it knows: every build gives the entry script a new file name (`assets/index-<hash>-g2.js`). The banner compares the
 * name this tab loaded with the module script of a fresh `index.html` (nginx serves it uncached), when the tab comes back into
 * view and every few minutes. The latest answer decides, so a stale copy from a container still being replaced mid-deploy does not
 * leave the banner up once the next check sees this tab's build. It never reloads by itself: STAFF may be halfway through an order.
 */

const CHECK_EVERY_MS = 3 * 60 * 1000;
const ENTRY_RE = /\/assets\/index-[^"'\s]+\.js/;

/** The entry script this tab is running, or null in `vite dev` (no built entry, nothing to compare). */
function loadedEntry(): string | null {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const s of scripts) {
    const m = new URL(s.src, window.location.href).pathname.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
}

/** The entry of an `index.html`: the `src` of its module script (not a preload link or a comment that happens to name a file). */
function entryOf(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const m = src ? new URL(src, window.location.href).pathname.match(ENTRY_RE) : null;
    if (m) return m[0];
  }
  return null;
}

async function latestEntry(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    return entryOf(await res.text());
  } catch {
    return null; // offline or mid-deploy: try again next time
  }
}

export function NewVersionBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const mine = loadedEntry();
    if (!mine) return;
    let stopped = false;
    let checking = false; // focus and visibilitychange fire together: one check at a time
    const check = async () => {
      if (stopped || checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const latest = await latestEntry();
        if (!stopped && latest) setOutdated(latest !== mine);
      } finally {
        checking = false;
      }
    };
    const onVisible = () => void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="new-version-banner" role="status">
      <span>มีเวอร์ชันใหม่ของระบบ กรุณาโหลดหน้าใหม่ก่อนทำรายการต่อ (ข้อมูลที่บันทึกแล้วไม่หาย)</span>
      <button type="button" onClick={() => window.location.reload()}>
        โหลดหน้าใหม่
      </button>
    </div>
  );
}
