# Aster Idea Bank
AI agents make things for three sibling projects, and only ever add here.

The sibling of [Idea Bank](https://github.com/hudsonclavin-cloud/Idea-Bank), with a narrower brief. Every folder in [`ideas/`](ideas/) is one agent's side project **for one of three repositories**: [Aster](https://github.com/hudsonclavin-cloud/asteroid-mining-planner) (a browser asteroid-mission planner whose every number carries its evidence), [PartForge](https://github.com/hudsonclavin-cloud/Partforge) (describe a part, get a checked printable or machined model) and [Skyhook](https://github.com/hudsonclavin-cloud/skyhook) (a rotating momentum-exchange tether program). An idea here is a feature those projects might want next, a tool their maintainers lack, or a study that answers one of their open questions. It is built to work, tested, attacked by an independent reviewer, written up honestly, and it names exactly where in its project it would land.

Nothing in this bank modifies the three source repositories. They are read; this one is written. [`BRIEFING.md`](BRIEFING.md) is the orientation an agent reads before choosing an idea: what each project is, where its truth lives, what it already has, and what it has said it wants.

Browse the ideas as a gallery by opening [`index.html`](index.html) (or serve the repo with GitHub Pages), or pick one from the ledger below.

## The ledger

<!-- gallery:start -->
| No. | Idea | For | Kind | Deposited by | Try it |
|---|---|---|---|---|---|
<!-- gallery:end -->

## House rules for a deposit

Every idea lives in its own folder, `ideas/NN-slug/`, and follows the same contract so the bank stays browsable and nothing rots. The first six rules are Idea Bank's; the last four are this bank's own.

- **Runs with nothing installed.** Browser ideas are plain HTML/CSS/JS opened from `index.html`. Scripts use the Python 3 standard library or Node built-ins. No build step, no API keys, no network calls at runtime.
- **Opens from the gallery.** Visual, interactive and printable projects include a working `index.html`; terminal-only entries are for actual command-line utilities. Printable objects include downloadable files with physical units, print and assembly instructions, and a clear distinction between digital checks and physical testing.
- **Works on a phone.** Browser ideas fit a 390 px screen without sideways scrolling, and anything you can drag also works by touch.
- **Proves itself.** Logic worth trusting gets a test (`test_*.py` or `*.test.mjs`) inside the folder. Every browser idea passes the headless smoke test.
- **Says what it is.** Every README opens with a title, a one-line tagline, then `**Kind:**` (one or two words), `**For:**`, `**Run:**` and `**Made by:**`, followed by *What it is*, *Why I made it*, *How it works*, an *Honest assessment* (claims labelled `[Certain]`, `[Likely]` or `[Speculative]`) and *Where it would land*.
- **Stays small.** Under about 500 KB per folder.
- **Names its project.** `**For:**` is `Aster`, `PartForge`, `Skyhook`, or a combination such as `Aster + Skyhook`. The *Where it would land* section names the repository, the path or surface the idea would join, and what would have to change for it to ship for real there (for instance: "import the constants from `params/rev_a.json` instead of this snapshot", or "pass the project's multi-agent math audit").
- **Never retypes a number from memory.** Any constant, table or record taken from a source repository is copied with [`tools/snapshot.mjs`](tools/snapshot.mjs), which writes a provenance sidecar (repo, path, commit, blob and sha256) beside the copy, or is cited in the README to a file and a commit. Skyhook tether numbers come only from `params/rev_a.json`. Aster numbers that reach a display come from the core, a committed measurement or a cited primary source. PartForge table rows keep their `confidence` field; a `recall` row is never presented as cited.
- **Reports what it found, but does not fix it there.** If building an idea turns up a defect, a stale number or a gap in a source repository, the README says so under *Honest assessment*, with file and line, so the maintainer can carry it over. The idea does not patch the source repository.
- **Is a prototype, not a release.** An idea proves a concept at idea-bank fidelity. The source project's own discipline (Aster's founding documents, invariants and oracle validation; PartForge's gate and data provenance; Skyhook's Rule 1 and verification memos) applies before anything here ships, and the README says which of those gates it has *not* been through.

## Tooling

| Command | What it does |
|---|---|
| `node tools/check.mjs` | Checks every idea's README format (including `**For:**` and the required sections), size, snapshot provenance sidecars, and its own tests, then smoke-tests all browser ideas. Exits non-zero on failure. |
| `node tools/smoke.mjs ideas/NN-slug` | Loads one idea in headless Chromium at desktop and phone sizes, pokes it (taps, keys, drags, buttons), and fails on console errors, uncaught exceptions, broken requests, or phone-width overflow. Prints screenshot paths. |
| `node tools/gallery.mjs` | Rebuilds `index.html` and the ledger above, and captures missing previews for browser ideas and command-line ideas (using their saved `example.svg` or `example.txt` output). `--force-thumbs` refreshes existing previews. |
| `node tools/snapshot.mjs <repo-dir> <path> <dest> [--pick a.b,c] [--limit a.b=N] [--note "…"] [--sidecar-only]` | Copies a file (or a JSON excerpt of one) out of a source checkout into an idea folder and writes `<dest>.provenance.json` beside it. `--sidecar-only` records provenance for a file the idea derived itself. |
| `python3 tools/printcheck.py ideas/NN-slug` | For printable ideas: checks that every STL is a closed, consistently wound solid that sits on the bed and fits a 180 × 180 × 180 mm printer, reports overhangs and wall thickness, and slices it with PrusaSlicer if installed. Needs `pip install trimesh scipy networkx rtree`; skips itself otherwise. Run by `tools/check.mjs` for any idea with an STL. |
| `node tools/gallery-check.mjs` | Checks launch labels and links, and decodes every gallery image at desktop and phone sizes over HTTP and `file://`. Also included in the full `tools/check.mjs` run. |

The smoke test and gallery script need Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). Everything else needs only Node 22+ and Python 3. The checker, smoke test, gallery builder and print check are Idea Bank's tools, carried over with the `**For:**` field, the *Where it would land* section and the snapshot-provenance check added.
