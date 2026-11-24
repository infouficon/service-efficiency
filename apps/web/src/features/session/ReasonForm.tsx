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
        {options.map((option) => {
          const selected = reason === option;
          return (
            <div
              key={option}
              className={`custom-radio-card ${selected ? 'selected' : ''}`}
              onClick={() => {
                setReason(option);
                setText('');
              }}
            >
              <div className="custom-radio-circle">
                {selected && <div className="custom-radio-dot" />}
              </div>
              <span className="custom-radio-title">{option}</span>
            </div>
          );
        })}
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
