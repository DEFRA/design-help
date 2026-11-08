const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function unit(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * How long a sign-in link lasts, in words: "7 days", "12 hours",
 * "15 minutes". Uses the largest unit that divides the time exactly.
 */
export function linkLifetimeText(ttl) {
  if (ttl >= DAY_MS && ttl % DAY_MS === 0) {
    return unit(ttl / DAY_MS, 'day', 'days')
  }
  if (ttl >= HOUR_MS && ttl % HOUR_MS === 0) {
    return unit(ttl / HOUR_MS, 'hour', 'hours')
  }
  return unit(Math.max(1, Math.round(ttl / MINUTE_MS)), 'minute', 'minutes')
}
