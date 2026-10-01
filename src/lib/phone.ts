import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/max";

// Phone numbers are stored as international digits without "+", e.g. "971501234567".
// That is the form WhatsApp's wa.me links and the login lookup both use.

// A number typed with or without the country code ("050 123 4567", "+971 50 123 4567",
// "00971…", even "971501234567") → "971501234567". Null if it isn't a real number.
export function normalizePhone(raw: string, countryCode = ""): string | null {
  const text = raw.trim().replace(/^00/, "+");
  if (!text) return null;
  const cc = countryCode.replace(/\D/g, "");
  const parsed = parsePhoneNumberFromString(text, cc ? { defaultCallingCode: cc } : undefined);
  return parsed?.isValid() ? parsed.number.slice(1) : null;
}

// "971501234567" → "+971 50 123 4567"
export function displayPhone(digits: string): string {
  if (!digits) return "";
  return parsePhoneNumberFromString(`+${digits}`)?.formatInternational() ?? `+${digits}`;
}

export function whatsappLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function telLink(digits: string): string {
  return `tel:+${digits}`;
}

// Countries that use a calling code: "971" → ["AE"], "44" → ["GB", "GG", "IM", "JE"].
export function countriesForCallingCode(code: string): string[] {
  const digits = code.replace(/\D/g, "");
  return digits ? getCountries().filter((c) => getCountryCallingCode(c) === digits) : [];
}

// "AE" → "United Arab Emirates"
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
