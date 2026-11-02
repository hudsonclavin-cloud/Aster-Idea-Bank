#!/bin/sh
# Build-time oracle (not imported by the page or the tests): what real pytest collects from
# Skyhook's tests/ at the pinned commit, in two throw-away venvs:
#   A: `pip install pytest`            (README.md:69-70, the Quick start block)
#   B: `pip install pytest openpyxl`   (.github/workflows/ci.yml:23)
# census.test.mjs compares the census's pytest reach and its file-level skip verdicts with this.
#
#   sh oracle/pytest-oracle.sh <scratch-dir> <skyhook-checkout> > oracle/pytest.txt
set -eu
S="$1"; REPO="$2"; COMMIT=34935cb1f67a8422a9fd49481e080faade2c0d92
T="$S/skyhook-$(echo $COMMIT | cut -c1-7)"
rm -rf "$T" && mkdir -p "$T"
git -C "$REPO" archive --format=tar "$COMMIT" | tar -x -C "$T"
for v in a b; do
  [ -x "$S/venv-25$v/bin/pytest" ] || { python3 -m venv "$S/venv-25$v"; "$S/venv-25$v/bin/pip" install -q pytest $( [ $v = b ] && echo openpyxl ); }
done
echo "# skyhook @ $COMMIT, $(date -u +%Y-%m-%d)"
for v in a b; do
  echo "## venv $v: $("$S/venv-25$v/bin/pip" freeze | grep -i -E '^(pytest|openpyxl)==' | tr '\n' ' ')"
  # -rs lists module-level skips with their reason; the collection lines name the files
  (cd "$T" && "$S/venv-25$v/bin/pytest" tests/ --collect-only -q -rs -p no:cacheprovider 2>&1 | grep -E '^tests/|SKIPPED|collected|error' | sed -E 's/::.*$//' | sort | uniq -c) || true
done
rm -rf "$T"
