const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const RECENT_DAYS = 14

export type StreakDay = {
  date: string
  typed: boolean
}

export type Streak = {
  /** Consecutive days ending today, or yesterday if today has not been typed yet. */
  current: number
  longest: number
  /** The last two weeks, oldest first, ending today. */
  recent: StreakDay[]
}

export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function streakFrom(typedDates: readonly string[], today: string): Streak {
  const typed = new Set(typedDates.filter((date) => DAY.test(date) && date <= today))
  const recent: StreakDay[] = []
  for (let ago = RECENT_DAYS - 1; ago >= 0; ago--) {
    const date = shiftDay(today, -ago)
    recent.push({ date, typed: typed.has(date) })
  }

  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const date of [...typed].sort()) {
    run = previous != null && shiftDay(previous, 1) === date ? run + 1 : 1
    previous = date
    if (run > longest) longest = run
  }

  let current = 0
  let cursor = typed.has(today) ? today : shiftDay(today, -1)
  while (typed.has(cursor)) {
    current += 1
    cursor = shiftDay(cursor, -1)
  }

  return { current, longest, recent }
}

export function streakLine(streak: Streak): string | null {
  if (streak.current <= 0 && streak.longest <= 0) return null
  if (streak.current <= 0) {
    return streak.longest === 1 ? 'Longest run is 1 day.' : `Longest run is ${streak.longest} days.`
  }
  const current = streak.current === 1 ? '1 day in a row.' : `${streak.current} days in a row.`
  if (streak.longest > streak.current) return `${current} Longest run is ${streak.longest} days.`
  return current
}

function shiftDay(day: string, by: number): string {
  const match = DAY.exec(day)
  const year = Number(match?.[1])
  const month = Number(match?.[2])
  const date = Number(match?.[3])
  const utc = new Date(Date.UTC(year, month - 1, date))
  utc.setUTCDate(utc.getUTCDate() + by)
  return utc.toISOString().slice(0, 10)
}
