import { useEffect, useState } from 'react';

/**
 * D182: a tab left open across a deploy keeps running the old screens against the new API. When the API starts asking for
 * something the old screens never show (D146: discount type + customer source), STAFF gets an error they cannot fix from
 * that page. This banner tells them a new version is out, so they reload before it bites.
 *
 * How it knows: every build gives the entry script a new file name (`assets/index-<hash>-g2.js`). The banner compares the
 * name this tab loaded with the one in a fresh `index.html` (nginx serves it uncached), when the tab comes back into view
 * and every few minutes. It never reloads by itself: STAFF may be halfway through an order.
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

async function latestEntry(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const m = (await res.text()).match(ENTRY_RE);
    return m ? m[0] : null;
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
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      const latest = await latestEntry();
      if (!stopped && latest && latest !== mine) setOutdated(true);
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
