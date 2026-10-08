import {
  ClipboardList,
  User as UserIcon,
  Phone,
  ShoppingBag,
  Percent,
  CreditCard,
} from 'lucide-react';
import type { MockSession } from '../../types/session';

interface SummaryProps {
  session: MockSession;
  hideHeader?: boolean;
  title?: string;
}

export function Summary({
  session,
  hideHeader = false,
  title = 'สรุปข้อมูลคำสั่งซื้อ & การชำระเงิน',
}: SummaryProps) {
  const s = session.selection;
  const branchLabel =
    session.branchName || (session.branchCode ? `สาขา ${session.branchCode}` : '—');

  const accessoriesList = Object.entries(s?.accessories || {});

  return (
    <div className="cashier-summary-card">
      {!hideHeader && (
        <div className="summary-card-header">
          <ClipboardList size={18} color="#0abab5" />
          <h3 style={{ margin: 0, fontSize: '15px' }}>{title}</h3>
        </div>
      )}

      <div className="summary-subsections-wrap">
        {/* Section A: Customer & Staff Info */}
        <div className="summary-subsection">
          <div className="subsection-title">
            <UserIcon size={15} /> ข้อมูลลูกค้า & ผู้ให้บริการ
          </div>
          <div className="subsection-grid">
            <div className="info-item-row">
              <span className="info-item-label">เบอร์โทรศัพท์ลูกค้า:</span>
              <span className="info-item-value" style={{ letterSpacing: '0.5px' }}>
                {session.phone ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={13} color="#0abab5" /> {session.phone}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="info-item-row">
              <span className="info-item-label">Staff ผู้ดูแล:</span>
              <span className="info-item-value">{session.staffId}</span>
            </div>
            <div className="info-item-row">
              <span className="info-item-label">สาขา:</span>
              <span className="info-item-value">{branchLabel}</span>
            </div>
          </div>
        </div>

        {/* Section B: Product & Accessories */}
        <div className="summary-subsection">
          <div className="subsection-title">
            <ShoppingBag size={15} /> รายการสินค้า & อุปกรณ์เสริม
          </div>
          <div className="subsection-grid">
            {s?.product ? (
              <>
                <div className="info-item-row">
                  <span className="info-item-label">สินค้าหลัก (Model):</span>
                  <span className="info-item-value">
                    {s.product.category ? `${s.product.category} · ` : ''}
                    {s.product.model || s.product.product}
                  </span>
                </div>
                <div className="info-item-row">
                  <span className="info-item-label">รหัสสินค้า (SKU):</span>
                  <span className="product-sku-chip">
                    {s.product.sku || '—'}
                  </span>
                </div>
              </>
            ) : (
              <div className="info-item-row">
                <span className="info-item-label">สินค้าหลัก:</span>
                <span className="muted" style={{ fontSize: '13px' }}>
                  {accessoriesList.length > 0
                    ? 'ซื้อเฉพาะอุปกรณ์เสริม'
                    : 'ยังไม่ได้ระบุสินค้า'}
                </span>
              </div>
            )}
            <div className="info-item-row" style={{ alignItems: 'flex-start' }}>
              <span className="info-item-label" style={{ paddingTop: '4px' }}>
                อุปกรณ์เสริม:
              </span>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  flex: 1,
                }}
              >
                {accessoriesList.length > 0 ? (
                  accessoriesList.map(([name, qty]) => (
                    <span key={name} className="accessory-chip-pill">
                      <strong>{name}</strong>
                      <span style={{ color: '#0abab5', fontWeight: 700 }}>
                        × {qty}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="muted" style={{ fontSize: '13px' }}>
                    ไม่มีอุปกรณ์เสริม
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section C: Payment & Promotions */}
        <div className="summary-subsection">
          <div className="subsection-title">
            <Percent size={15} /> วิธีชำระเงิน & สิทธิพิเศษ
          </div>
          <div className="subsection-grid">
            <div className="info-item-row">
              <span className="info-item-label">วิธีชำระเงิน:</span>
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                }}
              >
                {s?.payments && s.payments.length > 0 ? (
                  s.payments.map((p) => (
                    <span key={p} className="payment-tag-chip">
                      <CreditCard size={12} /> {p}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            </div>
            {s?.ontop && s.ontop.length > 0 && (
              <div className="info-item-row">
                <span className="info-item-label">Ontop:</span>
                <span className="info-item-value">{s.ontop.join(', ')}</span>
              </div>
            )}
            {s?.points && s.points.length > 0 && (
              <div className="info-item-row">
                <span className="info-item-label">สะสมคะแนน:</span>
                <span className="info-item-value">{s.points.join(', ')}</span>
              </div>
            )}
            {s?.burnPoints && s.burnPoints.length > 0 && (
              <div className="info-item-row">
                <span className="info-item-label">ตัดแต้ม (Burn Points):</span>
                <span className="info-item-value">
                  {s.burnPoints.join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
