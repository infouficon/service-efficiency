import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toggleOption } from '../features/session/workflow';

export function Modal({
  title,
  isOpen = true,
  onClose,
  children,
  maxWidth,
}: {
  title: ReactNode;
  isOpen?: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-box" style={maxWidth ? { maxWidth } : undefined}>
        <div className="modal-header">
          <h2 id="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {title}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '';
  const classes = `button ${variant} ${sizeClass} ${className}`.trim();
  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
export function Panel({
  title,
  eyebrow,
  children,
}: {
  title: ReactNode;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  none = true,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (value: string[]) => void;
  none?: boolean;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="choices">
        {options.map((option) => (
          <label
            className={`choice ${value.includes(option) ? 'selected' : ''}`}
            key={option}
          >
            <input
              type="checkbox"
              checked={value.includes(option)}
              onChange={() => onChange(toggleOption(value, option))}
            />
            <span>{option}</span>
          </label>
        ))}
        {none && (
          <Button variant="secondary" size="sm" onClick={() => onChange([])}>
            None / ล้างรายการ
          </Button>
        )}
      </div>
    </fieldset>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? 'error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
