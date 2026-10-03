/**
 * Password rules shared by the server (authoritative) and the UI (instant
 * feedback). Pure function — safe to import on both sides.
 */
export const MIN_PASSWORD_LENGTH = 12;

const COMMON = new Set([
  "password1234",
  "password12345",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "iloveyou1234",
  "admin1234567",
  "administrator",
  "ledgerflow123",
  "ledgerflow1234",
  "welcome12345",
  "letmein12345",
  "changeme1234",
  "abcdefghijkl",
  "abc123abc123",
  "111111111111",
  "000000000000",
]);

/** Returns an error message, or `null` when the password is acceptable. */
export function validatePassword(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose something less guessable.";
  if (username && username.trim().length >= 3 && lower.includes(username.trim().toLowerCase())) {
    return "Password must not contain your username.";
  }
  if (new Set(lower).size < 5) return "Password is too repetitive. Use a wider mix of characters.";
  return null;
}
