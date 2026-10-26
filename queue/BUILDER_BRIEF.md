# Builder brief — one deposit for the Aster Idea Bank

You are building ONE idea for the Aster Idea Bank at `/home/user/Aster-Idea-Bank`. Your assignment (number, slug, title and the judged proposal) is in your prompt. The bank's purpose: AI agents build feature prototypes, maintainer tools and studies for three sibling projects, Aster (`/home/user/asteroid-mining-planner`), PartForge (`/home/user/Partforge`) and Skyhook (`/home/user/skyhook`), and only ever add here.

## Before you write anything

1. Read `/home/user/Aster-Idea-Bank/README.md` (house rules; the checker enforces the README format) and `/home/user/Aster-Idea-Bank/BRIEFING.md` (the project facts, where truth lives, what each project has said it wants).
2. Read two finished Idea Bank deposits for the bar you are held to: `/home/user/Idea-Bank/ideas/74-whose-turn/README.md` and `/home/user/Idea-Bank/ideas/42-nothing-to-push-against/README.md`, and skim their `index.html`, logic module and tests. Notice: a "Why I made it" that shows alternatives weighed; a "How it works" where every number traces somewhere; tests described with their teeth (what fails when the code is wrong); an honest assessment that names what is rough.
3. Verify the proposal's citations against the source repo with grep before building. If the cited open item does not exist, or the feature is already shipped, or the data is not where the proposal says, do not fake it: build the honest variant and say so in the README; if nothing honest remains, stop and return status `abandoned` with the reason.

## Where you may write

Only inside `/home/user/Aster-Idea-Bank/ideas/NN-slug/` (your folder; create it). Never write anywhere else: not other idea folders, not the bank's `tools/`, `README.md`, `BRIEFING.md` or `index.html`, and NEVER inside `/home/user/asteroid-mining-planner`, `/home/user/Partforge`, `/home/user/skyhook` or `/home/user/Idea-Bank`. Do not run `node tools/gallery.mjs` (it rewrites the bank's root files; the integrator runs it). Do not run git commands that change state anywhere (no add, commit, push, checkout, stash, reset). Do not install packages (no `npm install`, no `pip install`). Scratch files go in `/tmp` or in your folder and are deleted before you finish. Other builders are working in sibling folders at the same time; ignore them.

## What a deposit contains

- **`index.html`** for browser ideas: plain HTML/CSS/JS with classic scripts (no modules that break on `file://`, no build step); opening the file directly must work; `<meta name="viewport" content="width=device-width, initial-scale=1">`; light and dark via `prefers-color-scheme` (define colours as CSS variables on `:root`, redefine under `@media (prefers-color-scheme: dark)`); no horizontal overflow at 390 px; anything draggable also works by touch; no network requests; no console errors; keyboard-reachable controls. Put the logic in a pure module file (for example `model.js`) that loads both as a classic script and via `require()` so Node tests import it without a bundler, Idea Bank style:
  ```js
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ModelName = factory();
  })(typeof self !== 'undefined' ? self : this, function () { /* ... */ return api; });
  ```
  No external CDN scripts: everything the page needs is in the folder. Canvas 2D or inline SVG for drawings.
- **For CLI ideas:** a Python 3 standard-library script or a Node built-ins script with `--help` and a non-zero exit on failure, plus `example.txt` (real saved output from running it against the actual checkout, which the gallery renders as the preview). Where it adds value, also ship an `index.html` that presents the tool's findings or lets a person use the same logic in the browser; then the idea opens from the gallery and the **Run:** line still gives the command.
- **For printable ideas:** STL written directly by your own Python/JS (no OpenSCAD here), physical units stated, print and assembly instructions, and a clear line between digital checks and physical testing. `tools/printcheck.py` will skip itself here (trimesh is not installed), so state in the README that the mesh was checked by your own code (closed, consistently wound, on the bed) and what remains unverified.
- **Data from a source repo:** copy it with
  `node /home/user/Aster-Idea-Bank/tools/snapshot.mjs <repo-dir> <path-in-repo> /home/user/Aster-Idea-Bank/ideas/NN-slug/snapshots/<file> [--pick a.b,c] [--limit a.b=N] [--note "why"]`
  so a `<file>.provenance.json` sidecar is written. For an excerpt you derive with your own script (for example 2,000 of 41,906 catalog bodies), keep the deriving script in the folder (`build-data.mjs` / `build_data.py`), write the derived file under `snapshots/`, then run snapshot.mjs with `--sidecar-only --note "derived by build_data.py: <rule>"` pointing at the source file. Keep the whole folder under 500 KB (`du -sk`); the checker fails above 650 KB. Never retype a constant from memory: snapshot it or cite file and commit in the README.
- **Tests:** `*.test.mjs` (node:test + node:assert/strict) and/or `test_*.py` (unittest), runnable from the bank root: `node --test ideas/NN-slug/x.test.mjs`, `python3 -m unittest discover -s ideas/NN-slug -p 'test_*.py'`. Tests must have teeth: at least one test pins a number to something outside your own code (a published value in the source repo's findings, fixtures or tests; a hand-worked example; a closed form; a limit case; a round trip). Where the source repo publishes a number your model should reproduce (Skyhook's 121.83x at 30% derate, Aster's poliastro vectors or launch-vehicle anchors, PartForge's table rows), reproduce it as a reconciliation test and say so in the README. Keep the whole test run under about 60 s. State in the README what breaks when you sabotage the code (try it: flip a sign, change a constant, count failing tests).
- **Optional `ui-check.mjs`:** drives the page in headless Chromium with the globally installed Playwright (load it as `/home/user/Idea-Bank/ideas/74-whose-turn/ui-check.mjs` does, with the `npm root -g` fallback). Strongly recommended for anything interactive: assert the numbers on the page, the refusal states, phone width, dark mode. Name it `ui-check.mjs` (not `*.test.mjs`) and point to it from **Run:** so the checker does not run it inside the generic test step unless you want it to (if you do want it run, add a `check.mjs` in your folder that spawns it; the checker runs `check.mjs` if present).
- **`README.md`** in the house format, exactly this skeleton:
  ```
  # Title
  > One-sentence tagline. This is what the gallery shows; make it say the real thing, with the real number if there is one.

  **Kind:** one or two words
  **For:** Aster | PartForge | Skyhook | or a combination joined with +
  **Run:** how to open or run it, and how to run its tests, from the bank root
  **Made by:** a persona name you choose, Idea Bank style (one or two words, e.g. "Fairlead", "Gnomon", "Notchwright"); not "Claude"

  ## What it is
  ## Why I made it        which open item, backlog line, kernel or evaluation row it serves, with file:line; what alternatives you weighed and why this won
  ## How it works         the math or logic, units, what every number traces to (snapshot, computation, citation)
  ## Tests                what they assert; their teeth (what fails when the code is wrong, counted)
  ## Honest assessment    every claim labelled [Certain] / [Likely] / [Speculative]; what works; what is rough; a "Findings about the source repo" list if you found defects or stale numbers, with file:line; which of the target project's gates this has NOT been through
  ## Where it would land  repository, path or surface, and what must change to ship there for real
  ```
  The checker requires: a `# Title` line, a `> tagline` line, the four `**Field:**` lines with `**For:**` naming at least one of Aster / PartForge / Skyhook, the sections What it is, Why I made it, How it works, Honest assessment and Where it would land, at least one confidence label, and a provenance sidecar beside every file under `snapshots/`.

## Honesty rules (non-negotiable)

- Skyhook tether numbers come only from `params/rev_a.json` (snapshot it or an excerpt). Aster constants come from the core and porkchop modules (snapshot the file or cite file and commit). PartForge rows keep their `confidence` field; a `recall` row is never presented as cited.
- Every number a page shows traces to a snapshot, a computation the page can show, or a cited source. When the data to answer is absent, the page shows a structured refusal (what is missing, what would help), never a placeholder number. A kernel that cannot refuse does not ship.
- Say what fidelity this is: an idea-bank prototype. Name which of the target project's gates it has not passed (Aster: multi-agent math audit, oracle validation, founding-doc DEC process, protected core; PartForge: the geometry gate, the data provenance pipeline and skeptic review; Skyhook: Rule 1 canon, VM verification, pytest suite).
- Finding a defect, stale value or gap in a source repo is valuable: record it under "Findings about the source repo" with file:line and what you observed. Do not fix it there.
- Do not overclaim. "Tests pass" means you ran them and read the output. A number you did not verify is labelled [Speculative]. Attribution for borrowed methods: cite the paper or standard by name; say when you know it from secondary sources.

## Finish

1. From the bank root run `node /home/user/Aster-Idea-Bank/tools/check.mjs ideas/NN-slug`. It checks README format, folder size, snapshot sidecars, your tests, then the headless smoke test at 1280 px and 390 px (console errors, uncaught exceptions, failed requests, horizontal overflow). Fix everything until it prints `all ideas pass`.
2. Read the smoke screenshots it prints (they are PNGs; use the Read tool) at both sizes and fix anything that looks wrong: overflow, unreadable text, blank canvas, dark-mode contrast.
3. `du -sk` your folder; delete scratch files; make sure `__pycache__` and `node_modules` are not present.
4. Return the structured report your prompt asks for. Be exact about what you built, what the tests pin, what you found in the source repo, and what you could not do.
