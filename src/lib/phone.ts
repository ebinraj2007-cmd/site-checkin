// Phone numbers are stored as international digits without "+", e.g. "971501234567".
// That is the form WhatsApp's wa.me links and the login lookup both use.

export function normalizePhone(raw: string, countryCode = ""): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cc = countryCode.replace(/\D/g, "");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (cc) {
    const national = digits.replace(/^0+/, "");
    // "971501234567" typed without "+" is already international; "0501234567" is not.
    const alreadyInternational = digits.startsWith(cc) && digits.length >= cc.length + 8;
    digits = alreadyInternational ? digits : cc + national;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function displayPhone(digits: string): string {
  return digits ? `+${digits}` : "";
}

export function whatsappLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function telLink(digits: string): string {
  return `tel:+${digits}`;
}
