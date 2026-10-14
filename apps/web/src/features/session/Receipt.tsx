import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Printer } from 'lucide-react';
import { Button } from '../../components/ui';
import type { MockSession } from '../../types/session';
import { qrCode } from '../../utils/qr';
import { itemName } from './workflow';

/**
 * The receipt of a session on paper (F9, D58): a plain order summary for an 80 mm printer, **without prices** (the legal
 * receipt stays in U POS), with the branch's registration QR at the bottom (F10). It lives in a portal on `<body>` so the
 * print stylesheet can hide everything else and print only this.
 */
/** A QR code of `text` as an SVG (with its quiet zone). `size` in pixels, or leave it to the stylesheet (`className`). */
export function QrCodeSvg({
  text,
  size,
  className,
}: {
  text: string;
  size?: number;
  className?: string;
}) {
  const qr = qrCode(text);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`-4 -4 ${qr.size + 8} ${qr.size + 8}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect
        x="-4"
        y="-4"
        width={qr.size + 8}
        height={qr.size + 8}
        fill="#fff"
      />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

export function ReceiptSheet({
  session,
  printedAt,
}: {
  session: MockSession;
  printedAt: string;
}) {
  const url = session.branchRegistrationUrl;
  const s = session.selection;
  const accessories = Object.entries(s.accessories);
  const perks = [
    s.ontop.length > 0 ? `Ontop: ${s.ontop.join(', ')}` : '',
    s.points.length > 0 ? `สะสมแต้ม: ${s.points.join(', ')}` : '',
    s.burnPoints.length > 0 ? `ตัดแต้ม: ${s.burnPoints.join(', ')}` : '',
  ].filter(Boolean);
  return (
    <div className="receipt-print-root" aria-hidden="true">
      <div className="receipt">
        <h1>{session.branchName || 'U-Store'}</h1>
        {session.branchPhone && (
          <p className="receipt-center">โทร {session.branchPhone}</p>
        )}
        <hr />
        <p className="receipt-center receipt-title">ใบเสร็จรับสินค้า</p>
        <p className="receipt-center receipt-note">(สรุปรายการ ไม่แสดงราคา)</p>
        <p className="receipt-queue">{session.queue}</p>
        <p className="receipt-row">
          <span>วันที่</span>
          <span>{printedAt}</span>
        </p>
        <p className="receipt-row">
          <span>พนักงาน</span>
          <span>{session.staffId}</span>
        </p>
        <hr />
        {s.items.map((item) => (
          <p className="receipt-row" key={item.id ?? item.product.id}>
            <span>{itemName(item)}</span>
            <span>x{item.quantity}</span>
          </p>
        ))}
        {accessories.map(([name, qty]) => (
          <p className="receipt-row" key={name}>
            <span>{name}</span>
            <span>x{qty}</span>
          </p>
        ))}
        <hr />
        <p className="receipt-row">
          <span>ชำระโดย</span>
          <span>{s.payments.join(', ') || '-'}</span>
        </p>
        {perks.map((line) => (
          <p key={line} className="receipt-small">
            {line}
          </p>
        ))}
        {url && (
          <>
            <hr />
            <QrCodeSvg text={url ?? ''} className="receipt-qr" />
            <p className="receipt-center receipt-small">
              สแกนเพื่อลงทะเบียนสมาชิก
            </p>
          </>
        )}
        <hr />
        <p className="receipt-center">ขอบคุณที่ใช้บริการ</p>
      </div>
    </div>
  );
}

/** The time on the paper (th-TH, short). */
export const nowText = () =>
  new Date().toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

/** The "พิมพ์ใบเสร็จ" button of a session (F9) and, off screen, the receipt it prints. */
export function ReceiptPrint({ session }: { session: MockSession }) {
  const [printedAt, setPrintedAt] = useState('');
  // the time on the paper is the time of printing, for the button and for Ctrl+P alike: it is put into the sheet just
  // before the browser takes the page
  useEffect(() => {
    const stamp = () => flushSync(() => setPrintedAt(nowText()));
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  return (
    <>
      <div className="receipt-print-action">
        <Button variant="secondary" onClick={() => window.print()}>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={16} />
            พิมพ์ใบเสร็จ
          </span>
        </Button>
        {!session.branchRegistrationUrl && (
          <span className="fine">
            สาขานี้ยังไม่มี URL ลงทะเบียน ใบเสร็จจะไม่มี QR (ADMIN ตั้งค่าที่
            จัดการระบบ → จัดการสาขา)
          </span>
        )}
      </div>
      {createPortal(
        <ReceiptSheet session={session} printedAt={printedAt} />,
        document.body,
      )}
    </>
  );
}
