import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import type { CountryCode } from 'libphonenumber-js';
import {
  getAllCountries,
  cleanNationalNumber,
  splitPhoneForInput,
  toE164,
  isValidNationalNumber,
  type CountryInfo,
} from '../utils/phone';

export interface PhoneInputProps {
  value: string;
  onChange: (e164Value: string, isValid: boolean) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

export function PhoneInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  placeholder,
  className = '',
  ariaInvalid,
  ariaDescribedBy,
}: PhoneInputProps) {
  const allCountries = useMemo(() => getAllCountries(), []);
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>('TH');
  const [nationalNumber, setNationalNumber] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // Sync internal state with external value prop
  useEffect(() => {
    const parts = splitPhoneForInput(value);
    setSelectedCountry(parts.country);
    setNationalNumber(parts.nationalNumber);
  }, [value]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const currentCountryInfo = useMemo(() => {
    return allCountries.find((c) => c.code === selectedCountry) || allCountries[0];
  }, [allCountries, selectedCountry]);

  // Filter countries by search query
  const filteredCountries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allCountries;
    return allCountries.filter(
      (c) =>
        c.nameTh.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.replace('+', '').includes(q.replace('+', '')),
    );
  }, [allCountries, searchQuery]);

  const handleCountrySelect = (country: CountryInfo) => {
    setSelectedCountry(country.code);
    setIsOpen(false);
    setSearchQuery('');

    // Re-clean existing digits under new country rules
    const cleaned = cleanNationalNumber(nationalNumber, country.code);
    setNationalNumber(cleaned);

    const valid = isValidNationalNumber(cleaned, country.code);
    const e164 = toE164(cleaned, country.code) || cleaned;
    onChange(e164, valid);

    phoneInputRef.current?.focus();
  };

  const handleNumberChange = (rawInput: string) => {
    const cleaned = cleanNationalNumber(rawInput, selectedCountry);
    setNationalNumber(cleaned);

    const valid = isValidNationalNumber(cleaned, selectedCountry);
    const e164 = toE164(cleaned, selectedCountry) || cleaned;
    onChange(e164, valid);
  };

  const defaultPlaceholder =
    placeholder ??
    (selectedCountry === 'TH'
      ? 'เช่น 81 234 5678 หรือ 2 123 4567 (ไม่ต้องใส่ 0)'
      : 'เบอร์โทรศัพท์');

  return (
    <div
      ref={containerRef}
      className={`phone-input-group ${className}`}
      data-invalid={ariaInvalid ? 'true' : 'false'}
    >
      {/* Country Select Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className="phone-input-country-btn"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{currentCountryInfo.flag}</span>
          <span style={{ color: '#334155', fontWeight: 600, fontSize: '14px' }}>
            {currentCountryInfo.dialCode}
          </span>
        </span>
        <ChevronDown size={14} style={{ color: '#64748b' }} />
      </button>

      {/* Main Phone Number Input */}
      <input
        ref={phoneInputRef}
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={defaultPlaceholder}
        value={nationalNumber}
        onChange={(e) => handleNumberChange(e.target.value)}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="phone-input-field"
      />

      {/* Dropdown list with search */}
      {isOpen && (
        <div className="phone-dropdown-menu">
          {/* Search box with comfortable padding & rounded inner box */}
          <div className="phone-search-header">
            <div className="phone-search-box">
              <Search size={15} style={{ color: '#94a3b8', flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="ค้นหาประเทศหรือรหัสโทร (+66, ไทย, Japan...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="phone-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="phone-search-clear"
                  title="ล้างคำค้นหา"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Countries scrollable list */}
          <div
            role="listbox"
            style={{
              overflowY: 'auto',
              flex: 1,
              padding: '6px 0',
            }}
          >
            {filteredCountries.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                ไม่พบประเทศที่ค้นหา
              </div>
            ) : (
              filteredCountries.map((c) => {
                const isSelected = c.code === selectedCountry;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleCountrySelect(c)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 14px',
                      border: 'none',
                      background: isSelected ? '#eff6ff' : 'transparent',
                      color: isSelected ? '#1d4ed8' : '#1e293b',
                      fontSize: '13.5px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{ fontSize: '19px', lineHeight: 1 }}>{c.flag}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.nameTh}{' '}
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>({c.nameEn})</span>
                    </span>
                    <span style={{ color: '#64748b', fontWeight: 500, fontSize: '12.5px' }}>{c.dialCode}</span>
                    {isSelected && <Check size={15} style={{ color: '#2563eb', marginLeft: '4px', flexShrink: 0 }} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
