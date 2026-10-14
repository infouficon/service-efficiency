import { useState, type FormEvent } from 'react';
import { UserCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import { phoneIsValid } from './workflow';

/**
 * Step 1 of a walk-in (D56, D68, D70): the customer's phone number. Submitting creates the
 * session directly in PRODUCT_SELECTION. The queue number is allocated later at confirmation.
 */
export function WalkInForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (phone: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!phoneIsValid(phone)) {
      setAttempted(true);
      return;
    }
    onSubmit(phone);
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
          : 'กรอกเบอร์โทรศัพท์ลูกค้าเพื่อเริ่มให้บริการ'}
      </p>

      <Button type="submit" size="lg" disabled={busy}>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <UserCheck size={18} />
          {busy ? 'กำลังเริ่มบริการ…' : 'เริ่มบริการ'}
        </span>
      </Button>
    </form>
  );
}
