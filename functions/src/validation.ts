// ─── Input Validation Helpers ─────────────────────────────────────────────────

export const MAX_KEYWORD_LEN = 120;
export const MAX_LOCATION_LEN = 200;
export const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,\-'&#/()_]+$/u;

export function sanitizeString(raw: unknown, maxLen: number = 500): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, maxLen);
  if (trimmed.length === 0) return null;
  if (!SAFE_TEXT_RE.test(trimmed)) return null;
  return trimmed;
}
