import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js';

export interface CountryInfo {
  code: CountryCode;
  nameTh: string;
  nameEn: string;
  dialCode: string;
  flag: string;
}

const POPULAR_CODES: CountryCode[] = [
  'TH', 'LA', 'MM', 'KH', 'CN', 'JP', 'KR', 'SG', 'MY', 'VN', 'US', 'GB', 'AU', 'DE', 'FR', 'IN', 'RU', 'TW', 'HK',
];

const thNames = new Intl.DisplayNames(['th'], { type: 'region' });
const enNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function getFlagEmoji(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/**
 * Returns all countries formatted with Thai names, English names, dial code, and flag emoji.
 * Popular countries are at the beginning of the list.
 */
export function getAllCountries(): CountryInfo[] {
  const allCodes = getCountries();
  const mapCountry = (code: CountryCode): CountryInfo => {
    let nameTh: string = code;
    let nameEn: string = code;
    try {
      nameTh = thNames.of(code) || code;
    } catch {
      // Fallback to code
    }
    try {
      nameEn = enNames.of(code) || code;
    } catch {
      // Fallback to code
    }
    let dialCode = '';
    try {
      dialCode = '+' + getCountryCallingCode(code);
    } catch {
      // Ignore
    }
    return {
      code,
      nameTh,
      nameEn,
      dialCode,
      flag: getFlagEmoji(code),
    };
  };

  const popularSet = new Set(POPULAR_CODES);
  const popular = POPULAR_CODES.map(mapCountry);
  const others = allCodes
    .filter((c) => !popularSet.has(c))
    .map(mapCountry)
    .sort((a, b) => a.nameTh.localeCompare(b.nameTh, 'th'));

  return [...popular, ...others];
}

/**
 * Cleans the national number input based on country:
 * - For Thailand ('TH'):
 *   1. If the user types '0' at the start, cut it off automatically (D120).
 *   2. Keeps only digits.
 *   3. Enforces max length of 9 digits (mobile is 9 digits after cutting 0; company is 8 digits).
 * - For other countries:
 *   1. Keeps only digits.
 *   2. Enforces max length of 15 digits (ITU-T E.164 maximum).
 */
export function cleanNationalNumber(value: string, country: CountryCode): string {
  const digits = value.replace(/\D/g, '');
  if (country === 'TH') {
    // Strip leading 0
    const withoutZero = digits.replace(/^0+/, '');
    return withoutZero.slice(0, 9);
  }
  return digits.slice(0, 15);
}

/**
 * Normalizes input to E.164 (+66812345678, +14155552671).
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry: CountryCode = 'TH'): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject strings containing letters or invalid characters
  if (/[^\d\s\+\-\(\)\.]/.test(trimmed)) return null;

  if (trimmed.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(trimmed);
    return parsed && parsed.isValid() ? parsed.number : null;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return null;

  const cleanNumber = defaultCountry === 'TH' ? digitsOnly.replace(/^0+/, '') : digitsOnly;
  const parsed = parsePhoneNumberFromString(cleanNumber, defaultCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * Checks whether the phone string or combination of (country, nationalNumber) is valid.
 */
export function isValidPhone(raw: string | null | undefined, defaultCountry: CountryCode = 'TH'): boolean {
  return normalizePhone(raw, defaultCountry) !== null;
}

/**
 * Checks if a specific (country, nationalNumber) combination is valid.
 */
export function isValidNationalNumber(nationalNumber: string, country: CountryCode): boolean {
  if (!nationalNumber) return false;
  const parsed = parsePhoneNumberFromString(nationalNumber, country);
  return Boolean(parsed && parsed.isValid());
}

/**
 * Converts a (country, nationalNumber) pair into an E.164 phone string.
 */
export function toE164(nationalNumber: string, country: CountryCode): string | null {
  if (!nationalNumber) return null;
  const parsed = parsePhoneNumberFromString(nationalNumber, country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * Splits an existing stored phone (E.164, local, or legacy) into CountryCode and national number.
 */
export function splitPhoneForInput(phone: string | null | undefined): { country: CountryCode; nationalNumber: string } {
  if (!phone) return { country: 'TH', nationalNumber: '' };
  const trimmed = phone.trim();
  if (!trimmed) return { country: 'TH', nationalNumber: '' };

  const toParse = trimmed.startsWith('+') ? trimmed : '+66' + trimmed.replace(/^0+/, '');
  const parsed = parsePhoneNumberFromString(toParse);
  if (parsed && parsed.country) {
    return {
      country: parsed.country,
      nationalNumber: parsed.nationalNumber,
    };
  }
  return {
    country: 'TH',
    nationalNumber: trimmed.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9),
  };
}

/**
 * Friendly display formatting:
 * - Thai numbers: 081-234-5678 (mobile) or 02-123-4567 (company/landline)
 * - Foreign numbers: +81 90 1234 5678
 */
export function formatDisplayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';

  const toParse = trimmed.startsWith('+') ? trimmed : '+66' + trimmed.replace(/^0+/, '');
  const parsed = parsePhoneNumberFromString(toParse);
  if (parsed && parsed.isValid()) {
    if (parsed.country === 'TH') {
      const nat = parsed.formatNational();
      return nat.replace(/\s+/g, '-');
    }
    return parsed.formatInternational();
  }
  return phone;
}
