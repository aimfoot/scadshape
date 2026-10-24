# AI trial

Lets a (weaker) AI model design things with the app's own prompt, the way a user would, and runs
the answers through what the app does with pasted code. It shows which mistakes AI code makes, whether
the app's problem list and "Copy for AI" text get them fixed, and what the checks miss.

```sh
node tools/aitrial/run.mjs            # all requests in requests.json
node tools/aitrial/run.mjs 2 17       # only requests 2 and 17
MODEL=sonnet ROUNDS=2 PARALLEL=2 node tools/aitrial/run.mjs
REQUESTS=$PWD/tools/aitrial/requests-hard.json OUT=$PWD/tools/aitrial/out/hard node tools/aitrial/run.mjs
node tools/browser/aitrial-sheet.mjs  # contact sheets of the results
```

The last five requests in `requests.json` and `requests-hard.json` are in Swedish on purpose: users
write in their own language. `requests-hard.json` asks for more: parts that must fit together
(clearances, threads, snap fits, print-in-place joints), shapes that invite overhangs, and big parts.

Per request: the prompt from "Copy prompt" (A1 mini build volume) plus the request goes to the
`claude` CLI (`--model`, default haiku) as a plain chat without tools. The code is picked out of the
answer, rendered in the app's WASM build (a worker thread, 90 s limit), and checked like in the app:
OpenSCAD's messages, lint, and the model checks (too big for the bed, mid-air starts, flat ceilings,
overhangs). While there are problems, the "Copy for
AI" text goes back into the same chat (ROUNDS, default 3). The last code goes through "Convert to
sketches" and is drawn to a PNG. When a `scadcheck` command is installed, it judges every rendered
round independently (slicing-based), to show what the app's own checks miss.

Output (git-ignored) in `tools/aitrial/out/`: per request the prompts, answers, code, logs, STL and
judge output for each round, `result.json` (with the last code's top comment, `description`, as the app
shows it), and `results.json` for all. It uses the CLI's account,
so it costs usage (about 1 cent per request with Haiku).

Reports of earlier runs: `reports/`.
