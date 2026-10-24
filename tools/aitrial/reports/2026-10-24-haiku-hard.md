# AI trial 2026-10-24: Claude Haiku 5.5, 30 harder requests

The normal set (`requests.json`) was nearly always clean after the fixes of the
[second run](2026-10-24-haiku-2.md), so this run used `requests-hard.json`: parts that must fit
together (clearances, threads, snap fits, print-in-place joints), shapes that invite overhangs
(arches, hooks, rockets, chess pieces), and tall or wide parts. Same model, prompt and 3 fix rounds.
Cost $0.44.

## Summary

- **Printable: 29 of 30 clean in the end, 25 on the first answer.** Problems found and fixed on the
  way: a 32 mm flat ceiling (#9), a chess piece starting in mid-air (#21), and wrong `threaded_nut()`
  arguments (#11 `ns`/`od`, #18 `od`). The parameter list fixed each of these in one round.
- **One false alarm, now fixed:** #2's screw threads. BOSL2's ISO thread flanks are 60° from upright,
  and the overhang check (and the judge, scadcheck) called them overhangs. The AI was caught between
  two rules of the prompt ("threads with `threaded_rod()`" and "no overhang over 45°"), tried a
  `tooth_angle` argument that doesn't exist, and in the end asked the user to choose. Thread flanks
  print fine without support. `src/overhangs.ts` now skips them: a flank goes all the way round, is
  shallow (≤ 4 mm) and no steeper than 65°, and is taller than it is deep, while a rim flaring out
  more steeply than 45° is always deeper than it is tall. The prompt says threads are fine. Run
  again, #2 was clean in 2 rounds (the second fixed a real 73 mm ceiling in the lid). The app still
  agrees with the judge everywhere else (122 of 125 rounds and models; the 3 that differ are #2's
  thread flanks).
- **The judge finds nothing else** in the final answers except thin parts (fine thread detail),
  which the app doesn't check.
- **Three requests got no answer** from the chat CLI the first time (#1, #8, #13, all long answers;
  4 in parallel). Asked again, all three were clean on the first answer.

## What the checks can't see: does it do what was asked?

Looked at the pictures of the 30 final answers. Printable is not the same as right:

| # | Request | What came out |
|---|---|---|
| 1 | print-in-place hinge box | Box and lid side by side; the lid's knuckles must be put on the box's pin by hand. Not print-in-place. |
| 16 | ring with LOVE around the outside | A 4 mm flat washer with the letters standing on top: no overhang, but not a finger ring with text around it. |
| 23 | carabiner with a flexible gate | A closed loop with a slit, no gate. |
| 28 | vase, square to circle, twisting | Shape right, but solid (a vase-mode slice would make it hollow). |
| 6 | arched bridge | The arch became a 45° triangle (printable, as the prompt asked); railings as loose bars. |
| 21 | chess pieces | The knight is a block. |

The rest look right: the planetary set has an internal ring gear, the bolt/nut/washer and threaded
jars fit, the Pi case has its openings, the 250 mm headphone stand comes in three parts that fit the
bed, and the bevel gears, pulley, spinner, drawer and shelves are what was asked.

The 45° rule sometimes changes the design rather than adding a chamfer (#6, #16). That is the right
call for printing without support, but the user should hear about it: the AI says so in its answer
text, not in the code.

## Next

- Thread flanks are skipped now; scadcheck (the judge, outside the repo) still reports them.
- Function can't be checked on the mesh. Ideas: ask the AI to say in a comment at the top what each
  part does and how the parts go together (shown in the app), or a prompt line for print-in-place
  joints (clearance all round, parts connected while printing).
- The trial could retry a chat that gave no answer.
