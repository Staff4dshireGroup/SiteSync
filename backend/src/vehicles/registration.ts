/**
 * UK registration plates accepted after spaces and punctuation are removed:
 * current (AB12CDE), prefix (A123BCD), suffix (ABC123A), and dateless / NI.
 */
const UK_REGISTRATION =
  /^(?:[A-Z]{2}\d{2}[A-Z]{3}|[A-Z]\d{1,3}[A-Z]{3}|[A-Z]{3}\d{1,3}[A-Z]|[A-Z]{1,3}\d{1,4}|\d{1,4}[A-Z]{1,3})$/;

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeRegistration(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isUkRegistration(input: string): boolean {
  return UK_REGISTRATION.test(normalizeRegistration(input));
}

export function formatRegistration(stored: string): string {
  const normalized = normalizeRegistration(stored);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(normalized)) {
    return `${normalized.slice(0, 4)} ${normalized.slice(4)}`;
  }
  return normalized;
}

export function normalizeVin(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidVin(input: string): boolean {
  return VIN.test(normalizeVin(input));
}
