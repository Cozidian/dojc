import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  applyEvent,
  createTest,
  finalize,
  focusLabel,
  isLayoutId,
  layoutIds,
  layoutName,
  newSeed,
  reviewRun,
  toSessionRequest,
  type CoachingSummary,
  type Drill,
  type EngineState,
  type InputEvent,
  type LayoutId,
  type MissList,
  type Progress,
  type RunDetail,
  type SaveSessionResponse,
  type Streak,
  type SessionResult,
} from '@dojc/core'
import { fetchCoaching, fetchMisses, fetchProgress, fetchRun, fetchStreak, saveSession } from './api.ts'
import { Passage, ProgressChapter, StreakNote } from './progress.tsx'

const LAYOUT_KEY = 'dojc.layout'

function initialLayout(): LayoutId {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY)
    if (stored && isLayoutId(stored)) return stored
  } catch {
    // Storage can be blocked. QWERTY remains the default.
  }
  return 'qwerty-ansi'
}

function makeTest(layoutId: LayoutId, drill: Drill | null): EngineState {
  return createTest({
    languageId: 'en',
    layoutId,
    mode: drill ? 'drill' : 'words',
    modeValue: drill ? 20 : 25,
    seed: newSeed(),
    drill,
    correctionPolicy: 'must_fix',
  })
}

function toInput(event: KeyboardEvent, origin: number): InputEvent {
  return {
    tMs: performance.now() - origin,
    type: event.type === 'keydown' ? 'down' : 'up',
    code: event.code,
    key: event.key,
    shift: event.shiftKey,
    shortcut: event.metaKey || event.ctrlKey || event.altKey,
  }
}

function shouldHold(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  return event.key.length === 1 || event.code === 'Backspace' || event.code === 'Space' || event.code === 'Tab'
}

export function App() {
  const [layout, setLayout] = useState<LayoutId>(initialLayout)
  const [state, setState] = useState(() => makeTest(initialLayout(), null))
  const [phase, setPhase] = useState<'typing' | 'result'>('typing')
  const [localResult, setLocalResult] = useState<SessionResult | null>(null)
  const [serverResult, setServerResult] = useState<SaveSessionResponse | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [coaching, setCoaching] = useState<CoachingSummary | null>(null)
  const [focused, setFocused] = useState(false)
  const [chapter, setChapter] = useState<'test' | 'progress'>('test')
  const [progress, setProgress] = useState<Progress | null | undefined>(undefined)
  const [habits, setHabits] = useState<MissList | null>(null)
  const [streak, setStreak] = useState<Streak | null>(null)
  const [past, setPast] = useState<RunDetail | null>(null)

  const stateRef = useRef(state)
  const layoutRef = useRef(layout)
  const startedAtRef = useRef(new Date().toISOString())
  const originRef = useRef(performance.now())
  const flushedRef = useRef(false)
  const generationRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const pastRef = useRef<RunDetail | null>(null)
  const chapterRef = useRef(chapter)
  stateRef.current = state
  layoutRef.current = layout
  pastRef.current = past
  chapterRef.current = chapter

  function persist(snapshot: EngineState, startedAt: string) {
    void saveSession(toSessionRequest(snapshot, startedAt))
      .then((saved) => {
        setServerResult(saved)
        setCoaching(saved.coaching)
      })
      .catch(() => setSaveError(true))
  }

  function flush() {
    const current = stateRef.current
    if (!current.done || flushedRef.current) return
    flushedRef.current = true
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    persist(current, startedAtRef.current)
  }

  function arm() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    const generation = generationRef.current
    timerRef.current = window.setTimeout(() => {
      if (generation !== generationRef.current) return
      flush()
    }, 220)
  }

  function begin(nextLayout: LayoutId, drill: Drill | null) {
    pastRef.current = null
    setPast(null)
    chapterRef.current = 'test'
    setChapter('test')
    flush()
    generationRef.current += 1
    flushedRef.current = false
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    const next = makeTest(nextLayout, drill)
    stateRef.current = next
    startedAtRef.current = new Date().toISOString()
    originRef.current = performance.now()
    setState(next)
    setPhase('typing')
    setLocalResult(null)
    setServerResult(null)
    setSaveError(false)
    window.setTimeout(() => stageRef.current?.focus(), 0)
  }

  function showTest() {
    chapterRef.current = 'test'
    setChapter('test')
    window.setTimeout(() => stageRef.current?.focus(), 0)
  }

  useEffect(() => {
    let cancel = false
    void fetchCoaching(layout).then((next) => {
      if (!cancel) setCoaching(next)
    })
    return () => {
      cancel = true
    }
  }, [layout])

  useEffect(() => {
    let cancel = false
    void fetchStreak().then((next) => {
      if (!cancel) setStreak(next)
    })
    return () => {
      cancel = true
    }
  }, [serverResult?.id])

  useEffect(() => {
    if (chapter !== 'progress') return
    let cancel = false
    void fetchProgress(layout).then((next) => {
      if (!cancel) setProgress(next)
    })
    void fetchMisses(layout).then((next) => {
      if (!cancel) setHabits(next)
    })
    return () => {
      cancel = true
    }
  }, [chapter, layout, serverResult?.id])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Escape restarts. Its keyup must not land in the new test, or the layout
      // toggle stays locked on an empty passage.
      if (event.code === 'Escape') {
        if (event.type === 'keydown') {
          event.preventDefault()
          if (chapterRef.current === 'progress') {
            if (pastRef.current) {
              pastRef.current = null
              setPast(null)
            } else {
              showTest()
            }
          } else {
            begin(layoutRef.current, null)
          }
        }
        return
      }
      if (chapterRef.current === 'progress') return
      const current = stateRef.current
      // A key released after a restart belongs to the previous passage.
      if (event.type === 'keyup' && !current.held[event.code]) return
      if (current.done) {
        if (event.type === 'keyup' && !flushedRef.current) {
          const next = applyEvent(current, toInput(event, originRef.current))
          stateRef.current = next
          setState(next)
          arm()
        }
        return
      }
      if (event.type !== 'keydown' && event.type !== 'keyup') return
      if (shouldHold(event)) event.preventDefault()
      const next = applyEvent(current, toInput(event, originRef.current))
      stateRef.current = next
      setState(next)
      if (next.done && !current.done) {
        setPhase('result')
        setLocalResult(finalize(next))
        arm()
      }
    }
    function onHide() {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    stageRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
    // Installed once. The handlers read refs, which stay current across renders.
  }, [])

  useEffect(() => {
    if (chapter === 'test' && phase === 'result') primaryRef.current?.focus()
  }, [chapter, phase, serverResult])

  function switchLayout() {
    const current = stateRef.current
    if (current.actions.length > 0 && !current.done) return
    const ids = layoutIds()
    const nextLayout = ids[(ids.indexOf(layoutRef.current) + 1) % ids.length] ?? layoutRef.current
    layoutRef.current = nextLayout
    try {
      localStorage.setItem(LAYOUT_KEY, nextLayout)
    } catch {
      // The choice still applies for this page.
    }
    setLayout(nextLayout)
    setProgress(undefined)
    setHabits(null)
    begin(nextLayout, null)
  }

  function openRun(id: string) {
    if (!id) return
    if (pastRef.current?.id === id) {
      pastRef.current = null
      setPast(null)
      return
    }
    void fetchRun(id).then((detail) => {
      if (detail) setPast(detail)
    })
  }

  const shown = serverResult ?? localResult
  const practice = serverResult?.coaching.focus ?? null
  const freshReview = phase === 'result' ? reviewRun(state.words, state.actions) : null
  const started = state.actions.length > 0
  const locked = started && !state.done

  return (
    <main>
      <header>
        <p className="mark">dojc</p>
        <nav className="chapters" aria-label="Chapters">
          {chapter === 'test' ? (
            <span className="chapter here">Test</span>
          ) : (
            <button type="button" className="chapter" onClick={showTest}>
              Test
            </button>
          )}
          {chapter === 'progress' ? (
            <span className="chapter here">Progress</span>
          ) : (
            <button type="button" className="chapter" onClick={() => setChapter('progress')}>
              Progress
            </button>
          )}
        </nav>
        <button type="button" className="layout" onClick={switchLayout} disabled={locked}>
          {layoutName(layout)}
        </button>
      </header>
      {chapter === 'progress' ? (
        <ProgressChapter
          layout={layout}
          coaching={coaching}
          habits={habits}
          progress={progress}
          past={past}
          streak={streak}
          onOpen={openRun}
          begin={begin}
        />
      ) : (
        <section
          ref={stageRef}
          className={focused ? 'stage focused' : 'stage'}
          tabIndex={phase === 'typing' ? 0 : -1}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseDown={(event) => {
            const target = event.target
            if (target instanceof Element && target.closest('button')) return
            stageRef.current?.focus()
          }}
        >
          {phase === 'typing' ? (
            <>
              {state.spec.drill ? <p className="drill">Practice · {focusLabel(state.spec.drill)}</p> : null}
              <div className="words" aria-label="Passage">
                {state.words.map((word, index) => (
                  <Word
                    key={`${state.spec.seed}-${index}`}
                    word={word}
                    typed={index === state.wordIndex ? state.typed : ''}
                    active={index === state.wordIndex}
                    done={index < state.wordIndex}
                  />
                ))}
              </div>
              <p className="hint">{focused ? 'Backspace fixes a mistake. Esc starts over.' : 'Click here, then type.'}</p>
              {!started ? <StreakNote streak={streak} /> : null}
              {!started ? (
                <button type="button" className="link" onClick={() => setChapter('progress')}>
                  Progress
                </button>
              ) : null}
            </>
          ) : shown ? (
            <div className="result" aria-live="polite">
              <Score wpm={shown.wpm} accuracy={shown.accuracy} consistency={shown.consistency} />
              {saveError ? <p className="note">This test stayed on this page. It was not saved.</p> : null}
              {serverResult ? (
                <>
                  <p className="coach">{serverResult.coaching.sentence ?? 'Nothing stands out yet.'}</p>
                  <p className="note">
                    Based on {serverResult.coaching.tests} {serverResult.coaching.tests === 1 ? 'test' : 'tests'}.
                  </p>
                </>
              ) : null}
              <Actions practice={practice} layout={layout} begin={begin} primaryRef={primaryRef} />
              <StreakNote streak={streak} />
              {freshReview ? <Passage words={freshReview} /> : null}
              <button type="button" className="link jump" onClick={() => setChapter('progress')}>
                Progress
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  )
}

function Word({ word, typed, active, done }: { word: string; typed: string; active: boolean; done: boolean }) {
  if (!active) return <span className={done ? 'word done' : 'word'}>{word}</span>
  const chars: ReactNode[] = []
  for (let i = 0; i < word.length; i++) {
    if (i === typed.length) chars.push(<Caret key="caret" />)
    const got = typed[i]
    const cls = got == null ? 'rest' : got === word[i] ? 'ok' : 'bad'
    chars.push(
      <span key={i} className={cls}>
        {word[i]}
      </span>,
    )
  }
  for (let i = word.length; i < typed.length; i++) {
    chars.push(
      <span key={`x${i}`} className="bad">
        {typed[i]}
      </span>,
    )
  }
  if (typed.length >= word.length) chars.push(<Caret key="caret-end" />)
  return <span className="word active">{chars}</span>
}

function Caret() {
  return <span className="caret" aria-hidden="true" />
}

function Score({ wpm, accuracy, consistency }: { wpm: number; accuracy: number; consistency: number | null }) {
  return (
    <>
      <p className="score">
        <span className="num">{Math.round(wpm)}</span> wpm
      </p>
      <p className="sub">
        {Math.round(accuracy * 100)}% accuracy
        {consistency != null ? ` · consistency ${Math.round(consistency)}` : ''}
      </p>
    </>
  )
}

function Actions({
  practice,
  layout,
  begin,
  primaryRef,
}: {
  practice: Drill | null
  layout: LayoutId
  begin: (layout: LayoutId, drill: Drill | null) => void
  primaryRef: { current: HTMLButtonElement | null }
}) {
  return (
    <div className="actions">
      {practice ? (
        <button ref={primaryRef} type="button" className="primary" onClick={() => begin(layout, practice)}>
          Practice {focusLabel(practice)}
        </button>
      ) : null}
      <button
        ref={practice ? undefined : primaryRef}
        type="button"
        className={practice ? undefined : 'primary'}
        onClick={() => begin(layout, null)}
      >
        Again
      </button>
    </div>
  )
}


