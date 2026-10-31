// time zones. events are stored in utc. "late night" and "your busiest
// day" depend on the visitor's zone, so every local view goes through here.
//
// asking Intl for each of a million events is slow, so the utc offset is
// cached per 15 minute bucket. every modern offset and every daylight saving
// change falls on a multiple of 15 minutes, so the cache is exact.

export const DAY = 86400000;
export const HOUR = 3600000;
const BUCKET = 15 * 60000;

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function isValidZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const zones = new Map();

/** @param {string} tz an iana zone such as Europe/London */
export function zone(tz = 'UTC') {
  let z = zones.get(tz);
  if (!z) {
    z = new Zone(tz);
    zones.set(tz, z);
  }
  return z;
}

class Zone {
  constructor(tz) {
    if (!isValidZone(tz)) throw new RangeError(`unknown time zone: ${tz}`);
    this.tz = tz;
    this.fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    /** @type {Map<number, number>} */
    this.cache = new Map();
  }

  /** ms to add to a utc time to get the local wall clock time */
  offset(t) {
    const b = Math.floor(t / BUCKET);
    let o = this.cache.get(b);
    if (o === undefined) {
      o = this.compute(b * BUCKET);
      this.cache.set(b, o);
    }
    return o;
  }

  compute(t) {
    const p = {};
    for (const part of this.fmt.formatToParts(new Date(t))) p[part.type] = part.value;
    let year = Number(p.year);
    if (p.era === 'BC') year = 1 - year;
    const local = Date.UTC(year, Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    return local - t;
  }

  /** the local day number (days since 1970-01-01 on the local calendar) */
  dayKey(t) {
    return Math.floor((t + this.offset(t)) / DAY);
  }

  /** the local hour, 0 to 23 */
  hour(t) {
    const l = t + this.offset(t);
    return Math.floor((l - Math.floor(l / DAY) * DAY) / HOUR);
  }

  /** the local weekday, 0 is monday */
  weekday(t) {
    return weekdayOfDay(this.dayKey(t));
  }

  year(t) {
    return new Date(t + this.offset(t)).getUTCFullYear();
  }

  /** local calendar parts */
  parts(t) {
    const l = t + this.offset(t);
    const d = new Date(l);
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(),
      hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: (d.getUTCDay() + 6) % 7,
    };
  }

  /** the utc time of a local wall clock time. in a skipped hour it lands just after. */
  toUtc(year, month, day, hour = 0, minute = 0) {
    const wall = Date.UTC(year, month, day, hour, minute);
    let t = wall - this.offset(wall);
    t = wall - this.offset(t);
    return t;
  }

  /** the utc time where a local day number starts */
  dayStart(dayKey) {
    const d = new Date(dayKey * DAY);
    return this.toUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /** [start, end) of a local calendar year, in utc ms */
  yearBounds(year) {
    return [this.toUtc(year, 0, 1), this.toUtc(year + 1, 0, 1)];
  }
}

/** 0 is monday. 1970-01-01 was a thursday. */
export function weekdayOfDay(dayKey) {
  return (((dayKey + 3) % 7) + 7) % 7;
}

/** calendar parts of a local day number */
export function dayParts(dayKey) {
  const d = new Date(dayKey * DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: weekdayOfDay(dayKey) };
}

/** "march 3" */
export function dayName(dayKey) {
  const p = dayParts(dayKey);
  return `${MONTHS[p.month]} ${p.day}`;
}

/** "monday, march 3" */
export function longDayName(dayKey) {
  const p = dayParts(dayKey);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[p.month]} ${p.day}`;
}

/** "11 pm", "midnight", "noon" */
export function hourName(h) {
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/** "9:41 pm" */
export function clockTime(hour, minute) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "march 2019" */
export function monthYear(t, z) {
  const p = z.parts(t);
  return `${MONTHS[p.month]} ${p.year}`;
}
