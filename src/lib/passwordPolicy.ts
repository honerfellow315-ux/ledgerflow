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

/** Common bases. A password is rejected when, after stripping trailing digits
 * and symbols, it is one of these (so "Password123!" and "admin2024" fail too). */
const COMMON_BASES = new Set([
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "qwerty",
  "qwertyuiop",
  "iloveyou",
  "changeme",
  "ledgerflow",
  "abcdef",
  "abcdefgh",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "master",
  "login",
  "princess",
  "sunshine",
  "trustno",
  "pakistan",
  "london",
]);

/** Returns an error message, or `null` when the password is acceptable. */
export function validatePassword(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  const lower = password.toLowerCase();
  if (
    COMMON.has(lower) ||
    COMMON_BASES.has(lower.replace(/[^a-z]+$/, "").replace(/^[^a-z]+/, ""))
  ) {
    return "That password is too common. Choose something less guessable.";
  }
  if (/^\d+$/.test(password)) return "Password cannot be only numbers.";
  if (username && username.trim().length >= 3 && lower.includes(username.trim().toLowerCase())) {
    return "Password must not contain your username.";
  }
  if (new Set(lower).size < 5) return "Password is too repetitive. Use a wider mix of characters.";
  return null;
}
