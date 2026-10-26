/*
 * Said vs Derived: the pure logic behind said-vs-derived.mjs and index.html.
 *
 * Aster's DEC-17-5 (SLICE_17_FOUNDING.md:197-217, LOCKED) and DEC-19.5-8
 * (src/v2/SLICE_19_5_FOUNDING.md:176-181, PROPOSED) say a label is read from the computation
 * that produced the numbers, never typed. This module finds the places where it is typed:
 *
 *   1. lex()            a TypeScript lexer that knows strings, templates (with nested ${}),
 *                       comments, regex literals and the call/object context of each literal.
 *   2. harvestCanon()   the values the code already owns: top-level `const NAME = <number|date>`,
 *                       first-level fields of top-level `const NAME = { ... }` objects, and the
 *                       screening cache's `metadata` block, each with its home (file:line).
 *   3. scanSource()     classes every string/template literal (import, console, error, css,
 *                       token, display) and reads dates, year spans and unit-bearing numbers out
 *                       of the static text of display literals; `${}` text is DERIVED.
 *   4. buildReport()    matches display numbers to canon, groups retyped code literals and
 *                       constants that have two homes, applies an allowlist, and formats it.
 *
 * Pure: no fs, no clock, no network. Loads as a classic script (window.SaidDerived) and with
 * require(). Every rule here is a heuristic with a stated bias; README "How it works" lists them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SaidDerived = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Lexer
  // ---------------------------------------------------------------------------------------------

  const KEYWORDS_BEFORE_REGEX = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
    'else', 'yield', 'await', 'export', 'default',
  ]);
  const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'with']);

  function isIdentStart(c) {
    return /[A-Za-z_$\u00C0-\uFFFF]/.test(c);
  }
  function isIdentPart(c) {
    return /[\w$\u00C0-\uFFFF]/.test(c);
  }

  function lineIndex(src) {
    const starts = [0];
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  }
  function lineOf(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /**
   * Lex TypeScript/JavaScript source. Returns
   *   literals: [{kind:'string'|'template', start, end, line, parts:[{raw, start}], exprs:[{text,start}], ctx}]
   *   tokens:   [{type:'ident'|'num'|'str'|'punct', value, start, end, depth}]  (code-level, incl. inside ${})
   *   errors:   ['unterminated ...'] when the source is not lexically closed
   * ctx = {callees:[outer..inner], key: innermost object-literal key or null, prev: [up to 3 prior tokens]}
   */
  function lex(src) {
    const n = src.length;
    const literals = [];
    const tokens = [];
    const errors = [];
    const stack = []; // {open:'('|'['|'{'|'${', callee, key, expectKey, cand}
    let prev = null; // previous significant token

    function push(tok) {
      tokens.push(tok);
      prev = tok;
    }
    function topObject() {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].open === '{') return stack[k];
        if (stack[k].open === '${') return null;
      }
      return null;
    }
    function ctxNow() {
      const callees = [];
      for (const e of stack) if (e.open === '(' && e.callee) callees.push(e.callee);
      const obj = topObject();
      const recent = tokens.slice(-3).map((t) => t.value);
      return { callees, key: obj ? obj.key : null, prev: recent };
    }
    function regexAllowed() {
      if (!prev) return true;
      if (prev.type === 'num' || prev.type === 'str' || prev.type === 'regex') return false;
      if (prev.type === 'ident') return KEYWORDS_BEFORE_REGEX.has(prev.value);
      if (prev.type === 'punct') return !(prev.value === ')' || prev.value === ']' || prev.value === '}');
      return true;
    }
    function calleeBefore() {
      // identifier chain immediately before '(' : a.b.c  /  new X  /  keyword
      let k = tokens.length - 1;
      if (k < 0 || tokens[k].type !== 'ident') return null;
      if (CONTROL_KEYWORDS.has(tokens[k].value)) return tokens[k].value;
      const parts = [tokens[k].value];
      k--;
      while (k >= 1 && tokens[k].type === 'punct' && (tokens[k].value === '.' || tokens[k].value === '?.') && tokens[k - 1].type === 'ident') {
        parts.unshift(tokens[k - 1].value);
        k -= 2;
      }
      let name = parts.join('.');
      if (k >= 0 && tokens[k].type === 'ident' && tokens[k].value === 'new') name = `new ${name}`;
      return name;
    }
    function noteKeyCandidate(value) {
      const obj = stack.length && stack[stack.length - 1].open === '{' ? stack[stack.length - 1] : null;
      if (obj) {
        if (obj.expectKey) obj.cand = value;
        else obj.cand = null;
        obj.expectKey = false;
      }
    }

    function scanString(i) {
      const q = src[i];
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === q) break;
        if (c === '\n') {
          errors.push(`unterminated string at line ${lineOf(lineStarts, i)}`);
          break;
        }
        j++;
      }
      if (j >= n) errors.push(`unterminated string at line ${lineOf(lineStarts, i)}`);
      const lit = {
        kind: 'string',
        start: i,
        end: Math.min(j + 1, n),
        line: lineOf(lineStarts, i),
        parts: [{ raw: src.slice(i + 1, Math.min(j, n)), start: i + 1 }],
        exprs: [],
        ctx: ctxNow(),
      };
      literals.push(lit);
      noteKeyCandidate(lit.parts[0].raw);
      push({ type: 'str', value: lit.parts[0].raw, start: i, end: lit.end, depth: stack.length, line: lit.line });
      return lit.end;
    }

    function scanTemplate(i) {
      const lit = { kind: 'template', start: i, end: n, line: lineOf(lineStarts, i), parts: [], exprs: [], ctx: ctxNow() };
      literals.push(lit);
      let j = i + 1;
      let partStart = j;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '`') {
          lit.parts.push({ raw: src.slice(partStart, j), start: partStart });
          lit.end = j + 1;
          noteKeyCandidate(null);
          push({ type: 'str', value: '`', start: i, end: lit.end, depth: stack.length, line: lit.line });
          return j + 1;
        }
        if (c === '$' && src[j + 1] === '{') {
          lit.parts.push({ raw: src.slice(partStart, j), start: partStart });
          const exprStart = j + 2;
          stack.push({ open: '${', callee: null, key: null, expectKey: false, cand: null });
          const savedPrev = prev;
          prev = null;
          const close = scanCode(exprStart, stack.length);
          prev = savedPrev;
          stack.pop();
          lit.exprs.push({ text: src.slice(exprStart, close), start: exprStart });
          j = close + 1;
          partStart = j;
          continue;
        }
        j++;
      }
      errors.push(`unterminated template at line ${lit.line}`);
      lit.parts.push({ raw: src.slice(partStart, n), start: partStart });
      return n;
    }

    function scanRegex(i) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (inClass) {
          if (c === ']') inClass = false;
        } else if (c === '[') inClass = true;
        else if (c === '/') break;
        j++;
      }
      if (j >= n || src[j] !== '/') {
        // not a regex after all; treat as division
        push({ type: 'punct', value: '/', start: i, end: i + 1, depth: stack.length });
        return i + 1;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      push({ type: 'regex', value: src.slice(i, j), start: i, end: j, depth: stack.length });
      return j;
    }

    // Scan code from i. If stopDepth is a number, return the index of the '}' that closes the
    // ${ entry at that stack depth.
    function scanCode(i, stopDepth) {
      while (i < n) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF') {
          i++;
          continue;
        }
        if (c === '/' && src[i + 1] === '/') {
          const e = src.indexOf('\n', i);
          i = e < 0 ? n : e;
          continue;
        }
        if (c === '/' && src[i + 1] === '*') {
          const e = src.indexOf('*/', i + 2);
          if (e < 0) {
            errors.push(`unterminated comment at line ${lineOf(lineStarts, i)}`);
            return n;
          }
          i = e + 2;
          continue;
        }
        if (c === '/') {
          i = regexAllowed() ? scanRegex(i) : (push({ type: 'punct', value: '/', start: i, end: i + 1, depth: stack.length }), i + 1);
          continue;
        }
        if (c === "'" || c === '"') {
          i = scanString(i);
          continue;
        }
        if (c === '`') {
          i = scanTemplate(i);
          continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
          let j = i;
          if (c === '0' && /[xXoObB]/.test(src[i + 1] || '')) {
            j += 2;
            while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
          } else {
            while (j < n && /[0-9_]/.test(src[j])) j++;
            if (src[j] === '.' && src[j + 1] !== '.') {
              j++;
              while (j < n && /[0-9_]/.test(src[j])) j++;
            }
            if (/[eE]/.test(src[j] || '') && /[-+0-9]/.test(src[j + 1] || '')) {
              j += 2;
              while (j < n && /[0-9_]/.test(src[j])) j++;
            }
          }
          if (src[j] === 'n') j++;
          const text = src.slice(i, j);
          noteKeyCandidate(text);
          push({ type: 'num', value: text, start: i, end: j, depth: stack.length, line: lineOf(lineStarts, i) });
          i = j;
          continue;
        }
        if (isIdentStart(c) || c === '#') {
          let j = i + 1;
          while (j < n && isIdentPart(src[j])) j++;
          const word = src.slice(i, j);
          noteKeyCandidate(word);
          push({ type: 'ident', value: word, start: i, end: j, depth: stack.length, line: lineOf(lineStarts, i) });
          i = j;
          continue;
        }
        // punctuation
        if (c === '(' || c === '[' || c === '{') {
          const callee = c === '(' ? calleeBefore() : null;
          const top = stack.length ? stack[stack.length - 1] : null;
          if (top && top.open === '{') top.expectKey = false;
          push({ type: 'punct', value: c, start: i, end: i + 1, depth: stack.length });
          stack.push({ open: c, callee, key: null, expectKey: c === '{', cand: null });
          i++;
          continue;
        }
        if (c === ')' || c === ']' || c === '}') {
          if (c === '}' && stopDepth !== undefined && stack.length === stopDepth) return i;
          const want = c === ')' ? '(' : c === ']' ? '[' : '{';
          if (stack.length && stack[stack.length - 1].open === want) stack.pop();
          else errors.push(`unbalanced '${c}' at line ${lineOf(lineStarts, i)}`);
          push({ type: 'punct', value: c, start: i, end: i + 1, depth: stack.length });
          i++;
          continue;
        }
        const top = stack.length ? stack[stack.length - 1] : null;
        if (c === ',' && top && top.open === '{') {
          top.expectKey = true;
          top.key = null;
          top.cand = null;
          push({ type: 'punct', value: c, start: i, end: i + 1, depth: stack.length });
          i++;
          continue;
        }
        if (c === ':' && top && top.open === '{' && top.cand !== null && prev && prev.type !== 'punct') {
          top.key = top.cand;
          top.cand = null;
          push({ type: 'punct', value: c, start: i, end: i + 1, depth: stack.length });
          i++;
          continue;
        }
        if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] || '')) {
          if (top && top.open === '{') top.cand = null;
          push({ type: 'punct', value: '?.', start: i, end: i + 2, depth: stack.length });
          i += 2;
          continue;
        }
        if (top && top.open === '{' && !(c === '?' && top.cand !== null)) {
          top.expectKey = false;
          if (c !== '?') top.cand = null;
        }
        push({ type: 'punct', value: c, start: i, end: i + 1, depth: stack.length });
        i++;
      }
      if (stopDepth !== undefined) errors.push('unterminated ${ expression');
      return n;
    }

    const lineStarts = lineIndex(src);
    scanCode(0);
    if (stack.length) errors.push(`${stack.length} unclosed bracket(s) at end of file`);
    return { literals, tokens, errors, lineStarts };
  }

  // Cook escapes so `km\u00B2/s\u00B2` reads as km²/s²; map[k] = raw offset of cooked char k.
  function cook(raw) {
    let out = '';
    const map = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c !== '\\') {
        out += c;
        map.push(i);
        continue;
      }
      const d = raw[i + 1];
      let ch = null;
      let len = 2;
      if (d === 'u' && raw[i + 2] === '{') {
        const e = raw.indexOf('}', i + 3);
        ch = String.fromCodePoint(parseInt(raw.slice(i + 3, e), 16));
        len = e - i + 1;
      } else if (d === 'u') {
        ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
        len = 6;
      } else if (d === 'x') {
        ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16));
        len = 4;
      } else if (d === 'n') ch = '\n';
      else if (d === 't') ch = '\t';
      else if (d === 'r') ch = '\r';
      else if (d === '\n') ch = '';
      else if (d === '\r') {
        ch = '';
        if (raw[i + 2] === '\n') len = 3;
      } else ch = d === undefined ? '' : d;
      for (const cc of ch) {
        out += cc;
        map.push(i);
      }
      i += len - 1;
    }
    map.push(raw.length);
    return { text: out, map };
  }

  // ---------------------------------------------------------------------------------------------
  // Literal classification
  // ---------------------------------------------------------------------------------------------

  const CSS_PROPERTIES = new Set(
    (
      'align-content align-items align-self animation aspect-ratio backdrop-filter background background-color ' +
      'background-image background-position background-size border border-bottom border-collapse border-color ' +
      'border-left border-radius border-right border-spacing border-style border-top border-width bottom ' +
      'box-shadow box-sizing clip-path color column-gap columns cursor display fill filter flex flex-basis ' +
      'flex-direction flex-grow flex-shrink flex-wrap float font font-family font-size font-style ' +
      'font-variant-numeric font-weight gap grid grid-area grid-column grid-row grid-template-columns ' +
      'grid-template-rows height image-rendering inset justify-content justify-items justify-self left ' +
      'letter-spacing line-height list-style margin margin-bottom margin-left margin-right margin-top ' +
      'max-height max-width min-height min-width mix-blend-mode object-fit opacity order outline ' +
      'outline-offset overflow overflow-wrap overflow-x overflow-y padding padding-bottom padding-left ' +
      'padding-right padding-top pointer-events position resize right row-gap stroke stroke-width ' +
      'table-layout text-align text-decoration text-overflow text-shadow text-transform top transform ' +
      'transform-origin transition user-select vertical-align visibility white-space width will-change ' +
      'word-break word-wrap z-index touch-action scrollbar-width accent-color caret-color content inset-inline'
    ).split(/\s+/),
  );
  function kebab(name) {
    return name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  }
  function isCssKey(key) {
    if (!key) return false;
    const k = String(key).replace(/^['"]|['"]$/g, '');
    return k === 'style' || /Style$/.test(k) || k === 'cssText' || CSS_PROPERTIES.has(k) || CSS_PROPERTIES.has(kebab(k)) || /^--/.test(k);
  }
  const CSS_DECL = /^\s*(?:(-{0,2}[a-z][a-z-]*)\s*:\s*[^;:{}]*;?\s*)+$/i;
  function looksLikeCss(text) {
    const t = text.trim();
    if (!t) return false;
    if (/^(?:linear-gradient|radial-gradient|conic-gradient|rgba?|hsla?|translate[XYZ3d]*|scale[XYZ]?|rotate[XYZ]?|calc|var|url|cubic-bezier)\(/i.test(t)) return true;
    if (/^#[0-9a-f]{3,8}$/i.test(t)) return true;
    if (!CSS_DECL.test(t)) return false;
    // every declaration's property must be a known CSS property or a custom property
    const props = t.split(';').map((d) => d.split(':')[0].trim().toLowerCase()).filter(Boolean);
    return props.length > 0 && props.every((p) => CSS_PROPERTIES.has(p) || p.startsWith('--') || /^-(webkit|moz|ms)-/.test(p));
  }

  const SENTINEL = '\u0000';
  // Join a literal's cooked static parts with a sentinel where each ${} was.
  function staticText(lit) {
    const cooked = lit.parts.map((p) => cook(p.raw));
    return { cooked, joined: cooked.map((c) => c.text).join(SENTINEL) };
  }

  const YEAR_SPAN = /(?<![\d.])((?:19|20)\d{2})\s*(?:–|—|-|to|through|→)\s*((?:19|20)\d{2})(?![\d-])/g;
  const ISO_DATE = /(?<![\d.])((?:19|20)\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])(?![\d])/g;

  /**
   * Class of a literal: import | console | error | css | code | token | display.
   * Only display literals are read for claims; the others are counted.
   */
  function classifyLiteral(lit, joined) {
    const ctx = lit.ctx;
    const prev = ctx.prev;
    const last = prev[prev.length - 1];
    if (last === 'from' || last === 'import') return 'import';
    if (ctx.callees.some((c) => c === 'import' || c === 'require' || /(^|\.)import$/.test(c))) return 'import';
    if (ctx.callees.some((c) => /^console\./.test(c))) return 'console';
    if (ctx.callees.some((c) => /^new \w*Error$|^\w*Error$/.test(c)) || last === 'throw') return 'error';
    const plain = joined.split(SENTINEL).join('0');
    if (isCssKey(ctx.key) || looksLikeCss(plain)) return 'css';
    // embedded program text (GLSL shaders) is code, not words for a person
    if (/\bgl_(?:Position|FragColor|PointSize)\b|\bvoid\s+main\s*\(|^\s*(?:precision|uniform|varying|attribute)\s/m.test(plain)) return 'code';
    if (!/\s/.test(plain.trim())) {
      // whitespace-free: keys, ids, class names, URLs, data values. A bare year span is the
      // one whitespace-free shape that is almost always a label, so it stays display.
      if (/^[(\[]?(?:19|20)\d{2}\s*(?:–|—|-|→)\s*(?:19|20)\d{2}[)\],.;:]?$/.test(plain.trim())) return 'display';
      return 'token';
    }
    return 'display';
  }

  // ---------------------------------------------------------------------------------------------
  // Claims inside display text
  // ---------------------------------------------------------------------------------------------

  // The astronomical unit, exactly, by IAU 2012 Resolution B2: 149 597 870 700 m.
  const AU_M = 149597870700;
  // Units, longest first: [text, dimension, metres|seconds|degrees|… per unit, needs a space before].
  const UNITS = [
    ['km²/s²', 'c3', 1], ['km^2/s^2', 'c3', 1], ['km2/s2', 'c3', 1], ['km²s⁻²', 'c3', 1],
    ['km/s', 'speed', 1000], ['m/s', 'speed', 1],
    ['AU', 'length', AU_M], ['au', 'length', AU_M],
    ['km', 'length', 1000], ['m', 'length', 1, true],
    ['days', 'time', 86400], ['day', 'time', 86400], ['d', 'time', 86400, true],
    ['years', 'time', 31557600], ['year', 'time', 31557600], ['yr', 'time', 31557600],
    ['hours', 'time', 3600], ['hour', 'time', 3600], ['h', 'time', 3600, true], ['min', 'time', 60],
    ['seconds', 'time', 1], ['second', 'time', 1], ['ms', 'time', 0.001], ['s', 'time', 1, true],
    ['degrees', 'angle', 1], ['deg', 'angle', 1], ['°', 'angle', 1], ['rad', 'angle', 57.29577951308232],
    ['%', 'fraction', 0.01],
    ['kg', 'mass', 1], ['t', 'mass', 1000, true],
    ['MB', 'data', 1e6], ['KB', 'data', 1e3], ['kB', 'data', 1e3], ['GB', 'data', 1e9],
  ];
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // Single-letter units (m, d, h, s, t) need a space before them, so "1840s" is a decade.
  const UNIT_RE = UNITS.map((u) => (u[3] ? `(?<=\\s)${esc(u[0])}` : esc(u[0]))).join('|');
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  // 10^6, 10⁶, 2.5×10^3, 1e6, 41,906, 0.05
  const NUM_RE =
    `(?:\\d+(?:\\.\\d+)?\\s*[×x]\\s*)?10(?:\\^[-−]?\\d+|[⁻${SUP}]+)` +
    '|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?(?:[eE][-+−]?\\d+)?';
  const MULT_RE = '(?:\\s(thousand|million|billion))?';
  const CMP_RE = '(?:≤|≥|<=|>=|<|>|~|≈|=|up to|below|above|under|over|at most|at least)';
  // [cmp] NUM [– NUM] [million] UNIT   (unit must end at a word boundary)
  const QTY = new RegExp(
    `(?:(${CMP_RE})\\s*)?(?<![\\w.^])(${NUM_RE})(?:\\s*(?:–|-|to)\\s*(${NUM_RE}))?${MULT_RE}\\s?(${UNIT_RE})(?![\\w²^/])`,
    'g',
  );
  // C3 carries its unit by name: "C3 ≤ 25", "C3 = 21–29".
  const C3_PREFIX = new RegExp(`\\bC3\\s*(${CMP_RE})?\\s*(?<![\\w.])(${NUM_RE})(?:\\s*(?:–|-)\\s*(${NUM_RE}))?(?![\\w.]|\\s?(?:${UNIT_RE})(?![\\w]))`, 'g');
  // A bare decimal (0.14) is read only to be matched against a unitless constant whose name
  // shares a word with the sentence; unmatched bare numbers are never reported.
  const BARE = /(?<![\w.^,−-])(\d+\.\d+)(?![\w%°]|\.\d|\s?(?:km|m\/s|AU|au|deg|days?|s\b))/g;

  function parseNum(s) {
    const t = String(s).replace(/,/g, '').replace(/−/g, '-');
    const sup = (x) => x.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/g, (c) => (c === '⁻' ? '-' : String(SUP.indexOf(c))));
    let m = /^(?:(\d+(?:\.\d+)?)\s*[×x]\s*)?10(?:\^([-]?\d+)|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/.exec(t);
    if (m) return (m[1] ? Number(m[1]) : 1) * 10 ** Number(m[2] !== undefined ? m[2] : sup(m[3]));
    return Number(t);
  }
  function unitInfo(u) {
    const hit = UNITS.find((x) => x[0] === u);
    return hit ? { unit: hit[0], dim: hit[1], toBase: hit[2] } : null;
  }
  const MULT = { thousand: 1e3, million: 1e6, billion: 1e9 };

  /** Claims in one display literal's cooked text: dates, year spans, unit-bearing numbers. */
  function claimsIn(joined) {
    const claims = [];
    const taken = [];
    const overlaps = (a, b) => taken.some(([s, e]) => a < e && b > s);
    let m;
    ISO_DATE.lastIndex = 0;
    while ((m = ISO_DATE.exec(joined))) {
      claims.push({ kind: 'date', text: m[0], index: m.index, value: m[0], dim: 'date' });
      taken.push([m.index, m.index + m[0].length]);
    }
    YEAR_SPAN.lastIndex = 0;
    while ((m = YEAR_SPAN.exec(joined))) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      if (Number(m[2]) <= Number(m[1])) continue;
      claims.push({ kind: 'span', text: m[0], index: m.index, value: [m[1], m[2]], dim: 'year' });
      taken.push([m.index, m.index + m[0].length]);
    }
    // half spans next to an interpolation: "${a}–2040" or "2026–${b}"
    const half = /\u0000\s*(?:–|-)\s*((?:19|20)\d{2})(?![\d-])|(?<![\d.-])((?:19|20)\d{2})\s*(?:–|-)\s*\u0000/g;
    while ((m = half.exec(joined))) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      const y = m[1] || m[2];
      claims.push({ kind: 'span', text: m[0].replace(SENTINEL, '${…}'), index: m.index + m[0].indexOf(y), value: [y], dim: 'year', half: true });
      taken.push([m.index, m.index + m[0].length]);
    }
    QTY.lastIndex = 0;
    while ((m = QTY.exec(joined))) {
      const start = m.index + m[0].indexOf(m[2]);
      if (overlaps(start, m.index + m[0].length)) continue;
      const u = unitInfo(m[5]);
      const k = m[4] ? MULT[m[4]] : 1;
      const values = [parseNum(m[2]) * k];
      if (m[3] !== undefined) values.push(parseNum(m[3]) * k);
      claims.push({ kind: 'qty', text: m[0].trim(), index: start, values, unit: u.unit, dim: u.dim, toBase: u.toBase, cmp: m[1] || null });
      taken.push([start, m.index + m[0].length]);
    }
    C3_PREFIX.lastIndex = 0;
    while ((m = C3_PREFIX.exec(joined))) {
      const start = m.index + m[0].lastIndexOf(m[2]);
      if (overlaps(start, m.index + m[0].length)) continue;
      const values = [parseNum(m[2])];
      if (m[3] !== undefined) values.push(parseNum(m[3]));
      claims.push({ kind: 'qty', text: m[0].trim(), index: start, values, unit: 'km²/s² (by name)', dim: 'c3', toBase: 1, cmp: m[1] || null });
      taken.push([start, m.index + m[0].length]);
    }
    BARE.lastIndex = 0;
    while ((m = BARE.exec(joined))) {
      if (overlaps(m.index, m.index + m[0].length)) continue;
      claims.push({ kind: 'bare', text: m[0], index: m.index, values: [Number(m[1])], unit: null, dim: 'ratio', toBase: 1, cmp: null });
      taken.push([m.index, m.index + m[0].length]);
    }
    claims.sort((a, b) => a.index - b.index);
    return claims;
  }

  // ---------------------------------------------------------------------------------------------
  // Name words: does a sentence talk about the quantity a constant names?
  // ---------------------------------------------------------------------------------------------

  const STOP = new Set(
    ('km kms kmps mps ms au deg rad day days sec second seconds default max min value threshold ' +
      'fraction params param metadata the of utc jd to km2s2 km2 s2 is at per and for in on by with ' +
      'from or as it this that are be not no its an all any num count').split(' '),
  );
  const SYNONYMS = { δ: 'delta', Δ: 'delta', reflectivity: 'albedo', reflectivities: 'albedo', flight: 'tof', dep: 'departure' };
  function words(text) {
    return String(text)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/Δ/g, ' delta ')
      .split(/[^A-Za-z0-9]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean);
  }
  function normWord(w) {
    let t = SYNONYMS[w] || w;
    if (t.length > 4 && /ies$/.test(t)) t = `${t.slice(0, -3)}y`;
    else if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) t = t.slice(0, -1);
    return t;
  }
  /**
   * Significant words of a constant name: GRID_PARAMS.tofMinDays -> {grid, tof}. With
   * unitsToo, a name made only of unit words (AU_M, AU_KM) keeps them, so two homes of the
   * astronomical unit still group; a display claim never matches such a name.
   */
  function nameWords(name, unitsToo) {
    const all = words(name).map(normWord);
    const sig = all.filter((w) => (w.length > 2 || /\d/.test(w)) && !STOP.has(w));
    return new Set(sig.length || !unitsToo ? sig : all.filter((w) => w.length > 1));
  }
  /** Words of a sentence, with hyphenated words also joined (co-orbital -> coorbital). */
  function textWords(text) {
    const t = String(text);
    const joinedHyphens = (t.match(/[A-Za-z]+(?:-[A-Za-z]+)+/g) || []).map((w) => w.replace(/-/g, '').toLowerCase());
    return new Set(words(t).concat(joinedHyphens).concat(/Δ/.test(t) ? ['delta'] : []).map(normWord));
  }
  // Two words agree if equal, or if they share a prefix of at least 5 letters that covers 3/4 of
  // the shorter one (feasible / feasibility, coorbital / coorbitals).
  function wordsAgree(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    if (n < 5) return false;
    let k = 0;
    while (k < n && a[k] === b[k]) k++;
    return k >= 5 && k >= 0.75 * n;
  }
  function sharedWords(name, text) {
    const tw = [...(text instanceof Set ? text : textWords(text))];
    return [...nameWords(name)].filter((w) => tw.some((t) => wordsAgree(w, t)));
  }

  // ---------------------------------------------------------------------------------------------
  // Canon: what the code already owns
  // ---------------------------------------------------------------------------------------------

  // Dimension and scale of a constant from its name (the repo's own suffix conventions).
  const NAME_DIMS = [
    [/JULIAN_?(DAY|DATE)|Julian(Day|Date)|_JD$|[a-z]JD$|Jd$/, 'epoch', 1],
    [/KM_?2_?S_?2|Km2S2|KM2S2/i, 'c3', 1],
    [/MPS2$|_M_S2$/, 'accel', 1],
    [/(KMPS$|_KM_S$|Kmps$|KmS$)/, 'speed', 1000],
    [/(MPS$|_M_S$|Mps$)/, 'speed', 1],
    [/(_MS$|[a-z]Ms$)/, 'time', 0.001],
    [/(_KM$|Km$)/, 'length', 1000],
    [/(_M$|[a-z]M$)/, 'length', 1],
    [/(_AU$|Au$|AU$)/, 'length', AU_M],
    [/(DAYS?$|Days?$|_DAYS?_)/, 'time', 86400],
    [/(SECONDS?$|Seconds?$|_S$|_SEC$)/, 'time', 1],
    [/(DEG$|Deg$|_DEG_)/, 'angle', 1],
    [/(RAD$|Rad$)/, 'angle', 57.29577951308232],
    [/(FRACTION$|Fraction$)/, 'fraction', 1],
    [/(ALBEDO|Albedo)/, 'ratio', 1],
    [/(_PX$|Px$|_PIXELS?$)/, 'pixel', 1],
  ];
  function dimFromName(name) {
    const last = String(name).split('.').pop();
    for (const [re, dim, toBase] of NAME_DIMS) if (re.test(last)) return { dim, toBase };
    return { dim: 'unknown', toBase: 1 };
  }

  function numberValue(text) {
    const t = String(text).replace(/_/g, '').replace(/n$/, '');
    if (/^0[xob]/i.test(t)) return Number(t);
    return Number(t);
  }
  /** Significant figures of a numeric literal as written (integer trailing zeros not counted). */
  function sigFigs(text) {
    let t = String(text).replace(/_/g, '').replace(/^[-+−]/, '').replace(/n$/, '');
    if (/^0[xob]/i.test(t)) return 0;
    t = t.replace(/[eE][-+−]?\d+$/, '');
    if (t.includes('.')) {
      const digits = t.replace('.', '').replace(/^0+/, '');
      return digits.length;
    }
    return t.replace(/^0+/, '').replace(/0+$/, '').length;
  }

  function isDateString(s) {
    return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])$/.test(s);
  }

  /**
   * Homes in one TS file: depth-0 `[export] const NAME [: T] = <num | -num | 'date'> [as const]`
   * and the first-level fields of depth-0 `[export] const NAME = { field: <num|'date'|fn('date')> }`.
   */
  function harvestTs(path, src, lexed) {
    const L = lexed || lex(src);
    const T = L.tokens;
    const homes = [];
    for (let k = 0; k < T.length; k++) {
      const t = T[k];
      if (t.type !== 'ident' || t.value !== 'const' || t.depth !== 0) continue;
      const exported = k > 0 && T[k - 1].type === 'ident' && T[k - 1].value === 'export';
      const nameTok = T[k + 1];
      if (!nameTok || nameTok.type !== 'ident') continue;
      let j = k + 2;
      // skip a type annotation up to '=' at depth 0
      while (j < T.length && !(T[j].type === 'punct' && T[j].value === '=' && T[j].depth === 0)) {
        if (T[j].type === 'punct' && T[j].value === ';' && T[j].depth === 0) break;
        if (T[j].type === 'ident' && T[j].value === 'const' && T[j].depth === 0) break;
        j++;
      }
      if (!T[j] || T[j].value !== '=') continue;
      const v = T[j + 1];
      if (!v) continue;
      const name = nameTok.value;
      const endsHere = (idx) => {
        const a = T[idx];
        if (!a) return true;
        if (a.type === 'punct' && (a.value === ';' || a.value === ',')) return true;
        if (a.type === 'ident' && a.value === 'as' && T[idx + 1] && T[idx + 1].value === 'const') return true;
        return a.line !== undefined && a.line > T[idx - 1].line && a.type === 'ident';
      };
      if (v.type === 'num' && endsHere(j + 2)) {
        homes.push(home(path, name, v.value, v.line, exported, false));
      } else if (v.type === 'punct' && v.value === '-' && T[j + 2] && T[j + 2].type === 'num' && endsHere(j + 3)) {
        homes.push(home(path, name, `-${T[j + 2].value}`, T[j + 2].line, exported, false));
      } else if (v.type === 'str' && isDateString(v.value) && endsHere(j + 2)) {
        homes.push(home(path, name, v.value, v.line, exported, false));
      } else if (v.type === 'punct' && v.value === '{') {
        // first-level fields
        let d = j + 2;
        const objDepth = v.depth + 1;
        while (d < T.length && !(T[d].type === 'punct' && T[d].value === '}' && T[d].depth === v.depth)) {
          const f = T[d];
          if (f.depth === objDepth && (f.type === 'ident' || f.type === 'str') && T[d + 1] && T[d + 1].value === ':' && T[d + 1].depth === objDepth) {
            const prevTok = T[d - 1];
            const keyPos = prevTok.value === '{' || prevTok.value === ',';
            if (keyPos) {
              const a = T[d + 2];
              const b = T[d + 3];
              const fieldName = `${name}.${f.value}`;
              const closesField = (idx) => T[idx] && T[idx].type === 'punct' && (T[idx].value === ',' || T[idx].value === '}') && T[idx].depth <= objDepth;
              if (a && a.type === 'num' && closesField(d + 3)) homes.push(home(path, fieldName, a.value, a.line, exported, true));
              else if (a && a.type === 'punct' && a.value === '-' && b && b.type === 'num' && closesField(d + 4)) homes.push(home(path, fieldName, `-${b.value}`, b.line, exported, true));
              else if (a && a.type === 'str' && isDateString(a.value) && closesField(d + 3)) homes.push(home(path, fieldName, a.value, a.line, exported, true));
              else if (a && a.type === 'ident' && b && b.value === '(' && T[d + 4] && T[d + 4].type === 'str' && isDateString(T[d + 4].value) && T[d + 5] && T[d + 5].value === ')' && closesField(d + 6)) {
                const h = home(path, fieldName, T[d + 4].value, T[d + 4].line, exported, true);
                h.via = `${a.value}('${T[d + 4].value}')`;
                homes.push(h);
              }
            }
          }
          d++;
        }
      }
    }
    return homes;
  }

  function home(path, name, text, line, exported, field) {
    const date = isDateString(text);
    const nd = date ? { dim: 'date', toBase: 1 } : dimFromName(name);
    return {
      name,
      text: String(text),
      value: date ? text : numberValue(text),
      dim: nd.dim,
      toBase: nd.toBase,
      sig: date ? 8 : sigFigs(text),
      path,
      line,
      exported,
      field,
      source: 'ts',
    };
  }

  /** Homes from a JSON object (e.g. the screening cache's metadata). Leaves only. */
  function harvestJson(path, obj, prefix, lineOfKey) {
    const homes = [];
    (function walk(o, pre) {
      for (const [k, v] of Object.entries(o)) {
        const name = pre ? `${pre}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, name);
        else if (typeof v === 'number' || (typeof v === 'string' && isDateString(v))) {
          const date = typeof v === 'string';
          const nd = date ? { dim: 'date', toBase: 1 } : dimFromName(name);
          homes.push({
            name,
            text: String(v),
            value: v,
            dim: nd.dim,
            toBase: nd.toBase,
            sig: date ? 8 : sigFigs(String(v)),
            path,
            line: lineOfKey ? lineOfKey(k) : null,
            exported: true,
            field: true,
            source: 'json',
          });
        }
      }
    })(obj, prefix);
    return homes;
  }

  /**
   * Find the balanced JSON object that follows `"key":` in a text prefix (the first KB of a large
   * file). Returns {object, offset} or null if the key or the object's end is not in the prefix.
   */
  function jsonObjectAfterKey(text, key) {
    const at = text.indexOf(`"${key}"`);
    if (at < 0) return null;
    let i = text.indexOf('{', at);
    if (i < 0) return null;
    const start = i;
    let depth = 0;
    let inStr = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return { object: JSON.parse(text.slice(start, i + 1)), offset: start };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Scanning one file
  // ---------------------------------------------------------------------------------------------

  // Canon names an interpolation reads: ALL_CAPS identifiers and dotted paths of harvested homes.
  function canonReads(exprText, canonNames) {
    const reads = [];
    const re = /[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*/g;
    let m;
    while ((m = re.exec(exprText))) {
      const chain = m[0].replace(/\?\./g, '.');
      const parts = chain.split('.');
      for (let k = parts.length; k >= 1; k--) {
        const tail = parts.slice(-k).join('.');
        const full = parts.slice(0, k).join('.');
        if (canonNames.has(full)) {
          reads.push(full);
          break;
        }
        if (canonNames.has(tail)) {
          reads.push(tail);
          break;
        }
      }
    }
    return [...new Set(reads)];
  }

  function excerpt(text, index, len, width) {
    const w = width || 60;
    const a = Math.max(0, index - w);
    const b = Math.min(text.length, index + len + w);
    return `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`.replace(/\u0000/g, '${…}').replace(/\s+/g, ' ');
  }

  // Identifier chains (a.b?.c) in code tokens, with the line of their first identifier.
  function identChains(tokens) {
    const out = [];
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'ident') continue;
      const prevTok = tokens[k - 1];
      if (prevTok && prevTok.type === 'punct' && (prevTok.value === '.' || prevTok.value === '?.')) continue;
      const parts = [t.value];
      let j = k + 1;
      while (tokens[j] && tokens[j].type === 'punct' && (tokens[j].value === '.' || tokens[j].value === '?.') && tokens[j + 1] && tokens[j + 1].type === 'ident') {
        parts.push(tokens[j + 1].value);
        j += 2;
      }
      out.push({ chain: parts.join('.'), line: t.line, start: t.start, depth: t.depth, index: k });
    }
    return out;
  }

  /**
   * Scan one TS source. opts: {canonNames: Set of harvested names, jsonNames: Set of data-file
   * names (metadata.*)}. Returns {path, counts, displays:[{line, text, unitText, claims, reads}],
   * codeNumbers, dateLiterals, runtimeReads, errors}.
   */
  function scanSource(path, src, opts) {
    const o = opts instanceof Set ? { canonNames: opts } : opts || {};
    const L = lex(src);
    // One level of indirection inside the file: a depth-0 const whose initializer reads a
    // harvested name (PORKCHOP_DEPARTURE_SPAN_LABEL <- GRID_PARAMS.depStartJD) is canon-derived too.
    const canonNames = new Set(o.canonNames || []);
    const via = new Map();
    {
      const T = L.tokens;
      for (let k = 0; k < T.length; k++) {
        if (!(T[k].type === 'ident' && T[k].value === 'const' && T[k].depth === 0 && T[k + 1] && T[k + 1].type === 'ident')) continue;
        let j = k + 2;
        while (T[j] && !(T[j].value === '=' && T[j].depth === 0)) j++;
        const from = j + 1;
        let e = from;
        while (T[e] && !(T[e].type === 'punct' && T[e].value === ';' && T[e].depth === 0) && !(T[e].type === 'ident' && (T[e].value === 'const' || T[e].value === 'export' || T[e].value === 'function') && T[e].depth === 0 && e > from)) e++;
        const reads = [];
        for (const c of identChains(T.slice(from, e))) for (const r of canonReads(c.chain, canonNames)) reads.push(r);
        // literal templates in the initializer read through ${}
        for (const lit of L.literals) if (lit.start >= (T[from] || {}).start && lit.end <= ((T[e - 1] || {}).end || 0)) for (const ex of lit.exprs) for (const r of canonReads(ex.text, canonNames)) reads.push(r);
        if (reads.length) via.set(T[k + 1].value, [...new Set(reads)]);
      }
      for (const name of via.keys()) canonNames.add(name);
    }
    // Where code reads a data file's field at runtime (metadata.feasibleC3MaxKm2S2).
    const runtimeReads = [];
    if (o.jsonNames && o.jsonNames.size) {
      for (const c of identChains(L.tokens)) {
        const hit = canonReads(c.chain, o.jsonNames).find((r) => r.includes('.'));
        if (hit) runtimeReads.push({ path, line: c.line, reads: hit, chain: c.chain });
      }
    }
    const counts = { literals: L.literals.length, import: 0, console: 0, error: 0, css: 0, code: 0, token: 0, display: 0 };
    const displays = [];
    const dateLiterals = [];
    // Literals joined by '+' read as one sentence: 'Bodies marked co-orbital … ' + "… 0.05 AU".
    // (found by position: a literal's end, optional space, '+', optional space, a literal's start)
    const chainOf = new Map();
    const litAt = new Map(L.literals.map((l) => [l.start, l]));
    let chain = 0;
    for (const lit of L.literals.slice().sort((a, b) => a.start - b.start)) {
      if (!chainOf.has(lit.start)) chainOf.set(lit.start, ++chain);
      let p = lit.end;
      while (p < src.length && /\s/.test(src[p])) p++;
      if (src[p] !== '+') continue;
      p++;
      while (p < src.length && /\s/.test(src[p])) p++;
      if (litAt.has(p)) chainOf.set(p, chainOf.get(lit.start));
    }
    const chainText = new Map();
    const offsetInChain = new Map();
    for (const lit of L.literals.slice().sort((a, b) => a.start - b.start)) {
      const id = chainOf.get(lit.start);
      const before = chainText.has(id) ? `${chainText.get(id)} ` : '';
      offsetInChain.set(lit.start, before.length);
      chainText.set(id, `${before}${staticText(lit).joined}`);
    }
    for (const lit of L.literals) {
      const { cooked, joined } = staticText(lit);
      const cls = classifyLiteral(lit, joined);
      counts[cls]++;
      // whole-literal ISO dates in code (data, not display) feed the duplicate pass
      if (lit.exprs.length === 0 && isDateString(cooked[0].text)) {
        dateLiterals.push({ path, line: lit.line, value: cooked[0].text, cls, callees: lit.ctx.callees, key: lit.ctx.key });
      }
      if (cls !== 'display') continue;
      const reads = [];
      for (const e of lit.exprs) {
        for (const r of canonReads(e.text, canonNames)) reads.push({ name: r, via: via.get(r) || null, expr: e.text.trim(), line: lineOf(L.lineStarts, e.start) });
      }
      const claims = claimsIn(joined).map((c) => {
        // map the claim's cooked index back to a source line
        let acc = 0;
        let line = lit.line;
        for (let p = 0; p < cooked.length; p++) {
          const len = cooked[p].text.length;
          if (c.index <= acc + len) {
            const rawOff = cooked[p].map[Math.max(0, Math.min(c.index - acc, len))];
            line = lineOf(L.lineStarts, lit.parts[p].start + rawOff);
            break;
          }
          acc += len + 1;
        }
        // context: the whole sentence when literals are joined with '+'
        const whole = chainText.get(chainOf.get(lit.start)) || joined;
        return Object.assign({}, c, { line, context: excerpt(whole, (offsetInChain.get(lit.start) || 0) + c.index, c.text.length) });
      });
      const unitText = (chainText.get(chainOf.get(lit.start)) || joined).replace(/\u0000/g, ' ');
      displays.push({ line: lit.line, kind: lit.kind, text: joined.replace(/\u0000/g, '${…}'), unitText, claims, reads });
    }
    const codeNumbers = [];
    for (const t of L.tokens) {
      if (t.type !== 'num') continue;
      const s = sigFigs(t.value);
      codeNumbers.push({ path, line: t.line, text: t.value, value: numberValue(t.value), sig: s, depth: t.depth, start: t.start });
    }
    return { path, counts, displays, codeNumbers, dateLiterals, runtimeReads, errors: L.errors };
  }

  // HTML entry points: visible text and the text-bearing attributes, scripts/styles/comments removed.
  function scanHtml(path, src) {
    const starts = lineIndex(src);
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    const body = src
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/<script\b[\s\S]*?<\/script>/gi, (m) => blank(m))
      .replace(/<style\b[\s\S]*?<\/style>/gi, (m) => blank(m));
    const pieces = [];
    const attr = /\b(content|title|alt|aria-label|placeholder|value)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let m;
    while ((m = attr.exec(body))) {
      const v = m[3] !== undefined ? m[3] : m[4];
      if (/^(width=|text\/|UTF-8$)/i.test(v)) continue;
      pieces.push({ text: v, start: m.index + m[0].indexOf(v) });
    }
    const text = />([^<>]+)</g;
    while ((m = text.exec(body))) {
      if (!m[1].trim()) continue;
      pieces.push({ text: m[1], start: m.index + 1 });
    }
    const displays = [];
    for (const p of pieces) {
      const t = p.text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&ndash;/g, '–');
      const claims = claimsIn(t).map((c) => Object.assign({}, c, { line: lineOf(starts, p.start + c.index), context: excerpt(t, c.index, c.text.length) }));
      displays.push({ line: lineOf(starts, p.start), kind: 'html', text: t.trim(), unitText: t, claims, reads: [] });
    }
    return { path, counts: { literals: pieces.length, display: pieces.length }, displays, codeNumbers: [], dateLiterals: [], runtimeReads: [], errors: [] };
  }

  // ---------------------------------------------------------------------------------------------
  // Matching and the report
  // ---------------------------------------------------------------------------------------------

  const REL_TOL = 1e-9;
  function sameValue(a, b) {
    if (a === b) return true;
    const s = Math.max(Math.abs(a), Math.abs(b));
    return s > 0 && Math.abs(a - b) / s < REL_TOL;
  }

  /**
   * Canon homes whose value a display claim restates: same dimension and the same value in base
   * units (a percentage against a *_FRACTION; a bare decimal only against a unitless or
   * unknown-dimension constant). Dates match by value; a year span matches dates in its years.
   */
  function matchClaim(claim, canon) {
    if (claim.kind === 'date') return canon.filter((h) => h.dim === 'date' && h.value === claim.value);
    if (claim.kind === 'span') {
      const years = claim.value;
      return canon.filter((h) => h.dim === 'date' && years.includes(String(h.value).slice(0, 4)));
    }
    const out = [];
    for (const h of canon) {
      if (h.dim === 'date' || h.dim === 'epoch' || typeof h.value !== 'number') continue;
      if (claim.kind === 'bare' ? !(h.dim === 'ratio' || h.dim === 'unknown') : h.dim === 'unknown') continue;
      for (const v of claim.values) {
        let ok = false;
        // a bare decimal never matches a whole number (1.0 is everywhere) and needs >= 2 figures
        if (claim.kind === 'bare') ok = !Number.isInteger(h.value) && h.sig >= 2 && sameValue(v, h.value);
        else if (claim.dim === 'fraction' && h.dim === 'fraction') ok = sameValue(v * 0.01, h.value);
        else if (claim.dim === h.dim) ok = sameValue(v * claim.toBase, h.value * h.toBase);
        if (ok) {
          out.push(h);
          break;
        }
      }
    }
    return out;
  }

  // Rank homes: the data a label describes (JSON metadata) first, then exported, then local.
  function rankHomes(homes, path) {
    const score = (h) => (h.source === 'json' ? 0 : h.exported ? 1 : h.path === path ? 2 : 3);
    return homes.slice().sort((a, b) => score(a) - score(b) || a.path.localeCompare(b.path) || a.line - b.line);
  }

  function fid(f) {
    return `${f.class}|${f.path}:${f.line}|${f.literal}`;
  }

  /**
   * Build the report from per-file scans and the canon.
   * opts: {minSig (default 4), allowlist: {entries:[{id, reason}]}, strict, classes (keep only these)}
   */
  function buildReport(scans, canon, opts) {
    const o = Object.assign({ minSig: 4, allowlist: null, strict: false }, opts || {});
    const findings = [];
    const derived = [];
    const homesAt = new Set(canon.filter((h) => h.source === 'ts').map((h) => `${h.path}:${h.line}`));

    // Pass 1: display literals
    for (const s of scans) {
      for (const d of s.displays) {
        for (const r of d.reads) {
          if (derived.some((x) => x.path === s.path && x.line === r.line && x.reads === r.name)) continue;
          derived.push({ path: s.path, line: r.line, reads: r.name, via: r.via, expr: r.expr });
        }
        const tw = textWords(d.unitText || d.text);
        for (const c of d.claims) {
          const matches = rankHomes(matchClaim(c, canon), s.path);
          let cls;
          let homes = matches;
          let alsoEqual = [];
          if (c.kind === 'date' || c.kind === 'span') cls = 'LITERAL-DATE-SPAN';
          else {
            // a value match counts only when the constant's name shares a word with the sentence
            homes = matches.filter((h) => sharedWords(h.name, tw).length > 0);
            alsoEqual = matches.filter((h) => !homes.includes(h));
            if (homes.length) cls = 'LITERAL-MATCHES-CONSTANT';
            else if (c.kind === 'bare') continue;
            else cls = 'LITERAL-WITH-UNITS';
          }
          const at = (h) => (h.line ? `${h.path}:${h.line}` : h.path);
          const f = {
            class: cls,
            path: s.path,
            line: c.line,
            literal: c.text,
            context: c.context,
            homes: homes.map((h) => ({ name: h.name, value: h.text, at: at(h), words: sharedWords(h.name, tw) })),
          };
          if (alsoEqual.length) f.alsoEqual = alsoEqual.map((h) => ({ name: h.name, value: h.text, at: at(h) }));
          f.id = fid(f);
          findings.push(f);
        }
      }
    }

    // Pass 2: retyped constants: a code literal (>= minSig significant figures) whose value a
    // canon home elsewhere owns, or which is typed in two or more files.
    const byValue = new Map();
    for (const s of scans) {
      for (const n of s.codeNumbers) {
        if (n.sig < o.minSig || !Number.isFinite(n.value)) continue;
        if (homesAt.has(`${n.path}:${n.line}`) && canon.some((h) => h.path === n.path && h.line === n.line && sameValue(Math.abs(h.value), Math.abs(n.value)))) continue;
        const key = Math.abs(n.value);
        const list = byValue.get(key) || [];
        list.push(n);
        byValue.set(key, list);
      }
    }
    const retyped = [];
    for (const [value, sites] of byValue) {
      const owners = canon.filter((h) => typeof h.value === 'number' && h.source === 'ts' && sameValue(Math.abs(h.value), value) && h.sig >= o.minSig);
      const files = new Set(sites.map((x) => x.path));
      if (!owners.some((h) => h.exported) && files.size < 2) continue;
      retyped.push({ value, sites, owners, files });
    }
    // Values with no named home that two files share three or more of are one copied block
    // (a duplicated algorithm), reported once per file rather than once per literal.
    const blockOf = new Map();
    const noHome = retyped.filter((g) => !g.owners.length);
    const filesList = [...new Set(noHome.flatMap((g) => [...g.files]))].sort();
    for (let a = 0; a < filesList.length; a++) {
      for (let b = a + 1; b < filesList.length; b++) {
        const shared = noHome.filter((g) => g.files.has(filesList[a]) && g.files.has(filesList[b]));
        if (shared.length < 3) continue;
        for (const g of shared) if (!blockOf.has(g.value)) blockOf.set(g.value, [filesList[a], filesList[b]]);
      }
    }
    const blocks = new Map();
    for (const g of retyped) {
      if (blockOf.has(g.value)) {
        for (const site of g.sites) {
          const k = site.path;
          const blk = blocks.get(k) || { path: k, lines: [], values: new Set(), other: blockOf.get(g.value).find((f) => f !== k) || blockOf.get(g.value)[0] };
          blk.lines.push(site.line);
          blk.values.add(site.text.replace(/_/g, ''));
          blocks.set(k, blk);
        }
        continue;
      }
      for (const site of g.sites) {
        const f = {
          class: 'RETYPED-CONSTANT',
          path: site.path,
          line: site.line,
          literal: site.text,
          context: g.owners.length ? `typed in ${g.files.size} file${g.files.size > 1 ? 's' : ''}; the value has a named home` : `typed in ${g.files.size} files; no named home`,
          homes: g.owners.map((h) => ({ name: h.name, value: h.text, at: `${h.path}:${h.line}` })),
          group: String(g.value),
        };
        f.id = fid(f);
        findings.push(f);
      }
    }
    for (const blk of blocks.values()) {
      const lo = Math.min(...blk.lines);
      const hi = Math.max(...blk.lines);
      const otherBlk = blocks.get(blk.other);
      const f = {
        class: 'RETYPED-CONSTANT',
        path: blk.path,
        line: lo,
        literal: `block of ${blk.values.size} literals`,
        context: `lines ${lo}-${hi} (${[...blk.values].join(', ')}) repeat ${blk.other}${otherBlk ? `:${Math.min(...otherBlk.lines)}-${Math.max(...otherBlk.lines)}` : ''}; no named home`,
        homes: [],
        group: `block:${[...blk.values].sort().join(',')}`,
      };
      f.id = fid(f);
      findings.push(f);
    }

    // Pass 3: the same ISO date typed as a code literal in two or more files.
    const dates = new Map();
    for (const s of scans) for (const d of s.dateLiterals) {
      const list = dates.get(d.value) || [];
      list.push(d);
      dates.set(d.value, list);
    }
    const dateGroups = [];
    for (const [value, sites] of dates) {
      const files = [...new Set(sites.map((x) => x.path))];
      if (files.length < 2) continue;
      const owners = canon.filter((h) => h.dim === 'date' && h.value === value);
      // a data file's date in the same year but on another day (S17-F2: the grid ends 2040-01-01,
      // the cache's screening window 2040-12-31)
      const sameYear = canon.filter((h) => h.source === 'json' && h.dim === 'date' && h.value !== value && String(h.value).slice(0, 4) === value.slice(0, 4));
      dateGroups.push({
        value,
        files,
        sites: sites.map((x) => `${x.path}:${x.line}`),
        owners: owners.map((h) => `${h.name} (${h.path}${h.line ? `:${h.line}` : ''})`),
        sameYear: sameYear.map((h) => ({ name: h.name, value: h.text, at: `${h.path}${h.line ? `:${h.line}` : ''}` })),
      });
      const isHome = (site) => owners.some((h) => h.source === 'ts' && h.path === site.path && h.line === site.line);
      const homeSites = sites.filter(isHome);
      const reported = homeSites.length === 1 ? sites.filter((x) => !isHome(x)) : sites;
      for (const site of reported) {
        const others = owners.filter((h) => !(h.path === site.path && h.line === site.line));
        const f = { class: 'DUPLICATE-DATE', path: site.path, line: site.line, literal: `'${value}'`, context: `typed in ${files.length} files`, homes: others.map((h) => ({ name: h.name, value: h.text, at: h.line ? `${h.path}:${h.line}` : h.path })), group: value };
        f.id = fid(f);
        findings.push(f);
      }
    }

    // Pass 4: one quantity with two homes in different files (same dimension, same value in base
    // units, and a shared name token beyond the unit suffix).
    const twoHomes = [];
    // A constant of unknown dimension qualifies only when the two names say the same words
    // (COMPARE_BODY_CAP / COMPARE_BODIES_CAP); a known dimension needs one shared word.
    const tsCanon = canon.filter((h) => h.dim !== 'date' && typeof h.value === 'number' && h.value !== 0);
    const sameWords = (x, y) => {
      const wx = [...nameWords(x, true)];
      const wy = [...nameWords(y, true)];
      return wx.length > 0 && wx.length === wy.length && wx.every((w) => wy.some((v) => wordsAgree(w, v))) && wy.every((w) => wx.some((v) => wordsAgree(w, v)));
    };
    for (let a = 0; a < tsCanon.length; a++) {
      for (let b = a + 1; b < tsCanon.length; b++) {
        const A = tsCanon[a];
        const B = tsCanon[b];
        if (A.path === B.path || A.dim !== B.dim) continue;
        if (!sameValue(A.value * A.toBase, B.value * B.toBase)) continue;
        const wa = [...nameWords(A.name, true)];
        const wb = [...nameWords(B.name, true)];
        const shared = wa.filter((w) => wb.some((v) => wordsAgree(w, v)));
        if (!shared.length) continue;
        if (A.dim === 'unknown' && !sameWords(A.name, B.name)) continue;
        twoHomes.push({ a: A, b: B, shared });
      }
    }
    // Pairs join into groups (three route runtimes defining one constant are one group); one
    // finding per group, anchored at its first home.
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) !== x) x = parent.get(x);
      return x;
    };
    for (const { a, b } of twoHomes) {
      for (const h of [a, b]) if (!parent.has(h)) parent.set(h, h);
      parent.set(find(a), find(b));
    }
    const groups = new Map();
    for (const h of parent.keys()) groups.set(find(h), (groups.get(find(h)) || []).concat(h));
    for (const members of groups.values()) {
      members.sort((x, y) => x.path.localeCompare(y.path) || x.line - y.line);
      const [X, ...rest] = members;
      const at = (h) => `${h.path}${h.line ? `:${h.line}` : ''}`;
      const f = {
        class: 'TWO-HOMES',
        path: X.path,
        line: X.line,
        literal: `${X.name} = ${X.text}`,
        context: `${members.length} homes for one ${X.dim === 'unknown' ? 'value' : X.dim}: ${members.map((h) => `${h.name} = ${h.text} (${at(h)})`).join('; ')}`,
        homes: rest.map((h) => ({ name: h.name, value: h.text, at: at(h) })),
        group: members.map((h) => `${h.name}@${h.path}`).join(','),
      };
      f.id = fid(f);
      findings.push(f);
    }

    findings.sort((p, q) => CLASS_ORDER.indexOf(p.class) - CLASS_ORDER.indexOf(q.class) || p.path.localeCompare(q.path) || p.line - q.line || p.literal.localeCompare(q.literal));
    // opts.classes keeps only some classes (the page's one-snippet scanner has no second file to
    // duplicate into and must not report the canon's own two-homes groups)
    if (o.classes) {
      const keepCls = new Set(o.classes);
      for (let k = findings.length - 1; k >= 0; k--) if (!keepCls.has(findings[k].class)) findings.splice(k, 1);
      if (!keepCls.has('DUPLICATE-DATE')) dateGroups.length = 0;
      if (!keepCls.has('TWO-HOMES')) twoHomes.length = 0;
    }

    // Allowlist
    const allow = applyAllowlist(findings, o.allowlist);
    const failingClasses = o.strict ? CLASS_ORDER : FAILING;
    const failing = findings.filter((f) => failingClasses.includes(f.class) && !allow.allowed.has(f.id));
    const counts = {};
    for (const c of CLASS_ORDER) counts[c] = findings.filter((f) => f.class === c).length;
    const runtimeReads = [].concat(...scans.map((s) => s.runtimeReads || []));
    return { findings, derived, runtimeReads, dateGroups, twoHomes, counts, failing, allow, strict: !!o.strict };
  }

  const CLASS_ORDER = ['LITERAL-MATCHES-CONSTANT', 'LITERAL-DATE-SPAN', 'RETYPED-CONSTANT', 'DUPLICATE-DATE', 'TWO-HOMES', 'LITERAL-WITH-UNITS'];
  const FAILING = ['LITERAL-MATCHES-CONSTANT', 'LITERAL-DATE-SPAN', 'RETYPED-CONSTANT', 'DUPLICATE-DATE', 'TWO-HOMES'];

  /**
   * Allowlist: {entries: [{id, reason}]}. id is "<class>|<path>:<line>|<literal>" (that one
   * finding) or "<class>|<path>|<literal>" (that literal anywhere in the file). An entry whose
   * reason is shorter than 8 characters is an error and suppresses nothing; an entry that matches
   * nothing is reported as stale.
   */
  function applyAllowlist(findings, allowlist) {
    const allowed = new Map();
    const errors = [];
    const unused = [];
    if (!allowlist) return { allowed, errors, unused, entries: 0 };
    const entries = Array.isArray(allowlist) ? allowlist : allowlist.entries;
    if (!Array.isArray(entries)) {
      errors.push('allowlist has no "entries" array');
      return { allowed, errors, unused, entries: 0 };
    }
    const byId = new Map(findings.map((f) => [f.id, [f]]));
    const byNoLine = new Map();
    for (const f of findings) {
      const k = `${f.class}|${f.path}|${f.literal}`;
      byNoLine.set(k, (byNoLine.get(k) || []).concat(f));
    }
    for (const e of entries) {
      if (!e || typeof e.id !== 'string') {
        errors.push('allowlist entry without an "id"');
        continue;
      }
      if (typeof e.reason !== 'string' || e.reason.trim().length < 8) {
        errors.push(`allowlist entry "${e.id}" has no reason (at least 8 characters); it suppresses nothing`);
        continue;
      }
      const hits = byId.get(e.id) || byNoLine.get(e.id);
      if (!hits) {
        unused.push(e.id);
        continue;
      }
      for (const f of hits) allowed.set(f.id, e.reason.trim());
    }
    return { allowed, errors, unused, entries: entries.length };
  }

  // ---------------------------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------------------------

  const CLASS_NOTE = {
    'LITERAL-MATCHES-CONSTANT': 'a display string types a value the code owns; read it from the home instead',
    'LITERAL-DATE-SPAN': 'a display string types a date or a year span; derive it from the grid or data it describes',
    'RETYPED-CONSTANT': 'a code literal restates a value with a home elsewhere, or is typed in two or more files',
    'DUPLICATE-DATE': 'the same ISO date literal is typed in two or more files',
    'TWO-HOMES': 'one quantity is defined in two files under two names',
    'LITERAL-WITH-UNITS': 'a unit-bearing number in a display string that matches nothing the code owns (informational)',
  };

  function mdEscape(s) {
    return String(s).replace(/\|/g, '\\|').replace(/`/g, "'");
  }

  function formatMarkdown(report, meta) {
    const m = meta || {};
    const out = [];
    out.push('# Said vs Derived');
    out.push('');
    if (m.root) out.push(`Checkout: ${m.root}${m.commit ? ` at ${m.commit}` : ' (not a git checkout of its own; no commit to report)'}${m.dirty ? ' (working tree differs from HEAD)' : ''}`);
    if (m.scanned) out.push(`Scanned: ${m.scanned.ts} TypeScript files and ${m.scanned.html} HTML files${m.fileSource ? ` (${m.fileSource})` : ''}; ${m.scanned.literals} literals, ${m.scanned.displayLiterals} of them display text.`);
    if (m.canon) out.push(`Canon: ${m.canon.total} homes (${m.canon.ts} TypeScript constants or fields, ${m.canon.json} cache metadata leaves${m.canon.jsonFrom ? ` from ${m.canon.jsonFrom}` : ''}).`);
    if (m.cacheRefusal) out.push(`Cache metadata: NOT READ, ${m.cacheRefusal}`);
    out.push(`Allow-list: ${report.allow.entries ? `${m.allowlistFile ? `${m.allowlistFile}, ` : ''}${report.allow.entries} entries, ${report.allow.allowed.size} applied` : 'none'}${report.strict ? '; strict (informational class fails too)' : ''}.`);
    out.push('');
    out.push('| class | found | allowed | what it means |');
    out.push('|---|---|---|---|');
    for (const c of CLASS_ORDER) {
      const n = report.counts[c];
      const a = report.findings.filter((f) => f.class === c && report.allow.allowed.has(f.id)).length;
      out.push(`| ${c} | ${n} | ${a} | ${CLASS_NOTE[c]} |`);
    }
    out.push('');
    for (const c of CLASS_ORDER) {
      const list = report.findings.filter((f) => f.class === c);
      if (!list.length) continue;
      out.push(`## ${c} (${list.length})`);
      out.push('');
      for (const f of list) {
        const allowed = report.allow.allowed.get(f.id);
        const homes = f.homes.length ? ` = ${f.homes.map((h) => `${h.name} = ${h.value} (${h.at})`).join('; ')}` : '';
        out.push(`- ${allowed ? '[allowed] ' : ''}\`${f.path}:${f.line}\` \`${mdEscape(f.literal)}\`${homes}`);
        if (f.context) out.push(`  - ${mdEscape(f.context)}`);
        if (f.alsoEqual) out.push(`  - same value, no shared name word (not counted as a match): ${f.alsoEqual.map((h) => `${h.name} (${h.at})`).join('; ')}`);
        if (allowed) out.push(`  - allowed: ${mdEscape(allowed)}`);
      }
      out.push('');
    }
    if (report.dateGroups.length) {
      out.push('## Duplicate date groups');
      out.push('');
      for (const g of report.dateGroups) {
        out.push(`- '${g.value}' in ${g.files.length} files: ${g.sites.join(', ')}${g.owners.length ? `; homes: ${g.owners.join(', ')}` : '; no named home'}`);
        for (const y of g.sameYear || []) out.push(`  - same year, another day in the data: ${y.name} = ${y.value} (${y.at})`);
      }
      out.push('');
    }
    out.push(`## Derived (${report.derived.length} interpolations read a named constant)`);
    out.push('');
    const byFile = new Map();
    for (const d of report.derived) byFile.set(d.path, (byFile.get(d.path) || []).concat(d));
    for (const [p, list] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`- \`${p}\`: ${list.map((d) => `:${d.line} ${d.reads}${d.via ? ` (← ${d.via.join(', ')})` : ''}`).join(', ')}`);
    }
    out.push('');
    if (report.runtimeReads && report.runtimeReads.length) {
      out.push(`## Runtime reads of data-file fields (${report.runtimeReads.length})`);
      out.push('');
      const byField = new Map();
      for (const r of report.runtimeReads) byField.set(r.reads, (byField.get(r.reads) || []).concat(`${r.path}:${r.line}`));
      for (const [field, sites] of [...byField].sort((a, b) => a[0].localeCompare(b[0]))) out.push(`- ${field}: ${sites.join(', ')}`);
      out.push('');
    }
    if (report.allow.errors.length) {
      out.push('## Allow-list errors');
      for (const e of report.allow.errors) out.push(`- ${e}`);
      out.push('');
    }
    if (report.allow.unused.length) {
      out.push('## Allow-list entries that matched nothing (stale)');
      for (const e of report.allow.unused) out.push(`- ${mdEscape(e)}`);
      out.push('');
    }
    if (m.lexErrors && m.lexErrors.length) {
      out.push('## Files the lexer could not close (findings there may be incomplete)');
      for (const e of m.lexErrors) out.push(`- ${e}`);
      out.push('');
    }
    const nInfo = report.findings.filter((f) => !FAILING.includes(f.class)).length;
    out.push(`Result: ${report.failing.length} failing finding(s) after the allow-list${report.strict ? '' : `; ${nInfo} informational`}.`);
    return out.join('\n');
  }

  function toJson(report, meta) {
    return {
      meta: meta || {},
      counts: report.counts,
      failing: report.failing.map((f) => f.id),
      findings: report.findings.map((f) => Object.assign({}, f, { allowed: report.allow.allowed.get(f.id) || null })),
      dateGroups: report.dateGroups,
      derived: report.derived,
      runtimeReads: report.runtimeReads,
      allowlist: { entries: report.allow.entries, applied: report.allow.allowed.size, errors: report.allow.errors, unused: report.allow.unused },
    };
  }

  /** A canon home as a plain row (page-data.js) and back again. */
  function homeToRow(h) {
    return { name: h.name, value: h.text, dim: h.dim, toBase: h.toBase, sig: h.sig, path: h.path, line: h.line, exported: h.exported, source: h.source };
  }
  function homeFromRow(r) {
    const date = r.dim === 'date';
    return Object.assign({}, r, { text: r.value, value: date ? r.value : numberValue(r.value), field: String(r.name).includes('.') });
  }

  return {
    homeToRow,
    homeFromRow,
    lex,
    cook,
    classifyLiteral,
    staticText,
    claimsIn,
    looksLikeCss,
    isCssKey,
    sigFigs,
    numberValue,
    dimFromName,
    harvestTs,
    harvestJson,
    jsonObjectAfterKey,
    scanSource,
    scanHtml,
    matchClaim,
    buildReport,
    applyAllowlist,
    formatMarkdown,
    toJson,
    CLASS_ORDER,
    FAILING,
    CLASS_NOTE,
    SENTINEL,
  };
});
