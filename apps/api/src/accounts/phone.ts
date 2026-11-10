/** A Thai mobile number as 10 digits ("0812345678") from the spellings the ERP and people use; null when it is not one. */
export function normalizeThaiMobile(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return /^0[689]\d{8}$/.test(digits) ? digits : null;
}
