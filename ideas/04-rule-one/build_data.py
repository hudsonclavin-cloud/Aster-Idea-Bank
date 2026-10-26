#!/usr/bin/env python3
"""Derive the self-test fixtures under snapshots/fixtures/ from a Skyhook checkout.

Each fixture keeps the source file's LINE NUMBERS: only the listed line ranges
are copied, every other line is left empty, so a finding at
snapshots/fixtures/tools/sims/skyhook_program_site.html:1135 is the same
file:line as in the repository. Two fixtures (skyhook_calculator.jsx,
docs/glossary.md) are whole-file copies made with the bank's snapshot.mjs and
are not touched here.

    python3 ideas/04-rule-one/build_data.py /home/user/skyhook

After writing each excerpt this script runs the bank's tools/snapshot.mjs with
--sidecar-only so every fixture carries a provenance sidecar naming the source
path, commit and sha256. Run it from the bank root; it writes only inside
ideas/04-rule-one/snapshots/fixtures/.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.abspath(os.path.join(HERE, "..", ".."))
FIXTURES = os.path.join(HERE, "snapshots", "fixtures")

# path in repo -> list of (first, last) 1-based inclusive line ranges, and why.
EXCERPTS = {
    "tools/sims/skyhook_program_site.html": ([(215, 222), (240, 247), (360, 365), (408, 412), (1130, 1140), (1415, 1420)],
        "FIG labels (219 lower tip 100-150 km), the symbol table (243, 246), the mass-ratio prose (363), FIG 4 caption (410), "
        "the Calculator's LAD ladder (1135, DEVIATIONS #8) and the glossary dd (1417, 1419)"),
    "tools/sims/skyhook_no_leo_stress_test.jsx": ([(1, 80)],
        "the import of params/rev_a.json (16), the REVA mapping that reads mass_ratio.tether_to_payload_single_arm_range (48), "
        "a key rev_a.json does not have, and the line that indexes it (79)"),
    "tools/sims/skyhook_orbit_theater.html": ([(30, 45), (199, 203)],
        "VTIP=3.5 (39, DEVIATIONS #4 Leave) and the self-labelling status line (201)"),
    "docs/project_instructions.md": ([(29, 32), (44, 49), (124, 127), (199, 203)],
        "2.1 'say, 3.5 km/s' (31) and 4.3 '1-second timing error at 3.5 km/s' (126), both DEVIATIONS #5 Leave; "
        "the labelled 3.5 mentions at 46 and 48; the Phase 3 HASTOL geometry line (201)"),
    "docs/original_README.md": ([(1, 8)],
        "the prepended archival header (1) and the 'v_tip 3.5 km/s Phase 3 target' sentence (6; DEVIATIONS #1 says line 4)"),
    "docs/program_manifest.md": ([(1, 10), (64, 70)],
        "the two CANON CORRECTION banners (6: release 10.05, mass ratio ~41x/65x/123x; 8: the correct ladder) and the "
        "24 Aug session delta that says 'v_tip 3.5 km/s reaffirmed' (68)"),
    "docs/objections_faq.md": ([(36, 39)],
        "'A 600 km structure' (38) against 2L = 640 km, and the 3.9 g Phase 3 line (36)"),
}


def excerpt(src_text, ranges):
    lines = src_text.split("\n")
    keep = set()
    for a, b in ranges:
        keep.update(range(a, b + 1))
    out = [(ln if (i + 1) in keep else "") for i, ln in enumerate(lines)]
    last = max(keep)
    return "\n".join(out[:last]) + "\n"


def main(argv):
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        sys.stderr.write("usage: build_data.py <skyhook-checkout>\n")
        return 2
    repo = os.path.abspath(argv[1])
    snapshot = os.path.join(BANK, "tools", "snapshot.mjs")
    for rel, (ranges, why) in EXCERPTS.items():
        src = os.path.join(repo, rel)
        with open(src, encoding="utf-8") as fh:
            text = fh.read()
        dest = os.path.join(FIXTURES, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(excerpt(text, ranges))
        spans = ", ".join(f"{a}-{b}" for a, b in ranges)
        note = (f"derived by build_data.py: lines {spans} copied verbatim, every other line left empty so line numbers "
                f"match the source; kept for {why}")
        r = subprocess.run(["node", snapshot, repo, rel, dest, "--sidecar-only", "--note", note],
                           capture_output=True, text=True)
        sys.stdout.write(r.stdout + r.stderr)
        if r.returncode != 0:
            return r.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
