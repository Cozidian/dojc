import { describe, expect, test } from 'vitest'
import { streakFrom, streakLine } from './streak.ts'

describe('streak', () => {
  test('counts consecutive days and keeps today open until it is missed', () => {
    const throughToday = streakFrom(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-22'], '2026-10-22')
    expect(throughToday.current).toBe(3)
    expect(throughToday.longest).toBe(3)
    expect(throughToday.recent).toHaveLength(14)
    expect(throughToday.recent.at(-1)).toEqual({ date: '2026-10-22', typed: true })
    expect(throughToday.recent[0]?.date).toBe('2026-10-09')

    const stillYesterday = streakFrom(['2026-10-20', '2026-10-21'], '2026-10-22')
    expect(stillYesterday.current).toBe(2)
    expect(stillYesterday.recent.at(-1)).toEqual({ date: '2026-10-22', typed: false })

    const missed = streakFrom(['2026-10-20'], '2026-10-22')
    expect(missed.current).toBe(0)
    expect(missed.longest).toBe(1)
  })

  test('the longest run can be an older one', () => {
    const streak = streakFrom(
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-21', '2026-10-22'],
      '2026-10-22',
    )
    expect(streak.current).toBe(2)
    expect(streak.longest).toBe(5)
    expect(streakLine(streak)).toBe('2 days in a row. Longest run is 5 days.')
  })

  test('the line stays quiet when there is nothing to say', () => {
    const none = streakFrom([], '2026-10-22')
    expect(none.current).toBe(0)
    expect(none.longest).toBe(0)
    expect(streakLine(none)).toBeNull()
    expect(streakLine(streakFrom(['2026-10-22'], '2026-10-22'))).toBe('1 day in a row.')
    expect(streakLine(streakFrom(['2026-10-20'], '2026-10-22'))).toBe('Longest run is 1 day.')
    expect(streakLine(streakFrom(['2026-10-21', '2026-10-22'], '2026-10-22'))).toBe('2 days in a row.')
  })
})
