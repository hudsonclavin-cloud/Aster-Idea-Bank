/*
 * Line Drift — the pure half of the citation linter (no fs, no git, no clock).
 *
 * Given the text of a Markdown document, it finds three kinds of reference:
 *   line   `path:N`, `path:N-M`, `path:N,M`, and a bare `:N` that inherits the last path named
 *          in the same paragraph (`:646` after `src/v2/app/porkchop/main.ts:637`);
 *   path   a backticked repository path with no line (`tools/x/y.json`, `src/v2/core/`);
 *   commit a 7–40 hex token with at least one digit and one letter (`bcf1738`), backticked or not,
 *          unless the sentence says it is a content hash (sha256 / md5 / blob) or it ends in "…".
 * It pairs each line citation with the snippets (backticked code or a quoted string of 2+ words)
 * that sit closer to it than to any other citation in the same sentence, and, given an `env` that
 * answers questions about a tree of files, judges each reference:
 *   OK, MOVED (snippet found, but not on the cited lines), GONE (snippet nowhere in the file),
 *   IN-RANGE (no snippet to check; the cited lines exist), PAST-EOF, MISSING-PATH, IGNORED,
 *   UNTRACKED, UNREACHABLE-COMMIT, NOT-A-COMMIT, UNCHECKABLE.
 * The env is built by line-drift.mjs from a git checkout (or a commit), and by the page from text
 * pasted into it. Loads as a classic script (window.LineDrift) and with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LineDrift = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUSES = [
    'OK', 'PARTIAL', 'MOVED', 'GONE', 'IN-RANGE', 'PAST-EOF', 'MISSING-PATH', 'IGNORED', 'UNTRACKED',
    'UNREACHABLE-COMMIT', 'NOT-A-COMMIT', 'UNCHECKABLE',
  ];
  // Statuses that make the CLI exit 1 unless allowlisted. IN-RANGE, NOT-A-COMMIT and UNCHECKABLE
  // are reported but never fail a run: they are "could not check fully", not "found wrong".
  const DRIFT = new Set(['MOVED', 'GONE', 'PAST-EOF', 'MISSING-PATH', 'IGNORED', 'UNTRACKED', 'UNREACHABLE-COMMIT']);

  // ---------------------------------------------------------------------------------------------
  // Text helpers

  // One-to-one character folding used for the "loose" match: every dash to '-', every single or
  // double quote to '"' (a quotation nested in quotes swaps its marks), and the multiplication sign
  // to 'x' (STATUS.md writes `Grid: ${...}x${...}` for a source line with ×).
  const FOLD = {
    '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
    "'": '"', '\u2018': '"', '\u2019': '"', '\u201A': '"', '\u2032': '"',
    '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2033': '"',
    '\u00D7': 'x', '\u00A0': ' ',
  };
  function fold(s) {
    let out = '';
    for (const ch of s) out += FOLD[ch] || ch;
    return out;
  }
  const isWS = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ';
  function collapse(s) {
    return s.replace(/[\s ]+/g, ' ').trim();
  }
  function lineCount(text) {
    if (text === '') return 0;
    const n = text.split('\n').length;
    return text.endsWith('\n') ? n - 1 : n;
  }

  // Whitespace-collapsed copy of a file with, for every character, the 1-based line it came from.
  // A run of whitespace becomes one space attributed to the line the run starts on. Folding is
  // character-for-character, so the loose copy shares the same line map.
  function indexText(text) {
    let norm = '';
    const lines = [];
    let line = 1;
    let i = 0;
    const n = text.length;
    while (i < n && isWS(text[i])) { if (text[i] === '\n') line++; i++; }
    while (i < n) {
      const ch = text[i];
      if (isWS(ch)) {
        const startLine = line;
        while (i < n && isWS(text[i])) { if (text[i] === '\n') line++; i++; }
        if (i < n) { norm += ' '; lines.push(startLine); }
        continue;
      }
      norm += ch;
      lines.push(line);
      i++;
    }
    const loose = fold(norm);
    // Compact: the loose copy with every space removed and ' ` folded to ", for code snippets
    // (`confidence:"assumed"` against confidence: 'assumed').
    let compact = '';
    const clines = [];
    for (let k = 0; k < loose.length; k++) {
      const ch = loose[k];
      if (ch === ' ') continue;
      compact += ch === "'" || ch === '`' ? '"' : ch;
      clines.push(lines[k]);
    }
    return { norm, loose, lines, compact, clines, lineCount: lineCount(text) };
  }
  function compactOf(s) {
    return fold(s).replace(/\s+/g, '').replace(/['`]/g, '"');
  }

  function findAll(hay, needle, max) {
    const out = [];
    if (!needle) return out;
    let from = 0;
    while (out.length < max) {
      const k = hay.indexOf(needle, from);
      if (k < 0) break;
      out.push(k);
      from = k + 1;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Markdown units: paragraphs, list items, table rows and headings, with fenced code skipped.

  function splitUnits(text) {
    const rawLines = text.split('\n');
    const units = [];
    let cur = null;
    let fence = null;
    const flush = () => { if (cur) { units.push(cur); cur = null; } };
    for (let idx = 0; idx < rawLines.length; idx++) {
      let ln = rawLines[idx].replace(/\r$/, '');
      const lineNo = idx + 1;
      const fm = /^\s{0,3}(`{3,}|~{3,})/.exec(ln);
      if (fence) {
        if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && /^\s*$/.test(ln.slice(fm[0].length))) fence = null;
        continue;
      }
      if (fm) { flush(); fence = fm[1]; continue; }
      if (/^\s*$/.test(ln)) { flush(); continue; }
      // Blockquote markers are stripped; the quoted text is still prose.
      ln = ln.replace(/^\s{0,3}(>\s?)+/, '');
      const isHeading = /^\s{0,3}#{1,6}\s/.test(ln);
      const isRow = /^\s*\|/.test(ln);
      const isSep = isRow && /^\s*\|?[\s:|-]+\|?\s*$/.test(ln) && ln.includes('-');
      const isItem = /^\s*([-*+]|\d{1,3}[.)])\s+/.test(ln);
      if (isSep) { flush(); continue; }
      if (isHeading || isRow || isItem || (cur && (cur.kind === 'heading' || cur.kind === 'row'))) flush();
      if (!cur) cur = { kind: isHeading ? 'heading' : isRow ? 'row' : isItem ? 'item' : 'para', firstLine: lineNo, text: '', lineStarts: [] };
      else cur.text += '\n';
      cur.lineStarts.push(cur.text.length);
      cur.text += ln;
      if (isHeading) flush();
    }
    flush();
    return units;
  }

  function lineOfOffset(unit, off) {
    let lo = 0;
    let hi = unit.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (unit.lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return unit.firstLine + lo;
  }

  // CommonMark code spans: a run of n backticks closed by the next run of exactly n.
  function codeSpans(text) {
    const spans = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '\\' && text[i + 1] === '`') { i += 2; continue; }
      if (text[i] !== '`') { i++; continue; }
      let j = i;
      while (text[j] === '`') j++;
      const n = j - i;
      let k = j;
      let found = -1;
      while (k < text.length) {
        if (text[k] === '`') {
          let m = k;
          while (text[m] === '`') m++;
          if (m - k === n) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found < 0) { i = j; continue; }
      let content = text.slice(j, found).replace(/\n/g, ' ');
      if (content.length > 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim()) content = content.slice(1, -1);
      spans.push({ start: i, end: found + n, content });
      i = found + n;
    }
    return spans;
  }

  function maskSpans(text, spans, ch) {
    if (!spans.length) return text;
    let out = '';
    let last = 0;
    for (const s of spans) {
      out += text.slice(last, s.start) + ch.repeat(s.end - s.start);
      last = s.end;
    }
    return out + text.slice(last);
  }

  // Quoted strings outside code spans: curly pairs, and straight double quotes paired in order.
  function quoteSpans(masked) {
    const spans = [];
    const re = /“([^“”]{1,400})”/g;
    let m;
    while ((m = re.exec(masked))) spans.push({ start: m.index, end: m.index + m[0].length, content: m[1] });
    const straight = [];
    for (let i = 0; i < masked.length; i++) if (masked[i] === '"' && masked[i - 1] !== '\\') straight.push(i);
    for (let p = 0; p + 1 < straight.length; p += 2) {
      const a = straight[p];
      const b = straight[p + 1];
      if (b - a - 1 >= 1 && b - a - 1 <= 400) spans.push({ start: a, end: b + 1, content: masked.slice(a + 1, b) });
    }
    spans.sort((x, y) => x.start - y.start);
    return spans;
  }

  // A snippet farther than this (in characters of the paragraph) from every citation in its sentence
  // is left unpaired. Tuned on Aster at 62ddb17; see the README for what it costs and saves.
  const MAX_PAIR_GAP = 80;
  const SEPARATOR = /[;,]|\b(?:and|but|while|whereas|whilst)\b/i;
  // Text that joins a snippet to a citation without saying anything else: "is at", " (", "at", ...
  const CONNECTOR = /^[\s(),:;*_\u2014\u2013-]*(?:(?:is|are|was|at|in|on|see|lives|sits|line|lines|from|defined|set|renders?|reads?|says?|holds?)[\s(),:;*_]*)*$/i;
  const ABBREV = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf|etc|approx|incl|No|Fig|Eq|al|ca|resp|min|max|Rev|Dr|Mr|Ms|St)$/;
  // Sentence boundaries: . ! ? followed by whitespace and an opener, outside code and quotes; in a
  // table row, every unescaped | is also a boundary (each cell is read on its own).
  function sentenceBounds(masked, isRow, quotes) {
    const cuts = [0];
    // A quoted sentence ("... immediately.") closes the sentence it sits in when the next word
    // starts a new one; the period is inside the masked quote, so the scan below cannot see it.
    for (const q of quotes || []) {
      if (!/[.!?]\s*$/.test(q.content)) continue;
      let j = q.end;
      while (j < masked.length && /[*_)]/.test(masked[j])) j++;
      if (j >= masked.length || !isWS(masked[j])) continue;
      let k = j;
      while (k < masked.length && isWS(masked[k])) k++;
      if (k < masked.length && /[A-Z"\u201C(\[*`\u0000\u0001_]/.test(masked[k])) cuts.push(j);
    }
    for (let i = 0; i < masked.length; i++) {
      const ch = masked[i];
      if (isRow && ch === '|' && masked[i - 1] !== '\\') { cuts.push(i + 1); continue; }
      // A middle dot between spaces separates list entries written on one line (" · ").
      if (ch === '\u00B7' && masked[i - 1] === ' ' && masked[i + 1] === ' ') { cuts.push(i + 1); continue; }
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      let j = i + 1;
      while (j < masked.length && (masked[j] === '*' || masked[j] === ')' || masked[j] === '_')) j++;
      if (j >= masked.length || !isWS(masked[j])) continue;
      let k = j;
      while (k < masked.length && isWS(masked[k])) k++;
      if (k >= masked.length) continue;
      if (!/[A-Z0-9"“(\[*`\u0000\u0001_]/.test(masked[k])) continue;
      if (ch === '.' && ABBREV.test(masked.slice(Math.max(0, i - 8), i))) continue;
      cuts.push(j);
    }
    cuts.push(masked.length);
    cuts.sort((a, b) => a - b);
    const out = [];
    for (let c = 0; c + 1 < cuts.length; c++) if (cuts[c + 1] > cuts[c]) out.push([cuts[c], cuts[c + 1]]);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Classifying a code span or a token

  const LINES_RE = '(\\d+(?:\\s*[-–]\\s*\\d+)?(?:\\s*,\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)*)';
  // A path segment list whose last segment carries an extension (or is a dotfile like .gitignore).
  const PATH_CORE = '((?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_@+-]*(?:\\.[A-Za-z0-9_-]+)*\\.[A-Za-z][A-Za-z0-9_-]{0,15})';
  const CITE_FULL = new RegExp(`^(?:\\./)?${PATH_CORE}:${LINES_RE}$`);
  // Inside a code span an extensionless file under a folder also cites (`.githooks/pre-commit:53`).
  const CITE_BARE = new RegExp(`^(?:\\./)?((?:[A-Za-z0-9_.@+-]+/)+[A-Za-z][A-Za-z0-9_-]*):${LINES_RE}$`);
  const CITE_CONT = new RegExp(`^:${LINES_RE}$`);
  const CITE_PLAIN = new RegExp(`(?<![A-Za-z0-9_./@+:-])${PATH_CORE}:${LINES_RE}(?![A-Za-z0-9_:])`, 'g');
  const HEX_RE = /^[0-9a-f]{7,40}$/;
  const HEX_PLAIN = /(?<![A-Za-z0-9_\/.#@-])([0-9a-f]{7,40})(?![A-Za-z0-9_-])/g;
  const KNOWN_EXT = /\.(md|ts|tsx|mts|js|mjs|cjs|jsx|json|jsonl|py|html|css|yml|yaml|sh|txt|csv|toml|svg|png|jpg|jpeg|webp|pdf|xlsx|wasm|glb|bin|ndjson|lock|scad|stl|ps1|bat|cfg|ini|xml|map|zip|gz)$/i;

  function parseRanges(s) {
    return s.split(',').map((part) => {
      const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      return [a, b];
    });
  }

  function looksLikeCommit(tok) {
    return HEX_RE.test(tok) && /[0-9]/.test(tok) && /[a-f]/.test(tok);
  }

  function looksLikePath(c) {
    if (!c || c.length > 200) return false;
    if (/[\s*?{}$<>|"'`\\]/.test(c)) return false;
    if (/^[\/~-]/.test(c) || c.includes('://') || c.includes('..')) return false;
    if (/^[a-z]+:[a-z]/i.test(c)) return false; // node:test, npm:pkg
    if (!/^[A-Za-z0-9_.@+\/-]+$/.test(c)) return false;
    const last = c.replace(/\/$/, '').split('/').pop();
    if (c.endsWith('/')) return c.includes('/') && !/^\.+\/$/.test(c);
    if (KNOWN_EXT.test(last)) return /^[^.]/.test(last) || /\.[^.]+\./.test(last);
    if (/^\.[A-Za-z][\w.-]*$/.test(last)) return c.includes('/') || /^\.(gitignore|gitattributes|nvmrc|npmrc|editorconfig|dispatch-scope)$/.test(last);
    return false;
  }

  // Example names a document uses to explain a procedure (`file.new.ts`), not files it claims exist.
  const PLACEHOLDER = /(^|\/)(file|foo|bar|baz|example|my-?[a-z]*|your-?[a-z]*|name|path\/to|xxx|NN-[a-z-]+)(\.[a-z0-9]+)*(\/|$)/i;
  function isPlaceholder(p) {
    return PLACEHOLDER.test(p) || /(^|\/)path\/to\//.test(p);
  }

  // A hash in the same sentence that is said to be a content hash, not a commit.
  const HASH_CONTEXT = /\b(sha-?256|sha-?1|shasum|md5|blob|hash(?:es|ed)?|digest|checksum|fingerprint|tarball|integrity)\b/i;
  // Git abbreviates commits to 7-12 hex digits and prints 40 in full; other lengths (16-hex prompt
  // fingerprints, 24-hex run ids, 32 md5, 64 sha256) are content identifiers, not commits.
  const commitLength = (n) => (n >= 7 && n <= 12) || n === 40;

  // ---------------------------------------------------------------------------------------------
  // Extraction

  function extract(text, docPath) {
    const units = splitUnits(text);
    const refs = [];
    let heading = '';
    for (const unit of units) {
      if (unit.kind === 'heading') heading = collapse(unit.text.replace(/^\s*#+\s*/, ''));
      const t = unit.text;
      const cs = codeSpans(t);
      const masked0 = maskSpans(t, cs, '\u0000');
      const qs = quoteSpans(masked0).filter((q) => !cs.some((c) => c.start < q.end && q.start < c.end));
      const masked = maskSpans(masked0, qs, '\u0001');
      const sentences = sentenceBounds(masked, unit.kind === 'row', qs);
      const sentenceOf = (off) => {
        for (let k = 0; k < sentences.length; k++) if (off >= sentences[k][0] && off < sentences[k][1]) return k;
        return sentences.length - 1;
      };
      const items = []; // {kind, start, end, ...}
      let lastPath = null;
      // Code spans first, in order, so a bare `:N` inherits the right path.
      const events = [];
      for (const c of cs) events.push({ type: 'code', start: c.start, end: c.end, content: c.content });
      // Plain-text citations and commits (outside code spans and quotes).
      let m;
      CITE_PLAIN.lastIndex = 0;
      while ((m = CITE_PLAIN.exec(masked))) {
        events.push({ type: 'plaincite', start: m.index, end: m.index + m[0].length, path: m[1], lines: m[2] });
      }
      HEX_PLAIN.lastIndex = 0;
      while ((m = HEX_PLAIN.exec(masked))) {
        if (!looksLikeCommit(m[1])) continue;
        events.push({ type: 'plaincommit', start: m.index, end: m.index + m[0].length, hex: m[1] });
      }
      for (const q of qs) events.push({ type: 'quote', start: q.start, end: q.end, content: q.content });
      events.sort((a, b) => a.start - b.start);

      for (const ev of events) {
        const sent = sentenceOf(ev.start);
        const line = lineOfOffset(unit, ev.start);
        const base = { start: ev.start, end: ev.end, sentence: sent, line };
        if (ev.type === 'code') {
          let content = ev.content;
          if (unit.kind === 'row') content = content.replace(/\\\|/g, '|');
          const trimmed = content.trim();
          let mm;
          if ((mm = CITE_FULL.exec(trimmed) || CITE_BARE.exec(trimmed))) {
            lastPath = mm[1];
            items.push({ ...base, kind: 'line', path: mm[1], ranges: parseRanges(mm[2]), raw: trimmed, form: 'code' });
          } else if ((mm = CITE_CONT.exec(trimmed))) {
            items.push({ ...base, kind: 'line', path: lastPath, inherited: lastPath ? 'last citation' : null, ranges: parseRanges(mm[1]), raw: trimmed, form: 'continuation' });
          } else if (/^@?[0-9a-f]{7,40}$/.test(trimmed) && looksLikeCommit(trimmed.replace(/^@/, ''))) {
            items.push({ ...base, kind: 'commit', hex: trimmed.replace(/^@/, ''), raw: trimmed, form: 'code' });
          } else if (looksLikePath(trimmed)) {
            items.push({ ...base, kind: 'path', path: trimmed.replace(/^\.\//, ''), raw: trimmed, form: 'code' });
          } else if (trimmed.length >= 2) {
            items.push({ ...base, kind: 'snippet', text: content, form: 'code' });
          }
        } else if (ev.type === 'plaincite') {
          lastPath = ev.path;
          items.push({ ...base, kind: 'line', path: ev.path, ranges: parseRanges(ev.lines), raw: `${ev.path}:${ev.lines}`, form: 'plain' });
        } else if (ev.type === 'plaincommit') {
          items.push({ ...base, kind: 'commit', hex: ev.hex, raw: ev.hex, form: 'plain' });
        } else if (ev.type === 'quote') {
          const q = collapse(ev.content.replace(/\\([!-\/:-@\[-`{-~])/g, '$1'));
          if (q.split(' ').length >= 2 && q.length >= 8) items.push({ ...base, kind: 'snippet', text: q, form: 'quote' });
        }
      }

      // A bare :N with no citation before it in the paragraph takes the first backticked path of its
      // sentence ("`tools/x.mjs` interpolates ... (`:190`)"), else the paragraph's first one.
      for (const it of items) {
        if (it.kind !== 'line' || it.path) continue;
        const inSentence = items.find((x) => x.kind === 'path' && x.sentence === it.sentence && !x.path.endsWith('/'));
        const inUnit = items.find((x) => x.kind === 'path' && !x.path.endsWith('/'));
        if (inSentence) { it.path = inSentence.path; it.inherited = 'path named in the sentence'; }
        else if (inUnit) { it.path = inUnit.path; it.inherited = 'first path named in the paragraph'; }
      }

      // Pair each snippet with one line citation in its sentence: one joined to it only by
      // connective words ("`x` is at `:7`", "`:646` (`Grid ...`)") if there is one, else the nearest
      // within MAX_PAIR_GAP characters; ties go to the citation before the snippet.
      const cites = items.filter((x) => x.kind === 'line');
      for (const c of cites) c.snippets = [];
      for (const s of items.filter((x) => x.kind === 'snippet')) {
        let best = null;
        let bestScore = Infinity;
        for (const c of cites) {
          if (c.sentence !== s.sentence) continue;
          const before = s.end <= c.start;
          const d = before ? c.start - s.end : c.end <= s.start ? s.start - c.end : 0;
          if (d > MAX_PAIR_GAP) continue;
          const gap = before ? t.slice(s.end, c.start) : t.slice(c.end, s.start);
          // Joined by connective words: strongly preferred. Across a clause break (", and", "; ",
          // " but "): kept only as a last resort.
          const score = CONNECTOR.test(gap) ? d / 1000 : SEPARATOR.test(gap) ? d + MAX_PAIR_GAP : d;
          if (score < bestScore || (score === bestScore && best && c.start < s.start && best.start > s.start)) { best = c; bestScore = score; }
        }
        if (best && !(s.form === 'code' && best.path && s.text.trim() === best.path)) best.snippets.push({ text: s.text, form: s.form, line: s.line });
      }
      // Commit tokens first: which of them read as content hashes rather than commits.
      for (const it of items) {
        if (it.kind !== 'commit') continue;
        const after = t.slice(it.end, it.end + 2);
        it.hashLike = /^(\u2026|\.\.)/.test(after) || !commitLength(it.hex.length) ||
          (it.hex.length !== 40 && HASH_CONTEXT.test(t.slice(Math.max(sentences[it.sentence][0], it.start - 40), it.start)));
      }
      // A commit pins the line and path references near it: the only commit in the sentence, or
      // else the only commit in the paragraph ("- `4d3bae2` — docs/ rebuilt. Entry bundles ...").
      const commitsIn = (pred) => [...new Set(items.filter((x) => x.kind === 'commit' && !x.hashLike && pred(x)).map((x) => x.hex))];
      const unitCommits = commitsIn(() => true);
      const pinFor = (it) => {
        const inSentence = commitsIn((x) => x.sentence === it.sentence);
        if (inSentence.length === 1) return { commit: inSentence[0], scope: 'sentence' };
        if (inSentence.length === 0 && unitCommits.length === 1) return { commit: unitCommits[0], scope: 'paragraph' };
        return null;
      };
      const sentText = (k) => t.slice(sentences[k][0], sentences[k][1]);
      // The reference's sentence and the one after it ("... cites `x`. That path has never existed."),
      // with code spans blanked so a path's own words ("untracked.txt") do not count.
      const nearText = (k) => collapse(masked0.slice(sentences[k][0], sentences[Math.min(sentences.length - 1, k + 1)][1]).replace(/\u0000+/g, ' '));
      for (const it of items) {
        if (it.kind === 'snippet') continue;
        const st = collapse(sentText(it.sentence)).replace(/\u0000|\u0001/g, '');
        const ref = {
          doc: docPath, line: it.line, unit: units.indexOf(unit), kind: it.kind, raw: it.raw, form: it.form,
          sentence: st.length > 360 ? `${st.slice(0, 357)}...` : st,
          near: nearText(it.sentence),
          heading,
        };
        if (it.kind === 'line' || it.kind === 'path') {
          ref.path = it.path;
          if (it.kind === 'line') {
            if (it.inherited) ref.inherited = it.inherited;
            ref.ranges = it.ranges;
            ref.snippets = it.snippets;
          }
          const pin = pinFor(it);
          if (pin) { ref.pinnedCommit = pin.commit; ref.pinnedScope = pin.scope; }
        } else if (it.kind === 'commit') {
          ref.hex = it.hex;
          if (it.hashLike) ref.hashLike = true;
        }
        refs.push(ref);
      }
    }
    return { units, refs };
  }

  // ---------------------------------------------------------------------------------------------
  // Path resolution against an env

  function dirname(p) {
    const k = p.lastIndexOf('/');
    return k < 0 ? '' : p.slice(0, k);
  }
  function joinPath(a, b) {
    const parts = (a ? `${a}/${b}` : b).split('/');
    const out = [];
    for (const s of parts) {
      if (s === '.' || s === '') continue;
      if (s === '..') out.pop();
      else out.push(s);
    }
    return out.join('/');
  }

  // env.exists(p) -> 'file' | 'dir' | null; env.files() -> array of known files (tracked set).
  function resolvePath(p, docPath, env, unitText) {
    if (!p) return { status: 'UNRESOLVED', reason: 'a bare :N with no path earlier in its paragraph' };
    const clean = p.replace(/\/$/, '');
    const tries = [clean];
    const rel = joinPath(dirname(docPath), clean);
    if (rel !== clean) tries.push(rel);
    for (const cand of tries) {
      const kind = env.exists(cand);
      if (kind) return { status: 'FOUND', path: cand, how: cand === clean ? 'repo root' : 'document folder', type: kind };
    }
    // Suffix match against the known file list (a bare `main.ts:291` or `app/porkchop/main.ts:916`).
    if (!p.endsWith('/')) {
      const suffix = `/${clean}`;
      let cands = env.files().filter((f) => f.endsWith(suffix));
      if (cands.length === 1) return { status: 'FOUND', path: cands[0], how: 'unique suffix', type: 'file' };
      if (cands.length > 1) {
        // Prefer a candidate whose folder the same paragraph names (`src/v2/app/porkchop/...`).
        const ctx = cands.filter((c) => unitText && unitText.includes(dirname(c) + '/'));
        if (ctx.length === 1) return { status: 'FOUND', path: ctx[0], how: 'suffix, folder named in paragraph', type: 'file' };
        return { status: 'AMBIGUOUS', candidates: cands.slice(0, 8), count: cands.length };
      }
    }
    // Missing: offer files with the same basename (the likely intended path).
    const base = clean.split('/').pop();
    const like = env.files().filter((f) => f.split('/').pop() === base).slice(0, 5);
    return { status: 'MISSING', path: clean, sameName: like };
  }

  // ---------------------------------------------------------------------------------------------
  // Snippet search

  function prepSnippet(s) {
    let t = collapse(s);
    if (/^[^`]*$/.test(t)) t = t.replace(/[.,;:]+$/, ''); // prose punctuation outside the quote
    return t;
  }

  // Returns {found: 'exact'|'loose'|null, hits: [[startLine, endLine], ...], key}
  function locate(index, snippet, form) {
    const raw = prepSnippet(snippet);
    // An elided quote ("a … b") is searched by its longest part.
    const parts = raw.split(/\s*(?:…|\.\.\.)\s*/).filter((x) => x.length >= 3);
    const key = parts.length > 1 ? parts.reduce((a, b) => (b.length > a.length ? b : a)) : raw;
    if (key.length < 2) return { found: null, hits: [], key };
    const spanOf = (k, len) => [index.lines[k], index.lines[Math.min(index.lines.length - 1, k + len - 1)]];
    let hits = findAll(index.norm, key, 50).map((k) => spanOf(k, key.length));
    if (hits.length) return { found: 'exact', hits, key, elided: parts.length > 1 };
    const lk = fold(key);
    hits = findAll(index.loose, lk, 50).map((k) => spanOf(k, lk.length));
    if (hits.length) return { found: 'loose', hits, key, elided: parts.length > 1 };
    if (form === 'code') {
      const ck = compactOf(key);
      if (ck.length >= 4) {
        hits = findAll(index.compact, ck, 50).map((k) => [index.clines[k], index.clines[Math.min(index.clines.length - 1, k + ck.length - 1)]]);
        if (hits.length) return { found: 'compact', hits, key, elided: parts.length > 1 };
      }
    }
    return { found: null, hits: [], key, elided: parts.length > 1 };
  }

  // The longest run of consecutive snippet words that the cited lines contain (dash and quote
  // folded). PARTIAL when it is at least 5 words and a third of the snippet: the citation points at
  // the right place and the quotation is not verbatim (a misquote, not drift).
  function partialRun(index, key, ranges) {
    const words = fold(key).split(' ').filter(Boolean);
    if (words.length < 6) return null;
    let cited = '';
    for (let k = 0; k < index.lines.length; k++) {
      const ln = index.lines[k];
      if (ranges.some(([a, b]) => ln >= a && ln <= b)) cited += index.loose[k];
    }
    if (!cited) return null;
    let best = 0;
    let bestAt = 0;
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i + best; j--) {
        if (cited.includes(words.slice(i, j).join(' '))) { best = j - i; bestAt = i; break; }
      }
    }
    if (best >= 5 && best * 3 >= words.length) {
      const t = words.slice(bestAt, bestAt + best).join(' ');
      return { run: best, words: words.length, text: t.length > 60 ? `${t.slice(0, 57)}...` : t };
    }
    return null;
  }

  const overlaps = (hit, ranges) => ranges.some(([a, b]) => hit[0] <= b && hit[1] >= a);
  const fmtRanges = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
  const fmtHit = (h) => (h[0] === h[1] ? `:${h[0]}` : `:${h[0]}-${h[1]}`);

  // Judge a line citation's lines and snippets against the file text.
  function judgeLines(ref, textOrIndex) {
    const index = typeof textOrIndex === 'string' ? indexText(textOrIndex) : textOrIndex;
    const n = index.lineCount;
    const bad = ref.ranges.find(([a, b]) => a < 1 || b < a || b > n);
    const results = (ref.snippets || []).map((s) => {
      const r = locate(index, s.text, s.form);
      const onCited = r.hits.filter((h) => overlaps(h, ref.ranges));
      return {
        text: s.text, form: s.form, key: r.key, match: r.found, elided: !!r.elided,
        verdict: !r.found ? 'GONE' : onCited.length ? 'OK' : 'MOVED',
        at: (onCited.length ? onCited : r.hits).slice(0, 6).map(fmtHit),
        count: r.hits.length,
      };
    });
    const out = { lineCount: n, snippetResults: results };
    if (bad) {
      out.status = 'PAST-EOF';
      out.note = `cites line ${fmtRanges([bad])}; the file has ${n} line${n === 1 ? '' : 's'}`;
      const found = results.filter((r) => r.verdict !== 'GONE');
      if (found.length) out.note += `; snippet now at ${found[0].at.join(', ')}`;
      return out;
    }
    if (!results.length) {
      out.status = 'IN-RANGE';
      out.note = 'no snippet in the sentence; only the line range was checked';
      return out;
    }
    const ok = results.find((r) => r.verdict === 'OK');
    const moved = results.find((r) => r.verdict === 'MOVED');
    let partial = null;
    if (!ok) {
      for (const r of results) {
        const p = partialRun(index, r.key, ref.ranges);
        if (p && (!partial || p.run > partial.run)) partial = { ...p, r };
      }
    }
    if (ok) {
      out.status = 'OK';
      if (ok.match === 'loose') out.note = 'matches only after folding dashes, quotes and ×';
      if (ok.match === 'compact') out.note = 'matches only with spacing and quote style ignored';
    } else if (partial) {
      out.status = 'PARTIAL';
      out.note = `the cited lines hold ${partial.run} of the snippet's ${partial.words} words in a row ("${partial.text}"); the rest is not quoted verbatim`;
      partial.r.verdict = 'PARTIAL';
    } else if (moved) {
      out.status = 'MOVED';
      out.movedTo = moved.at;
      out.note = `snippet now at ${moved.at.join(', ')}${moved.count > moved.at.length ? ` (+${moved.count - moved.at.length} more)` : ''}`;
      if (moved.match === 'loose') out.note += ' (after folding dashes, quotes and ×)';
      if (moved.match === 'compact') out.note += ' (spacing and quote style ignored)';
    } else {
      out.status = 'GONE';
      out.note = 'snippet not found anywhere in the file';
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Judging a reference

  // env: {
  //   exists(p) -> 'file'|'dir'|null, files() -> string[], read(p) -> string|null,
  //   tracked(p) -> true|false|null, ignored(p) -> {source,line,pattern}|null|undefined,
  //   forceAdded(p) -> {source,line,pattern}|null|undefined, commit(hex) -> {type, full}|undefined,
  //   shallow: bool, label: string
  // }
  function judge(ref, env, unitText) {
    const out = { status: 'UNCHECKABLE' };
    if (ref.kind === 'commit') {
      if (ref.hashLike) { out.status = 'UNCHECKABLE'; out.note = 'reads as a content hash, not a commit'; out.hash = true; return out; }
      const info = env.commit ? env.commit(ref.hex) : undefined;
      if (!info) { out.note = 'git unavailable'; return out; }
      if (info.type === 'commit') {
        out.status = 'OK';
        out.full = info.full;
        if (info.onHead === false) out.note = "a commit in this clone, but not in HEAD's history";
        return out;
      }
      if (info.type === 'ambiguous') { out.note = 'abbreviation is ambiguous in this repository'; return out; }
      if (info.type === 'missing') {
        if (env.shallow) { out.note = `not in this shallow clone (history starts at ${env.shallowSince || 'its boundary'})`; return out; }
        out.status = 'UNREACHABLE-COMMIT';
        out.note = 'no such object in this clone';
        return out;
      }
      out.status = 'NOT-A-COMMIT';
      out.note = `names a ${info.type} object, not a commit`;
      return out;
    }

    const res = resolvePath(ref.path, ref.doc, env, unitText);
    out.resolution = res;
    if (res.status === 'UNRESOLVED') { out.note = res.reason; return out; }
    if (res.status === 'AMBIGUOUS') {
      out.note = `${res.count} files end in ${ref.path}: ${res.candidates.slice(0, 3).join(', ')}${res.count > 3 ? ', ...' : ''}`;
      return out;
    }
    if (res.status === 'MISSING') {
      out.target = res.path;
      if (isPlaceholder(ref.path)) { out.status = 'UNCHECKABLE'; out.note = 'reads as a placeholder name, not a file the document says exists'; return out; }
      const ig = env.ignored ? env.ignored(res.path) : undefined;
      const notes = [];
      if (ig) {
        out.status = 'IGNORED';
        notes.push(`absent here, and git ignores this location (${ig.source}:${ig.line} \`${ig.pattern}\`)`);
      } else out.status = 'MISSING-PATH';
      if (res.sameName.length) notes.push(`same name at ${res.sameName.slice(0, 2).join(', ')}`);
      if (notes.length) out.note = notes.join('; ');
      return out;
    }
    const target = res.path;
    out.target = target;
    const tracked = env.tracked ? env.tracked(target, res.type) : null;
    const ig = env.ignored ? env.ignored(target) : undefined;
    let pathStatus;
    let pathNote = '';
    if (tracked === true) {
      pathStatus = 'OK';
      const fa = env.forceAdded ? env.forceAdded(target) : null;
      if (fa) pathNote = `tracked, but matches ${fa.source}:${fa.line} \`${fa.pattern}\` with no ! exception`;
    } else if (tracked === false) {
      if (ig) { pathStatus = 'IGNORED'; pathNote = `present but ignored by ${ig.source}:${ig.line} \`${ig.pattern}\``; }
      else if (ig === undefined) { pathStatus = 'UNCHECKABLE'; pathNote = 'not tracked; ignore rules not checkable'; }
      else { pathStatus = 'UNTRACKED'; pathNote = 'exists but is not tracked by git'; }
    } else {
      pathStatus = 'UNCHECKABLE';
      pathNote = 'exists; tracking not checkable without git';
    }
    if (res.how !== 'repo root') out.how = res.how;

    if (ref.kind === 'path') {
      out.status = pathStatus;
      if (pathNote) out.note = pathNote;
      return out;
    }
    // Line citation.
    if (res.type === 'dir') { out.status = 'UNCHECKABLE'; out.note = 'cites a line in a folder'; return out; }
    const cache = env._index || (env._index = new Map());
    let index = cache.get(target);
    if (index === undefined) {
      const text = env.read(target);
      index = text == null ? null : indexText(text);
      cache.set(target, index);
    }
    if (index == null) {
      out.status = 'UNCHECKABLE';
      out.note = (env.why && env.why(target)) || 'file could not be read';
      return out;
    }
    const lj = judgeLines(ref, index);
    out.lineStatus = lj.status;
    out.lineCount = lj.lineCount;
    out.snippetResults = lj.snippetResults;
    if (lj.movedTo) out.movedTo = lj.movedTo;
    if (pathStatus === 'IGNORED' || pathStatus === 'UNTRACKED') {
      out.status = pathStatus;
      out.note = `${pathNote}; lines: ${lj.status}`;
    } else {
      out.status = lj.status;
      out.note = [lj.note, pathNote].filter(Boolean).join('; ') || undefined;
      if (pathStatus === 'UNCHECKABLE' && lj.status === 'OK') out.trackingUnknown = true;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Context: does the document itself say the reference is stale?

  const GONE_WORDS = /\b(never (?:been )?(?:committed|existed|tracked)|has never existed|does(?: not|n't) exist|no longer (?:exists?|present|written|tracked)|deleted|removed|retired|superseded|renamed|unrecoverable|lost|not (?:yet )?(?:committed|tracked)|untracked|never staged|absent)\b/i;
  const CORRECTION_WORDS = /\b(correction|corrected|erratum|errata|was (?:false|wrong)|FALSE|WRONG|stale|read (?:those|these|it|this|them) (?:citations? )?as|the (?:authoritative|correct) path|off by|now (?:at|reads|lives)|moved to|has moved|never existed|only the directory segment was wrong)\b/;

  // The reference names something to be made: a proposal, a plan, a future slice.
  const PLAN_WORDS = /\b(PROPOSED|proposed|proposal|planned|will (?:be )?(?:create|add|write|commit|generate)d?|to be (?:created|added|written|committed|generated)|not yet (?:created|written|built)|TODO|future slice|next slice)\b/;

  // Another project named next to the reference: the path may live there, not here.
  const FOREIGN = /\b(poliastro|pykep|GMAT|adam_core|astropy|Skyhook|PartForge|Idea[- ]Bank|aster-audit-reports|upstream)\b/i;

  function basename(p) {
    return (p || '').replace(/\/$/, '').split('/').pop();
  }

  // For a non-OK reference: does its own sentence say the thing is gone, and does another
  // paragraph of the same document mention the same path (or commit) next to correction words?
  function context(ref, units) {
    const out = {};
    const near = ref.near || ref.sentence;
    // For a path, words like "deleted" or "never committed" near it say the document knows; for a
    // line citation only words about the citation itself count ("now at", "off by", "stale").
    if (CORRECTION_WORDS.test(near) || (ref.kind !== 'line' && GONE_WORDS.test(near))) out.saysGone = true;
    const fm = FOREIGN.exec(near);
    if (fm) out.foreign = fm[1];
    if (PLAN_WORDS.test(near) || PLAN_WORDS.test(ref.heading || '')) out.planned = true;
    let keys;
    if (ref.kind === 'commit') keys = [ref.hex];
    else if (!ref.path) return out;
    else if (ref.kind === 'line') keys = [`${basename(ref.path)}:${ref.ranges[0][0]}`];
    else {
      keys = [ref.path];
      // A bare file name also counts when it is distinctive (12+ characters:
      // tier-sizing-results.json, not REPORT.md).
      if (ref.path.includes('/') && basename(ref.path).length >= 12) keys.push(basename(ref.path));
    }
    const words = ref.kind === 'line' ? [CORRECTION_WORDS] : [CORRECTION_WORDS, GONE_WORDS];
    // Another paragraph of the same document annotates it when a sentence there names the same
    // reference and it, or the sentence after it, carries correction words.
    for (const u of units) {
      const last = u.firstLine + u.lineStarts.length - 1;
      if (ref.line >= u.firstLine && ref.line <= last) continue;
      if (!keys.some((k) => u.text.includes(k))) continue;
      const sents = u.text.split(/(?<=[.!?;])\s+(?=[A-Z`*"(\[])/);
      const prose = (x) => maskSpans(x, codeSpans(x), ' ');
      const hit = sents.some((x, i) => keys.some((k) => x.includes(k)) && words.some((w) => w.test(prose(x)) || (sents[i + 1] && w.test(prose(sents[i + 1])))));
      if (hit) {
        out.annotatedAt = u.firstLine;
        break;
      }
    }
    return out;
  }


  // ---------------------------------------------------------------------------------------------
  // Summaries and formatting

  function tally(findings) {
    const byStatus = {};
    for (const s of STATUSES) byStatus[s] = 0;
    const byDoc = {};
    const byKind = { line: {}, path: {}, commit: {} };
    for (const f of findings) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      (byDoc[f.doc] ||= Object.fromEntries(STATUSES.map((s) => [s, 0])))[f.status]++;
      byKind[f.kind][f.status] = (byKind[f.kind][f.status] || 0) + 1;
    }
    return { total: findings.length, byStatus, byDoc, byKind };
  }

  function isDrift(f) {
    return DRIFT.has(f.status);
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + ' '.repeat(n - s.length);
  }

  function describeAt(label, h) {
    if (!h) return '';
    const tag = h.commit ? `${h.commit.slice(0, 7)}${h.date ? `, ${h.date}` : ''}` : '';
    if (h.state === 'uncommitted') return `${label}: not committed yet`;
    if (h.state === 'before-clone') return `${label} ${tag}: at this shallow clone's boundary, so possibly older; not checked`;
    if (h.state !== 'checked') return `${label} ${h.commit ? h.commit.slice(0, 7) : ''}: ${h.state}`;
    // Only a MOVED verdict's note (where the snippet stood then) adds to the status word.
    return `${label} ${tag}: ${h.status === 'OK' ? 'held' : h.status}${h.status === 'MOVED' && h.note ? ` (${h.note})` : ''}`;
  }

  // One line: what the reference was at the commit it first appeared in the document, at the
  // commit that last edited its line, and at the commit its sentence names.
  function describeHistory(f) {
    const parts = [];
    const h = f.history || {};
    if (h.first && h.last && h.first.commit && h.first.commit === h.last.commit) {
      parts.push(describeAt('first appeared and last edited', h.first));
    } else {
      if (h.first) parts.push(describeAt('first appeared', h.first));
      if (h.last) parts.push(describeAt('line last edited', h.last));
    }
    if (f.pinned) parts.push(describeAt(`at the commit its ${f.pinned.scope || 'sentence'} names,`, f.pinned).replace(', ', ' ').replace('names, ', 'names '));
    return parts.join('; ');
  }

  function describeContext(f) {
    const bits = [];
    if (f.context && f.context.saysGone) bits.push('its own sentence says so');
    if (f.context && f.context.foreign) bits.push(`names ${f.context.foreign}`);
    if (f.context && f.context.planned) bits.push('reads as a plan or proposal');
    if (f.context && f.context.annotatedAt) bits.push(`annotated at :${f.context.annotatedAt}`);
    if (f.allowed) bits.push(`allowed: ${f.allowed}`);
    return bits.join('; ');
  }

  return {
    STATUSES, DRIFT, fold, collapse, lineCount, indexText, splitUnits, codeSpans, quoteSpans,
    sentenceBounds, looksLikeCommit, looksLikePath, parseRanges, extract, resolvePath, locate,
    judgeLines, judge, context, isPlaceholder, partialRun, MAX_PAIR_GAP, tally, isDrift, pad, fmtRanges, describeHistory, describeContext,
    joinPath, dirname,
  };
});
