import type { Clock } from './types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Parses 'YYYY-MM-DD' (or '-1500-03-01' for BC years) as a UTC date. */
function parseStart(iso: string): Date {
  const m = iso.match(/^(-?\d+)-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Bad date ${iso}`);
  const d = new Date(Date.UTC(2000, Number(m[2]) - 1, Number(m[3])));
  d.setUTCFullYear(Number(m[1]));
  return d;
}

export function clockDate(c: Clock): Date {
  const d = parseStart(c.startDate);
  return new Date(d.getTime() + c.hours * 3_600_000);
}

export function formatDate(c: Clock, opts: { time?: boolean } = {}): string {
  const d = clockDate(c);
  const y = d.getUTCFullYear();
  const year = y <= 0 ? `${1 - y} BC` : y < 1000 ? `${y} AD` : `${y}`;
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${year}`;
  return opts.time ? `${base}, ${String(d.getUTCHours()).padStart(2, '0')}:00` : base;
}

export function formatShortDate(c: Clock): string {
  const d = clockDate(c);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

/** Whole hours from the clock's start date to an ISO date (negative if earlier). */
export function hoursUntil(startDate: string, date: string): number {
  return Math.round((parseStart(date).getTime() - parseStart(startDate).getTime()) / 3_600_000);
}

/** 1-based turn number ("Day 1" is the first day). */
export const turnNumber = (c: Clock) => Math.floor(c.hours / c.turnHours) + 1;
