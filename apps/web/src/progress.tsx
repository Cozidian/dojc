import {
  caughtUpLine,
  focusLabel,
  habitLetterLine,
  habitWordLine,
  runMissLine,
  streakLine,
  type CoachingSummary,
  type Drill,
  type FingerBar,
  type LayoutId,
  type MissList,
  type Progress,
  type RunDetail,
  type RunSummary,
  type RunWord,
  type Streak,
  type StreakDay,
} from '@dojc/core'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const month = MONTHS[date.getMonth()] ?? ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${month}, ${hours}:${minutes}`
}

function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`
}

function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function runLine(run: RunSummary): string {
  const practice = run.drill ? `Practice · ${focusLabel(run.drill)} · ` : ''
  return `${formatWhen(run.startedAt)} · ${practice}${Math.round(run.wpm)} wpm · ${Math.round(run.accuracy * 100)}%`
}

export function ProgressChapter({
  layout,
  coaching,
  habits,
  progress,
  past,
  streak,
  onOpen,
  begin,
}: {
  layout: LayoutId
  coaching: CoachingSummary | null
  habits: MissList | null
  progress: Progress | null | undefined
  past: RunDetail | null
  streak: Streak | null
  onOpen: (id: string) => void
  begin: (layout: LayoutId, drill: Drill | null) => void
}) {
  if (progress == null) {
    return progress === null ? (
      <p className="note">Progress did not load.</p>
    ) : null
  }

  const focus = coaching?.focus ?? null
  const hasHabits = !!habits && (habits.letters.length > 0 || habits.words.length > 0)
  const fingersReady = progress.fingers.some((finger) => finger.medianMs != null)
  const trace = progress.trace && progress.trace.points.length > 0 ? progress.trace : null

  if (progress.runs.length === 0) {
    return (
      <div className="progress">
        <StreakNote streak={streak} marks />
        <p className="note">Tests you finish will show up here.</p>
      </div>
    )
  }

  return (
    <div className="progress">
      <StreakNote streak={streak} marks />
      {progress.points.length > 0 ? (
        <>
          <h2>Speed</h2>
          <LineChart
            label="Speed"
            points={progress.points}
            valueOf={(point) => point.wpm}
            format={(value) => `${Math.round(value)} wpm`}
            openId={past?.id ?? null}
          />
          <h2>Accuracy</h2>
          <LineChart
            label="Accuracy"
            points={progress.points}
            valueOf={(point) => point.accuracy * 100}
            format={(value) => `${Math.round(value)}%`}
            openId={past?.id ?? null}
          />
          <p className="note">Practice runs stay off these lines.</p>
        </>
      ) : (
        <p className="note">Speed and accuracy come from measured tests. Practice runs stay off those lines.</p>
      )}

      {fingersReady || progress.points.length > 0 ? (
        <>
          <h2>Fingers</h2>
          {fingersReady ? (
            <>
              <p className="note">Median gap between keys, on letters hit cleanly.</p>
              <FingerChart fingers={progress.fingers} focusTarget={focus?.kind === 'finger' ? focus.target : null} />
            </>
          ) : (
            <p className="note">A finger appears here once it has enough clean keystrokes.</p>
          )}
        </>
      ) : null}

      {coaching?.sentence || focus || hasHabits || trace || progress.caughtUp ? (
        <>
          <h2>Practice</h2>
          {coaching?.sentence ? <p className="coach">{coaching.sentence}</p> : null}
          {progress.caughtUp ? <p className="note">{caughtUpLine(progress.caughtUp)}</p> : null}
          {trace ? (
            <>
              <LineChart
                label={focusLabel(trace)}
                points={trace.points}
                valueOf={(point) => point.medianMs}
                format={(value) => `${Math.round(value)} ms`}
                openId={past?.id ?? null}
              />
              <p className="note">Lower is quicker.</p>
            </>
          ) : null}
          {focus ? (
            <div className="actions">
              <button type="button" className="primary" onClick={() => begin(layout, focus)}>
                Practice {focusLabel(focus)}
              </button>
            </div>
          ) : null}
          <Habits list={habits} onPractice={(drill) => begin(layout, drill)} />
        </>
      ) : null}

      <h2>Tests</h2>
      <div className="runs">
        {progress.runs.map((run) => {
          const open = past?.id === run.id
          return (
            <div key={run.id}>
              <button
                type="button"
                className={open ? 'run open' : 'run'}
                aria-current={open ? 'true' : undefined}
                onClick={() => onOpen(run.id)}
              >
                {runLine(run)}
              </button>
              {open && past ? <Passage words={past.words} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function StreakNote({ streak, marks = false }: { streak: Streak | null; marks?: boolean }) {
  if (!streak) return null
  const line = streakLine(streak)
  if (!line || (!marks && streak.current <= 0)) return null
  const typed = streak.recent.filter((day) => day.typed).length
  return (
    <div className="streak">
      <p className={marks ? 'coach' : 'note'}>{line}</p>
      {marks ? (
        <div className="days" role="img" aria-label={`Last ${streak.recent.length} days, typed on ${typed}.`}>
          {streak.recent.map((day, index) => {
            const today = index === streak.recent.length - 1
            const className = ['day', day.typed ? 'on' : '', today ? 'today' : ''].filter(Boolean).join(' ')
            return <span key={day.date} className={className} title={dayTitle(day)} />
          })}
        </div>
      ) : null}
    </div>
  )
}

function dayTitle(day: StreakDay): string {
  const date = new Date(`${day.date}T12:00:00`)
  const label = Number.isNaN(date.getTime()) ? day.date : `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`
  return day.typed ? `${label}, typed` : label
}

function LineChart<T extends { id: string; startedAt: string }>({
  label,
  points,
  valueOf,
  format,
  openId,
}: {
  label: string
  points: readonly T[]
  valueOf: (point: T) => number
  format: (value: number) => string
  openId: string | null
}) {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  const values = points.map(valueOf)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || Math.max(Math.abs(high) * 0.25, 1)
  const min = low - span * 0.35
  const max = high + span * 0.45
  const width = 640
  const height = 176
  const padL = 12
  const padR = 16
  const padT = 26
  const padB = 28
  const innerW = width - padL - padR
  const innerH = height - padT - padB
  const xOf = (index: number) => (points.length === 1 ? padL + innerW / 2 : padL + (index / (points.length - 1)) * innerW)
  const yOf = (value: number) => padT + innerH - ((value - min) / (max - min)) * innerH
  const openedOnChart = openId != null && points.some((point) => point.id === openId)
  const markedIndex = openedOnChart ? points.findIndex((point) => point.id === openId) : points.length - 1
  const marked = points[markedIndex] ?? last
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(index).toFixed(1)} ${yOf(valueOf(point)).toFixed(1)}`)
    .join(' ')
  const floor = padT + innerH
  const area =
    points.length > 1
      ? `${line} L ${xOf(points.length - 1).toFixed(1)} ${floor.toFixed(1)} L ${xOf(0).toFixed(1)} ${floor.toFixed(1)} Z`
      : null
  const anchor = markedIndex <= 0 ? 'start' : markedIndex >= points.length - 1 ? 'end' : 'middle'
  const sameDay = shortDate(first.startedAt) === shortDate(last.startedAt)
  const axis = sameDay ? clock : shortDate
  const summary =
    points.length === 1
      ? `${label}, ${format(valueOf(first))} on ${formatWhen(first.startedAt)}`
      : `${label}, ${points.length} tests, from ${format(valueOf(first))} to ${format(valueOf(last))}. Latest marked point ${format(valueOf(marked))}.`

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
      <line className="baseline" x1={padL} x2={width - padR} y1={floor} y2={floor} />
      {area ? <path className="area" d={area} /> : null}
      {points.length > 1 ? <path className="line" d={line} /> : null}
      {points.map((point, index) => (
        <circle
          key={point.id}
          className={index === markedIndex ? 'dot last' : 'dot'}
          cx={xOf(index)}
          cy={yOf(valueOf(point))}
          r={index === markedIndex ? 4 : 2.6}
        >
          <title>{`${formatWhen(point.startedAt)}, ${format(valueOf(point))}`}</title>
        </circle>
      ))}
      <text x={xOf(markedIndex)} y={yOf(valueOf(marked)) - 10} textAnchor={anchor}>
        {format(valueOf(marked))}
      </text>
      <text x={xOf(0)} y={height - 8} textAnchor={points.length === 1 ? 'middle' : 'start'}>
        {axis(first.startedAt)}
      </text>
      {points.length > 1 ? (
        <text x={xOf(points.length - 1)} y={height - 8} textAnchor="end">
          {axis(last.startedAt)}
        </text>
      ) : null}
    </svg>
  )
}

function FingerChart({ fingers, focusTarget }: { fingers: FingerBar[]; focusTarget: string | null }) {
  const shown = fingers.flatMap((finger) => (finger.medianMs == null ? [] : [finger.medianMs]))
  const slowest = Math.max(...shown, 1)
  return (
    <div className="fingers">
      {fingers.map((finger) => {
        const hot = focusTarget === finger.target
        return (
          <div key={finger.target} className={hot ? 'finger hot' : 'finger'}>
            <span>{focusLabel({ kind: 'finger', target: finger.target })}</span>
            <span className="track" aria-hidden="true">
              {finger.medianMs != null ? (
                <span className="bar" style={{ width: `${(finger.medianMs / slowest) * 100}%` }} />
              ) : null}
            </span>
            <span>{finger.medianMs == null ? '—' : `${Math.round(finger.medianMs)} ms`}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Passage({ words }: { words: RunWord[] }) {
  const notes = words.flatMap((word, index) => {
    const line = runMissLine(word)
    return line ? [{ index, line }] : []
  })
  return (
    <>
      <div className="review" aria-label="This test">
        {words.map((word, index) => (
          <span key={index} className="word">
            {word.letters.map((letter, letterIndex) => (
              <span key={letterIndex} className={letter.wrong.length > 0 ? 'bad' : undefined}>
                {letter.char}
              </span>
            ))}
            {word.extras.map((extra, extraIndex) => (
              <span key={`x${extraIndex}`} className="bad">
                {extra}
              </span>
            ))}
          </span>
        ))}
      </div>
      {notes.map((note) => (
        <p key={note.index} className="note">
          {note.line}
        </p>
      ))}
    </>
  )
}

function Habits({ list, onPractice }: { list: MissList | null; onPractice: (drill: Drill) => void }) {
  if (!list || (list.letters.length === 0 && list.words.length === 0)) return null
  return (
    <div className="habits">
      <p className="note">Often missed</p>
      {list.letters.map((letter) => (
        <div key={letter.letter} className="habit">
          <p className="note">{habitLetterLine(letter)}</p>
          <button
            type="button"
            className="link"
            aria-label={`Practice ${letter.letter}`}
            onClick={() => onPractice({ kind: 'letter', target: letter.letter })}
          >
            Practice
          </button>
        </div>
      ))}
      {list.words.map((word) => (
        <div key={word.word} className="habit">
          <p className="note">{habitWordLine(word)}</p>
          <button
            type="button"
            className="link"
            aria-label={`Practice ${word.word}`}
            onClick={() => onPractice({ kind: 'word', target: word.word })}
          >
            Practice
          </button>
        </div>
      ))}
    </div>
  )
}
