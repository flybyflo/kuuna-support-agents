export function initialsFromTitle(title: string): string {
  const normalized = title
    .trim()
    .replace(/^@+/, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim();
  if (!normalized) return "??";

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}
