import { useEffect, useState, type FormEvent } from 'react';
import { Ticket } from 'lucide-react';
import { Button, Notice } from '../../components/ui';
import { fetchCustomerTypesApi } from '../../services/sessionApi';
import type { CustomerType } from '../../types/session';
import { phoneIsValid } from './workflow';

/**
 * Step 1 of a walk-in (D56, D57): the customer's phone number and customer type. Submitting creates the
 * session, and the server hands out the queue number ("คิว A012") that staff use to call the customer.
 */
export function WalkInForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (phone: string, customerTypeId?: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [types, setTypes] = useState<CustomerType[] | null>(null);
  const [typeId, setTypeId] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    fetchCustomerTypesApi()
      .then((list) => {
        if (!active) return;
        setTypes(list);
        // the list comes in letter order: the first one is the default type
        setTypeId((current) => current || list[0]?.id || '');
      })
      .catch((err: unknown) => {
        if (active)
          setLoadError(
            err instanceof Error ? err.message : 'โหลดประเภทลูกค้าไม่สำเร็จ',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!phoneIsValid(phone)) {
      setAttempted(true);
      return;
    }
    onSubmit(phone, typeId || undefined);
  };

  return (
    <form className="walkin-form" onSubmit={submit} noValidate>
      <label>
        หมายเลขโทรศัพท์ลูกค้า (Customer Phone Number)
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          className="walkin-phone"
          placeholder="เบอร์โทรศัพท์ 10 หลัก"
          aria-invalid={attempted && !phoneIsValid(phone)}
          aria-describedby="walkin-phone-help"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
            setAttempted(false);
          }}
        />
      </label>
      <p
        id="walkin-phone-help"
        className={attempted && !phoneIsValid(phone) ? 'field-error' : 'fine'}
      >
        {attempted && !phoneIsValid(phone)
          ? `กรุณากรอกตัวเลข 0–9 ให้ครบ 10 หลัก (ขณะนี้ ${phone.length}/10)`
          : 'เริ่มที่เบอร์โทรลูกค้า แล้วเลือกประเภทลูกค้าเพื่อรับคิว'}
      </p>

      <fieldset className="type-picker">
        <legend>ประเภทลูกค้า</legend>
        {loadError && <Notice error>{loadError}</Notice>}
        {types === null && !loadError && (
          <span className="fine">กำลังโหลด…</span>
        )}
        {types?.map((type) => (
          <button
            type="button"
            key={type.id}
            className={`type-card ${typeId === type.id ? 'selected' : ''}`}
            aria-pressed={typeId === type.id}
            onClick={() => setTypeId(type.id)}
          >
            <span className="type-letter">{type.letter}</span>
            <span className="type-name">{type.name}</span>
            {type.description && (
              <span className="type-description">{type.description}</span>
            )}
          </button>
        ))}
      </fieldset>

      <Button type="submit" size="lg" disabled={busy || types === null}>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <Ticket size={18} />
          {busy ? 'กำลังรับคิว…' : 'รับคิว'}
        </span>
      </Button>
    </form>
  );
}
