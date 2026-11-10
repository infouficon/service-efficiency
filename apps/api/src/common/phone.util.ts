import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';

/**
 * Normalizes any phone number into E.164 format (+66812345678, +14155552671).
 *
 * Rules:
 * - If raw starts with `+`: parsed directly as international number.
 * - If defaultCountry is 'TH' (default) and number starts with '0' (e.g. 0812345678 or 021234567),
 *   the leading '0' is stripped (D120) before parsing.
 * - Supports Thai mobile (9 digits without 0) and Thai company/landline (8 digits without 0, e.g. 02-xxx-xxxx -> 2xxxxxxx).
 * - Returns the E.164 string on success, or null if invalid.
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

  // Remove spaces, hyphens, parentheses, etc.
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return null;

  // Thai phone handling: strip leading 0
  const cleanNumber = defaultCountry === 'TH' ? digitsOnly.replace(/^0+/, '') : digitsOnly;
  const parsed = parsePhoneNumberFromString(cleanNumber, defaultCountry);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * Returns true if the phone number can be normalized into a valid E.164 number.
 */
export function isValidPhone(raw: string | null | undefined, defaultCountry: CountryCode = 'TH'): boolean {
  return normalizePhone(raw, defaultCountry) !== null;
}

/**
 * Class-validator decorator for customer phone numbers (Thai mobile/company or international).
 */
export function IsCustomerPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCustomerPhone',
      target: object.constructor,
      propertyName: propertyName,
      options: {
        message: 'Phone number must be a valid phone number (Thai mobile, 9-digit company, or international E.164)',
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          return typeof value === 'string' && isValidPhone(value);
        },
      },
    });
  };
}

/**
 * Format phone for customer-facing / staff display.
 * - Thai numbers: 081-234-5678 (mobile) or 02-123-4567 (company / landline)
 * - Foreign numbers: +81 90 1234 5678
 */
export function formatDisplayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const parsed = parsePhoneNumberFromString(phone.startsWith('+') ? phone : '+66' + phone.replace(/^0+/, ''));
  if (parsed && parsed.isValid()) {
    if (parsed.country === 'TH') {
      const national = parsed.formatNational();
      return national.replace(/\s+/g, '-');
    }
    return parsed.formatInternational();
  }
  return phone;
}

/**
 * Format customerPhone when sending to FileMaker Pro or POS outbound payloads (D120).
 * - Thai numbers (+66...): converted back to local format with leading 0 (e.g. +66812345678 -> 0812345678, +6621234567 -> 021234567)
 *   so legacy POS/FileMaker ERP customer lookups find the record by cust_tel.
 * - Foreign numbers: sent as E.164 string (e.g. +819012345678).
 */
export function toOutboundCustomerPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.startsWith('+66')) {
    return '0' + phone.slice(3);
  }
  return phone;
}
