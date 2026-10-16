// Framework-free: also loaded by the scheduled Worker.
export function retentionReviewDueAt(submittedAt: string, years: number): string | null {
  if (!Number.isInteger(years) || years < 0 || years > 20) throw new Error('Ungültige Aufbewahrungsfrist.')
  if (!years) return null
  const date = new Date(submittedAt)
  if (!Number.isFinite(date.getTime())) throw new Error('Ungültiges Einsendungsdatum.')
  const month = date.getUTCMonth(), day = date.getUTCDate(), year = date.getUTCFullYear() + years
  date.setUTCDate(1)
  date.setUTCFullYear(year)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString()
}

export function retentionWindow(now: Date) {
  const week = new Date(now)
  week.setUTCHours(0, 0, 0, 0)
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7)
  return { period: week.toISOString().slice(0, 10), now: now.toISOString(),
    in30: new Date(now.getTime() + 30 * 86400000).toISOString(),
    in90: new Date(now.getTime() + 90 * 86400000).toISOString() }
}
