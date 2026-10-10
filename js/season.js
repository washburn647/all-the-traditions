// "This time of year": find each year's show closest to a date, aligning
// on moving holidays (Easter, Thanksgiving...) when the date is near one.
import { db } from './data.js';

const DAY = 86400000;

function nthWeekday(year, month, weekday, n) { // month 0-based, n>0 from start, n<0 from end
  if (n > 0) {
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

function easter(y) { // Anonymous Gregorian computus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

// Holiday-themed shows aired the Sunday on or before the holiday (checked
// against themed song titles in the archive); New Year's went either way, so
// it takes the nearest Sunday.
export const HOLIDAYS = [
  { name: "New Year's", at: y => new Date(y, 0, 1), nearest: true },
  { name: "Valentine's Day", at: y => new Date(y, 1, 14) },
  { name: "St. Patrick's Day", at: y => new Date(y, 2, 17) },
  { name: 'Easter', at: easter },
  { name: "Mother's Day", at: y => nthWeekday(y, 4, 0, 2) },
  { name: 'Memorial Day', at: y => nthWeekday(y, 4, 1, -1) },
  { name: "Father's Day", at: y => nthWeekday(y, 5, 0, 3) },
  { name: 'Fourth of July', at: y => new Date(y, 6, 4) },
  { name: 'Labor Day', at: y => nthWeekday(y, 8, 1, 1) },
  { name: 'Halloween', at: y => new Date(y, 9, 31) },
  { name: 'Thanksgiving', at: y => nthWeekday(y, 10, 4, 4) },
  { name: 'Christmas', at: y => new Date(y, 11, 25) },
];

const daysBetween = (a, b) => Math.round((a - b) / DAY);

// The Sunday a holiday's show would have aired in a given year.
export function holidaySunday(h, year) {
  const d = h.at(year), dow = d.getDay();
  const back = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  if (h.nearest && dow > 3) return new Date(back.getFullYear(), back.getMonth(), back.getDate() + 7);
  return back;
}

// The holiday a date falls near (within `window` days), if any.
export function nearHoliday(date, window = 6) {
  let best = null;
  for (const h of HOLIDAYS) {
    for (const y of [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1]) {
      const diff = Math.abs(daysBetween(date, h.at(y)));
      if (diff <= window && (!best || diff < best.diff)) best = { holiday: h, diff };
    }
  }
  return best && best.holiday;
}

// The holiday whose show this was, if any.
export function showHoliday(show) {
  for (const h of HOLIDAYS) {
    for (const y of [show.year - 1, show.year, show.year + 1]) {
      if (daysBetween(show.date, holidaySunday(h, y)) === 0) return h;
    }
  }
  return null;
}

// For each year, the show nearest the target. `month`/`day` describe the date
// (1-based month); if it sits near a moving holiday, each year aligns on that
// year's holiday instead. Returns { holiday, matches: [{ show, target, offset }] }.
export function closestShows(month, day, { maxOffset = 10 } = {}) {
  const ref = new Date(2001, month - 1, day); // non-leap reference year
  const holiday = nearHoliday(new Date(new Date().getFullYear(), month - 1, day));
  const matches = [];
  for (const year of db.years) {
    // With a holiday, aim at the Sunday its show aired but report the offset
    // from the holiday itself ("4 days before Thanksgiving").
    const target = holiday ? holidaySunday(holiday, year) : new Date(year, ref.getMonth(), ref.getDate());
    const label = holiday ? holiday.at(year) : target;
    let best = null;
    for (const s of db.shows) {
      if (Math.abs(s.year - year) > 1) continue;
      const dist = Math.abs(daysBetween(s.date, target));
      if (!best || dist < best.dist) best = { show: s, target, dist, offset: daysBetween(s.date, label) };
    }
    if (best && best.dist <= maxOffset) matches.push(best);
  }
  // A show can be nearest for two adjacent target years around New Year's; keep it once.
  const seen = new Set();
  return { holiday, matches: matches.filter(m => !seen.has(m.show.iso) && seen.add(m.show.iso)).reverse() };
}

// Every show within `window` days of month/day in any year (for seasonal stats).
export function showsNear(month, day, window = 14) {
  return db.shows.filter(s => {
    const target = new Date(s.year, month - 1, day);
    return [-1, 0, 1].some(dy => {
      const t = new Date(target); t.setFullYear(s.year + dy);
      return Math.abs(daysBetween(s.date, t)) <= window;
    });
  });
}
