import { useState, type FormEvent } from 'react';
import { UserCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import { PhoneInput } from '../../components/PhoneInput';
import { phoneIsValid } from './workflow';

/**
 * Step 1 of a walk-in (D56, D68, D70, D120): the customer's phone number.
 * Supports Thai mobile (9 digits without 0), Thai company (8 digits without 0), and international numbers.
 * Submitting creates the session directly in PRODUCT_SELECTION.
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

  const isInvalid = attempted && !phoneIsValid(phone);

  return (
    <form className="walkin-form" onSubmit={submit} noValidate>
      <label style={{ display: 'block', marginBottom: '8px' }}>
        <span style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>
          หมายเลขโทรศัพท์ลูกค้า (Customer Phone Number)
        </span>
        <PhoneInput
          value={phone}
          onChange={(newPhone) => {
            setPhone(newPhone);
            setAttempted(false);
          }}
          autoFocus
          disabled={busy}
          ariaInvalid={isInvalid}
          ariaDescribedBy="walkin-phone-help"
        />
      </label>
      <p
        id="walkin-phone-help"
        className={isInvalid ? 'field-error' : 'fine'}
      >
        {isInvalid
          ? 'กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (เบอร์ไทยไม่ต้องใส่ 0 นำหน้า หรือเลือกประเทศสำหรับเบอร์ต่างประเทศ)'
          : 'กรอกเบอร์โทรศัพท์ลูกค้าเพื่อเริ่มให้บริการ (รองรับเบอร์ไทยและเบอร์ต่างประเทศ)'}
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
