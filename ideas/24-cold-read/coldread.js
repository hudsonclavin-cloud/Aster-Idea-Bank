/* coldread.js — Cold Read: read a PartForge .scad file cold, before any render, and name
   every SPEC/FLIGHT declaration problem with a line number.

   Two kinds of rule live here, and every diagnostic says which it is:
     source: 'app'       — PartForge's own code decided it. parseFlight, parseSpec, flightLint,
                           lint, flightContradictions, topLevelIsOnlyMain and mainPlainUnion run
                           VERBATIM from snapshots/app-rules.js (copied out of index.html by
                           build-data.mjs). Whether a FLIGHT or SPEC entry is dropped or demoted
                           is decided by running the app's parser on that one entry, never by a
                           second copy of its acceptance rules.
     source: 'cold-read' — this file's own text reading: line positions, the reason an entry
                           was dropped (which field), module tables, the call graph from the top
                           level, the parameter block. Where Cold Read and the app could disagree,
                           the app's verdict is reported and the disagreement is flagged (PARITY).

   It never says a part passes. Every report ends with FOOTER. Pure: no DOM, no I/O.
   Loads as a classic script (window.ColdRead, after snapshots/app-rules.js) and via require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./snapshots/app-rules.js'));
  else root.ColdRead = factory(root.PartForgeRules);
})(typeof self !== 'undefined' ? self : this, function (APP_DEFAULT) {
  'use strict';

  const FOOTER = 'text checks only; geometry not checked';
  const SEV_ORDER = { error: 0, warning: 1, info: 2 };
  const FLIGHT_CATS = ['critical', 'od', 'bores', 'holes', 'revolve', 'gauges', 'loads'];
  const TOL_CATS = new Set(['critical', 'od', 'bores', 'holes', 'revolve']);
  // OpenSCAD's own modules and statement keywords (OpenSCAD User Manual, language reference).
  // Not a PartForge number: the language itself. Used only to tell an unknown module from a builtin.
  const BUILTIN_MODULES = new Set(('cube sphere cylinder polyhedron square circle polygon text import surface ' +
    'linear_extrude rotate_extrude projection translate rotate scale resize mirror multmatrix color offset hull ' +
    'minkowski union difference intersection render children echo assert group roof fill assign').split(' '));
  const STATEMENT_WORDS = new Set(['for', 'intersection_for', 'if', 'else', 'let', 'each', 'module', 'function']);

  // ---------------------------------------------------------------- text positions
  function makeLines(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    function pos(off) {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
      return { line: lo + 1, col: off - starts[lo] + 1 };
    }
    function lineText(line) {
      if (line < 1 || line > starts.length) return '';
      const s = starts[line - 1], e = line < starts.length ? starts[line] - 1 : text.length;
      return text.slice(s, e).replace(/\r$/, '');
    }
    return { starts, pos, lineText, count: starts.length };
  }

  // Comments blanked to spaces (newlines kept, so every offset still points at the same place);
  // codeOnly also blanks string interiors. Records where the comments are.
  function scanText(code) {
    const n = code.length, a = code.split(''), b = code.split('');
    const comments = [];
    let i = 0;
    while (i < n) {
      const c = code[i], d = code[i + 1];
      if (c === '/' && d === '/') {
        const s = i;
        while (i < n && code[i] !== '\n') { a[i] = ' '; b[i] = ' '; i++; }
        comments.push([s, i]);
        continue;
      }
      if (c === '/' && d === '*') {
        const s = i, close = code.indexOf('*/', i + 2), e = close < 0 ? n : close + 2;
        for (; i < e; i++) if (code[i] !== '\n') { a[i] = ' '; b[i] = ' '; }
        comments.push([s, e]);
        continue;
      }
      if (c === '"') {
        i++;
        while (i < n && code[i] !== '"') {
          if (code[i] === '\\' && i + 1 < n) { b[i] = ' '; i++; }
          if (code[i] !== '\n') b[i] = ' ';
          i++;
        }
        i = Math.min(i + 1, n);
        continue;
      }
      i++;
    }
    const inComment = (off) => comments.some(([s, e]) => off >= s && off < e);
    return { noComments: a.join(''), codeOnly: b.join(''), comments, inComment };
  }
  // The same comment stripping the app's flightLint() does (block comments, then every // to the
  // end of the line), but blanking instead of deleting, so a match's offset is its source offset.
  function appStrip(src) {
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
  }

  // ---------------------------------------------------------------- JSON with positions
  // A strict JSON reader that keeps the offset of every value and key. JSON.parse (what the app
  // runs) stays the authority on accept/reject; this reader only says WHERE. Error offsets follow
  // V8's JSON.parse convention ("at position N") so the two can be compared in the tests.
  function parseJsonLoc(text) {
    let i = 0;
    const n = text.length, dupes = [], stack = [];
    const fail = (msg, at, extra) => { throw Object.assign(new Error(msg), { offset: at, jsonError: true }, extra || {}); };
    const ws = () => { while (i < n) { const c = text.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } };
    const describe = (at) => (at >= n ? 'the end of the block' : text[at] === '\n' ? 'a line break' : `'${text[at]}'`);
    const prevSigAt = (at) => { let k = at - 1; while (k >= 0 && /\s/.test(text[k])) k--; return k; };
    const prevSig = (at) => { const k = prevSigAt(at); return k >= 0 ? text[k] : ''; };
    const isDigit = (c) => c >= '0' && c <= '9';
    const word = (at) => { const w = /^[A-Za-z_$][\w$]*/.exec(text.slice(at, at + 40)); return w ? w[0] : null; };
    function endFail() {
      const open = stack[stack.length - 1];
      fail('the JSON ends before it is complete', n, open ? { openAt: open.at, openCh: open.ch } : {});
    }
    function badValue() {
      if (i >= n) endFail();
      const c = text[i];
      if (c === "'") fail('a single-quoted string: JSON strings take double quotes', i);
      if (c === '/') fail('a comment inside the JSON: JSON has no comments', i);
      if (c === '}' || c === ']') {
        const p = prevSig(i);
        fail(p === ',' ? `a trailing comma before '${c}': JSON does not allow one` : p === ':' ? 'a key with no value' : `unexpected '${c}'`, i, p === ',' ? { pointAt: prevSigAt(i) } : {});
      }
      const w = word(i);
      if (w) {
        // V8 reads a t/f/n as the start of true/false/null and reports the first character that
        // breaks the literal; point the person at the word, keep V8's offset for comparison
        const lit = c === 't' ? 'true' : c === 'f' ? 'false' : c === 'n' ? 'null' : '';
        let k = 0; while (k < lit.length && text[i + k] === lit[k]) k++;
        fail(`unquoted word '${w}': a JSON value is a number, a "string", true, false or null`, i + k, { pointAt: i });
      }
      fail(`unexpected ${describe(i)}`, i);
    }
    function value() {
      ws();
      const start = i, c = text[i];
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === '"') { const v = string(); return { v, loc: { start, end: i } }; }
      if (c === '-' || isDigit(c)) { const v = number(); return { v, loc: { start, end: i } }; }
      for (const [w, v] of [['true', true], ['false', false], ['null', null]])
        if (text.startsWith(w, i)) { i += w.length; return { v, loc: { start, end: i } }; }
      return badValue();
    }
    function object() {
      const start = i;
      stack.push({ ch: '{', at: i }); i++;
      const v = {}, keys = Object.create(null);
      ws();
      if (text[i] === '}') { i++; stack.pop(); return { v, loc: { start, end: i, keys } }; }
      for (;;) {
        ws();
        if (text[i] !== '"') {
          if (i >= n) endFail();
          const c = text[i], w = word(i);
          if (c === '}') fail("a trailing comma before '}': JSON does not allow one", i, { pointAt: prevSigAt(i) });
          if (c === "'") fail('a single-quoted key: JSON keys take double quotes', i);
          if (c === '/') fail('a comment inside the JSON: JSON has no comments', i);
          if (w) fail(`unquoted key '${w}': JSON keys take double quotes`, i);
          fail(`expected a "key" but found ${describe(i)}`, i);
        }
        const keyStart = i, k = string();
        ws();
        if (text[i] !== ':') { if (i >= n) endFail(); fail(`expected ':' after the key "${k}" but found ${describe(i)}`, i); }
        i++;
        const r = value();
        if (Object.prototype.hasOwnProperty.call(keys, k)) dupes.push({ key: k, first: keys[k].keyStart, second: keyStart });
        keys[k] = { keyStart, loc: r.loc };
        Object.defineProperty(v, k, { value: r.v, enumerable: true, writable: true, configurable: true });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; stack.pop(); return { v, loc: { start, end: i, keys } }; }
        if (i >= n) endFail();
        fail(text[i] === '"' ? `a missing comma: expected ',' or '}' after the value of "${k}"`
          : `expected ',' or '}' after the value of "${k}" but found ${describe(i)}`, i);
      }
    }
    function array() {
      const start = i;
      stack.push({ ch: '[', at: i }); i++;
      const v = [], items = [];
      ws();
      if (text[i] === ']') { i++; stack.pop(); return { v, loc: { start, end: i, items } }; }
      for (;;) {
        const r = value();
        v.push(r.v); items.push(r.loc);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; stack.pop(); return { v, loc: { start, end: i, items } }; }
        if (i >= n) endFail();
        fail(/["{[\d-]/.test(text[i]) ? "a missing comma: expected ',' or ']' between two array entries"
          : `expected ',' or ']' in an array but found ${describe(i)}`, i);
      }
    }
    function string() {
      i++;
      let out = '';
      for (;;) {
        if (i >= n) fail("a string is never closed (a missing '\"')", n);
        const ch = text.charCodeAt(i);
        if (ch === 34) { i++; return out; }
        if (ch === 92) {
          const e = text[i + 1];
          const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (e !== undefined && Object.prototype.hasOwnProperty.call(map, e)) { out += map[e]; i += 2; continue; }
          if (e === 'u') {
            let k = 0;
            while (k < 4 && /[0-9a-fA-F]/.test(text[i + 2 + k] || '')) k++;
            if (k === 4) { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue; }
            fail('a bad \\u escape: four hex digits are needed', i + 2 + k);
          }
          if (e === undefined) fail("a string is never closed (a missing '\"')", n);
          fail(`a bad escape '\\${e === '\n' ? 'n' : e}' inside a string`, i + 1);
        }
        if (ch < 32) fail(ch === 10 ? 'a line break inside a string: a JSON string cannot continue onto the next line'
          : 'a raw control character (a tab?) inside a string', i);
        out += text[i]; i++;
      }
    }
    function number() {
      const s = i;
      if (text[i] === '-') { i++; if (!isDigit(text[i])) fail("a '-' with no number after it", i); }
      if (text[i] === '0') i++; else while (isDigit(text[i])) i++;
      if (text[i] === '.') { i++; if (!isDigit(text[i])) fail("a number that ends in '.' with no digits after it", i); while (isDigit(text[i])) i++; }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!isDigit(text[i])) fail('a number with an exponent but no exponent digits', i);
        while (isDigit(text[i])) i++;
      }
      return Number(text.slice(s, i));
    }
    const top = value();
    ws();
    if (i < n) fail(`text after the end of the JSON value: ${describe(i)}`, i);
    return { value: top.v, loc: top.loc, dupes };
  }

  // The SPEC or FLIGHT block the way the app reads it: the app's own regex (lifted from
  // parseSpec/parseFlight), each line's comment prefix removed with the app's own regex. Keeps a
  // map from every offset in the JSON text back to the source offset.
  function extractBlock(code, re, prefixRe) {
    const rd = new RegExp(re.source, re.flags.replace(/[dg]/g, '') + 'd');
    const m = rd.exec(code);
    if (!m) return null;
    const [s, e] = m.indices[1];
    const raw = code.slice(s, e).split('\n');
    const segs = [];
    let json = '', jo = 0, so = s;
    raw.forEach((l, k) => {
      const pm = prefixRe.exec(l), pre = pm && pm.index === 0 ? pm[0].length : 0;
      const body = l.slice(pre);
      segs.push({ j: jo, s: so + pre, len: body.length });
      json += body + (k < raw.length - 1 ? '\n' : '');
      jo += body.length + 1; so += l.length + 1;
    });
    function map(off) {
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].j <= off) lo = mid; else hi = mid - 1; }
      const g = segs[lo];
      return g.s + Math.max(0, Math.min(off - g.j, g.len));
    }
    return { json, start: m.index, end: m.index + m[0].length, bodyStart: s, map };
  }

  // ---------------------------------------------------------------- OpenSCAD structure
  function tokenize(src) {
    const toks = [], n = src.length;
    let i = 0;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j), s: i, e: j }); i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
        toks.push({ t: 'num', v: m[0], s: i, e: i + m[0].length }); i += m[0].length; continue;
      }
      if (c === '"') {
        let j = i + 1; while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
        j = Math.min(j + 1, n);
        toks.push({ t: 'str', v: '', s: i, e: j }); i = j; continue;
      }
      toks.push({ t: 'p', v: c, s: i, e: i + 1 }); i++;
    }
    return toks;
  }
  function matchClose(toks, k, open, close) {
    let depth = 0;
    for (let j = k; j < toks.length; j++) {
      if (toks[j].v === open && toks[j].t === 'p') depth++;
      else if (toks[j].v === close && toks[j].t === 'p') { depth--; if (depth === 0) return j; }
    }
    return -1;
  }
  // End of one statement starting at k: a ';' at depth 0, or the '}' closing a '{' at depth 0
  // (continuing through `else`). Returns the index of that token, or -1 when the file ends first.
  function statementEnd(toks, k) {
    let paren = 0, bracket = 0;
    for (let j = k; j < toks.length; j++) {
      const t = toks[j];
      if (t.t !== 'p') continue;
      if (t.v === '(') paren++; else if (t.v === ')') paren--;
      else if (t.v === '[') bracket++; else if (t.v === ']') bracket--;
      else if (paren === 0 && bracket === 0) {
        if (t.v === ';') return j;
        if (t.v === '{') {
          const close = matchClose(toks, j, '{', '}');
          if (close < 0) return -1;
          if (toks[close + 1] && toks[close + 1].v === 'else') { j = close; continue; }
          return close;
        }
      }
    }
    return -1;
  }
  const MOD_RANK = { '*': 4, '%': 3, '!': 2, '#': 1 };
  const stronger = (a, b) => ((MOD_RANK[a] || 0) >= (MOD_RANK[b] || 0) ? a : b) || null;
  const renders = (mod) => mod !== '*' && mod !== '%';
  // Module instantiations in token range [from, to): an identifier followed by '(' in statement
  // position (not inside ( ) or [ ], not in the value of an assignment). A modifier (* % ! #)
  // applies to that instantiation and to everything it carries.
  function callsIn(toks, from, to) {
    const calls = [];
    let paren = 0, bracket = 0, expr = false, chainMod = null;
    const modStack = [null];
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (t.t === 'p') {
        if (t.v === '(') paren++; else if (t.v === ')') paren--;
        else if (t.v === '[') bracket++; else if (t.v === ']') bracket--;
        else if (paren === 0 && bracket === 0) {
          if (t.v === '=') expr = true;
          else if (t.v === ';') { expr = false; chainMod = null; }
          else if (t.v === '{') { modStack.push(stronger(chainMod, modStack[modStack.length - 1])); chainMod = null; expr = false; }
          else if (t.v === '}') { if (modStack.length > 1) modStack.pop(); chainMod = null; expr = false; }
        }
        continue;
      }
      if (t.t !== 'id' || paren !== 0 || bracket !== 0 || expr) continue;
      const next = toks[k + 1];
      if (!next || next.v !== '(') continue;
      const prev = toks[k - 1];
      if (prev && prev.t === 'id' && (prev.v === 'module' || prev.v === 'function')) continue;
      if (STATEMENT_WORDS.has(t.v)) continue;
      let mod = null, j = k - 1;
      while (j >= from && toks[j].t === 'p' && '*%!#'.includes(toks[j].v)) { mod = stronger(mod, toks[j].v); j--; }
      if (mod) chainMod = stronger(chainMod, mod);
      calls.push({ name: t.v, s: t.s, mod: stronger(chainMod, modStack[modStack.length - 1]) });
    }
    return calls;
  }
  function parseStructure(src) {
    const toks = tokenize(src);
    const modules = [], functions = [], assigns = [], tops = [], includes = [];
    let k = 0, broken = null;
    while (k < toks.length) {
      const t = toks[k], next = toks[k + 1];
      if (t.t === 'id' && (t.v === 'include' || t.v === 'use') && next && next.v === '<') {
        let j = k + 1; while (j < toks.length && toks[j].v !== '>') j++;
        includes.push({ kind: t.v, s: t.s }); k = j + 1; continue;
      }
      if (t.t === 'id' && t.v === 'module' && next && next.t === 'id' && toks[k + 2] && toks[k + 2].v === '(') {
        const pc = matchClose(toks, k + 2, '(', ')');
        if (pc < 0) { broken = { s: t.s, what: 'parenthesis' }; break; }
        let paramsHaveParen = false;
        for (let j = k + 3; j < pc; j++) if (toks[j].v === '(' || toks[j].v === ')') paramsHaveParen = true;
        const b = pc + 1;
        if (toks[b] && toks[b].v === '{') {
          const close = matchClose(toks, b, '{', '}');
          if (close < 0) { broken = { s: toks[b].s, what: 'brace' }; break; }
          modules.push({ name: next.v, s: t.s, nameS: next.s, from: b + 1, to: close, braced: true, paramsHaveParen });
          k = close + 1;
        } else {
          const end = statementEnd(toks, b);
          if (end < 0) { broken = { s: t.s, what: 'statement' }; break; }
          modules.push({ name: next.v, s: t.s, nameS: next.s, from: b, to: end + 1, braced: false, paramsHaveParen });
          k = end + 1;
        }
        continue;
      }
      if (t.t === 'id' && t.v === 'function' && next && next.t === 'id') {
        const end = statementEnd(toks, k);
        if (end < 0) { broken = { s: t.s, what: 'statement' }; break; }
        functions.push({ name: next.v, s: t.s }); k = end + 1; continue;
      }
      if (t.t === 'id' && next && next.v === '=' && !(toks[k + 2] && toks[k + 2].v === '=')) {
        const end = statementEnd(toks, k);
        if (end < 0) { broken = { s: t.s, what: 'statement' }; break; }
        const val = toks.slice(k + 2, end);
        const literal = val.length === 1 && val[0].t === 'num' ? Number(val[0].v)
          : val.length === 2 && val[0].v === '-' && val[1].t === 'num' ? -Number(val[1].v) : null;
        assigns.push({ name: t.v, s: t.s, e: toks[end].e, literal });
        k = end + 1; continue;
      }
      if (t.t === 'p' && t.v === ';') { k++; continue; }
      const end = statementEnd(toks, k);
      if (end < 0) { broken = { s: t.s, what: 'statement' }; break; }
      tops.push({ from: k, to: end + 1, s: t.s, e: toks[end].e });
      k = end + 1;
    }
    return { toks, modules, functions, assigns, tops, includes, broken };
  }

  // ---------------------------------------------------------------- small helpers
  const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : v === undefined ? 'absent' : JSON.stringify(v));
  const alts = (re) => { const m = /^\^\(([^()]*)\)\$$/.exec(re.source); return m ? m[1].split('|') : [re.source]; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const f3 = (v) => (+v).toFixed(3);

  // ---------------------------------------------------------------- the linter
  function lint(code, opts) {
    opts = opts || {};
    const APP = opts.rules || APP_DEFAULT;
    if (!APP || typeof APP.parseFlight !== 'function') throw new Error('Cold Read needs the PartForge rules (snapshots/app-rules.js)');
    if (typeof code !== 'string') throw new TypeError('lint(code): code must be a string');
    const V = APP.VOCAB;
    const L = makeLines(code);
    const scan = scanText(code);
    const diags = [];
    const grade = opts.grade === 'flight' || opts.grade === 'hobby' ? opts.grade : (code.includes('FLIGHT-BEGIN') ? 'flight' : 'hobby');
    const mdStr = (v) => (typeof v === 'string' ? APP.mdSafe(v) : '');
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d);
    const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && isFinite(x));

    function add(severity, rule, off, message, extra) {
      const at = off == null || off < 0 ? null : L.pos(Math.min(off, code.length));
      const d = Object.assign({ severity, code: rule, line: at ? at.line : 0, col: at ? at.col : 0, message,
        quote: at ? L.lineText(at.line).trim().slice(0, 160) : '', source: 'cold-read' }, extra || {});
      diags.push(d);
      return d;
    }
    const lineOffset = (line) => (line >= 1 && line <= L.count ? L.starts[line - 1] : 0);

    // ---- structure first: modules, calls, top level
    const st = parseStructure(scan.codeOnly);
    const realModules = new Map();
    for (const m of st.modules) {
      if (realModules.has(m.name)) {
        add('warning', 'DUP_MODULE', m.nameS, `module ${m.name}() is defined twice (also at line ${L.pos(realModules.get(m.name).nameS).line}); OpenSCAD keeps one definition [Likely: the later one], so the other is dead text`);
      }
      realModules.set(m.name, m);
    }
    const appDefined = APP.appDefinedModules(code);
    for (const name of appDefined) {
      if (!realModules.has(name)) {
        // only when every "module name(" the gate's regex sees lies in a comment or a string
        const hits = [...code.matchAll(new RegExp('^\\s*module\\s+' + name + '\\s*\\(', 'gm'))].map((h) => h.index + h[0].indexOf('module'));
        if (!hits.length || hits.some((o) => scan.codeOnly.startsWith('module', o))) continue;
        const m = { index: hits[0], 0: 'module ' };
        add('warning', 'COMMENTED_MODULE', m.index,
          `"module ${name}(" appears only inside a comment or string. The gate's module table is a regex over the raw text (index.html:3226), so it counts ${name}() as defined; OpenSCAD does not, and a probe of ${name}() renders nothing`);
      }
    }
    if (st.broken) {
      add('error', 'BRACES', st.broken.s, `an unclosed ${st.broken.what === 'brace' ? "'{'" : st.broken.what === 'parenthesis' ? "'('" : 'statement (no closing \';\' or \'}\')'} from here to the end of the file: OpenSCAD will not compile it [Likely]; module and call checks below stop at this point`);
    }
    const modCalls = new Map();
    for (const [name, m] of realModules) modCalls.set(name, callsIn(st.toks, m.from, m.to));
    const topCalls = [];
    for (const t of st.tops) topCalls.push(...callsIn(st.toks, t.from, t.to));
    const userFunctions = new Set(st.functions.map((f) => f.name));
    // modules defined inside other modules (OpenSCAD allows it): known names, not unknown calls
    const nestedModules = new Set();
    st.toks.forEach((t, k) => { if (t.v === 'module' && st.toks[k + 1] && st.toks[k + 1].t === 'id') nestedModules.add(st.toks[k + 1].v); });
    for (const inc of st.includes)
      add('warning', 'INCLUDE', inc.s, `${inc.kind} <…>: the browser engine has no file system (the app's own lint says external files are unavailable, index.html:5920) [Likely], and Cold Read cannot see modules defined there`);
    const unknownSeverity = st.includes.length ? 'warning' : 'error';
    for (const [where, calls] of [['the top level', topCalls], ...[...modCalls].map(([n, c]) => [`module ${n}()`, c])]) {
      for (const c of calls) {
        if (realModules.has(c.name) || BUILTIN_MODULES.has(c.name) || nestedModules.has(c.name)) continue;
        add(unknownSeverity, 'UNKNOWN_MODULE', c.s, userFunctions.has(c.name)
          ? `${c.name}() is called as a module in ${where}, but ${c.name} is a function: OpenSCAD draws nothing for it [Likely]`
          : `${where} calls ${c.name}(), which is neither a module in this file nor an OpenSCAD built-in: OpenSCAD skips an unknown module with a warning and draws nothing for it [Likely]`);
      }
    }
    // reachability from what the top level renders
    function reach(includeHidden) {
      const seen = new Map();   // name -> first caller description
      const queue = [];
      for (const c of topCalls) if ((includeHidden || renders(c.mod)) && realModules.has(c.name) && !seen.has(c.name)) { seen.set(c.name, 'the top level'); queue.push(c.name); }
      while (queue.length) {
        const n = queue.shift();
        for (const c of modCalls.get(n) || [])
          if ((includeHidden || renders(c.mod)) && realModules.has(c.name) && !seen.has(c.name)) { seen.set(c.name, n + '()'); queue.push(c.name); }
      }
      return seen;
    }
    const reached = reach(false), reachedAny = reach(true);
    const rootMods = [...topCalls, ...[...modCalls].filter(([n]) => reached.has(n)).flatMap(([, c]) => c)].filter((c) => c.mod === '!');
    for (const c of rootMods)
      add('warning', 'ROOT_MODIFIER', c.s, `a '!' modifier on ${c.name}(): OpenSCAD then renders only that subtree and drops everything else in the file [Likely]`);
    const rootDesc = topCalls.filter((c) => renders(c.mod)).map((c) => c.name + '()');

    // ---- assembly files carry their own manifest contract; the gate skips SPEC checks for them
    const manifest = APP.parseManifest(code);
    if (manifest) add('info', 'ASSEMBLY', code.search(/^\/\/\s*MODULE:/m), `an assembly (// MODULE: ${manifest.mods.join(', ')}): the gate applies the manifest contract and skips SPEC part checks (index.html:3209)`, { source: 'app' });

    // ---- SPEC
    const specPresent = code.includes('SPEC-BEGIN');
    const spec = { present: specPresent, state: 'absent', parts: [] };
    const appSpec = APP.parseSpec(code);
    const specBlock = extractBlock(code, V.SPEC_BLOCK_RE, V.LINE_PREFIX_RE);
    let specParts = [];
    if (specPresent && !specBlock) {
      spec.state = 'unclosed';
      add('error', 'SPEC_UNCLOSED', code.indexOf('SPEC-BEGIN'), 'SPEC-BEGIN with no "// SPEC-END" line after it: parseSpec sees no block at all, and the gate then reports "SPEC block present but its JSON did not parse" (index.html:3221), which is not what is wrong', { source: 'app' });
    } else if (specBlock) {
      spec.state = analyseJsonBlock('SPEC', specBlock, (doc) => analyseSpec(doc));
    } else if (!manifest) {
      add('info', 'NO_SPEC', null, 'no SPEC block: the gate skips every part, joint, rule, layout and profile check for this file (index.html:3221)', { source: 'app' });
    }
    if (specBlock && !!appSpec !== (spec.state === 'parsed'))
      add('error', 'PARITY', specBlock ? specBlock.start : null, `Cold Read and the app's parseSpec disagree about whether this SPEC block is usable (app: ${appSpec ? 'usable' : 'null'}); trust the app`, { source: 'app' });

    function analyseJsonBlock(which, blk, analyse) {
      let doc = null, loc = null, myErr = null, appErr = null;
      try { JSON.parse(blk.json); } catch (e) { appErr = e; }
      try { const r = parseJsonLoc(blk.json); doc = r; loc = r.loc; } catch (e) { myErr = e; }
      if (appErr) {
        const at = myErr ? blk.map(myErr.pointAt != null ? myErr.pointAt : myErr.offset) : blk.bodyStart;
        let msg = `the ${which} JSON does not parse${myErr ? ': ' + myErr.message : ''}`;
        if (myErr && myErr.openAt != null) msg += ` (the '${myErr.openCh}' opened at line ${L.pos(blk.map(myErr.openAt)).line} is never closed)`;
        msg += which === 'FLIGHT'
          ? '. parseFlight returns {malformed:true}, the gate fails the file with "FLIGHT JSON did not parse" and measures nothing (index.html:5576)'
          : '. parseSpec returns null and the gate skips every SPEC check (index.html:3221; on a retry it is a failure)';
        add('error', which + '_JSON', at, msg, { source: 'app', located: !!myErr });
        if (!myErr) add('error', 'PARITY', blk.bodyStart, `JSON.parse rejects this ${which} block but Cold Read's position-keeping reader accepts it, so the position above is only the block start`);
        return 'malformed';
      }
      if (myErr) {
        add('error', 'PARITY', blk.bodyStart, `JSON.parse accepts this ${which} block but Cold Read's reader does not (${myErr.message}); positions in this block are approximate`);
        return analyse({ value: JSON.parse(blk.json), loc: null, dupes: [], blk });
      }
      for (const d of doc.dupes) {
        const isCat = which === 'FLIGHT' ? FLIGHT_CATS.includes(d.key) : ['parts', 'joints', 'proportions', 'layout', 'profile'].includes(d.key);
        add(isCat ? 'error' : 'warning', 'DUP_KEY', blk.map(d.second), `the key "${d.key}" appears twice in one ${which} object (first at line ${L.pos(blk.map(d.first)).line}); JSON.parse keeps only the last, so the first "${d.key}" is discarded without a word`, { source: 'app' });
      }
      return analyse({ value: doc.value, loc, dupes: doc.dupes, blk });
    }
    // Offset (source) of a JSON location; falls back to the block start.
    function locOf(doc, l) { return l ? doc.blk.map(l.start) : doc.blk.bodyStart; }
    function keyOf(doc, objLoc, key) { return objLoc && objLoc.keys && objLoc.keys[key] ? doc.blk.map(objLoc.keys[key].keyStart) : locOf(doc, objLoc); }
    function itemLoc(doc, key, idx) {
      const k = doc.loc && doc.loc.keys && doc.loc.keys[key];
      return k && k.loc.items ? k.loc.items[idx] : null;
    }

    function analyseSpec(doc) {
      const s = doc.value;
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        add('error', 'SPEC_SHAPE', locOf(doc, doc.loc), 'the SPEC block is not a JSON object, so parseSpec returns null and every SPEC check is skipped', { source: 'app' });
        return 'shape';
      }
      if (!Array.isArray(s.parts)) {
        add('error', 'SPEC_SHAPE', s.parts === undefined ? locOf(doc, doc.loc) : keyOf(doc, doc.loc, 'parts'), `the SPEC has ${s.parts === undefined ? 'no "parts"' : '"parts" that is not an array'}: parseSpec returns null and every SPEC check is skipped`, { source: 'app' });
        return 'shape';
      }
      // Per-entry verdicts from the app's own parseSpec, one entry at a time.
      const verdict = (cat, entry) => {
        const base = cat === 'parts' ? { parts: [entry] } : { parts: [{ name: 'p' }], [cat]: [entry] };
        const r = APP.parseSpec('// SPEC-BEGIN\n// ' + JSON.stringify(base) + '\n// SPEC-END\n');
        if (cat === 'parts') return r ? 1 : 0;
        if (!r) return null;
        if (cat === 'proportions') return typeof entry === 'string' ? r.proportions.length : r.rules.length;
        return r[cat].length;
      };
      const specReason = (cat, e) => {
        if (cat === 'parts') {
          if (!e || typeof e !== 'object') return `entry ${show(e)} is not an object`;
          return e.name === undefined ? 'it has no "name"' : `its name ${show(e.name)} is not a string`;
        }
        if (cat === 'joints') return !e || typeof e !== 'object' ? `entry ${show(e)} is not an object` : `a joint needs both "a" and "b" (a: ${show(e.a)}, b: ${show(e.b)})`;
        if (cat === 'proportions') {
          if (!e || typeof e !== 'object') return `entry ${show(e)} is neither a rule object nor a note string`;
          if (!e.a || !e.b) return `a rule needs "a" and "b" (a: ${show(e.a)}, b: ${show(e.b)})`;
          if (!isFinite(e.min) || !isFinite(e.max)) return `min ${show(e.min)} / max ${show(e.max)} are not both numbers`;
          return `min ${show(e.min)} is greater than max ${show(e.max)}`;
        }
        if (cat === 'layout') {
          if (!e || typeof e !== 'object') return `entry ${show(e)} is not an object`;
          if (!e.a || !e.b) return `a relation needs "a" and "b" (a: ${show(e.a)}, b: ${show(e.b)})`;
          return `rel ${show(e.rel)} is not one of ${alts(V.SPEC_REL).join(', ')}`;
        }
        if (cat === 'profile') {
          if (!e || typeof e !== 'object') return `entry ${show(e)} is not an object`;
          if (!e.part) return 'it has no "part"';
          if (!V.SPEC_AXIS.test(String(e.along || '')) || !V.SPEC_AXIS.test(String(e.measure || ''))) return `along ${show(e.along)} and measure ${show(e.measure)} must each be x, y or z`;
          if (String(e.along) === String(e.measure)) return `along and measure are both ${show(e.along)}`;
          return `from_mm ${show(e.from_mm)} / to_mm ${show(e.to_mm)} must be numbers ≥ 0`;
        }
        return 'it does not match what parseSpec keeps';
      };
      const capOf = { proportions: V.SPEC_CAPS.rules, layout: V.SPEC_CAPS.layout, profile: V.SPEC_CAPS.profile };
      const names = [];
      for (const cat of ['parts', 'joints', 'proportions', 'layout', 'profile']) {
        const list = s[cat];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          if (cat !== 'parts') add('warning', 'SPEC_DROP', keyOf(doc, doc.loc, cat), `"${cat}" is not an array, so parseSpec reads no ${cat} at all`, { source: 'app' });
          continue;
        }
        let kept = 0, keptNotes = 0;
        list.forEach((e, idx) => {
          const at = locOf(doc, itemLoc(doc, cat, idx));
          const v = verdict(cat, e);
          if (!v) {
            const sev = cat === 'parts' || cat === 'joints' ? 'error' : 'warning';
            const label = cat === 'parts' ? 'part' : cat === 'joints' ? 'joint' : cat === 'proportions' ? 'proportion rule' : cat === 'layout' ? 'layout relation' : 'profile';
            add(sev, 'SPEC_DROP', at, `SPEC ${label} #${idx + 1} is dropped by parseSpec without a word: ${specReason(cat, e)}`, { source: 'app', category: cat, index: idx });
            return;
          }
          if (cat === 'proportions' && typeof e === 'string') { keptNotes++; if (keptNotes > V.SPEC_CAPS.proportions) add('info', 'SPEC_CAP', at, `proportion note #${idx + 1} is past the first ${V.SPEC_CAPS.proportions} notes parseSpec keeps`, { source: 'app' }); return; }
          kept++;
          if (capOf[cat] && kept > capOf[cat]) add('warning', 'SPEC_CAP', at, `${cat === 'proportions' ? 'rule' : cat} #${idx + 1} is past the first ${capOf[cat]} that parseSpec keeps, so it is never checked`, { source: 'app' });
          if (cat === 'parts') names.push({ name: e.name.trim(), e, at, idx });
        });
      }
      // parts that survive: sizes, duplicates, modules
      const seen = new Map();
      for (const p of names) {
        if (seen.has(p.name)) add('warning', 'SPEC_DUP', p.at, `SPEC part "${p.name}" is declared twice (also part #${seen.get(p.name) + 1}); the gate probes ${p.name}() twice and keeps both rows`);
        else seen.set(p.name, p.idx);
        const sz = p.e.size_mm;
        const sizeAt = keyOf(doc, itemLoc(doc, 'parts', p.idx), 'size_mm');
        if (sz === undefined) add('info', 'SPEC_SIZE', p.at, `SPEC part "${p.name}" has no size_mm, so the gate skips its size check and flightContradictions cannot compare critical dimensions against it`, { source: 'app' });
        else if (!Array.isArray(sz) || sz.length !== 3) add('warning', 'SPEC_SIZE', sizeAt, `size_mm of "${p.name}" is ${show(sz)}, not three numbers: parseSpec stores null and the size check is skipped`, { source: 'app' });
        else if (!sz.every((v) => Number(v) > 0)) add('warning', 'SPEC_SIZE', sizeAt, `size_mm of "${p.name}" is ${show(sz)}: not every value is a positive number, so the gate skips the size check (index.html:3279)`, { source: 'app' });
      }
      specParts = names.map((p) => p.name);
      spec.parts = specParts;
      if (appSpec === null) {
        add('error', 'SPEC_SHAPE', keyOf(doc, doc.loc, 'parts'), 'no SPEC part survives parseSpec (each needs a string "name"), so parseSpec returns null and every SPEC check is skipped', { source: 'app' });
        return 'empty';
      }
      // names the rules, layout and profile refer to
      const partSet = new Set(specParts);
      const refCheck = (cat, fields, what) => {
        (Array.isArray(s[cat]) ? s[cat] : []).forEach((e, idx) => {
          if (!e || typeof e !== 'object') return;
          for (const f of fields) {
            const v = e[f];
            if (v == null || v === '') continue;
            const name = String(v).trim();
            if (partSet.has(name)) continue;
            if (cat === 'joints') {
              if (!appDefined.has(name))
                add('error', 'JOINT_MODULE', keyOf(doc, itemLoc(doc, cat, idx), f), `joint ${show(e.a)}–${show(e.b)} names "${name}", which is neither a SPEC part nor a module in this file. The gate marks the joint "missing module" and moves on without a failure (index.html:3255), so this joint is never checked`, { source: 'app' });
            } else {
              add('warning', 'SPEC_REF', keyOf(doc, itemLoc(doc, cat, idx), f), `${what} #${idx + 1} names "${name}", which is not a SPEC part: the gate notes "unmeasured part" and checks nothing for it (index.html:3333/3354/3384)`, { source: 'app' });
            }
          }
        });
      };
      refCheck('joints', ['a', 'b'], 'joint');
      refCheck('proportions', ['a', 'b'], 'proportion rule');
      refCheck('layout', ['a', 'b'], 'layout relation');
      refCheck('profile', ['part'], 'profile');
      // every SPEC part needs its module
      for (const p of names) {
        if (!appDefined.has(p.name))
          add('error', 'MODULE_MISSING', p.at, `the SPEC declares a part "${p.name}" but there is no module ${p.name}() in the code. The gate fails this after the render (index.html:3245)`, { source: 'app' });
      }
      return 'parsed';
    }

    // ---- FLIGHT
    const flightPresent = code.includes('FLIGHT-BEGIN');
    const flight = { present: flightPresent, state: 'absent', counts: {}, named: { dropped: 0, demoted: 0, uncounted: 0, capped: 0 }, app: null };
    const appF = APP.parseFlight(code);
    const flightBlock = extractBlock(code, V.FLIGHT_BLOCK_RE, V.LINE_PREFIX_RE);
    const critLocs = [];
    const gaugeModules = new Set();
    if (flightPresent && !flightBlock) {
      flight.state = 'unclosed';
      add('error', 'FLIGHT_UNCLOSED', code.indexOf('FLIGHT-BEGIN'), `FLIGHT-BEGIN with no "// FLIGHT-END" line after it: parseFlight sees no block at all${grade === 'flight' ? ', and in flight grade the gate fails the file for having no FLIGHT block (index.html:5571)' : ''}`, { source: 'app' });
    } else if (!flightPresent && grade === 'flight') {
      add('error', 'FLIGHT_MISSING', null, 'flight grade requires a FLIGHT block (// FLIGHT-BEGIN … // FLIGHT-END) and this file has none; the gate fails it (index.html:5571)', { source: 'app' });
    } else if (flightBlock) {
      flight.state = analyseJsonBlock('FLIGHT', flightBlock, (doc) => analyseFlight(doc));
    }
    const appFState = appF === null ? 'none' : appF.malformed ? 'bad' : 'ok';
    const myFState = !flightBlock ? 'none' : flight.state === 'malformed' || flight.state === 'shape' ? 'bad' : 'ok';
    if (appFState !== myFState)
      add('error', 'PARITY', flightBlock ? flightBlock.start : null, `Cold Read and the app's parseFlight disagree about this FLIGHT block (app: ${appF === null ? 'no block' : appF.malformed ? 'malformed' : 'parsed'}, Cold Read: ${flight.state}); trust the app`, { source: 'app' });
    flight.app = appF && !appF.malformed ? { dropped: appF.dropped, demoted: appF.demoted, declared: appF.declared, counts: APP.flightCounts(appF) } : null;

    function analyseFlight(doc) {
      const f = doc.value;
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        add('error', 'FLIGHT_SHAPE', locOf(doc, doc.loc), 'the FLIGHT block parses but is not a JSON object: parseFlight returns {malformed:true} and the gate measures nothing (index.html:5576)', { source: 'app' });
        return 'shape';
      }
      // top-level keys parseFlight reads: f.<key> and arr('<key>') in its own source
      const src = String(APP.parseFlight);
      const known = new Set([...src.matchAll(/\bf\.([a-z_]+)\b/g)].map((m) => m[1]).concat([...src.matchAll(/arr\('([a-z_]+)'\)/g)].map((m) => m[1])));
      for (const k of Object.keys(f)) if (!known.has(k))
        add('warning', 'FLIGHT_KEY', keyOf(doc, doc.loc, k), `parseFlight never reads the key "${k}"${closest(k, known) ? ` (did you mean "${closest(k, known)}"?)` : ''}; everything under it is ignored`, { source: 'app' });
      if (f.hazard !== undefined && !APP.FLIGHT_HAZARD.test(mdStr(f.hazard)))
        add('error', 'HAZARD', keyOf(doc, doc.loc, 'hazard'), `hazard ${show(f.hazard)} is not one of ${alts(APP.FLIGHT_HAZARD).join(', ')}: parseFlight reads it as "none", so the part gets no tier escalation from it and may be issued a tier-A manufacturing sheet (partTier, index.html:4779)`, { source: 'app' });
      if (f.tier !== undefined && !V.TIER.test(mdStr(f.tier).toUpperCase()))
        add('warning', 'VOCAB', keyOf(doc, doc.loc, 'tier'), `tier ${show(f.tier)} is not A, B or C: parseFlight ignores it`, { source: 'app' });
      if (!(num(f.tess_tol_mm, 0) > 0))
        add('info', 'TESS_UNDECLARED', f.tess_tol_mm === undefined ? locOf(doc, doc.loc) : keyOf(doc, doc.loc, 'tess_tol_mm'), `tess_tol_mm is ${show(f.tess_tol_mm)}: the CMM's tessellation allowance falls back to the Settings value (index.html:5583)`, { source: 'app' });

      const named = flight.named;
      for (const cat of FLIGHT_CATS) {
        const raw = f[cat];
        flight.counts[cat] = { written: Array.isArray(raw) ? raw.length : 0, kept: 0, dropped: 0, demoted: 0, uncounted: 0, capped: 0 };
        if (raw === undefined) continue;
        const C = flight.counts[cat];
        if (!Array.isArray(raw)) {
          add('error', 'FLIGHT_NOT_ARRAY', keyOf(doc, doc.loc, cat), `"${cat}" is ${Array.isArray(raw) ? 'an array' : raw === null ? 'null' : 'a ' + typeof raw}, not an array: parseFlight reads it as empty and counts nothing as dropped`, { source: 'app' });
          C.uncounted = 1; named.uncounted++;
          continue;
        }
        let objects = 0;
        const names = new Map();
        raw.forEach((e, idx) => {
          const at = locOf(doc, itemLoc(doc, cat, idx));
          if (!(e && typeof e === 'object')) {
            add('error', 'FLIGHT_UNCOUNTED', at, `${cat} #${idx + 1} is ${show(e)}, not an object: parseFlight filters it out before counting, so not even the "dropped" count mentions it`, { source: 'app', category: cat, index: idx });
            C.uncounted++; named.uncounted++;
            return;
          }
          objects++;
          if (objects > APP.FLIGHT_CAP) {
            C.capped++; named.capped++;
            if (objects === APP.FLIGHT_CAP + 1)
              add('error', 'FLIGHT_CAP', at, `${cat} has ${raw.filter((x) => x && typeof x === 'object').length} entries; parseFlight reads only the first FLIGHT_CAP = ${APP.FLIGHT_CAP} and never counts the rest, so ${cat} #${idx + 1} onward is silently unmeasured`, { source: 'app', category: cat, index: idx });
            return;
          }
          // the app's verdict for this one entry
          const one = APP.parseFlight('// FLIGHT-BEGIN\n// ' + JSON.stringify({ [cat]: [e] }) + '\n// FLIGHT-END\n');
          const reason = dropReason(cat, e);
          const demo = demoteReason(cat, e);
          const eLoc = itemLoc(doc, cat, idx);
          const nm = typeof e.name === 'string' && e.name ? ` "${APP.mdSafe(e.name).slice(0, 60)}"` : '';
          if (one.dropped) {
            C.dropped++; named.dropped++;
            add('error', 'FLIGHT_DROP', reason ? keyOf(doc, eLoc, reason.field) : at,
              `${cat} #${idx + 1}${nm} is dropped by parseFlight: ${reason ? reason.why : 'Cold Read could not name the field'}. The gate reports only a count ("N FLIGHT entries were ignored", index.html:5586), and this entry is never measured or checked`,
              { source: 'app', category: cat, index: idx, field: reason ? reason.field : null, reasonFound: !!reason });
            if (!reason) add('error', 'PARITY', at, `parseFlight drops ${cat} #${idx + 1} but Cold Read's field check finds nothing wrong with it`);
          } else if (reason) {
            add('error', 'PARITY', at, `Cold Read thinks ${cat} #${idx + 1} should be dropped (${reason.why}) but parseFlight keeps it; trust the app`);
          }
          if (one.demoted) {
            C.demoted++; named.demoted++;
            add('warning', 'FLIGHT_DEMOTE', demo ? keyOf(doc, eLoc, demo.field) : at,
              `${cat} #${idx + 1}${nm} claims a cited ${cat === 'loads' ? 'input' : 'tolerance'} but ${demo ? demo.why : 'Cold Read could not say why'}: parseFlight counts it as a tool default${one.dropped ? ' (and counts the demotion even though the entry itself is dropped)' : ''} (index.html:${cat === 'loads' ? 4740 : 4690})`,
              { source: 'app', category: cat, index: idx, field: demo ? demo.field : null });
            if (!demo) add('error', 'PARITY', at, `parseFlight demotes ${cat} #${idx + 1} but Cold Read's provenance check finds nothing wrong`);
          } else if (demo) {
            add('error', 'PARITY', at, `Cold Read thinks ${cat} #${idx + 1} should be demoted (${demo.why}) but parseFlight does not; trust the app`);
          }
          if (one.dropped) return;
          C.kept++;
          // words parseFlight reads as something else
          vocab(cat, e, eLoc, doc, idx, nm);
          const key = typeof e.name === 'string' ? APP.mdSafe(e.name).slice(0, 60) : '';
          if (key) {
            if (names.has(key)) add('warning', 'DUP_NAME', at, `two ${cat} entries are named "${key}" (#${names.get(key) + 1} and #${idx + 1}): the sheet and the gate's messages cannot tell them apart`, { category: cat, index: idx });
            else names.set(key, idx);
          }
          if (cat === 'critical') {
            const out = one.critical[0];
            critLocs.push({ name: out.name, module: out.module, axis: out.axis, at, e, eLoc, doc });
            if (out.module !== 'main' && !appDefined.has(out.module))
              add('error', 'MODULE_MISSING', keyOf(doc, eLoc, 'module'), `critical dimension${nm} names module ${out.module}(), which does not exist; the gate fails it after the render (index.html:5634)`, { source: 'app', category: cat, index: idx });
          }
          if (cat === 'gauges') {
            const mod = one.gauges[0].module;
            if (!appDefined.has(mod))
              add('error', 'MODULE_MISSING', keyOf(doc, eLoc, 'module'), `gauge${nm} names module ${mod}(), which does not exist; the gate fails it after the render (index.html:5711)`, { source: 'app', category: cat, index: idx });
            gaugeModules.add(mod);
          }
        });
      }
      return 'parsed';
    }
    function closest(k, set) {
      let best = null, bd = 3;
      for (const c of set) { const d = editDistance(k, c); if (d < bd) { bd = d; best = c; } }
      return best;
    }
    // Which field makes parseFlight drop an entry, checked in the order parseFlight checks them.
    // The verdict itself is the app's (above); this only names the field.
    function dropReason(cat, e) {
      const ax = () => (APP.FLIGHT_AXIS.test(mdStr(e.axis)) ? null : { field: 'axis', why: e.axis === undefined ? 'it has no axis' : `axis ${show(e.axis)} is not x, y or z` });
      const pos = (k) => (num(e[k], 0) > 0 ? null : { field: k, why: e[k] === undefined ? `it has no ${k}` : `${k} ${show(e[k])} is not a positive number` });
      const fin = (k) => (isFinite(num(e[k], NaN)) ? null : { field: k, why: e[k] === undefined ? `it has no ${k}` : `${k} ${show(e[k])} is not a number` });
      const round = () => ax() || pos('d_mm') || pos('tol_mm') || fin('from_mm') || fin('to_mm')
        || (num(e.from_mm, NaN) === num(e.to_mm, NaN) ? { field: 'to_mm', why: `from_mm and to_mm are both ${num(e.from_mm)}: a zero-length range` } : null);
      switch (cat) {
        case 'critical': return ax() || pos('nominal_mm') || pos('tol_mm');
        case 'od': case 'bores': return round();
        case 'holes': {
          const r = round(); if (r) return r;
          const pattern = V.HOLE_PATTERN.test(mdStr(e.pattern)) ? mdStr(e.pattern) : (Array.isArray(e.at_mm) ? (pair(e.at_mm) ? 'single' : 'list') : null);
          if (!pattern) return { field: e.pattern === undefined ? 'at_mm' : 'pattern', why: `${e.pattern === undefined ? 'it has no pattern' : `pattern ${show(e.pattern)} is not ${alts(V.HOLE_PATTERN).join(', ')}`} and no at_mm list to infer one from` };
          if (pattern === 'circle') {
            const n = Math.round(num(e.n, 0));
            if (!(n >= V.HOLE_N_MIN && n <= V.HOLE_N_MAX)) return { field: e.n === undefined ? 'pattern' : 'n', why: e.n === undefined ? `a circle pattern with no n (n must be ${V.HOLE_N_MIN}..${V.HOLE_N_MAX})` : `n ${show(e.n)} is outside ${V.HOLE_N_MIN}..${V.HOLE_N_MAX}` };
            if (!(num(e.bc_d_mm, 0) > 0)) return { field: e.bc_d_mm === undefined ? 'pattern' : 'bc_d_mm', why: e.bc_d_mm === undefined ? 'a circle pattern with no bc_d_mm' : `bc_d_mm ${show(e.bc_d_mm)} is not a positive number` };
            return null;
          }
          const list = pattern === 'single' ? [e.at_mm] : (Array.isArray(e.at_mm) ? e.at_mm : []);
          if (!list.some(pair)) return { field: 'at_mm', why: `pattern "${pattern}" but at_mm ${show(e.at_mm)} holds no [u, v] pair of numbers` };
          return null;
        }
        case 'revolve':
          if (!V.REVOLVE_TYPES.test(mdStr(e.type))) return { field: 'type', why: `type ${show(e.type)} is not one of ${alts(V.REVOLVE_TYPES).join(', ')}` };
          return pos('L_mm') || pos('R_mm') || fin('tip_at_mm');
        case 'gauges':
          return V.GAUGE_MODULE.test(mdStr(e.module)) ? null : { field: 'module', why: e.module === undefined ? 'it names no module' : `module ${show(e.module)} is not an identifier` };
        case 'loads':
          return V.LOAD_CHECKS.test(mdStr(e.check)) ? null : { field: 'check', why: `check ${show(e.check)} is not one of ${alts(V.LOAD_CHECKS).join(', ')}` };
        default: return null;
      }
    }
    // Why parseFlight would count an entry as demoted ("source" with no reference).
    function demoteReason(cat, e) {
      const srcKey = cat === 'loads' ? 'inputs_src' : 'tol_src', refKey = cat === 'loads' ? 'inputs_ref' : 'tol_ref';
      if (cat !== 'loads' && !TOL_CATS.has(cat)) return null;
      if (mdStr(e[srcKey]) !== 'source' || !APP.TOL_SRC.test(mdStr(e[srcKey]))) return null;
      // the app evaluates provenance only for entries that pass the checks it runs first
      if (cat === 'holes' ? !!roundOnlyReason(e) : cat !== 'loads' && !!dropReason(cat, e)) return null;
      if (cat === 'loads' && dropReason(cat, e)) return null;
      const ref = e[refKey];
      if (mdStr(ref).slice(0, 140)) return null;
      return { field: ref === undefined ? srcKey : refKey, why: ref === undefined ? `${srcKey} is "source" and there is no ${refKey}` : typeof ref !== 'string' ? `${refKey} is ${show(ref)}, not text` : `${refKey} is blank` };
    }
    function roundOnlyReason(e) { return dropReason('od', e); }
    function vocab(cat, e, eLoc, doc, idx, nm) {
      const at = (k) => keyOf(doc, eLoc, k);
      const srcKey = cat === 'loads' ? 'inputs_src' : TOL_CATS.has(cat) ? 'tol_src' : null;
      if (srcKey && e[srcKey] !== undefined && !APP.TOL_SRC.test(mdStr(e[srcKey]))) {
        const looksCited = /^source$/i.test(String(e[srcKey]).trim());
        add('warning', 'VOCAB', at(srcKey), `${cat} #${idx + 1}${nm}: ${srcKey} ${show(e[srcKey])} is not ${alts(APP.TOL_SRC).join(', ')}, so parseFlight reads it as "default"${looksCited ? ' and drops its reference without counting a demotion' : ''}`, { source: 'app', category: cat, index: idx });
      }
      if (cat === 'revolve' && e.axis !== undefined && !APP.FLIGHT_AXIS.test(mdStr(e.axis)))
        add('warning', 'VOCAB', at('axis'), `revolve #${idx + 1}${nm}: axis ${show(e.axis)} is not x, y or z, so parseFlight measures the profile along z`, { source: 'app', category: cat, index: idx });
      if (cat === 'gauges' && e.expect !== undefined && !V.GAUGE_INTERFERE.test(mdStr(e.expect)) && mdStr(e.expect) !== 'clear')
        add('warning', 'VOCAB', at('expect'), `gauge #${idx + 1}${nm}: expect ${show(e.expect)} is not "clear" or one of ${alts(V.GAUGE_INTERFERE).join(', ')}, so parseFlight reads it as "clear": the gauge must NOT touch the part`, { source: 'app', category: cat, index: idx });
      if (cat === 'holes' && e.pattern !== undefined && !V.HOLE_PATTERN.test(mdStr(e.pattern)))
        add('warning', 'VOCAB', at('pattern'), `holes #${idx + 1}${nm}: pattern ${show(e.pattern)} is not ${alts(V.HOLE_PATTERN).join(', ')}, so parseFlight infers "${pair(e.at_mm) ? 'single' : 'list'}" from at_mm`, { source: 'app', category: cat, index: idx });
    }

    // ---- named counts must equal the app's counters, or Cold Read says so
    if (appF && !appF.malformed) {
      if (flight.named.dropped !== appF.dropped)
        add('error', 'PARITY', flightBlock.start, `Cold Read names ${flight.named.dropped} dropped FLIGHT entries; parseFlight counts ${appF.dropped}. Trust the app's count`);
      if (flight.named.demoted !== appF.demoted)
        add('error', 'PARITY', flightBlock.start, `Cold Read names ${flight.named.demoted} demoted FLIGHT entries; parseFlight counts ${appF.demoted}. Trust the app's count`);
      for (const cat of FLIGHT_CATS) {
        const C = flight.counts[cat];
        if (C && C.kept !== appF[cat].length) add('error', 'PARITY', flightBlock.start, `${cat}: Cold Read keeps ${C.kept}, parseFlight keeps ${appF[cat].length}`);
      }
      if (appF.declared === 0)
        add('error', 'NOTHING_DECLARED', flightBlock.start, 'after parseFlight, the FLIGHT block declares nothing measurable (no critical, od, bores, holes, revolve or gauges entry survives); the gate fails it (index.html:5585)', { source: 'app' });
      // the app's own contradiction check, located at the critical entry
      for (const x of APP.flightContradictions(appSpec, appF)) {
        const c = critLocs.find((k) => k.name === x.name && k.module === x.module && k.axis === x.axis);
        const partAt = specBlock && specParts.includes(x.module) ? findPartLine(x.module) : null;
        add('error', 'CONTRADICTION', c ? keyOf(c.doc, c.eLoc, 'nominal_mm') : flightBlock.start,
          `Critical dimension "${x.name}": you say ${x.module}() measures ${f3(x.nominal_mm)} mm along ${x.axis}, but your SPEC gives ${x.module} a size of ${x.spec_mm.map(f3).join(' × ')} mm. A critical dimension is a module's full extent; a groove, pocket or step inside it is a bore, an od or a helper module. The app finds this only after the render (flightCheck, index.html:5620), although its doctrine says such a nominal "is rejected before anything is rendered" (index.html:1455)`,
          { source: 'app', related: partAt ? [{ line: partAt, note: `SPEC part ${x.module}` }] : [] });
      }
      // the app's flightLint, located with its own regexes
      const sev = grade === 'flight' ? 'error' : 'warning';
      const S = appStrip(code);
      const sentinel = sentinelLine();
      for (const w of APP.flightLint(code)) {
        const extra = { source: 'app', app: w };
        const tail = grade === 'flight' ? ' — the gate fails flight-grade code for this (index.html:5595)' : ' — a warning in hobby grade (index.html:5594)';
        if (/^no tess_tol parameter/.test(w)) add(sev, 'APP_FLIGHT_LINT', sentinel ? lineOffset(sentinel) : 0, `flightLint: ${w}${tail}`, extra);
        else if (/^the fn_tol\(\) helper is missing/.test(w)) add(sev, 'APP_FLIGHT_LINT', sentinel ? lineOffset(sentinel) : 0, `flightLint: ${w}${tail}`, extra);
        else if (/^a global \$/.test(w)) {
          const m = V.FLINT_GLOBAL_FN.exec(S);
          add(sev, 'APP_FLIGHT_LINT', m ? m.index + m[0].indexOf('$') : null, `flightLint: ${w}${tail}`, extra);
        } else if (/^\d+ round primitive/.test(w)) {
          const bare = [...S.matchAll(V.FLINT_BARE)].filter((m) => !V.FLINT_BARE_FN.test(m[2]));
          for (const m of bare) add(sev, 'APP_FLIGHT_LINT', m.index, `flightLint: ${m[1]}() without $fn=fn_tol(…) (the app says: "${w}")${tail}`, extra);
          if (bare.length !== parseInt(w, 10)) add('error', 'PARITY', null, `flightLint counts ${parseInt(w, 10)} bare round primitives; Cold Read located ${bare.length}`);
        } else if (/^sin\/cos\/tan/.test(w)) {
          const m = V.FLINT_TRIG.exec(S);
          add(sev, 'APP_FLIGHT_LINT', m ? m.index : null, `flightLint: ${w}${tail}`, extra);
        } else add(sev, 'APP_FLIGHT_LINT', null, `flightLint: ${w}${tail}`, extra);
      }
    }
    function findPartLine(name) {
      const p = spec.parts.indexOf(name);
      if (p < 0) return null;
      try {
        const r = parseJsonLoc(specBlock.json);
        const it = r.loc.keys.parts && r.loc.keys.parts.loc.items;
        const want = (r.value.parts || []).findIndex((e) => e && typeof e.name === 'string' && e.name.trim() === name);
        return it && want >= 0 ? L.pos(specBlock.map(it[want].start)).line : null;
      } catch (e) { return null; }
    }

    // ---- the hobby lint(), on the raw text exactly as the app runs it
    const appWarn = APP.lint(code);
    const hobbyRes = { minkowski: V.HLINT_MINKOWSKI, '$fn': V.HLINT_FN, text: V.HLINT_TEXT, import: V.HLINT_IMPORT };
    let appFnAt = -1;
    for (const w of appWarn) {
      const key = /^minkowski/.test(w) ? 'minkowski' : /^\$fn/.test(w) ? '$fn' : /^text/.test(w) ? 'text' : /^import/.test(w) ? 'import' : null;
      const m = key ? hobbyRes[key].exec(code) : null;
      const at = m ? m.index : null;
      if (key === '$fn') appFnAt = at;
      const inComment = at != null && scan.inComment(at);
      const glued = at != null && at > 0 && /[A-Za-z0-9_]/.test(code[at - 1]);
      let msg = `lint: ${w} — the app shows this warning on the report (index.html:6581)`;
      if (inComment) msg += '. This match is inside a comment: lint() tests the raw source, comments included, so the warning is false here';
      else if (glued) msg += `. This match is the tail of the identifier "${(/[A-Za-z0-9_]+$/.exec(code.slice(0, at)) || [''])[0]}${m[0].replace(/\s*\($/, '')}": lint()'s pattern has no word boundary, so the warning is false here`;
      add(inComment || glued ? 'info' : 'warning', 'APP_LINT', at, msg, { source: 'app', app: w });
    }
    // lint() reads only the FIRST "$fn = <digits>"; name any later one over its threshold
    for (const m of code.matchAll(new RegExp(V.HLINT_FN.source, 'g'))) {
      if (m.index === appFnAt || scan.inComment(m.index) || !(+m[1] > 128)) continue;
      add('warning', 'FN_HIGH', m.index, `$fn=${m[1]} is above the 128 the app's lint() warns at, but lint() only reads the first "$fn = <number>" in the file (index.html:5918), so the app does not mention this one`);
    }

    // ---- main(), what the top level draws, and the SPEC parts it must reach
    const isAssembly = !!manifest;
    const hasSpec = spec.state === 'parsed';
    if (hasSpec && !isAssembly && !st.broken) {
      // The gate's flight shortcut (index.html:3228-3235, 3424-3426): when main() is only calls to
      // declared parts and nothing else renders at the top level, placement is taken as true "by
      // construction" and the containment check does not run.
      const appOnlyMain = APP.topLevelIsOnlyMain(code);
      const shortcut = grade === 'flight' && APP.mainPlainUnion(code, specParts) && appOnlyMain;
      const unreached = [];
      // FLIGHT entries the gate measures on the finished object rather than on a module alone
      const onObject = appF && !appF.malformed ? appF.critical.filter((c) => c.module === 'main').length
        + appF.od.length + appF.bores.length + appF.holes.length + appF.revolve.length + appF.gauges.length : 0;
      if (!realModules.has('main'))
        add(grade === 'hobby' ? 'error' : 'warning', 'MAIN_MISSING', specBlock.end, `there is no module main(). Both doctrines ask for one that unions the SPEC parts (index.html:1350, 1482)${grade === 'hobby' ? ', and the hobby gate\'s containment probe subtracts main() from the parts (index.html:3442), so with no main() every part reads as "not in the finished object" [Likely]' : ''}`);
      if (!rootDesc.length) {
        add('error', 'NOTHING_RENDERS', null, `nothing at the top level draws anything${realModules.has('main') ? ' (main() is defined but never called)' : ''}: the render is empty`);
      } else {
        for (const name of specParts) {
          if (!realModules.has(name) || reached.has(name)) continue;
          unreached.push(name);
          const hidden = reachedAny.has(name);
          const callers = [...modCalls].filter(([, cs]) => cs.some((c) => c.name === name)).map(([n]) => n + '()');
          add('error', 'MAIN_UNREACHED', realModules.get(name).nameS,
            `SPEC part "${name}" is never drawn: ${rootDesc.join(', ')} at the top level ${hidden ? `reaches ${name}() only through a * or % modifier, which leaves it out of the render` : `never calls ${name}(), directly or through another module`}${callers.length && !hidden ? ` (it is called from ${callers.join(', ')}, which ${callers.length > 1 ? 'are' : 'is'} not drawn)` : ''}. `
            + (shortcut
              ? `In flight grade the gate skips its containment check here: mainPlainUnion() accepts a main() whose calls are all declared parts without asking whether every declared part is called, so placement is taken "by construction" (index.html:4536-4550, 3424-3426) [Likely: read from the code, not run]. ${onObject ? `It can still notice through the ${plural(onObject, 'FLIGHT entry', 'FLIGHT entries')} measured on the finished object, if one of them happens to touch ${name}; nothing guarantees it` : `No FLIGHT entry is measured on the finished object, so nothing in the gate looks for ${name}`}`
              : `The gate's containment check fails this after the render (index.html:3417-3448)`),
            { source: shortcut ? 'cold-read' : 'app', gateMisses: shortcut });
        }
      }
      // gauges and gauge_* modules must not be drawn
      for (const g of new Set([...gaugeModules, ...[...realModules.keys()].filter((n) => /^gauge_/.test(n))])) {
        if (reached.has(g))
          add('warning', 'GAUGE_RENDERED', realModules.get(g).nameS, `${g}() is a gauge but the top level draws it (via ${reached.get(g)}): a gauge solid that main() calls becomes material in the part (the flight doctrine: "Gauge modules (gauge_*) are extra modules that main() never calls", index.html:1482)`);
      }
      // the doctrine's "ONLY top-level statement is main();", checked by the app's own function
      const offenders = [];
      let mains = 0;
      for (const t of st.tops) {
        const toks = st.toks.slice(t.from, t.to);
        const bare = toks.length === 4 && toks[0].v === 'main' && toks[1].v === '(' && toks[2].v === ')' && toks[3].v === ';';
        if (bare) { mains++; if (mains > 1) offenders.push({ s: t.s, why: 'a second main();' }); continue; }
        if (toks[0].t === 'id' && (toks[0].v === 'assert' || toks[0].v === 'echo')) continue;
        offenders.push({ s: t.s, why: `"${code.slice(t.s, Math.min(t.e, t.s + 60)).replace(/\s+/g, ' ').trim()}" draws at the top level` });
      }
      for (const inc of st.includes) offenders.push({ s: inc.s, why: `${inc.kind} <…> at the top level` });
      for (const a of st.assigns) if (a.name.startsWith('$'))
        offenders.push({ s: a.s, why: `${a.name} = … at the top level: the app's topLevelIsOnlyMain() accepts an assignment only when the name starts with a letter or "_", so it reads this one as a drawing statement` });
      for (const m of st.modules) if (!m.braced || m.paramsHaveParen)
        offenders.push({ s: m.s, why: `module ${m.name}() ${!m.braced ? 'has no { } around its body' : 'has a parenthesis inside its parameter list'}, so the app's module-stripping pattern \`module name(...) {\` does not match it and reads its body as top-level statements` });
      if (mains === 0) offenders.push({ s: null, why: 'there is no bare main(); at the top level' });
      const why = '. The doctrine says the ONLY top-level statement is main(); (index.html:1350, 1482); in flight grade the gate\'s by-construction shortcut needs it (topLevelIsOnlyMain, index.html:4561)';
      if (!appOnlyMain) {
        if (offenders.length) for (const o of offenders) add('warning', 'TOP_LEVEL', o.s, o.why + why, { source: 'app' });
        else add('warning', 'TOP_LEVEL', null, `the app's topLevelIsOnlyMain() rejects this file's top level, and Cold Read cannot say which statement it objects to${why}`, { source: 'app' });
      } else if (offenders.length) {
        add('info', 'PARITY', null, `Cold Read sees ${offenders.length} top-level statement(s) besides main(); the app's topLevelIsOnlyMain() accepts the file. The app's verdict stands`);
      }
      if (shortcut)
        add(unreached.length ? 'warning' : 'info', 'SHORTCUT', realModules.has('main') ? realModules.get('main').nameS : null, `main() is a plain union of SPEC parts and nothing else renders at the top level, so in flight grade the gate takes the parts as placed by construction and skips the containment probe (index.html:3228-3235, 3426)${unreached.length ? `, although main() never draws ${unreached.map((n) => n + '()').join(', ')}` : ''}`, { source: 'app' });
    }

    // a module nothing calls and nothing declares: usually a rename that missed its callers
    if (!st.broken) {
      const called = new Set([...topCalls, ...[...modCalls.values()].flat()].map((c) => c.name));
      const declared = new Set([...specParts, ...critLocs.map((c) => c.module), ...gaugeModules, 'main']);
      for (const [name, m] of realModules)
        if (!called.has(name) && !declared.has(name) && !/^gauge_/.test(name))
          add('info', 'UNUSED_MODULE', m.nameS, `module ${name}() is defined but nothing calls it and neither block names it, so it is never drawn or measured`);
    }

    // ---- the parameter block
    function sentinelLine() {
      for (let i = 1; i <= L.count; i++) if (L.lineText(i).includes('--- end parameters ---')) return i;
      return 0;
    }
    const sentinel = sentinelLine();
    const sentinelOff = sentinel ? lineOffset(sentinel) : code.length;
    const panel = [];
    for (let i = 1; i <= (sentinel ? sentinel - 1 : L.count); i++) {
      const m = L.lineText(i).match(APP.PARAM_RE);
      if (m && m[1] !== '$fn' && m[1] !== 'print_layout') panel.push({ name: m[1], value: parseFloat(m[2]), line: i });
    }
    if (!sentinel && !isAssembly && (hasSpec || flightBlock))
      add('warning', 'PARAM_SENTINEL', null, `no "// --- end parameters ---" line: the parameter panel reads every line of the file that looks like "name = number; // text" (${plural(panel.length, 'line')} here) and rewrites those lines when a slider moves (extractParams/applyParams, index.html:6425-6444)`, { source: 'app' });
    const firstAssign = new Map();
    for (const a of st.assigns) {
      if (firstAssign.has(a.name)) {
        add('warning', 'DUP_ASSIGN', a.s, `${a.name} is assigned again (first at line ${L.pos(firstAssign.get(a.name).s).line}); OpenSCAD uses the last assignment for the whole file, including the lines above it [Likely]`);
        continue;
      }
      firstAssign.set(a.name, a);
      if (!sentinel || a.s >= sentinelOff || a.name.startsWith('$') || a.name === 'print_layout') continue;
      const ln = L.pos(a.s).line, text = L.lineText(ln);
      if (APP.PARAM_RE.test(text)) continue;
      const why = /^\s+\S/.test(text) ? 'it is indented' : !/;\s*\/\//.test(text) ? 'it has no "// description" after it'
        : !/^[A-Za-z_]\w*\s*=\s*-?[\d.]+\s*;/.test(text) ? 'its value is an expression, not a number' : 'the line holds more than one statement';
      add('info', 'PARAM_HIDDEN', a.s, `${a.name} is above the parameter sentinel but the parameter panel will not show it: ${why} (PARAM_RE, index.html:6420)`, { source: 'app' });
    }
    if (grade === 'flight' && panel.length && panel[0].name !== 'tess_tol')
      add('info', 'TESS_NOT_FIRST', lineOffset(panel[0].line), `the first parameter is ${panel[0].name}; the flight doctrine says the FIRST parameter is tess_tol (index.html:1479). flightLint only checks that tess_tol exists somewhere`);
    if (appF && !appF.malformed && appF.tess_tol_mm > 0) {
      const tt = firstAssign.get('tess_tol');
      if (tt && tt.literal != null && Math.abs(tt.literal - appF.tess_tol_mm) > 1e-12)
        add('warning', 'TESS_MISMATCH', tt.s, `tess_tol = ${tt.literal} here, but the FLIGHT block declares tess_tol_mm = ${appF.tess_tol_mm}: fn_tol() facets the geometry with tess_tol (its default argument) while the CMM allows for tess_tol_mm when it measures round features (index.html:5583, 5597)`);
    }

    // ---- sort, count, report
    diags.sort((a, b) => a.line - b.line || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.col - b.col);
    const count = (s) => diags.filter((d) => d.severity === s).length;
    const parity = diags.filter((d) => d.code === 'PARITY' && d.severity === 'error').length;
    return {
      grade,
      diagnostics: diags,
      summary: {
        errors: count('error'), warnings: count('warning'), infos: count('info'), parity,
        spec: spec.state, specParts: spec.parts.length,
        flight: flight.state, flightCounts: flight.counts, named: flight.named, app: flight.app,
        modules: realModules.size, drawn: reached.size, lines: L.count,
      },
      footer: FOOTER,
    };
  }

  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // ---------------------------------------------------------------- text report
  function format(result, opts) {
    opts = opts || {};
    const file = opts.file || '<input>';
    const out = [];
    const shown = result.diagnostics.filter((d) => opts.showInfo !== false || d.severity !== 'info');
    for (const d of shown) {
      out.push(`${file}:${d.line || '-'}:${d.col || '-'}: ${d.severity} ${d.code}: ${d.message}`);
      if (d.quote) out.push(`    ${String(d.line).padStart(4)} | ${d.quote}`);
    }
    const s = result.summary;
    const parts = [`${plural(s.errors, 'error')}`, `${plural(s.warnings, 'warning')}`, `${plural(s.infos, 'note')}${opts.showInfo === false && s.infos ? ' (hidden)' : ''}`];
    const read = [];
    if (s.spec !== 'absent') read.push(`SPEC ${s.spec}${s.spec === 'parsed' ? ` (${plural(s.specParts, 'part')})` : ''}`);
    if (s.flight !== 'absent') {
      const kept = Object.values(s.flightCounts).reduce((a, c) => a + c.kept, 0);
      read.push(`FLIGHT ${s.flight}${s.flight === 'parsed' ? ` (${kept} entries kept, ${s.named.dropped} dropped, ${s.named.demoted} demoted, ${s.named.uncounted + s.named.capped} never counted)` : ''}`);
    }
    read.push(`${plural(s.modules, 'module')}, ${s.drawn} drawn from the top level`);
    out.push(`${file}: ${parts.join(', ')} — ${result.grade} grade; ${read.join('; ')}`);
    if (!s.errors && !s.warnings) out.push(`${file}: no textual errors or warnings. That is not a pass: nothing here was rendered or measured.`);
    out.push(result.footer);
    return out.join('\n');
  }

  // The rule catalogue: what each code means and what the app itself does about it.
  const RULES = [
    ['SPEC_UNCLOSED', 'error', 'SPEC-BEGIN without SPEC-END', 'parseSpec sees no block; the gate says the JSON did not parse', 'index.html:2900, 3221'],
    ['SPEC_JSON', 'error', 'the SPEC JSON does not parse (line and column of the fault)', 'parseSpec returns null; every SPEC check skipped', 'index.html:2903-2928, 3221'],
    ['SPEC_SHAPE', 'error', 'SPEC is not an object, has no parts array, or no part survives', 'parseSpec returns null', 'index.html:2899-2929'],
    ['SPEC_DROP', 'error/warning', 'a part, joint, rule, relation or profile parseSpec drops (named, with the field)', 'dropped silently', 'index.html:2906-2926'],
    ['SPEC_CAP', 'warning', 'rules, relations or profiles past parseSpec\'s caps', 'sliced off silently', 'index.html:2915, 2920, 2926'],
    ['SPEC_SIZE', 'warning/info', 'size_mm missing or not three positive numbers', 'size check skipped', 'index.html:2907, 3279'],
    ['SPEC_DUP', 'warning', 'the same SPEC part name twice', 'both probed', ''],
    ['SPEC_REF', 'warning', 'a rule, relation or profile naming a part the SPEC does not declare', '"unmeasured part", no failure', 'index.html:3333, 3354, 3384'],
    ['JOINT_MODULE', 'error', 'a joint naming neither a SPEC part nor a module', '"missing module", no failure', 'index.html:3255'],
    ['MODULE_MISSING', 'error', 'a SPEC part, critical module or gauge module with no module definition', 'fails, after the render', 'index.html:3245, 5634, 5711'],
    ['FLIGHT_MISSING', 'error', 'flight grade with no FLIGHT block', 'fails', 'index.html:5571'],
    ['FLIGHT_UNCLOSED', 'error', 'FLIGHT-BEGIN without FLIGHT-END', 'no block seen', 'index.html:4673'],
    ['FLIGHT_JSON', 'error', 'the FLIGHT JSON does not parse (line and column of the fault)', 'fails: "FLIGHT JSON did not parse"', 'index.html:4677, 5576'],
    ['FLIGHT_SHAPE', 'error', 'FLIGHT JSON that is not an object', 'malformed', 'index.html:4678'],
    ['FLIGHT_KEY', 'warning', 'a top-level key parseFlight never reads (with a did-you-mean)', 'ignored silently', 'index.html:4672-4750'],
    ['DUP_KEY', 'error/warning', 'a key written twice in one object', 'JSON.parse keeps the last', 'ECMA-262 JSON.parse'],
    ['FLIGHT_NOT_ARRAY', 'error', 'a category that is not an array', 'read as empty, not counted', 'index.html:4682'],
    ['FLIGHT_UNCOUNTED', 'error', 'a category entry that is not an object', 'filtered before counting', 'index.html:4682'],
    ['FLIGHT_CAP', 'error', `entries past FLIGHT_CAP`, 'sliced off before counting', 'index.html:4652, 4682'],
    ['FLIGHT_DROP', 'error', 'an entry parseFlight drops, with the field that fails', 'counted only: "N FLIGHT entries were ignored"', 'index.html:4694-4733, 5586'],
    ['FLIGHT_DEMOTE', 'warning', 'a "source" claim with no reference', 'counted only', 'index.html:4690, 4740, 5587'],
    ['VOCAB', 'warning', 'tol_src, inputs_src, tier, revolve axis, gauge expect or hole pattern read as something else', 'silent fallback', 'index.html:4684-4740'],
    ['HAZARD', 'error', 'a hazard word parseFlight does not know', 'read as "none"', 'index.html:4684, 4779'],
    ['DUP_NAME', 'warning', 'two entries of one category with the same name', 'both kept', ''],
    ['NOTHING_DECLARED', 'error', 'nothing measurable survives parseFlight', 'fails', 'index.html:5585'],
    ['TESS_UNDECLARED', 'info', 'no positive tess_tol_mm', 'Settings value used', 'index.html:5583'],
    ['TESS_MISMATCH', 'warning', 'tess_tol parameter differs from FLIGHT tess_tol_mm', 'not compared', 'index.html:5583, 5597'],
    ['CONTRADICTION', 'error', 'a critical nominal that matches none of its SPEC part\'s extents (the app\'s flightContradictions)', 'fails, after the render', 'index.html:4847, 5620'],
    ['APP_FLIGHT_LINT', 'error (flight) / warning (hobby)', 'the app\'s flightLint, each finding at its line', 'fails in flight grade', 'index.html:4827, 5593'],
    ['APP_LINT', 'warning (info when false)', 'the app\'s hobby lint, at its line; says when the match is in a comment or an identifier', 'shown as a warning', 'index.html:5915, 6581'],
    ['FN_HIGH', 'warning', 'a later $fn above 128 that lint() does not read', 'not reported', 'index.html:5918'],
    ['UNKNOWN_MODULE', 'error', 'a call to a module that is neither defined nor built in', 'OpenSCAD draws nothing for it', 'OpenSCAD'],
    ['DUP_MODULE', 'warning', 'a module defined twice', '', 'OpenSCAD'],
    ['COMMENTED_MODULE', 'warning', '"module x(" only inside a comment', 'the gate\'s regex counts it', 'index.html:3226'],
    ['BRACES', 'error', 'unbalanced braces or parentheses', 'compile error', 'OpenSCAD'],
    ['INCLUDE', 'warning', 'include/use of another file', 'no file system in the browser', 'index.html:5920'],
    ['MAIN_MISSING', 'error (hobby) / warning (flight)', 'a SPEC file with no module main()', 'containment probe calls main()', 'index.html:1350, 1482, 3442'],
    ['NOTHING_RENDERS', 'error', 'the top level draws nothing', 'empty render', ''],
    ['MAIN_UNREACHED', 'error', 'a SPEC part the top level never draws (or only under * / %)', 'fails, after the render', 'index.html:3417-3448'],
    ['GAUGE_RENDERED', 'warning', 'a gauge module the top level draws', 'becomes material', 'index.html:1482'],
    ['ROOT_MODIFIER', 'warning', 'a ! modifier', 'only that subtree renders', 'OpenSCAD'],
    ['TOP_LEVEL', 'warning', 'top-level statements besides main(); (the app\'s topLevelIsOnlyMain, located)', 'shortcut off', 'index.html:4561'],
    ['SHORTCUT', 'info', 'main() qualifies for the by-construction shortcut', 'probe skipped', 'index.html:3228-3235, 3426'],
    ['ASSEMBLY', 'info', 'an assembly manifest', 'SPEC checks skipped', 'index.html:3209'],
    ['NO_SPEC', 'info', 'no SPEC block', 'SPEC checks skipped', 'index.html:3221'],
    ['PARAM_SENTINEL', 'warning', 'no "--- end parameters ---" line', 'panel reads the whole file', 'index.html:6425-6444'],
    ['PARAM_HIDDEN', 'info', 'an assignment above the sentinel the panel will not show', 'not shown', 'index.html:6420'],
    ['TESS_NOT_FIRST', 'info', 'tess_tol is not the first parameter', 'not checked', 'index.html:1479'],
    ['DUP_ASSIGN', 'warning', 'a variable assigned twice', 'last one wins', 'OpenSCAD'],
    ['UNUSED_MODULE', 'info', 'a module nothing calls and neither block names', 'never drawn', ''],
    ['PARITY', 'error', 'Cold Read and the app disagree; the app\'s verdict is reported', '', ''],
  ].map(([code, severity, what, app, ref]) => ({ code, severity, what, app, ref }));

  // Every index.html line this file cites, with text that line holds at PartForge 0974a62.
  // coldread.test.mjs checks that each citation above is listed here and, when the checkout is
  // at that commit, that each line still says this.
  const CITES = {
    1350: 'ONE MODULE PER PART, named EXACTLY', 1455: 'is rejected before anything is rendered', 1479: '4. Parameters, one per line',
    1482: 'ONE MODULE PER SPEC PART', 2899: 'function parseSpec(code){', 2900: 'SPEC-BEGIN', 2903: 'try {', 2906: 's.parts = s.parts.filter',
    2907: 'size_mm: Array.isArray(p.size_mm)', 2915: '.slice(0, 8);', 2920: 'slice(0, 12)', 2926: 'slice(0, 10)', 2928: 'catch(e){ return null; }',
    2929: '}', 3209: 'assembly — manifest contract applies', 3221: 'SPEC block present but its JSON did not parse', 3226: 'const defined = new Set',
    3228: 'Flight grade: when main() is nothing but calls', 3235: 'const plain = isFlight()', 3245: 'The SPEC declares a part',
    3255: "row.note = 'missing module'", 3279: 'if(p.size_mm && p.size_mm.every', 3333: "'unmeasured part'", 3354: "'unmeasured part'",
    3384: "'unmeasured part'", 3417: 'Does the printed object actually CONTAIN', 3424: 'const placed = g.parts.filter', 3426: 'byConstruction',
    3442: 'difference(){ union(){', 3448: "'probe error'", 4536: 'function mainPlainUnion', 4550: '}', 4561: 'function topLevelIsOnlyMain',
    4652: 'const FLIGHT_CAP = 24', 4672: 'function parseFlight(code){', 4673: 'FLIGHT-BEGIN', 4677: 'JSON.parse(json)', 4678: 'malformed:true',
    4682: 'const arr = k =>', 4684: 'FLIGHT_HAZARD.test', 4690: 'out.demoted++', 4694: 'out.dropped++', 4733: 'bolt_shear', 4740: 'out.demoted++',
    4750: '}', 4779: "f.hazard === 'pressure'", 4827: 'function flightLint(src){', 4847: 'function flightContradictions(spec, f){',
    5571: 'Flight grade requires a FLIGHT block', 5576: 'FLIGHT JSON did not parse', 5583: 'const tess = f.tess_tol_mm > 0',
    5585: 'declares nothing measurable', 5586: 'FLIGHT entr', 5587: 'a cited tolerance with no tol_ref', 5593: 'for(const w of flightLint(code))',
    5594: 'rows.lint.push(w)', 5595: 'Flight-grade code rule', 5597: 'differs from the', 5620: 'flightContradictions(g.spec, f)',
    5634: 'does not exist', 5711: 'which does not exist', 5915: 'function lint(code){', 5918: '$fn', 5920: 'external files are unavailable',
    6420: 'const PARAM_RE', 6425: 'function extractParams(code){', 6444: '}', 6581: 'const warns = lint(code)',
  };

  return { lint, format, parseJsonLoc, extractBlock, scanText, tokenize, parseStructure, RULES, CITES, FOOTER, BUILTIN_MODULES };
});
