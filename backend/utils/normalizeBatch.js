// Admins sometimes type a placeholder like "-" or "N/A" into a free-text
// batch field meaning "not applicable" — but the rest of the app treats
// any non-null Event.batch as a real batch to scope registrations,
// auto-registration cascades, and student visibility by. A stored "-"
// silently behaves as its own (empty, unmatchable) batch, hiding the event
// from every student. This normalizes those placeholders to true null at
// the point of write, so "no batch" is always represented the one way the
// rest of the codebase already checks for.
const PLACEHOLDER_BATCH_VALUES = new Set(["-", "--", "n/a", "na", "none", "nil", "null"]);

export const normalizeBatch = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_BATCH_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
};
