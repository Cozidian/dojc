# dojc

A self-hosted typing dojo. The test is the familiar one: words on a screen, a clock made of your own keystrokes. The record underneath is built for coaching. After enough clean typing it can say that, on Dvorak, your left pinky is slowing you down, or that the letter pair "bl" is holding you back, and then give you one thing to practice.

English, QWERTY, and Dvorak are the whole catalog for now. Another language is a word list. Another layout is a character map on the same physical keys. Another keyboard shape is a geometry. The session log does not have to change to add them.

There is one local user and no account. A hosted version can put authentication in front of that user later. The file `data/dojc.sqlite` is the whole history. The code is MIT licensed.

## Run

Node 22 or newer.

```bash
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. The API listens on http://127.0.0.1:8787 and is not exposed beyond this machine.

To serve the interface and the API from one process:

```bash
pnpm build
pnpm start
```

Then open http://127.0.0.1:8787. `HOST`, `PORT`, and `DB_PATH` override the defaults.

`pnpm test` runs the engine, the coaching rules, and the save path. `pnpm rebuild` replays every stored test and rewrites the derived transcript after an engine change. It leaves the key log alone.

## Stack

The browser and the server share one TypeScript engine. A finished test is saved as key events. The server replays those events and stores the transcript it computed, so the score on screen and the score in the file are the same function. SQLite is one file, which is the right database for a single-user install and a boring one to back up: stop the process and copy `data/`.

React draws the page. It does not decide what a keystroke meant.

## Layouts

dojc maps `KeyboardEvent.code`, the physical key, through the layout you selected. The operating system's layout is not consulted, and Caps Lock is ignored. Hold Shift for a capital. QWERTY and Dvorak are both ANSI home-row fingering: the finger belongs to the key position, and the letter is only what that position produces on the selected layout. That is why the same word can implicate different fingers after you switch.

The default test is 25 English words. A mistake has to be backspaced. After a test, the passage stays on screen with the letters you missed. Progress, in the header, is the other chapter. It draws speed, accuracy, and fingers for the measured tests, lists earlier tests with the time they were taken, and starts practice from what those tests keep showing. A streak is the days in a row you finished a test, including practice, and it follows you across layouts. A letter you miss often enough can be practiced on its own: twenty words that contain it. A word you miss often enough is set among other words, about one in four, never twice in a row. That practice does not become the speed focus. Drills stay out of the charts, the speed diagnosis, and the miss list, so practicing "bl", "y", or "finally" does not teach the dojo that you only type those. Progress draws the open focus across the measured tests, and a focus that caught up stays visible after the next one takes its place.

The model, the timing rules, and the coaching threshold live in [docs/data-model.md](docs/data-model.md).
