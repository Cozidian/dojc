# Data model

The product is the record of a test. Screens are replaceable. A claim such as "your left pinky is slowing you down" or ""bl" is holding you back" has to be computable from stored tests months later, including after the coaching rule changes.

Two facts are easy to mash together and must stay apart:

- A **letter pair** is language. "bl" is the same pair on every keyboard.
- A **finger** is a physical key on a geometry. Dvorak moves the letters, not the fingers. The "l" in "bl" is a right ring finger on QWERTY and a right pinky on Dvorak.

A session binds them: at this moment, on this layout, the target letter was this, the key you hit was that physical key, and that key belongs to this finger.

## What is stored

`key_events` is the immutable log: key down and key up, the physical `code`, the `key` string the browser reported, shift, whether a shortcut modifier was held, and `t_ms` from the page's monotonic clock. Wall-clock `started_at` is only for ordering sessions. Intervals never use it.

`actions` is the transcript the engine derived: commits, backspaces, and rejected spaces, with the target word, the expected letter, the produced letter, the in-word bigram, the finger, and the timing fields below. It is a cache. `pnpm rebuild` deletes it and writes it again from `key_events` plus the stored target text. Rebuild does not regenerate words from the seed, so a newer word list cannot rewrite an old test.

`sessions` holds the spec (language, layout, geometry, mode, seed, correction policy, drill target), the target text, the engine and word-list versions, and summary numbers for the history we have not built a screen for yet.

`focuses` is the training path: at most one open focus per user, layout, and language. The partial unique index enforces that. A focus stays open while it still qualifies, so a slightly worse letter pair cannot steal the path every test. It closes as `improved` when the median has dropped below its baseline and it is no longer slow relative to everything else, as `settled` when the gap closed because the rest of the typing got worse, or as `stale` when the trailing window no longer contains enough of it.

The local install inserts a single user, `local`. Accounts, if they ever exist, are a new way to obtain a user id. They are not a new shape for a test.

## Timing

- **iki** is this action's keydown minus the previous action's keydown.
- **hold** is keyup minus keydown. It stays null if the key is still down when the log ends. The page waits briefly after the last letter so that keyup is usually present.
- **flight** is this keydown minus the previous action key's keyup. A negative flight means the keys overlapped.
- **hesitation** is an iki of 1500 ms or more. The pause is blamed on the key that ends it.
- **after error** is set on the key that follows a mistake or a repair. The mistyped key itself is not marked, so it still counts as an error. The careful retype does not count as natural speed.

Key repeat is stored and does not insert a second character. Backspace stops at the start of the word. Unbound keys and shortcut chords are stored and do not change the transcript.

## Clean speed

Coaching and the consistency score use a clean letter interval:

`commit` and `correct` and not a hesitation and not after an error and iki is present and the finger is not the thumb.

Spaces are thumb actions. They count toward words-per-minute and stay out of finger and letter-pair comparisons. Error rate, when we start coaching on it, can use the incorrect commits this filter drops. Those rows are already stored.

Diagnosis uses the last 40 completed measurement sessions on that layout. Drill sessions are stored and excluded, so a practice round cannot become the evidence.

## Scores

A word is five characters. On a word test or a drill, duration is the last action minus the first, so reading time before the first key is free. On a time test, duration is the clock length.

- `wpm` = (correct characters / 5) / minutes
- `raw_wpm` = ((correct + incorrect + extra) / 5) / minutes
- `accuracy` = correct / (correct + incorrect + extra)

A rejected space counts as incorrect. A backspace does not add another incorrect on top of the mistake it removed. Consistency is `100 * (1 - coefficient of variation)` of clean intervals, using the sample standard deviation, and it is null until there are eight of them. Higher is steadier.

The default test requires mistakes to be fixed. The policy is a column, `must_fix`, so a later policy is an explicit new value rather than a quiet change in meaning.

## Coaching

A finger needs 25 clean intervals. A letter pair needs 8. The reference is the pooled median of the other fingers, or the other pairs, and that pool needs 20 intervals. The focus is the group whose median is at least 1.35 times the reference and at least 25 ms slower. Ties prefer the larger sample, then a finger, then the target name.

The sentence names the layout because the same pair is a different motion after you switch. "Words with bl" is operationalized as the in-word bigram `bl`, the interval on the second letter, practiced by typing words that contain it. Whole-word slowness would mix up length with the pair. The target word is stored on every action, so a later rule can group by word without a migration.

Thresholds live in `COACHING` in `packages/core/src/types.ts`. The decision itself is `coach` in `packages/core/src/coaching.ts`, covered by tests that name the pinky case and the "bl" case.

## Review

A finished test can be opened again. `reviewRun` lays the transcript back onto the stored passage. An incorrect commit marks that letter and remembers the character that was hit. The backspace that repairs it is not another miss, and a rejected space is not a miss either.

Words and letters you usually get wrong come from the same rows, counted across the last 40 completed measurement tests on that layout. A letter needs 15 attempts and 3 misses. A word needs to appear 3 times and be missed twice. Drills stay out. The lines are produced by `habitLetterLine` and `habitWordLine`. Thresholds live in `MISSES`. This list does not replace the one speed focus.

A listed letter can start a drill of twenty words that contain it. The session stores `drill_kind` `letter` and the letter as `drill_target`. Like the other drills, it is left out of speed diagnosis and out of this list. It does not become the one open focus. `focuses.kind` stays a finger or a bigram.

A listed word starts a drill of twenty words. About one of every four is that word, and it never appears twice in a row, so you have to enter it from a different word. The session stores `drill_kind` `word` and the word as `drill_target`. It is left out of speed diagnosis, this list, and the open focus.

## Progress

Progress is a reading of the same rows, not a second store. The speed and accuracy lines are the last 40 completed measurement tests on that layout, oldest first. Practice runs are left off, because a drill is not a comparable test. The finger chart uses the same clean intervals as coaching, in home-row order from left pinky to right pinky, and a finger is drawn once it has 25 of them. `fingerBars` in `packages/core/src/progress.ts` is that rule. Reading progress does not open or close a focus.

The chapter also lists the last 40 completed tests, drills included, with the time they were taken. Opening one replays the stored passage. Practice from that chapter is the open speed focus, or a letter or word from the miss list. It is the same drill the test page already runs.

While a finger or a letter pair is open, Progress draws that focus's clean gap on each measured test in the same window. A test with no clean sample of it is skipped. Lower is quicker. A focus that caught up stays as one line after a newer focus replaces it. While nothing else is open, that caught-up fact remains the coaching sentence. `focusTrace` in `packages/core/src/progress.ts` is the per-test median.

A streak is consecutive local days with at least one completed test. Practice counts, and so does either layout. Today stays part of the run until the day ends without a test. `streakFrom` in `packages/core/src/streak.ts` takes those dates. The row under the sentence is the last 14 days. The streak does not change coaching.

## Adding a language, layout, or keyboard

- A language is a word list and a version bump of `WORDLIST_VERSION`. Append words. Don't reorder them. Old tests keep `target_text`. The bundled English list is `packages/core/src/wordlist.ts`. It is a sequence of common words kept in this repository, not a passage from a book. A repeated word keeps its first place.
- A layout is a map from physical `code` to unshifted and shifted characters, in `packages/core/src/layouts.ts`. Startup upserts it into `layouts` and `layout_keys`. Give it an id like `colemak-ansi` and add that id to the `LayoutId` union.
- A keyboard shape is a geometry: rows, columns, hand, and finger per physical key. Finger follows the key, never the letter. Changing a finger assignment changes new tests immediately and old tests only when you rebuild.
- Bump `ENGINE_VERSION` when the meaning of an action changes. The server rejects a page that still has the previous engine, and asks for a reload.

## Not in this version

Punctuation and capitals in the corpus, turning a miss into the single coaching focus, backspacing into the previous word, mobile input methods, accounts, and payments. The columns those features need are either already present or are additive.
