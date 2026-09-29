import type { MockSession } from '../../types/session';
export function Summary({ session }: { session: MockSession }) {
  const s = session.selection;
  return (
    <dl className="summary">
      <dt>Customer Phone</dt>
      <dd>{session.phone || '—'}</dd>
      <dt>Staff ID</dt>
      <dd>{session.staffId}</dd>
      <dt>Product Category</dt>
      <dd>{s.product?.category ?? '—'}</dd>
      <dt>Product / Model / SKU</dt>
      <dd>
        {s.product
          ? `${s.product.product} / ${s.product.model} / ${s.product.sku}`
          : 'ยังไม่ได้เลือกสินค้า'}
      </dd>
      <dt>Accessories</dt>
      <dd>
        {Object.entries(s.accessories)
          .map(([name, quantity]) => `${name} × ${quantity || 'ยังไม่ระบุ'}`)
          .join(', ') || '—'}
      </dd>
      {(
        [
          ['Ontop', s.ontop],
          ['Points', s.points],
          ['Burn Point', s.burnPoints],
          ['Payment', s.payments],
        ] as const
      ).map(([name, values]) => (
        <div className="summary-row" key={name}>
          <dt>{name}</dt>
          <dd>{values.join(', ') || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
