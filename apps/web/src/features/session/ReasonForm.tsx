import { useState } from 'react';
import { Button } from '../../components/ui';
import { reasonIsValid } from './workflow';
export function ReasonForm({
  options,
  onSubmit,
  onBack,
  label,
}: {
  options: readonly string[];
  onSubmit: (reason: string, text: string) => void;
  onBack: () => void;
  label: string;
}) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reasonIsValid(reason, text)) onSubmit(reason, text.trim());
      }}
    >
      <fieldset>
        <legend>เลือกเหตุผล</legend>
        {options.map((option) => (
          <label className="reason" key={option}>
            <input
              type="radio"
              name="reason"
              checked={reason === option}
              onChange={() => {
                setReason(option);
                setText('');
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>
      {reason === 'อื่น ๆ' && (
        <label>
          ข้อความเพิ่มเติม
          <textarea
            autoFocus
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      <div className="actions">
        <Button variant="secondary" onClick={onBack}>
          กลับ
        </Button>
        <Button type="submit" disabled={!reasonIsValid(reason, text)}>
          {label}
        </Button>
      </div>
    </form>
  );
}
