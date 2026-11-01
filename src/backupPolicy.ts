export interface BackupStamp {
  key: number;
  time: number;
}

export const KEEP_RECENT = 20;
export const KEEP_DAYS = 30;
export const BACKUP_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Which backups to delete. Keeps the newest KEEP_RECENT backups (the last
 * ~40 minutes of drawing), plus the last backup of each day for KEEP_DAYS days.
 */
export function backupsToDelete(stamps: BackupStamp[], now: number): number[] {
  const sorted = [...stamps].sort((a, b) => b.time - a.time);
  const keep = new Set<number>();
  sorted.slice(0, KEEP_RECENT).forEach((s) => keep.add(s.key));
  const seenDays = new Set<string>();
  const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const s of sorted) {
    if (s.time < cutoff) continue;
    const d = new Date(s.time);
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!seenDays.has(day)) {
      seenDays.add(day);
      keep.add(s.key);
    }
  }
  return sorted.filter((s) => !keep.has(s.key)).map((s) => s.key);
}
