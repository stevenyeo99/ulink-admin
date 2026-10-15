// One date-and-time format for a case's page (header, timeline, technical details) — the browser's local format.
export function formatTimestamp(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}
