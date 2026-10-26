// Reach Census: a static map of which runner reaches which test file, and which CI job runs
// that runner. Nothing is executed: package.json scripts, workflow steps, documented commands
// and two runner-script shapes are read as text and evaluated against the tracked file list.
// Anything the evaluator cannot model is reported as "not understood", never as reached.
//
// Pure module: no fs, no child_process. A "tree" supplies the tracked paths and a read()
// function; reach-census.mjs builds one from a live checkout, snapshots/packs.js holds the
// three pinned ones. Loads as a classic script (window.ReachCensus) and via require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReachCensus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- paths (posix, tree-relative)
  function normalize(p) {
    const out = [];
    for (const seg of String(p).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else out.push('..');
      } else out.push(seg);
    }
    return out.join('/');
  }
  function join() {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) if (arguments[i] !== '' && arguments[i] != null) parts.push(arguments[i]);
    return normalize(parts.join('/'));
  }
  function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function basename(p) { return p.slice(p.lastIndexOf('/') + 1); }
  function outside(p) { return p === '..' || p.startsWith('../'); }
  function isAbs(p) { return /^([A-Za-z]:)?[\\/]/.test(p); }
  function resolveFrom(cwd, p) { return isAbs(p) ? null : join(cwd, p); }
  function uniq(arr) { return Array.from(new Set(arr)); }
  function sortPaths(arr) { return arr.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); }

  // ---------------------------------------------------------------- the tree
  // spec: { id, label, commit, files: [...tracked paths], read(path) -> string|null,
  //         docCommands?: [...] (precomputed) , mentionsFor?(paths) -> {path: [{file,line}]},
  //         config?: { extraCandidates: [{glob, kind, why}], localNode, nodeSource } }
  function makeTree(spec) {
    const files = sortPaths(uniq(spec.files.map(normalize).filter(Boolean)));
    const fileSet = new Set(files);
    const dirs = new Map();
    const ensure = (d) => {
      if (!dirs.has(d)) dirs.set(d, { files: new Set(), dirs: new Set() });
      return dirs.get(d);
    };
    ensure('');
    for (const f of files) {
      let d = dirname(f);
      ensure(d).files.add(basename(f));
      while (d !== '') {
        const parent = dirname(d);
        ensure(parent).dirs.add(basename(d));
        d = parent;
      }
    }
    const cache = new Map();
    const read = (p) => {
      p = normalize(p);
      if (cache.has(p)) return cache.get(p);
      let v = null;
      try { v = fileSet.has(p) ? spec.read(p) : null; } catch (e) { v = null; }
      if (v != null) v = String(v).replace(/\r\n/g, '\n');
      cache.set(p, v);
      return v;
    };
    return {
      id: spec.id, label: spec.label || spec.id, commit: spec.commit || null,
      files, fileSet, dirs, read,
      docCommandsList: spec.docCommands || null,
      mentionsFor: spec.mentionsFor || null,
      config: spec.config || {},
    };
  }

  // A view of the tree plus files emitted by a build step earlier in the same chain (tsc).
  function view(tree, virtual) {
    let vdirs = null;
    const vindex = () => {
      if (vdirs) return vdirs;
      vdirs = new Map();
      const ensure = (d) => { if (!vdirs.has(d)) vdirs.set(d, { files: new Set(), dirs: new Set() }); return vdirs.get(d); };
      for (const f of virtual ? virtual.keys() : []) {
        let d = dirname(f);
        ensure(d).files.add(basename(f));
        while (d !== '') { const parent = dirname(d); ensure(parent).dirs.add(basename(d)); d = parent; }
      }
      return vdirs;
    };
    return {
      isFile: (p) => tree.fileSet.has(p) || !!(virtual && virtual.has(p)),
      isDir: (p) => tree.dirs.has(p) || vindex().has(p),
      list: (d) => {
        const a = tree.dirs.get(d), b = vindex().get(d);
        const files = new Set(), ds = new Set();
        for (const x of [a, b]) if (x) { x.files.forEach((f) => files.add(f)); x.dirs.forEach((f) => ds.add(f)); }
        return { files: Array.from(files).sort(), dirs: Array.from(ds).sort() };
      },
      source: (p) => (virtual && virtual.has(p) ? virtual.get(p) : p),
    };
  }

  // ---------------------------------------------------------------- glob matching
  // Patterns are strings in which a backslash escapes the next character (so a quoted '*' that
  // reached a program literally is written '\*'). One segment at a time, like sh and Node.
  function hasMagic(seg, braces) {
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i];
      if (c === '\\') { i++; continue; }
      if (c === '*' || c === '?' || c === '[') return true;
      if (braces && c === '{') return true;
    }
    return false;
  }
  function unescapeGlob(s) { return s.replace(/\\(.)/g, '$1'); }
  function segRegex(seg) {
    let re = '';
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i];
      if (c === '\\') { re += escapeRe(seg[i + 1] || ''); i++; continue; }
      if (c === '*') { re += '[^/]*'; continue; }
      if (c === '?') { re += '[^/]'; continue; }
      if (c === '[') {
        const close = seg.indexOf(']', i + 2);
        if (close > i) {
          let body = seg.slice(i + 1, close);
          let neg = false;
          if (body[0] === '!' || body[0] === '^') { neg = true; body = body.slice(1); }
          re += '[' + (neg ? '^' : '') + body.replace(/\\/g, '\\\\').replace(/\]/g, '\\]') + ']';
          i = close;
          continue;
        }
        re += '\\[';
        continue;
      }
      re += escapeRe(c);
    }
    return new RegExp('^' + re + '$');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }
  // Brace expansion (bash words, Node globs): {a,b} with a top-level comma; escapes respected.
  function expandBraces(pat) {
    let depth = 0, open = -1;
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '\\') { i++; continue; }
      if (c === '{') { if (depth === 0) open = i; depth++; }
      else if (c === '}' && depth > 0) {
        depth--;
        if (depth === 0) {
          const body = pat.slice(open + 1, i);
          const alts = splitTopComma(body);
          if (alts.length > 1) {
            const pre = pat.slice(0, open), post = pat.slice(i + 1);
            const out = [];
            for (const a of alts) for (const x of expandBraces(pre + a + post)) out.push(x);
            return out;
          }
          open = -1;
        }
      }
    }
    return [pat];
  }
  function splitTopComma(s) {
    const out = []; let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { cur += c + (s[i + 1] || ''); i++; continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  // Walk a pattern from cwd. opts: { globstar, exclude(name) }. Returns tree paths (files and,
  // when the pattern ends there, directories), deduplicated.
  function globWalk(v, cwd, pattern, opts) {
    if (isAbs(pattern)) return [];
    const segs = pattern.split('/');
    const out = new Set();
    const step = (base, i) => {
      if (outside(base)) return;
      if (i === segs.length) { if (v.isFile(base) || v.isDir(base)) out.add(base); return; }
      const seg = segs[i];
      if (seg === '' || seg === '.') {
        if (i === segs.length - 1) { if (v.isDir(base)) out.add(base); return; }
        step(base, i + 1);
        return;
      }
      if (seg === '..') { step(dirname(base) === base ? '..' : join(base, '..'), i + 1); return; }
      if (opts.globstar && seg === '**') {
        step(base, i + 1);
        for (const d of v.list(base).dirs) {
          if (d.startsWith('.') || (opts.exclude && opts.exclude(d))) continue;
          step(join(base, d), i);
        }
        return;
      }
      if (!hasMagic(seg, false)) {
        const p = join(base, unescapeGlob(seg));
        if (i === segs.length - 1 ? (v.isFile(p) || v.isDir(p)) : v.isDir(p)) step(p, i + 1);
        return;
      }
      const re = segRegex(seg);
      const dotOk = seg[0] === '.' || seg.startsWith('\\.');
      const { files, dirs } = v.list(base);
      const last = i === segs.length - 1;
      const names = last ? dirs.concat(files) : dirs;
      for (const name of names) {
        if (name[0] === '.' && !dotOk) continue;
        if (opts.exclude && opts.exclude(name)) continue;
        if (re.test(name)) step(join(base, name), i + 1);
      }
    };
    step(normalize(cwd), 0);
    return sortPaths(Array.from(out));
  }
  // sh (dash) and bash without globstar: '**' is '*'. bash also expands braces first.
  function shExpand(v, cwd, pat, shell) {
    const pats = shell === 'bash' ? expandBraces(pat) : [pat];
    const words = [];
    for (const p of pats) {
      if (!hasMagic(p, false)) { words.push({ text: unescapeGlob(p), matched: false }); continue; }
      const hits = globWalk(v, cwd, p, { globstar: false });
      if (hits.length === 0) words.push({ text: unescapeGlob(p), matched: false, unmatchedGlob: true });
      else for (const h of hits) words.push({ text: relativeTo(cwd, h), matched: true });
    }
    return words;
  }
  function relativeTo(from, to) {
    from = normalize(from); to = normalize(to);
    if (from === '') return to;
    const a = from.split('/'), b = to.split('/');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return join(a.slice(i).map(() => '..').join('/'), b.slice(i).join('/')) || '.';
  }
  // Node >= 21 test runner: each argument is a glob (globstar, braces, dot entries excluded,
  // node_modules excluded); a directory match is handed to the loader and fails.
  function nodeGlob(v, cwd, pat) {
    const out = new Set();
    for (const p of expandBraces(pat)) for (const h of globWalk(v, cwd, p, { globstar: true, exclude: (n) => n === 'node_modules' })) out.add(h);
    return sortPaths(Array.from(out));
  }
  // Matching one tree path against a globstar pattern (allow lists, config globs).
  function globMatch(pattern, path) {
    for (const p of expandBraces(pattern)) {
      const segs = p.split('/'), parts = path.split('/');
      const m = (i, j) => {
        if (i === segs.length) return j === parts.length;
        if (segs[i] === '**') { for (let k = j; k <= parts.length; k++) if (m(i + 1, k)) return true; return false; }
        if (j === parts.length) return false;
        return segRegex(segs[i]).test(parts[j]) && m(i + 1, j + 1);
      };
      if (m(0, 0)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- shell
  // Splits one command line into simple commands. Words keep a glob pattern in which quoted
  // metacharacters are escaped, so expansion only applies to what the shell would expand.
  function shellParse(line) {
    const cmds = [];
    let cur = { words: [], assigns: [], sep: null, redirs: [] };
    let word = null;
    let error = null;
    const startWord = () => { if (!word) word = { text: '', pat: '', magic: false, brace: false, hasVar: false, hasSubst: false, quoted: false }; };
    const endWord = () => {
      if (!word) return;
      if (pendingRedir) { cur.redirs.push(pendingRedir + word.text); pendingRedir = null; word = null; return; }
      if (cur.words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text) && !word.quotedName) cur.assigns.push(word.text);
      else cur.words.push(word);
      word = null;
    };
    const endCmd = (sep) => {
      endWord();
      cur.sep = sep;
      if (cur.words.length || cur.assigns.length) cmds.push(cur);
      cur = { words: [], assigns: [], sep: null, redirs: [] };
    };
    let pendingRedir = null;
    const s = String(line);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === ' ' || c === '\t') { endWord(); continue; }
      if (c === '\n') { endCmd(';'); continue; }
      if (c === '#' && !word) break;
      if (c === "'") {
        startWord();
        const close = s.indexOf("'", i + 1);
        if (close < 0) { error = 'unterminated single quote'; break; }
        const lit = s.slice(i + 1, close);
        word.text += lit; word.pat += lit.replace(/[\\*?[\]{}]/g, '\\$&'); word.quoted = true;
        i = close;
        continue;
      }
      if (c === '"') {
        startWord();
        let j = i + 1, lit = '';
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && /[$`"\\\n]/.test(s[j + 1] || '')) { lit += s[j + 1]; j += 2; continue; }
          if (s[j] === '$') word.hasVar = true;
          if (s[j] === '`') word.hasSubst = true;
          lit += s[j]; j++;
        }
        if (j >= s.length) { error = 'unterminated double quote'; break; }
        word.text += lit; word.pat += lit.replace(/[\\*?[\]{}]/g, '\\$&'); word.quoted = true;
        i = j;
        continue;
      }
      if (c === '\\') {
        startWord();
        const n = s[i + 1] || '';
        word.text += n; word.pat += '\\' + n; i++;
        continue;
      }
      if (c === '&' && s[i + 1] === '&') { endCmd('&&'); i++; continue; }
      if (c === '|' && s[i + 1] === '|') { endCmd('||'); i++; continue; }
      if (c === '|') { endCmd('|'); if (s[i + 1] === '&') i++; continue; }
      if (c === ';') { endCmd(';'); continue; }
      if (c === '&' && s[i + 1] === '>') { endWord(); pendingRedir = '&>'; i++; if (s[i + 1] === '>') i++; continue; }
      if (c === '&') { endCmd('&'); continue; }
      if (c === '>' || c === '<') {
        if (word && /^\d+$/.test(word.text)) word = null; else endWord();
        let op = c;
        if (s[i + 1] === c) { op += c; i++; }
        if (s[i + 1] === '&') { op += '&'; i++; let d = ''; while (/\d|-/.test(s[i + 1] || '')) { d += s[i + 1]; i++; } if (d) { cur.redirs.push(op + d); continue; } }
        pendingRedir = op;
        continue;
      }
      if (c === '(' || c === ')') {
        if (c === '(' && word && word.text.endsWith('$')) { word.hasSubst = true; }
        error = error || 'subshell or command substitution';
        startWord(); word.text += c; word.pat += '\\' + c;
        continue;
      }
      if (c === '`') { startWord(); word.hasSubst = true; error = error || 'command substitution'; word.text += c; continue; }
      startWord();
      if (c === '$') word.hasVar = true;
      if (c === '*' || c === '?' || c === '[') word.magic = true;
      if (c === '{' || c === '}') word.brace = true;
      word.text += c; word.pat += c;
    }
    if (!error) endCmd(null);
    return { cmds, error };
  }

  // ---------------------------------------------------------------- YAML (the subset workflows use)
  // Block mappings and sequences, plain / quoted scalars, flow sequences and simple flow
  // mappings, block scalars (| and >). Anchors, aliases, tags and complex keys are refused.
  // Every mapping and sequence carries a non-enumerable __lines map (1-based source lines).
  function parseYaml(text) {
    const raw = String(text).replace(/\r\n/g, '\n').split('\n');
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
      const l = raw[i];
      if (/^\s*$/.test(l) || /^\s*#/.test(l)) { lines.push(null); continue; }
      if (/^---\s*$/.test(l) && lines.every((x) => x === null)) { lines.push(null); continue; }
      if (/^\.\.\.\s*$/.test(l) || /^---/.test(l)) throw new Error(`unsupported YAML: multiple documents (line ${i + 1})`);
      if (/\t/.test(l.match(/^\s*/)[0])) throw new Error(`unsupported YAML: tab indentation (line ${i + 1})`);
      lines.push({ n: i + 1, indent: l.match(/^ */)[0].length, text: l.slice(l.match(/^ */)[0].length), raw: l });
    }
    let pos = 0;
    const peek = () => { while (pos < lines.length && lines[pos] === null) pos++; return pos < lines.length ? lines[pos] : null; };
    const setLines = (obj, key, n) => {
      if (!Object.prototype.hasOwnProperty.call(obj, '__lines')) Object.defineProperty(obj, '__lines', { value: {}, enumerable: false });
      obj.__lines[key] = n;
    };
    function stripComment(s) {
      let q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) { if (q === "'" && s[i + 1] === "'") { i++; continue; } q = null; } else if (q === '"' && c === '\\') i++; continue; }
        if ((c === '"' || c === "'") && (i === 0 || /[\s[{,:]/.test(s[i - 1]))) { q = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
      }
      return s.replace(/\s+$/, '');
    }
    function scalar(s, n) {
      s = s.trim();
      if (s === '' || s === '~' || s === 'null') return null;
      if (/^[&*!]/.test(s)) throw new Error(`unsupported YAML: anchor, alias or tag (line ${n})`);
      if (s[0] === '"') {
        if (!/"$/.test(s) || s.length < 2) throw new Error(`unsupported YAML: multi-line double-quoted scalar (line ${n})`);
        return JSON.parse(s.replace(/\\'/g, "'"));
      }
      if (s[0] === "'") {
        if (!/'$/.test(s) || s.length < 2) throw new Error(`unsupported YAML: multi-line single-quoted scalar (line ${n})`);
        return s.slice(1, -1).replace(/''/g, "'");
      }
      if (s[0] === '[') {
        if (!/\]$/.test(s)) throw new Error(`unsupported YAML: multi-line flow sequence (line ${n})`);
        const body = s.slice(1, -1).trim();
        return body === '' ? [] : splitFlow(body, n).map((x) => scalar(x, n));
      }
      if (s[0] === '{') {
        if (!/\}$/.test(s)) throw new Error(`unsupported YAML: multi-line flow mapping (line ${n})`);
        const body = s.slice(1, -1).trim();
        const o = {};
        if (body) for (const kv of splitFlow(body, n)) {
          const m = /^([^:]+?)\s*:\s*(.*)$/.exec(kv);
          if (!m) throw new Error(`unsupported YAML: flow mapping entry (line ${n})`);
          o[scalar(m[1], n)] = scalar(m[2], n);
        }
        return o;
      }
      return s;
    }
    function splitFlow(s, n) {
      const out = []; let depth = 0, q = null, cur = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === '[' || c === '{') depth++;
        if (c === ']' || c === '}') depth--;
        if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      if (q || depth) throw new Error(`unsupported YAML: unbalanced flow collection (line ${n})`);
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    function blockScalar(header, parentIndent, n) {
      const m = /^([|>])([+-]?)(\d?)([+-]?)$/.exec(header);
      if (!m) throw new Error(`unsupported YAML: block scalar header "${header}" (line ${n})`);
      const style = m[1], chomp = m[2] || m[4];
      const body = [];
      let ind = null;
      while (pos < lines.length) {
        const rawLine = raw[pos];
        if (/^\s*$/.test(rawLine)) { body.push(''); pos++; continue; }
        const li = rawLine.match(/^ */)[0].length;
        if (li <= parentIndent) break;
        if (ind === null) ind = m[3] ? parentIndent + Number(m[3]) : li;
        if (li < ind) break;
        body.push(rawLine.slice(ind));
        pos++;
      }
      while (body.length && body[body.length - 1] === '' && chomp !== '+') body.pop();
      let out;
      if (style === '|') out = body.join('\n');
      else {
        out = '';
        for (let i = 0; i < body.length; i++) {
          const l = body[i];
          if (i === 0) { out = l; continue; }
          if (l === '' || /^\s/.test(l) || /^\s/.test(body[i - 1]) || body[i - 1] === '') out += '\n' + l;
          else out += ' ' + l;
        }
      }
      return chomp === '-' ? out : out + '\n';
    }
    function parseValue(rest, keyIndent, n, owner, key) {
      rest = stripComment(rest);
      if (rest === '') {
        const nx = peek();
        if (nx && (nx.indent > keyIndent || (nx.indent === keyIndent && /^-(\s|$)/.test(nx.text)))) return parseBlock(nx.indent);
        return null;
      }
      if (/^[|>]/.test(rest)) return blockScalar(rest, keyIndent, n);
      return scalar(rest, n);
    }
    function parseBlock(indent) {
      const first = peek();
      if (!first) return null;
      if (/^-(\s|$)/.test(first.text)) return parseSeq(indent);
      return parseMap(indent);
    }
    function splitKey(text, n) {
      if (/^\?\s/.test(text)) throw new Error(`unsupported YAML: complex key (line ${n})`);
      let q = null;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === q) q = null; continue; }
        if ((c === '"' || c === "'") && i === 0) { q = c; continue; }
        if (c === ':' && (i === text.length - 1 || /\s/.test(text[i + 1]))) return [text.slice(0, i), text.slice(i + 1)];
      }
      return null;
    }
    function parseMap(indent) {
      const obj = {};
      for (;;) {
        const l = peek();
        if (!l || l.indent < indent) break;
        if (l.indent > indent) throw new Error(`unsupported YAML: unexpected indentation (line ${l.n})`);
        if (/^-(\s|$)/.test(l.text)) break;
        const kv = splitKey(l.text, l.n);
        if (!kv) throw new Error(`unsupported YAML: expected "key: value" (line ${l.n})`);
        const key = String(scalar(kv[0], l.n));
        pos++;
        setLines(obj, key, l.n);
        obj[key] = parseValue(kv[1], indent, l.n, obj, key);
      }
      return obj;
    }
    function parseSeq(indent) {
      const arr = [];
      for (;;) {
        const l = peek();
        if (!l || l.indent < indent) break;
        if (l.indent > indent) throw new Error(`unsupported YAML: unexpected indentation (line ${l.n})`);
        if (!/^-(\s|$)/.test(l.text)) break;
        const after = l.text.replace(/^-\s*/, '');
        const itemIndent = l.indent + (l.text.length - after.length);
        setLines(arr, arr.length, l.n);
        if (after === '' || /^#/.test(after)) {
          pos++;
          const nx = peek();
          arr.push(nx && nx.indent > l.indent ? parseBlock(nx.indent) : null);
          continue;
        }
        const kv = /^["']/.test(after) && !splitKey(after, l.n) ? null : splitKey(after, l.n);
        if (kv && !/^[[{]/.test(after)) {
          // a mapping that starts on the dash line: rewrite this line as a key line at itemIndent
          lines[pos] = { n: l.n, indent: itemIndent, text: after, raw: l.raw };
          arr.push(parseMap(itemIndent));
          continue;
        }
        pos++;
        const v = stripComment(after);
        if (/^[|>]/.test(v)) { arr.push(blockScalar(v, l.indent, l.n)); continue; }
        arr.push(scalar(v, l.n));
      }
      return arr;
    }
    const doc = parseBlock(peek() ? peek().indent : 0);
    if (peek()) throw new Error(`unsupported YAML: trailing content (line ${peek().n})`);
    return doc;
  }

  // ---------------------------------------------------------------- documented commands
  const RUNNER_WORDS = new Set(['node', 'npm', 'npx', 'pytest', 'py.test', 'python', 'python3', 'tsc']);
  const SHELL_INFO = /^(|sh|bash|shell|console|zsh|text|txt|sh-session|shell-session|powershell|ps1|pwsh|cmd|bat|bash-session)$/i;
  const NO_EXPAND_INFO = /^(powershell|ps1|pwsh|cmd|bat)$/i;
  // A line that presents a command as the whole suite (used only to label doc drift).
  const SUITE_CLAIM = /\b(test suite|full suite|whole suite|entire suite|all (?:the )?(?:\w+ )?tests\b|run the tests|must (?:all )?pass|must be green|green before|should pass before|before (?:any|every) (?:commit|merge|push))/i;
  function firstProgram(text) {
    const t = text.replace(/^\s*[$>]\s+/, '').replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/, '');
    const m = /^(\S+)/.exec(t);
    if (!m) return null;
    if (m[1] === 'cd') {
      const after = /&&\s*(.*)$/.exec(t);
      return after ? firstProgram(after[1]) : null;
    }
    return m[1];
  }
  function pipInstalls(text) {
    const out = [];
    const re = /\b(?:pip3?|python3? -m pip)\s+install\s+([^;&|#\n]*)/g;
    let m;
    while ((m = re.exec(text))) {
      for (const w of m[1].trim().split(/\s+/)) {
        if (!w || w.startsWith('-')) continue;
        const name = w.replace(/^['"]|['"]$/g, '').split(/[<>=!~[;]/)[0].toLowerCase();
        if (name) out.push(name);
      }
    }
    return out;
  }
  function extractDocCommands(text, file) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let fence = null, prevProse = '', blockCmds = [], blockInstalls = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fm = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)/.exec(line);
      if (!fence && fm) {
        fence = { ch: fm[1][0], len: fm[1].length, info: fm[2] || '', start: i + 1, claim: prevProse };
        blockCmds = []; blockInstalls = [];
        continue;
      }
      if (fence) {
        const close = new RegExp('^\\s{0,3}' + (fence.ch === '`' ? '`' : '~') + '{' + fence.len + ',}\\s*$');
        if (close.test(line)) {
          for (const c of blockCmds) c.installs = uniq(blockInstalls);
          fence = null;
          continue;
        }
        const shellish = SHELL_INFO.test(fence.info);
        let t = line.replace(/^\s*[$>]\s+/, '');
        const at = i + 1;
        // a shell line ending in a backslash continues on the next line
        while (shellish && /\\\s*$/.test(t) && i + 1 < lines.length && !/^\s{0,3}(`{3,}|~{3,})\s*$/.test(lines[i + 1])) { t = t.replace(/\\\s*$/, ' ') + lines[++i].trim(); }
        if (shellish) for (const p of pipInstalls(t)) blockInstalls.push(p);
        const prog = firstProgram(t);
        const mk = (text) => ({ file, line: at, text: text.trim(), block: fence.start, shell: NO_EXPAND_INFO.test(fence.info) ? 'none' : 'sh', claim: SUITE_CLAIM.test(t) || SUITE_CLAIM.test(fence.claim), installs: [] });
        if (shellish && prog && RUNNER_WORDS.has(prog)) { const c = mk(t); blockCmds.push(c); out.push(c); continue; }
        // a command written after a label inside a code block: "tests/  ← test suite: node --test …"
        const mid = /(?:[:←→]|—|\s#)\s+((?:node|npm|npx|pytest|py\.test|python3?|tsc)\s[^#←]*?)\s*$/.exec(t);
        if (mid && RUNNER_WORDS.has(firstProgram(mid[1]))) { const c = mk(mid[1]); c.midLine = true; blockCmds.push(c); out.push(c); }
        continue;
      }
      const ind = /^( {4,}|\t)(\S.*)$/.exec(line);
      if (ind && !/^\s*[-*+]\s/.test(line) && !/^\s*\d+\.\s/.test(line)) {
        const t = ind[2].replace(/^[$>]\s+/, '');
        const prog = firstProgram(t);
        if (prog && RUNNER_WORDS.has(prog) && !/`/.test(t)) {
          out.push({ file, line: i + 1, text: t.trim(), block: null, shell: 'sh', claim: SUITE_CLAIM.test(t) || SUITE_CLAIM.test(prevProse), installs: pipInstalls(t) });
          continue;
        }
      }
      const spans = line.match(/`[^`]+`/g) || [];
      for (const sp of spans) {
        const t = sp.slice(1, -1);
        const prog = firstProgram(t);
        if (prog && RUNNER_WORDS.has(prog)) out.push({ file, line: i + 1, text: t.trim(), block: null, shell: 'sh', claim: SUITE_CLAIM.test(line), installs: pipInstalls(t) });
      }
      if (line.trim()) prevProse = line;
    }
    return out;
  }
  function isPlaceholder(text) {
    return /<[^>]*>|\.\.\.|…|\[options?\]|\[[^\]]*\|[^\]]*\]|\bN\b(?=\s|$)/.test(text);
  }

  // ---------------------------------------------------------------- JS source analysis
  // Two blanked copies of a script with identical offsets: `nc` has comments blanked (string
  // literals intact, used to read literals), `code` also blanks the insides of strings,
  // template literals and regex literals (used to find structure).
  function maskJs(src) {
    const nc = src.split(''), code = src.split('');
    const blank = (arr, a, b) => { for (let k = a; k < b; k++) if (arr[k] !== '\n') arr[k] = ' '; };
    let i = 0, lastSig = '';
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(nc, i, end); blank(code, i, end); i = end; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(nc, i, end); blank(code, i, end); i = end; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        blank(code, i + 1, j); i = j + 1; lastSig = 'x'; continue;
      }
      if (c === '`') {
        let j = i + 1, depth = 0;
        while (j < src.length) {
          if (src[j] === '\\') { j += 2; continue; }
          if (depth === 0 && src[j] === '`') break;
          if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
          if (depth > 0 && src[j] === '}') { depth--; j++; continue; }
          j++;
        }
        blank(code, i + 1, j); i = j + 1; lastSig = 'x'; continue;
      }
      if (c === '/' && (lastSig === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
          j++;
        }
        if (src[j] === '/') { blank(code, i + 1, j); i = j + 1; while (/[a-z]/.test(src[i] || '')) i++; lastSig = 'x'; continue; }
      }
      if (!/\s/.test(c)) lastSig = c;
      i++;
    }
    return { nc: nc.join(''), code: code.join('') };
  }
  function matchParen(code, open) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    for (let i = open; i < code.length; i++) {
      const c = code[i];
      if (pairs[c]) stack.push(pairs[c]);
      else if (c === ')' || c === ']' || c === '}') { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
    }
    return -1;
  }
  function splitArgs(nc, code, a, b) {
    const out = []; let depth = 0, start = a;
    for (let i = a; i < b; i++) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) { out.push({ text: nc.slice(start, i).trim(), at: start }); start = i + 1; }
    }
    if (nc.slice(start, b).trim()) out.push({ text: nc.slice(start, b).trim(), at: start });
    return out;
  }
  // Blocks: every '{' in code with its matching '}' and a header (the text before it back to
  // the previous statement boundary), plus the start of the statement each offset sits in.
  function jsBlocks(m) {
    const blocks = [];
    const stack = [];
    for (let i = 0; i < m.code.length; i++) {
      const c = m.code[i];
      if (c === '{') {
        let k = i - 1, depth = 0;
        while (k >= 0) {
          const d = m.code[k];
          if (d === ')' || d === ']') depth++;
          else if (d === '(' || d === '[') { if (depth === 0) break; depth--; }
          else if (depth === 0 && (d === ';' || d === '{' || d === '}')) break;
          k--;
        }
        const header = m.nc.slice(k + 1, i).trim();
        stack.push({ open: i, header, headerAt: k + 1 });
      } else if (c === '}') {
        const b = stack.pop();
        if (b) { b.close = i; blocks.push(b); }
      }
    }
    return blocks;
  }
  function enclosing(blocks, at) {
    return blocks.filter((b) => b.open < at && b.close > at).sort((x, y) => x.open - y.open);
  }
  function stringLit(t) {
    t = t.trim();
    const m = /^(['"])((?:\\.|(?!\1).)*)\1$/.exec(t);
    if (m) return m[2].replace(/\\(.)/g, '$1');
    const tm = /^`([^`$]*)`$/.exec(t);
    if (tm) return tm[1];
    return null;
  }

  // Resolves the files a Node runner script launches. Every launch of node (spawn, spawnSync,
  // execFile(Sync), fork with process.execPath or 'node') must be accounted for by a form below,
  // or the whole script is "not understood".
  //   L1 for (const V of [literals]) { ... launch(..., path.join(DIR, V)) }
  //   L2 ...X.map(f => path.join(DIR, f)) with const X = fs.readdirSync(DIR).filter(PRED)[.sort()]
  //   L3 literal paths path.join(DIR, 'a', 'b.test.mjs')
  //   L4 a function parameter whose function is called from for (const V of A), where A is filled
  //      by a recursive directory walk (searchRoots, a skip predicate on path segments, a suffix)
  //   Enclosing if (fs.existsSync(P)) / else branches become a quoted condition.
  function analyzeNodeScript(tree, script, cwd) {
    const src = tree.read(script);
    if (src == null) return { kind: 'missing' };
    const m = maskJs(src);
    const blocks = jsBlocks(m);
    const res = { kind: 'other', launches: [], nonNode: [], problems: [] };
    const lineOf = (at) => src.slice(0, at).split('\n').length;
    const scriptDir = dirname(script);

    // const bindings: name -> expression text (first declaration wins)
    const consts = new Map();
    const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
    let dm;
    while ((dm = declRe.exec(m.code))) {
      const start = dm.index + dm[0].length;
      let depth = 0, end = start;
      for (; end < m.code.length; end++) {
        const c = m.code[end];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
        else if ((c === ';' || c === '\n') && depth === 0) break;
        else if (c === ',' && depth === 0) break;
      }
      if (!consts.has(dm[1])) consts.set(dm[1], { text: m.nc.slice(start, end).trim(), at: start });
    }
    // path expressions -> tree path (or null when not resolvable)
    const pathExpr = (t, depth) => {
      t = t.trim();
      if (depth > 8) return null;
      const lit = stringLit(t);
      if (lit != null) return { rel: lit };
      if (/^process\.cwd\(\)$/.test(t)) return { abs: normalize(cwd) };
      if (/^__dirname$/.test(t)) return { abs: scriptDir };
      if (/^path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(t) || /^dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(t)) return { abs: scriptDir };
      const pj = /^(?:path\.)?(join|resolve)\(([\s\S]*)\)$/.exec(t);
      if (pj) {
        const mm = maskJs(pj[2]);
        const args = splitArgs(mm.nc, mm.code, 0, mm.code.length);
        let acc = null;
        for (const a of args) {
          const r = pathExpr(a.text, depth + 1);
          if (!r) return null;
          if (r.abs != null) acc = { abs: r.abs };
          else if (acc && acc.abs != null) acc = { abs: join(acc.abs, r.rel) };
          else if (acc) acc = { rel: join(acc.rel, r.rel) };
          else acc = pj[1] === 'resolve' ? { abs: join(normalize(cwd), r.rel) } : { rel: r.rel };
        }
        return acc;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(t) && consts.has(t)) return pathExpr(consts.get(t).text, depth + 1);
      return null;
    };
    const absPath = (t) => {
      const r = pathExpr(t, 0);
      if (!r) return null;
      return r.abs != null ? r.abs : join(normalize(cwd), r.rel);
    };
    // conditions from enclosing if/else blocks around an offset
    const conditionsAt = (at) => {
      const conds = [];
      for (const b of enclosing(blocks, at)) {
        const h = b.header;
        let cm = /^(?:\}\s*)?(?:else\s+)?if\s*\(([\s\S]*)\)$/.exec(h);
        if (cm) {
          const ex = /^fs\.existsSync\(([\s\S]*)\)$/.exec(cm[1].trim()) || /^existsSync\(([\s\S]*)\)$/.exec(cm[1].trim());
          const p = ex ? absPath(ex[1]) : null;
          conds.push({ text: `if (${cm[1].trim()})`, path: p, negated: false });
          continue;
        }
        if (/^(?:\}\s*)?else$/.test(h)) {
          // find the if block that this else closes
          const prev = blocks.filter((x) => x.close < b.open && /if\s*\(/.test(x.header)).sort((x, y) => y.close - x.close)[0];
          if (prev) {
            const pc = /if\s*\(([\s\S]*)\)$/.exec(prev.header);
            const ex = pc && (/^fs\.existsSync\(([\s\S]*)\)$/.exec(pc[1].trim()) || /^existsSync\(([\s\S]*)\)$/.exec(pc[1].trim()));
            conds.push({ text: `else of if (${pc ? pc[1].trim() : '?'})`, path: ex ? absPath(ex[1]) : null, negated: true });
          } else conds.push({ text: 'else', path: null, negated: true, unknown: true });
          continue;
        }
        if (/^(?:while|switch)\b/.test(h) || /\?\s*$/.test(h) || /^catch\b/.test(h)) conds.push({ text: h, unknown: true });
      }
      return conds;
    };
    const stmtPrefix = (at) => {
      let k = at - 1;
      while (k >= 0 && !/[;{}]/.test(m.code[k])) k--;
      return m.nc.slice(k + 1, at).trim();
    };

    // find launch sites
    const callRe = /\b(spawnSync|spawn|execFileSync|execFile|execSync|exec|fork)\s*\(/g;
    let cm;
    const launches = [];
    const execImported = /import\s*\{[^}]*\bexec(Sync)?\b[^}]*\}\s*from\s*['"](node:)?child_process['"]/.test(m.nc);
    while ((cm = callRe.exec(m.code))) {
      const before = m.nc.slice(Math.max(0, cm.index - 24), cm.index);
      if (/function\s+$/.test(before)) continue;
      const member = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before);
      if (member && !/^(child_process|childProcess|cp)$/.test(member[1])) continue;
      if ((cm[1] === 'exec' || cm[1] === 'execSync') && !member && !execImported) continue;
      const open = cm.index + cm[0].length - 1;
      const close = matchParen(m.code, open);
      if (close < 0) { res.problems.push(`unbalanced call at line ${lineOf(cm.index)}`); continue; }
      const args = splitArgs(m.nc, m.code, open + 1, close);
      launches.push({ fn: cm[1], at: cm.index, line: lineOf(cm.index), args });
    }
    const nodeLaunches = [];
    for (const l of launches) {
      const cmd = l.args[0] ? l.args[0].text : '';
      const isNode = l.fn === 'fork' || /^process\.execPath$/.test(cmd) || stringLit(cmd) === 'node';
      const lit = stringLit(cmd);
      if (isNode) nodeLaunches.push(l);
      else if (lit != null) res.nonNode.push({ line: l.line, program: lit.split(/\s+/)[0] });
      else if (/^process\.platform\s*===/.test(cmd) && /\?/.test(cmd)) res.nonNode.push({ line: l.line, program: cmd.replace(/\s+/g, ' ') });
      else res.problems.push(`line ${l.line}: ${l.fn}() with a program the census cannot read: ${cmd.slice(0, 60)}`);
    }
    const testish = /--test\b|\.test\.|\btest_|pytest|node:test|unittest/.test(m.nc);
    if (!nodeLaunches.length || !testish) {
      if (/\bimport\s*\(\s*[^)]*\.test\./.test(m.nc) || /\brequire\(\s*[^)]*\.test\./.test(m.nc)) res.problems.push('imports test files directly');
      res.kind = res.problems.length ? 'not-understood' : 'other';
      res.launchesNode = nodeLaunches.length > 0;
      return res;
    }
    res.kind = 'runner';
    for (const l of nodeLaunches) {
      const prefix = stmtPrefix(l.at);
      if (/^(if|else|while|for|do)\b/.test(prefix) || /\?|&&|\|\|/.test(prefix.replace(/\([^()]*\)/g, ''))) {
        res.problems.push(`line ${l.line}: launch inside a condition the census does not read (${prefix.slice(0, 50)})`);
        continue;
      }
      const arr = l.fn === 'fork' ? null : l.args[1];
      let items;
      if (l.fn === 'fork') items = [l.args[0]];
      else if (!arr || !/^\[[\s\S]*\]$/.test(arr.text)) { res.problems.push(`line ${l.line}: arguments are not an array literal`); continue; }
      else {
        const mm = maskJs(arr.text.slice(1, -1));
        items = splitArgs(mm.nc, mm.code, 0, mm.code.length);
      }
      const flags = [];
      const files = [];
      let ok = true;
      const conds = conditionsAt(l.at);
      if (conds.some((c) => c.unknown)) { res.problems.push(`line ${l.line}: launch inside ${conds.find((c) => c.unknown).text.slice(0, 40)}`); continue; }
      let scriptSeen = false;
      for (const it of items) {
        const t = it.text;
        const lit = stringLit(t);
        if (lit != null && lit.startsWith('-')) { flags.push(lit); continue; }
        if (/^`--[\w-]+=/.test(t)) { flags.push(t.replace(/^`|`$/g, '')); continue; }
        const got = resolveFileArg(t, l);
        if (!got) { ok = false; break; }
        for (const g of got) files.push(g);
        scriptSeen = true;
      }
      if (!ok) continue;
      if (!scriptSeen) { res.problems.push(`line ${l.line}: a node launch with no file argument`); continue; }
      res.launches.push({ line: l.line, test: flags.includes('--test'), flags, files, conditions: conds.map((c) => ({ text: c.text, path: c.path, negated: c.negated })) });
    }
    if (res.problems.length) res.kind = 'not-understood';
    return res;

    function resolveFileArg(t, l) {
      // L3 literal / path.join
      const p = /^(?:path\.)?(?:join|resolve)\(/.test(t) || stringLit(t) != null ? absPath(t) : null;
      if (p != null) return [{ path: p, form: 'literal' }];
      // L2 spread of X.map(f => path.join(DIR, f))
      const sp = /^\.\.\.\s*([A-Za-z_$][\w$]*)\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*(?:path\.)?join\(\s*([A-Za-z_$][\w$.()]*)\s*,\s*\2\s*\)\s*\)$/.exec(t);
      if (sp) {
        const dir = absPath(sp[3]);
        const def = consts.get(sp[1]);
        const rd = def && /^(?:fs\.)?readdirSync\(\s*([^)]*)\)\s*\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]*?)\)\s*(?:\.sort\(\s*\))?$/.exec(def.text);
        if (!rd || dir == null) { res.problems.push(`line ${l.line}: spread of ${sp[1]} that is not a readdirSync(...).filter(...) the census reads`); return null; }
        const rdDir = absPath(rd[1]);
        const pred = readdirPredicate(rd[3], rd[2]);
        if (rdDir == null || !pred) { res.problems.push(`line ${l.line}: readdirSync filter the census does not read: ${rd[3].slice(0, 60)}`); return null; }
        const entry = tree.dirs.get(rdDir);
        const names = entry ? Array.from(entry.files).concat(Array.from(entry.dirs)).sort() : [];
        return names.filter(pred.fn).map((n) => ({ path: join(dir, n), form: 'readdir', rule: `readdirSync(${rdDir || '.'}).filter(${pred.text})` }));
      }
      // identifiers: L1 loop over literals, L4 parameter fed from a walked list
      const id = /^([A-Za-z_$][\w$]*)$/.exec(t) ? t : null;
      const pj = /^(?:path\.)?join\(\s*([A-Za-z_$][\w$.()]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(t);
      const loopVar = id || (pj && pj[2]);
      const base = pj ? absPath(pj[1]) : normalize(cwd);
      if (loopVar && base != null) {
        const vals = loopValues(loopVar, l.at, 0);
        if (vals) return vals.map((v) => ({ path: v.abs ? v.path : join(base, v.path), form: v.form, rule: v.rule }));
      }
      res.problems.push(`line ${l.line}: file argument the census cannot resolve: ${t.slice(0, 60)}`);
      return null;
    }
    function loopValues(name, at, depth) {
      if (depth > 4) return null;
      // L1: for (const name of [literals]) enclosing `at`
      for (const b of enclosing(blocks, at).reverse()) {
        const fm = new RegExp('^for\\s*\\(\\s*(?:const|let|var)\\s+' + name + '\\s+of\\s+([\\s\\S]*)\\)$').exec(b.header);
        if (fm) {
          const src2 = fm[1].trim();
          if (/^\[[\s\S]*\]$/.test(src2)) {
            const mm = maskJs(src2.slice(1, -1));
            const items = splitArgs(mm.nc, mm.code, 0, mm.code.length).map((x) => stringLit(x.text));
            if (items.some((x) => x == null)) return null;
            return items.map((x) => ({ path: x, form: 'list', rule: 'for…of [' + items.length + ' literals]' }));
          }
          if (/^[A-Za-z_$][\w$]*$/.test(src2)) return walkedList(src2);
          return null;
        }
        const fn = new RegExp('^(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(\\s*' + name + '\\s*\\)$').exec(b.header);
        if (fn) {
          // L4: parameter; find call sites fn(x)
          const callRe2 = new RegExp('\\b' + fn[1] + '\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)', 'g');
          let c2, found = null, calls = 0;
          while ((c2 = callRe2.exec(m.code))) {
            if (c2.index >= b.headerAt && c2.index <= b.open) continue;
            calls++;
            const inner = loopValues(c2[1], c2.index, depth + 1);
            if (!inner) return null;
            found = (found || []).concat(inner);
          }
          if (!calls) { res.problems.push(`function ${fn[1]}() launches node but is never called with a plain argument`); return null; }
          return found;
        }
      }
      return null;
    }
    function walkedList(arrName) {
      const def = consts.get(arrName);
      if (!def || def.text !== '[]') return null;
      const pushRe = new RegExp('\\b' + arrName + '\\.push\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)', 'g');
      const pushes = [];
      let pm;
      while ((pm = pushRe.exec(m.code))) pushes.push(pm);
      if (pushes.length !== 1) return null;
      const push = pushes[0];
      const fnBlock = enclosing(blocks, push.index).find((b) => /^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(\s*[A-Za-z_$][\w$]*\s*\)$/.test(b.header));
      if (!fnBlock) return null;
      const fh = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(fnBlock.header);
      const walkName = fh[1], dirParam = fh[2];
      const body = m.nc.slice(fnBlock.open + 1, fnBlock.close);
      const relVar = push[1];
      const relDef = new RegExp('(?:const|let)\\s+' + relVar + '\\s*=\\s*(?:path\\.)?join\\(\\s*' + dirParam + '\\s*,\\s*([A-Za-z_$][\\w$]*)\\.name\\s*\\)').exec(body);
      if (!relDef) return null;
      const entryVar = relDef[1];
      if (!new RegExp('for\\s*\\(\\s*const\\s+' + entryVar + '\\s+of\\s+(?:fs\\.)?readdirSync\\(').test(body)) return null;
      if (!new RegExp(entryVar + '\\.isDirectory\\(\\)\\s*\\)\\s*\\{\\s*' + walkName + '\\(\\s*' + relVar + '\\s*\\)').test(body)) return null;
      const filt = new RegExp('if\\s*\\(\\s*' + entryVar + '\\.isFile\\(\\)\\s*&&\\s*' + entryVar + "\\.name\\.endsWith\\(\\s*(['\"])([^'\"]+)\\1\\s*\\)\\s*\\)\\s*\\{\\s*" + arrName + '\\.push\\(').exec(body);
      if (!filt) return null;
      const suffix = filt[2];
      // skip predicate
      let skip = [];
      const skipCall = new RegExp('if\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\(\\s*' + relVar + '\\s*\\)\\s*\\)\\s*\\{?\\s*continue').exec(body);
      if (skipCall) {
        const sb = blocks.find((b) => new RegExp('^function\\s+' + skipCall[1] + '\\s*\\(').test(b.header));
        if (!sb) return null;
        const sbody = m.nc.slice(sb.open + 1, sb.close).trim();
        const sm = /^return\s+([A-Za-z_$][\w$]*)\.split\(\s*path\.sep\s*\)\.some\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*([\s\S]*?)\);?$/.exec(sbody);
        if (!sm) return null;
        const terms = sm[3].split('||').map((x) => x.trim());
        for (const term of terms) {
          const tm = new RegExp('^' + sm[2] + "\\s*===\\s*(['\"])([^'\"]+)\\1$").exec(term);
          if (!tm) return null;
          skip.push(tm[2]);
        }
      } else if (/continue/.test(body.replace(new RegExp(walkName + '\\(\\s*' + relVar + '\\s*\\);\\s*continue', 'g'), ''))) return null;
      // root of the walk
      let walkBase;
      const rdArg = /(?:fs\.)?readdirSync\(\s*((?:path\.)?join\([^)]*\)|[A-Za-z_$][\w$]*)\s*[,)]/.exec(body);
      if (rdArg) {
        let expr = rdArg[1];
        const local = new RegExp('(?:const|let)\\s+' + expr + '\\s*=\\s*((?:path\\.)?join\\([^)]*\\))').exec(body);
        if (local) expr = local[1];
        if (expr === dirParam) walkBase = normalize(cwd);
        else {
          const jm = new RegExp('^(?:path\\.)?join\\(\\s*([A-Za-z_$][\\w$]*)\\s*,\\s*' + dirParam + '\\s*\\)$').exec(expr);
          if (jm) walkBase = absPath(jm[1]);
        }
      }
      if (walkBase == null) return null;
      // callers: for (const R of ROOTS) { walk(R); } or walk('literal')
      const roots = [];
      const callRe3 = new RegExp('\\b' + walkName + '\\(\\s*([^)]*)\\)', 'g');
      let c3;
      while ((c3 = callRe3.exec(m.code))) {
        if (c3.index > fnBlock.open && c3.index < fnBlock.close) continue;
        if (c3.index >= fnBlock.headerAt && c3.index <= fnBlock.open) continue;
        const a = m.nc.slice(c3.index + walkName.length + 1, c3.index + c3[0].length - 1).trim();
        const lit = stringLit(a);
        if (lit != null) { roots.push(lit); continue; }
        const loop = enclosing(blocks, c3.index).reverse().map((b) => new RegExp('^for\\s*\\(\\s*const\\s+' + a + '\\s+of\\s+([A-Za-z_$][\\w$]*)\\s*\\)$').exec(b.header)).find(Boolean);
        if (!loop) return null;
        const rdef = consts.get(loop[1]);
        if (!rdef || !/^\[[\s\S]*\]$/.test(rdef.text)) return null;
        const mm = maskJs(rdef.text.slice(1, -1));
        for (const it of splitArgs(mm.nc, mm.code, 0, mm.code.length)) {
          const r = pathExpr(it.text, 0);
          if (!r || r.abs != null) return null;
          roots.push(r.rel);
        }
      }
      if (!roots.length) return null;
      const out = [];
      for (const r of roots) {
        const start = join(walkBase, r);
        const rec = (d, relPrefix) => {
          const e = tree.dirs.get(d);
          if (!e) return;
          for (const name of Array.from(e.dirs).sort()) {
            const rel = join(relPrefix, name);
            if (rel.split('/').some((s) => skip.includes(s))) continue;
            rec(join(d, name), rel);
          }
          for (const name of Array.from(e.files).sort()) {
            const rel = join(relPrefix, name);
            if (rel.split('/').some((s) => skip.includes(s))) continue;
            if (name.endsWith(suffix)) out.push({ path: join(walkBase, rel), abs: true, form: 'walk', rule: `walk [${roots.join(', ')}] for *${suffix}${skip.length ? ', skipping ' + skip.join('/') : ''}` });
          }
        };
        if (!tree.dirs.has(start)) { res.problems.push(`walk root ${start || '.'} does not exist (readdirSync would throw)`); return null; }
        if (r.split('/').some((s) => skip.includes(s))) continue;
        rec(start, r);
      }
      return out;
    }
  }
  function readdirPredicate(text, v) {
    const terms = text.split('&&').map((x) => x.trim());
    const fns = [];
    for (const t of terms) {
      const m = new RegExp('^(!?)\\s*' + v + "\\.(endsWith|startsWith|includes)\\(\\s*(['\"])([^'\"]*)\\3\\s*\\)$").exec(t);
      if (!m) return null;
      const neg = m[1] === '!', meth = m[2], arg = m[4];
      fns.push((name) => { const r = name[meth](arg); return neg ? !r : r; });
    }
    return { fn: (name) => fns.every((f) => f(name)), text: `${v} => ${text.replace(/\s+/g, ' ')}` };
  }

  // ---------------------------------------------------------------- inventory
  const TEST_NAME = /(\.(test|spec)\.(mjs|cjs|js|ts|mts|cts)$)|((^|\/)test_[^/]*\.py$)|(_test\.py$)/;
  function inventory(tree) {
    const out = new Map();
    for (const f of tree.files) {
      if (f.split('/').includes('node_modules')) continue;
      if (TEST_NAME.test(f)) out.set(f, { path: f, kind: /\.py$/.test(f) ? 'pytest file' : /\.(ts|mts|cts)$/.test(f) ? 'TypeScript test' : 'Node test', declared: null });
    }
    for (const x of tree.config.extraCandidates || []) {
      for (const f of tree.files) if (globMatch(x.glob, f) && !out.has(f)) out.set(f, { path: f, kind: x.kind, declared: x.why || 'declared in census.config.json' });
    }
    return out;
  }

  // ---------------------------------------------------------------- command evaluation
  const OTHER_PROGRAMS = new Set(['vite', 'git', 'echo', 'printf', 'cat', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'curl', 'wget', 'tar', 'unzip', 'gunzip', 'grep', 'sed', 'awk', 'head', 'tail', 'sort', 'uniq', 'wc', 'tee', 'find', 'xargs', 'true', 'false', 'test', '[', 'export', 'set', 'sleep', 'open', 'start', 'code', 'chmod', 'touch', 'which', 'eslint', 'prettier', 'playwright', 'docker', 'diff', 'jq', 'du', 'gh', 'openscad', 'prusa-slicer', 'pwd', 'source', '.', 'exit', 'kill', 'npm-run-all', 'http-server', 'serve', 'firebase', 'wrangler', 'ruff', 'black', 'mypy', 'flake8']);
  function newCtx(tree, base) {
    return {
      tree,
      cwd: normalize(base.cwd || ''),
      shell: base.shell || 'sh',
      node: base.node || 22,
      nodeKnown: base.nodeKnown !== false,
      installs: (base.installs || []).slice(),
      virtual: new Map(),
      conditions: [],
      via: [],
      depth: 0,
      acc: base.acc,
    };
  }
  function newAcc() {
    return { reach: new Map(), broken: [], notUnderstood: [], others: [], notes: [], nonCandidates: [], versionNotes: [] };
  }
  function addReach(ctx, path, how, extraConds) {
    const real = view(ctx.tree, ctx.virtual).source(path);
    const conds = ctx.conditions.concat(extraConds || []);
    const prev = ctx.acc.reach.get(real);
    const rec = { via: ctx.via.concat([how]).join(' → '), conditions: conds, installs: ctx.installs.slice() };
    if (!prev) ctx.acc.reach.set(real, [rec]);
    else prev.push(rec);
  }
  function evalLine(ctx, line) {
    const parsed = shellParse(line);
    if (parsed.error) { ctx.acc.notUnderstood.push({ what: line.trim().slice(0, 120), why: `shell syntax not modelled (${parsed.error})`, via: ctx.via.join(' → ') }); return; }
    let prevSep = null, failed = false;
    const startCwd = ctx.cwd;
    for (const c of parsed.cmds) {
      // after a cd that cannot succeed, `a && b` does not run b
      if (failed && prevSep === '&&') { prevSep = c.sep; continue; }
      failed = false;
      const pushedCond = prevSep === '||';
      if (pushedCond) ctx.conditions.push({ text: 'runs only if the previous command fails (||)' });
      const before = ctx.acc.broken.length;
      evalSimple(ctx, c);
      if (ctx.acc.broken.length > before && c.words.length && c.words[0].text === 'cd') failed = true;
      if (pushedCond) ctx.conditions.pop();
      prevSep = c.sep;
    }
    ctx.cwd = startCwd;
  }
  function wordsFor(ctx, words) {
    // shell expansion of the words of one simple command
    const v = view(ctx.tree, ctx.virtual);
    const out = [];
    for (const w of words) {
      if (w.hasVar || w.hasSubst) { out.push({ text: w.text, dynamic: true }); continue; }
      if (ctx.shell === 'none' || !(w.magic || (w.brace && ctx.shell === 'bash'))) { out.push({ text: w.text }); continue; }
      for (const x of shExpand(v, ctx.cwd, w.pat, ctx.shell)) out.push(x);
    }
    return out;
  }
  function evalSimple(ctx, c) {
    ctx.display = c.words.map((w) => (/[\s]/.test(w.text) ? shQuote(w.text) : w.text)).join(' ');
    let words = wordsFor(ctx, c.words);
    while (words.length && ['env', 'time', 'command', 'exec', 'nohup'].includes(words[0].text)) {
      words = words.slice(1);
      while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) words = words.slice(1);
    }
    if (words.length && words[0].text === 'timeout') { words = words.slice(1); while (words.length && /^(-|\d)/.test(words[0].text)) words = words.slice(1); }
    if (!words.length) return;
    const prog = words[0].text;
    const args = words.slice(1);
    if (words.some((w) => w.dynamic) && /^(node|npm|npx|pytest|py\.test|python3?|tsc|cd)$/.test(prog)) {
      ctx.acc.notUnderstood.push({ what: words.map((w) => w.text).join(' '), why: 'shell variable or substitution in a runner command', via: ctx.via.join(' → ') });
      return;
    }
    if (prog === 'cd') {
      const d = args[0] ? resolveFrom(ctx.cwd, args[0].text) : '';
      if (d == null || outside(d) || !view(ctx.tree, ctx.virtual).isDir(d)) { ctx.acc.broken.push({ what: `cd ${args[0] ? args[0].text : ''}`, why: 'no such directory in the tracked tree', via: ctx.via.join(' → ') }); return; }
      ctx.cwd = d;
      return;
    }
    if (prog === 'node') return evalNode(ctx, args);
    if (prog === 'npm') return evalNpm(ctx, args);
    if (prog === 'npx') return evalNpx(ctx, args);
    if (prog === 'tsc') return evalTsc(ctx, args);
    if (prog === 'pytest' || prog === 'py.test') return evalPytest(ctx, args);
    if (prog === 'python' || prog === 'python3' || prog === 'py') return evalPython(ctx, args);
    if (prog === 'pip' || prog === 'pip3') {
      if (args[0] && args[0].text === 'install') for (const p of pipInstalls('pip install ' + args.slice(1).map((a) => a.text).join(' '))) ctx.installs.push(p);
      ctx.acc.others.push({ what: [prog].concat(args.map((a) => a.text)).join(' '), via: ctx.via.join(' → ') });
      return;
    }
    if (prog === 'sh' || prog === 'bash' || /^\.\/.*\.sh$/.test(prog)) {
      const script = prog.startsWith('./') ? prog : args[0] && args[0].text;
      if (!script || /^-/.test(script)) { ctx.acc.notUnderstood.push({ what: prog + ' ' + args.map((a) => a.text).join(' '), why: 'inline shell invocation', via: ctx.via.join(' → ') }); return; }
      return evalShellScript(ctx, script);
    }
    if (OTHER_PROGRAMS.has(prog)) { ctx.acc.others.push({ what: [prog].concat(args.map((a) => a.text)).join(' ').slice(0, 120), via: ctx.via.join(' → ') }); return; }
    ctx.acc.notUnderstood.push({ what: [prog].concat(args.map((a) => a.text)).join(' ').slice(0, 120), why: `program "${prog}" is not modelled`, via: ctx.via.join(' → '), unknownProgram: true });
  }
  function evalShellScript(ctx, script) {
    const p = resolveFrom(ctx.cwd, script);
    const src = p != null ? ctx.tree.read(p) : null;
    if (src == null) { ctx.acc.broken.push({ what: script, why: 'shell script not in the tracked tree', via: ctx.via.join(' → ') }); return; }
    if (/^\s*(if|for|while|case|function)\b|\(\)\s*\{/m.test(src)) { ctx.acc.notUnderstood.push({ what: p, why: 'shell script with control flow', via: ctx.via.join(' → ') }); return; }
    ctx.via.push(`sh ${p}`);
    const save = ctx.cwd;
    for (const l of src.split('\n')) if (l.trim() && !/^\s*#/.test(l)) evalLine(ctx, l.replace(/\\$/, ''));
    ctx.cwd = save;
    ctx.via.pop();
  }

  const NODE_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--env-file', '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern', '--test-concurrency', '--test-timeout', '--test-shard', '--input-type', '--title', '--stack-size', '--watch-path', '--test-isolation', '--test-coverage-include', '--test-coverage-exclude']);
  function evalNode(ctx, args) {
    let i = 0, test = false;
    const flags = [];
    for (; i < args.length; i++) {
      const a = args[i].text;
      if (!a.startsWith('-') || a === '-') break;
      if (a === '--') { i++; break; }
      if (a === '--test') { test = true; continue; }
      if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') { ctx.acc.others.push({ what: 'node ' + a + ' <inline code>', via: ctx.via.join(' → ') }); return; }
      flags.push(a);
      if (NODE_VALUE_FLAGS.has(a)) { i++; flags.push(args[i] ? args[i].text : ''); }
    }
    const conds = [];
    const fl = flags.join(' ');
    if (/--test-name-pattern|--test-skip-pattern|--test-only/.test(fl)) conds.push({ text: 'tests inside the files are filtered by name' });
    if (/--test-shard/.test(fl)) conds.push({ text: 'files are sharded: each run reaches only part of the list' });
    if (test) return evalNodeTest(ctx, args.slice(i), conds);
    const script = args[i];
    if (!script) { ctx.acc.others.push({ what: 'node (REPL)', via: ctx.via.join(' → ') }); return; }
    return evalNodeScript(ctx, script.text, conds);
  }
  function evalNodeScript(ctx, scriptText, conds) {
    const v = view(ctx.tree, ctx.virtual);
    const p = resolveFrom(ctx.cwd, scriptText);
    const cands = ctx.candidates;
    if (p == null || outside(p) || !v.isFile(p)) {
      // node resolves a bare path without extension too; keep it simple and say so
      ctx.acc.broken.push({ what: `node ${scriptText}`, why: 'script not in the tracked tree (Cannot find module)', via: ctx.via.join(' → '), path: p });
      return;
    }
    const src = v.source(p);
    if (cands && cands.has(src)) { ctx.conditions.push(...conds); addReach(ctx, p, `node ${scriptText}`); ctx.conditions.splice(ctx.conditions.length - conds.length, conds.length); return; }
    if (ctx.depth > 6) { ctx.acc.notUnderstood.push({ what: p, why: 'runner nesting deeper than 6', via: ctx.via.join(' → ') }); return; }
    const an = analyzeNodeScript(ctx.tree, src, ctx.cwd);
    if (an.kind === 'missing') { ctx.acc.broken.push({ what: `node ${scriptText}`, why: 'cannot read the script', via: ctx.via.join(' → ') }); return; }
    if (an.kind === 'other') {
      const s = ctx.tree.read(src) || '';
      if (/--test\b|node:test|\.test\.(m|c)?js|pytest/.test(maskJs(s).nc) && /\b(spawn|spawnSync|execFile|execFileSync|fork|import\()/.test(s)) {
        ctx.acc.notUnderstood.push({ what: src, why: 'script mentions tests and launches processes or imports modules, but no launch form the census reads', via: ctx.via.join(' → ') });
        return;
      }
      ctx.acc.others.push({ what: `node ${src}`, via: ctx.via.join(' → ') });
      return;
    }
    if (an.kind === 'not-understood') { ctx.acc.notUnderstood.push({ what: src, why: 'runner not understood: ' + an.problems.join('; '), via: ctx.via.join(' → ') }); return; }
    ctx.via.push(`node ${src}`);
    ctx.depth++;
    for (const l of an.launches) {
      const lconds = l.conditions.map((c) => ({ text: `${src}:${l.line} ${c.text}`, path: c.path, negated: c.negated }));
      for (const f of l.files) {
        const fv = view(ctx.tree, ctx.virtual);
        if (!fv.isFile(f.path)) {
          ctx.acc.broken.push({ what: f.path, why: `named by ${src}:${l.line} (${f.form}) but not in the tracked tree`, via: ctx.via.join(' → ') });
          continue;
        }
        const how = `${l.test ? 'node --test' : 'node'} ${f.path}  [${src}:${l.line}, ${f.rule || f.form}]`;
        ctx.conditions.push(...conds, ...lconds);
        if (ctx.candidates.has(fv.source(f.path))) addReach(ctx, f.path, how);
        else ctx.acc.nonCandidates.push({ path: f.path, via: ctx.via.concat([how]).join(' → ') });
        ctx.conditions.splice(ctx.conditions.length - conds.length - lconds.length, conds.length + lconds.length);
      }
    }
    for (const nn of an.nonNode) ctx.acc.others.push({ what: `${nn.program} (spawned by ${src}:${nn.line})`, via: ctx.via.join(' → ') });
    ctx.depth--;
    ctx.via.pop();
  }
  // node --test: Node >= 21 treats each argument as a glob; Node 20 takes paths and searches
  // directories with its default patterns, and one missing path stops the whole run.
  const NODE20_DEFAULT = (rel) => {
    const b = basename(rel);
    if (!/\.(c|m)?js$/.test(b)) return false;
    const stem = b.replace(/\.(c|m)?js$/, '');
    if (/^test$/.test(stem) || /^test-.+/.test(stem) || /.+[.\-_]test$/.test(stem)) return true;
    return rel.split('/').slice(0, -1).includes('test');
  };
  function nodeTestReach(ctx, patterns, version) {
    const v = view(ctx.tree, ctx.virtual);
    const files = [], problems = [], notes = [];
    if (!patterns.length) return { notModelled: 'node --test with no file arguments (default discovery is not modelled)' };
    if (version >= 21) {
      for (const p of patterns) {
        const hits = nodeGlob(v, ctx.cwd, p);
        if (!hits.length) { notes.push(`"${p}" matches nothing (Node ${version} runs no file for it and does not fail)`); continue; }
        for (const h of hits) {
          if (v.isDir(h) && !v.isFile(h)) problems.push(`"${p}" matches the directory ${h || '.'}: Node ≥21 hands it to the loader, which fails (Cannot find module)`);
          else files.push(h);
        }
      }
    } else {
      for (const p of patterns) {
        const q = resolveFrom(ctx.cwd, p.replace(/\\(.)/g, '$1'));
        if (q != null && v.isFile(q)) { files.push(q); continue; }
        if (q != null && v.isDir(q)) {
          const rec = (d) => { const e = v.list(d); for (const n of e.dirs) if (n !== 'node_modules') rec(join(d, n)); for (const n of e.files) { const f = join(d, n); if (NODE20_DEFAULT(relativeTo(q, f)) || NODE20_DEFAULT(f)) files.push(f); } };
          rec(q);
          continue;
        }
        return { files: [], problems: [`"${p}" is not a path Node 20 can find: the whole run stops (Could not find)`], notes };
      }
    }
    return { files: uniq(files), problems, notes };
  }
  function evalNodeTest(ctx, argWords, conds) {
    const patterns = argWords.map((w) => w.text);
    const primary = nodeTestReach(ctx, patterns, ctx.node);
    if (primary.notModelled) { ctx.acc.notUnderstood.push({ what: 'node --test', why: primary.notModelled, via: ctx.via.join(' → ') }); return; }
    const other = nodeTestReach(ctx, patterns, ctx.node >= 21 ? 20 : 22);
    const a = primary.files.slice().sort().join('\n'), b = (other.files || []).slice().sort().join('\n');
    const label = ctx.display && /^node\b/.test(ctx.display) ? ctx.display : `node --test ${patterns.join(' ')}`;
    if (a !== b || primary.problems.length !== (other.problems || []).length) {
      ctx.acc.versionNotes.push({ what: label, primary: { node: ctx.node, files: primary.files.length, problems: primary.problems }, other: { node: ctx.node >= 21 ? 20 : '≥21', files: (other.files || []).length, problems: other.problems || [] }, nodeKnown: ctx.nodeKnown });
    }
    for (const pr of primary.problems) ctx.acc.broken.push({ what: label, why: pr, via: ctx.via.join(' → ') });
    for (const n of primary.notes) ctx.acc.notes.push({ what: label, why: n, via: ctx.via.join(' → ') });
    if (!ctx.nodeKnown && a !== b) ctx.conditions.push({ text: 'Node version of this step is not pinned; Node 20 and Node ≥21 reach different files here' });
    ctx.conditions.push(...conds);
    const v = view(ctx.tree, ctx.virtual);
    for (const f of primary.files) {
      if (ctx.candidates.has(v.source(f))) addReach(ctx, f, label);
      else ctx.acc.nonCandidates.push({ path: f, via: ctx.via.concat([label]).join(' → ') });
    }
    ctx.conditions.splice(ctx.conditions.length - conds.length, conds.length);
    if (!ctx.nodeKnown && a !== b) ctx.conditions.pop();
  }
  function findPackage(ctx, from) {
    let d = from;
    for (;;) {
      const p = join(d, 'package.json');
      if (ctx.tree.fileSet.has(p)) return { dir: d, path: p };
      if (d === '') return null;
      d = dirname(d);
    }
  }
  function evalNpm(ctx, args) {
    const t = args.map((a) => a.text);
    let i = 0;
    while (i < t.length && t[i].startsWith('-')) {
      if (['--prefix', '-C', '--workspace', '-w', '--workspaces', '-ws'].includes(t[i])) { ctx.acc.notUnderstood.push({ what: 'npm ' + t.join(' '), why: `npm option ${t[i]} is not modelled`, via: ctx.via.join(' → ') }); return; }
      i++;
    }
    const sub = t[i];
    const rest = t.slice(i + 1);
    if (['test', 't', 'tst'].includes(sub)) return npmRun(ctx, 'test', rest);
    if (['run', 'run-script', 'rum', 'urn'].includes(sub)) {
      const r = rest.filter((x) => !/^--(silent|if-present)$|^-s$/.test(x));
      if (!r.length) { ctx.acc.others.push({ what: 'npm run (lists scripts)', via: ctx.via.join(' → ') }); return; }
      return npmRun(ctx, r[0], r.slice(1), rest.includes('--if-present'));
    }
    if (['start', 'stop', 'restart'].includes(sub)) return npmRun(ctx, sub, rest);
    if (['ci', 'install', 'i', 'add', 'clean-install', 'install-clean', 'isntall'].includes(sub)) {
      const pkg = findPackage(ctx, ctx.cwd);
      ctx.acc.others.push({ what: `npm ${sub}${pkg ? ' (' + pkg.path + ')' : ''}`, via: ctx.via.join(' → ') });
      if (pkg && rest.filter((x) => !x.startsWith('-')).length === 0) {
        let json = null;
        try { json = JSON.parse(ctx.tree.read(pkg.path)); } catch (e) { json = null; }
        for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) if (json && json.scripts && json.scripts[hook]) npmRun(ctx, hook, []);
      }
      return;
    }
    if (['exec', 'x'].includes(sub)) return evalNpx(ctx, args.slice(i + 1));
    ctx.acc.others.push({ what: 'npm ' + t.join(' '), via: ctx.via.join(' → ') });
  }
  function npmRun(ctx, name, extra, ifPresent) {
    let pkg = findPackage(ctx, ctx.cwd);
    if (!pkg && ctx.docMode) {
      // a documented `npm run X` with no package.json above the doc: read it against the one
      // package.json that defines X, if exactly one does
      const owners = ctx.tree.files.filter((f) => /(^|\/)package\.json$/.test(f) && !f.split('/').includes('node_modules')).filter((f) => { try { const j = JSON.parse(ctx.tree.read(f)); return !!(j.scripts && j.scripts[name]); } catch (e) { return false; } });
      if (owners.length === 1) { pkg = { dir: dirname(owners[0]), path: owners[0] }; ctx.acc.notes.push({ what: `npm run ${name}`, why: `read against ${owners[0]}, the only package.json with a "${name}" script` }); }
    }
    if (!pkg) { ctx.acc.broken.push({ what: `npm run ${name}`, why: `no package.json at or above ${ctx.cwd || '.'}`, via: ctx.via.join(' → ') }); return; }
    let json;
    try { json = JSON.parse(ctx.tree.read(pkg.path)); } catch (e) { ctx.acc.notUnderstood.push({ what: pkg.path, why: 'package.json does not parse', via: ctx.via.join(' → ') }); return; }
    const scripts = (json && json.scripts) || {};
    if (!scripts[name]) {
      if (!ifPresent) ctx.acc.broken.push({ what: `npm run ${name}`, why: `${pkg.path} has no "${name}" script`, via: ctx.via.join(' → ') });
      return;
    }
    if (ctx.depth > 8) { ctx.acc.notUnderstood.push({ what: `npm run ${name}`, why: 'npm script nesting deeper than 8', via: ctx.via.join(' → ') }); return; }
    const dd = extra.indexOf('--');
    const passed = dd >= 0 ? extra.slice(dd + 1) : extra.filter((x) => !x.startsWith('-'));
    const save = { cwd: ctx.cwd, shell: ctx.shell };
    ctx.depth++;
    for (const n of ['pre' + name, name, 'post' + name]) {
      if (!scripts[n]) continue;
      ctx.cwd = pkg.dir; ctx.shell = 'sh';
      ctx.via.push(`npm run ${n} (${pkg.path})`);
      evalLine(ctx, scripts[n] + (n === name && passed.length ? ' ' + passed.map(shQuote).join(' ') : ''));
      ctx.via.pop();
    }
    ctx.depth--;
    ctx.cwd = save.cwd; ctx.shell = save.shell;
  }
  function shQuote(s) { return /^[\w./=:@%+-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }
  function evalNpx(ctx, args) {
    let i = 0;
    while (i < args.length && args[i].text.startsWith('-')) { if (['-p', '--package'].includes(args[i].text)) i++; i++; }
    const bin = args[i] ? args[i].text : null;
    if (!bin) return;
    if (bin === 'tsc') return evalTsc(ctx, args.slice(i + 1));
    if (bin === 'pytest') return evalPytest(ctx, args.slice(i + 1));
    if (OTHER_PROGRAMS.has(bin) || bin === 'http-server') { ctx.acc.others.push({ what: 'npx ' + args.slice(i).map((a) => a.text).join(' '), via: ctx.via.join(' → ') }); return; }
    ctx.acc.notUnderstood.push({ what: 'npx ' + bin, why: `npx ${bin} is not modelled`, via: ctx.via.join(' → '), unknownProgram: true });
  }
  // tsc: emits per tsconfig (include/exclude/rootDir/outDir) or per command-line files. The
  // emitted .js paths are added to the chain's view so a later `node --test dist/...` finds them.
  function lenientJson(text) {
    let out = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { out += c; if (c === '\\') { out += text[++i]; } else if (c === '"') q = false; continue; }
      if (c === '"') { q = true; out += c; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
      out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }
  function evalTsc(ctx, args) {
    const t = args.map((a) => a.text);
    let project = null, noEmit = false, outDir = null, rootDir = null;
    const files = [];
    for (let i = 0; i < t.length; i++) {
      const a = t[i];
      if (a === '-p' || a === '--project') { project = t[++i]; continue; }
      if (a === '--noEmit') { noEmit = true; continue; }
      if (a === '--outDir') { outDir = t[++i]; continue; }
      if (a === '--rootDir') { rootDir = t[++i]; continue; }
      if (a === '-b' || a === '--build' || a === '--outFile' || a === '--watch' || a === '-w') { ctx.acc.notUnderstood.push({ what: 'tsc ' + t.join(' '), why: `tsc ${a} is not modelled`, via: ctx.via.join(' → ') }); return; }
      if (/^--(target|lib|module|moduleResolution|jsx)$/.test(a)) { i++; continue; }
      if (a.startsWith('-')) continue;
      files.push(a);
    }
    const label = 'tsc ' + t.join(' ');
    let inputs = [], cfgDir = ctx.cwd, cfgOut = null, cfgRoot = null;
    if (files.length) {
      for (const f of files) { const p = resolveFrom(ctx.cwd, f); if (p != null && ctx.tree.fileSet.has(p)) inputs.push(p); }
    } else {
      let cfgPath;
      if (project) { const p = resolveFrom(ctx.cwd, project); cfgPath = p != null && ctx.tree.fileSet.has(p) ? p : join(p || '', 'tsconfig.json'); }
      else { let d = ctx.cwd; for (;;) { if (ctx.tree.fileSet.has(join(d, 'tsconfig.json'))) { cfgPath = join(d, 'tsconfig.json'); break; } if (d === '') break; d = dirname(d); } }
      const text = cfgPath ? ctx.tree.read(cfgPath) : null;
      if (text == null) { ctx.acc.broken.push({ what: label, why: 'no tsconfig.json found', via: ctx.via.join(' → ') }); return; }
      let cfg;
      try { cfg = lenientJson(text); } catch (e) { ctx.acc.notUnderstood.push({ what: cfgPath, why: 'tsconfig does not parse', via: ctx.via.join(' → ') }); return; }
      const co = cfg.compilerOptions || {};
      if (cfg.extends || cfg.references || cfg.files || co.outFile || co.composite) { ctx.acc.notUnderstood.push({ what: cfgPath, why: 'tsconfig uses extends/references/files/outFile/composite, which the census does not model', via: ctx.via.join(' → ') }); return; }
      if (co.noEmit) noEmit = true;
      cfgDir = dirname(cfgPath);
      cfgOut = co.outDir != null ? join(cfgDir, co.outDir) : null;
      cfgRoot = co.rootDir != null ? join(cfgDir, co.rootDir) : null;
      const include = cfg.include || ['**/*'];
      const exclude = (cfg.exclude || []).map((x) => join(cfgDir, x));
      for (const f of ctx.tree.files) {
        if (!/\.(ts|tsx|mts|cts)$/.test(f) || /\.d\.(m|c)?ts$/.test(f)) continue;
        if (f.split('/').includes('node_modules')) continue;
        const rel = relativeTo(cfgDir, f);
        if (!include.some((g) => globMatch(normalize(join(cfgDir, g)), f) || (/\*\*\/\*$/.test(g) && globMatch(normalize(join(cfgDir, g)) + '.*', f)))) continue;
        if (exclude.some((g) => globMatch(g, f) || globMatch(g + '/**', f))) continue;
        if (cfgOut && (f === cfgOut || f.startsWith(cfgOut + '/'))) continue;
        void rel;
        inputs.push(f);
      }
    }
    if (noEmit) { ctx.acc.others.push({ what: label + ' (type-check only, emits nothing)', via: ctx.via.join(' → ') }); return; }
    const out = outDir != null ? resolveFrom(ctx.cwd, outDir) : cfgOut;
    let root = rootDir != null ? resolveFrom(ctx.cwd, rootDir) : cfgRoot;
    if (root == null) {
      const ds = inputs.map((f) => dirname(f).split('/'));
      let common = ds.length ? ds[0] : [];
      for (const d of ds) { let k = 0; while (k < common.length && k < d.length && common[k] === d[k]) k++; common = common.slice(0, k); }
      root = common.join('/');
    }
    let n = 0;
    for (const f of inputs) {
      const rel = relativeTo(root, f);
      if (outside(rel)) { ctx.acc.notUnderstood.push({ what: label, why: `${f} is outside rootDir ${root}`, via: ctx.via.join(' → ') }); return; }
      const js = rel.replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs').replace(/\.tsx?$/, '.js');
      ctx.virtual.set(out != null ? join(out, js) : join(root, js), f);
      n++;
    }
    ctx.acc.others.push({ what: `${label} (emits ${n} file${n === 1 ? '' : 's'}${out != null ? ' to ' + out : ''})`, via: ctx.via.join(' → ') });
  }
  // pytest with no configuration: test_*.py and *_test.py under each path, skipping the default
  // norecursedirs; explicit files are collected whatever their name. Any pytest configuration
  // file or conftest hook that changes collection makes the run "not understood".
  const PYTEST_NORECURSE = ['*.egg', '.*', '_darcs', 'build', 'CVS', 'dist', 'node_modules', 'venv', '{arch}'];
  function evalPytest(ctx, args) {
    const t = args.map((a) => a.text);
    const paths = [], ignores = [], conds = [];
    for (let i = 0; i < t.length; i++) {
      const a = t[i];
      if (/^(-v+|-q+|-x|-s|-l|--tb=\w+|-r\w*|--color=\w+|--durations=\d+|--strict-markers|--disable-warnings|--maxfail=\d+|--exitfirst|--verbose|--quiet|--collect-only|--co|-p\s*no:cacheprovider)$/.test(a)) continue;
      if (a === '--tb' || a === '--maxfail' || a === '--durations' || a === '--color') { i++; continue; }
      if (a === '-p') { i++; if (t[i] !== 'no:cacheprovider') { ctx.acc.notUnderstood.push({ what: 'pytest ' + t.join(' '), why: `plugin option -p ${t[i]}`, via: ctx.via.join(' → ') }); return; } continue; }
      if (a === '-W') { i++; continue; }
      if (a === '-k' || a === '-m') { conds.push({ text: `pytest ${a} ${t[i + 1]} selects tests inside the files` }); i++; continue; }
      if (/^--ignore=/.test(a)) { ignores.push(a.slice(9)); continue; }
      if (a === '--ignore') { ignores.push(t[++i]); continue; }
      if (a.startsWith('-')) { ctx.acc.notUnderstood.push({ what: 'pytest ' + t.join(' '), why: `pytest option ${a} is not modelled`, via: ctx.via.join(' → ') }); return; }
      paths.push(a.split('::')[0]);
    }
    const label = ctx.display && /^(pytest|py\.test|python)/.test(ctx.display) ? ctx.display : 'pytest ' + t.join(' ');
    // configuration that changes collection
    let d = ctx.cwd;
    for (;;) {
      for (const f of ['pytest.ini', '.pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg']) {
        const p = join(d, f);
        const s = ctx.tree.fileSet.has(p) ? ctx.tree.read(p) : null;
        if (s != null && (f.includes('pytest') || /\[(tool\.pytest\.ini_options|pytest|tool:pytest)\]/.test(s))) { ctx.acc.notUnderstood.push({ what: label, why: `pytest configuration in ${p} is not modelled`, via: ctx.via.join(' → ') }); return; }
      }
      if (d === '') break;
      d = dirname(d);
    }
    const v = view(ctx.tree, ctx.virtual);
    const starts = paths.length ? paths : ['.'];
    const found = [];
    const ignoreAbs = ignores.map((x) => resolveFrom(ctx.cwd, x));
    const norecurse = (name) => PYTEST_NORECURSE.some((g) => segRegex(g.replace(/[{}]/g, '\\$&')).test(name));
    for (const s of starts) {
      const p = resolveFrom(ctx.cwd, s);
      if (p == null || outside(p)) { ctx.acc.broken.push({ what: label, why: `path ${s} is outside the tree`, via: ctx.via.join(' → ') }); continue; }
      if (v.isFile(p)) { found.push(p); continue; }
      if (!v.isDir(p)) { ctx.acc.broken.push({ what: label, why: `file or directory not found: ${s} (pytest exits 4)`, via: ctx.via.join(' → ') }); continue; }
      const rec = (dir) => {
        if (ignoreAbs.includes(dir)) return;
        const e = v.list(dir);
        const conftest = join(dir, 'conftest.py');
        if (v.isFile(conftest)) {
          const c = ctx.tree.read(conftest) || '';
          if (/collect_ignore|pytest_ignore_collect|pytest_collect_file|pytest_collection_modifyitems|pytest_pycollect/.test(c)) { ctx.acc.notUnderstood.push({ what: label, why: `${conftest} changes collection`, via: ctx.via.join(' → ') }); return 'stop'; }
        }
        for (const f of e.files) {
          const fp = join(dir, f);
          if (ignoreAbs.includes(fp)) continue;
          if (/^test_.*\.py$/.test(f) || /_test\.py$/.test(f)) found.push(fp);
        }
        for (const sub of e.dirs) { if (norecurse(sub)) continue; if (rec(join(dir, sub)) === 'stop') return 'stop'; }
        return null;
      };
      if (rec(p) === 'stop') return;
    }
    ctx.conditions.push(...conds);
    for (const f of uniq(found)) {
      const fileConds = pythonFileConditions(ctx.tree, f, ctx.installs);
      if (ctx.candidates.has(f)) addReach(ctx, f, label, fileConds);
      else ctx.acc.nonCandidates.push({ path: f, via: ctx.via.concat([label]).join(' → ') });
    }
    ctx.conditions.splice(ctx.conditions.length - conds.length, conds.length);
  }
  // Module-level skips make a reached file contribute nothing. Only column-0 statements count
  // (an importorskip inside a fixture skips some tests, not the file).
  function pythonFileConditions(tree, f, installs) {
    const src = tree.read(f) || '';
    const out = [];
    const re = /^(?:pytest\.importorskip|importorskip)\(\s*(['"])([\w.]+)\1/gm;
    let m;
    while ((m = re.exec(src))) {
      const mod = m[2].split('.')[0].toLowerCase();
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ text: `${f}:${line} pytest.importorskip("${m[2]}") skips the whole file unless ${m[2]} is importable`, module: mod, satisfied: installs.includes(mod) });
    }
    const re2 = /^(pytestmark\s*=\s*pytest\.mark\.skipif\(.*|pytest\.skip\(.*allow_module_level\s*=\s*True.*)$/gm;
    while ((m = re2.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      out.push({ text: `${f}:${line} ${m[1].slice(0, 80)}`, module: null, satisfied: null });
    }
    return out;
  }
  function evalPython(ctx, args) {
    const t = args.map((a) => a.text);
    let i = 0;
    while (i < t.length && t[i].startsWith('-') && t[i] !== '-m' && t[i] !== '-c') { if (['-W', '-X'].includes(t[i])) i++; i++; }
    if (t[i] === '-c') { ctx.acc.others.push({ what: 'python -c <inline code>', via: ctx.via.join(' → ') }); return; }
    if (t[i] === '-m') {
      const mod = t[i + 1];
      if (mod === 'pytest') return evalPytest(ctx, args.slice(i + 2));
      if (mod === 'pip') { if (t[i + 2] === 'install') for (const p of pipInstalls('pip install ' + t.slice(i + 3).join(' '))) ctx.installs.push(p); ctx.acc.others.push({ what: 'python -m pip ' + t.slice(i + 2).join(' '), via: ctx.via.join(' → ') }); return; }
      if (mod === 'unittest') { ctx.acc.notUnderstood.push({ what: 'python -m unittest ' + t.slice(i + 2).join(' '), why: 'unittest discovery is not modelled', via: ctx.via.join(' → ') }); return; }
      ctx.acc.others.push({ what: 'python -m ' + t.slice(i + 1).join(' '), via: ctx.via.join(' → ') });
      return;
    }
    const script = t[i];
    if (!script) return;
    const p = resolveFrom(ctx.cwd, script);
    if (p == null || !ctx.tree.fileSet.has(p)) { ctx.acc.broken.push({ what: `python ${script}`, why: 'script not in the tracked tree', via: ctx.via.join(' → ') }); return; }
    if (ctx.candidates.has(p)) { addReach(ctx, p, `python ${script}`, pythonFileConditions(ctx.tree, p, ctx.installs)); return; }
    const src = ctx.tree.read(p) || '';
    if (/\b(pytest\.main|unittest\.main|TextTestRunner|TestLoader)\b/.test(src) || (/\bsubprocess\b/.test(src) && /pytest|unittest/.test(src))) {
      ctx.acc.notUnderstood.push({ what: p, why: 'Python script that may run tests in a way the census does not model', via: ctx.via.join(' → ') });
      return;
    }
    ctx.acc.others.push({ what: `python ${p}`, via: ctx.via.join(' → ') });
  }

  // ---------------------------------------------------------------- entries (where commands come from)
  function workflowEntries(tree) {
    const entries = [], problems = [];
    const wfs = tree.files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
    for (const wf of wfs) {
      let doc;
      try { doc = parseYaml(tree.read(wf)); } catch (e) { problems.push({ what: wf, why: e.message }); continue; }
      if (!doc || typeof doc !== 'object' || !doc.jobs) { problems.push({ what: wf, why: 'no jobs' }); continue; }
      const wfDefaults = (doc.defaults && doc.defaults.run) || {};
      for (const jobId of Object.keys(doc.jobs)) {
        const job = doc.jobs[jobId] || {};
        const jobLine = doc.jobs.__lines ? doc.jobs.__lines[jobId] : null;
        if (job.uses) { problems.push({ what: `${wf}:${jobLine} job ${jobId}`, why: 'reusable workflow call is not modelled' }); continue; }
        const jd = (job.defaults && job.defaults.run) || {};
        const steps = Array.isArray(job.steps) ? job.steps : [];
        let node = null, nodeKnown = false, python = null;
        const installs = [];
        const virtual = new Map();
        steps.forEach((step, idx) => {
          if (!step || typeof step !== 'object') return;
          const sl = steps.__lines ? steps.__lines[idx] : null;
          if (typeof step.uses === 'string' && /^actions\/setup-node@/.test(step.uses)) {
            const ver = step.with && step.with['node-version'];
            const mm = ver != null ? /^v?(\d+)/.exec(String(ver)) : null;
            if (mm) { node = Number(mm[1]); nodeKnown = true; } else { node = 22; nodeKnown = false; }
          }
          if (typeof step.uses === 'string' && /^actions\/setup-python@/.test(step.uses)) python = step.with && step.with['python-version'];
          if (typeof step.run !== 'string') return;
          const runLine = step.__lines && step.__lines.run ? step.__lines.run : sl;
          const conds = [];
          if (job.if) conds.push({ text: `job if: ${job.if}` });
          if (step.if) conds.push({ text: `step if: ${step.if}` });
          if (job.strategy && job.strategy.matrix) conds.push({ text: 'job runs once per matrix entry' });
          entries.push({
            kind: 'ci', id: `ci:${wf}#${jobId}.${idx}`, source: `${wf}:${runLine}`, file: wf, line: runLine,
            job: jobId, jobName: job.name || jobId, stepName: step.name || null, command: step.run.replace(/\n$/, ''),
            cwd: step['working-directory'] || jd['working-directory'] || wfDefaults['working-directory'] || '',
            shell: step.shell || jd.shell || wfDefaults.shell || 'bash', node: node == null ? 22 : node, nodeKnown, python,
            installs, virtual, conditions: conds, triggers: doc.on || doc.true || null,
          });
        });
      }
    }
    return { entries, problems };
  }
  function scriptEntries(tree) {
    const out = [];
    for (const f of tree.files.filter((x) => /(^|\/)package\.json$/.test(x) && !x.split('/').includes('node_modules'))) {
      let json;
      try { json = JSON.parse(tree.read(f)); } catch (e) { out.push({ kind: 'script', id: `script:${f}`, source: f, broken: 'package.json does not parse' }); continue; }
      const scripts = (json && json.scripts) || {};
      const text = tree.read(f);
      for (const name of Object.keys(scripts)) {
        if (/^(pre|post)/.test(name) && scripts[name.replace(/^(pre|post)/, '')]) continue;
        const idx = text.indexOf(JSON.stringify(name) + ':');
        const line = idx < 0 ? null : text.slice(0, idx).split('\n').length;
        out.push({ kind: 'script', id: `script:${f}#${name}`, source: `${f}:${line}`, file: f, line, name, pkgDir: dirname(f), command: `npm run ${name}`, cwd: dirname(f), shell: 'sh' });
      }
    }
    return out;
  }
  function docEntries(tree) {
    const cmds = tree.docCommandsList || [];
    const groups = new Map();
    for (const c of cmds) {
      if (isPlaceholder(c.text)) continue;
      const norm = normalizeCommand(c.text);
      const key = `${dirname(c.file)}\u0000${c.shell}\u0000${norm}\u0000${(c.installs || []).slice().sort().join(',')}`;
      if (!groups.has(key)) groups.set(key, { kind: 'doc', id: null, command: norm, docDir: dirname(c.file), shell: c.shell, sources: [], claim: false, installs: [] });
      const g = groups.get(key);
      g.sources.push({ file: c.file, line: c.line, claim: !!c.claim, installs: c.installs || [] });
      if (c.claim) g.claim = true;
    }
    let n = 0;
    const out = [];
    for (const g of groups.values()) {
      g.id = `doc:${++n}`;
      g.source = `${g.sources[0].file}:${g.sources[0].line}`;
      // what the reader is told to pip-install in the same block (grouping keeps these equal)
      g.installs = g.sources[0].installs.slice();
      out.push(g);
    }
    return out;
  }

  // The runner part of a documented command, without comments, redirections or pipes into
  // other programs: what two differently annotated mentions of one command have in common.
  function normalizeCommand(text) {
    const p = shellParse(text);
    if (p.error) return String(text).trim();
    const parts = [];
    for (const c of p.cmds) {
      if (!c.words.length) continue;
      const prog = c.words[0].text;
      if (!RUNNER_WORDS.has(prog) && prog !== 'cd') continue;
      parts.push(c.words.map((w) => (/[\s'"]/.test(w.text) ? shQuote(w.text) : w.text)).join(' '));
    }
    return parts.length ? parts.join(' && ') : String(text).trim();
  }
  function evaluateEntry(tree, entry, candidates, localNode) {
    const acc = newAcc();
    const run = (cwd) => {
      const a = newAcc();
      const ctx = newCtx(tree, { cwd, shell: entry.shell, node: entry.kind === 'ci' ? entry.node : localNode.version, nodeKnown: entry.kind === 'ci' ? entry.nodeKnown : localNode.known, installs: entry.installs || [], acc: a });
      ctx.candidates = candidates;
      ctx.docMode = entry.kind === 'doc';
      if (entry.virtual) ctx.virtual = entry.virtual;
      if (entry.conditions) ctx.conditions = entry.conditions.slice();
      if (entry.kind === 'script') npmRun(ctx, entry.name, []);
      else { if (entry.kind === 'ci') ctx.via.push(`${entry.file} job ${entry.job}`); for (const l of joinContinuations(entry.command)) evalLine(ctx, l); }
      if (entry.kind === 'ci') for (const p of pipInstalls(entry.command)) if (!entry.installs.includes(p)) entry.installs.push(p);
      return a;
    };
    if (entry.kind === 'doc') {
      // a documented command is read relative to its own folder first, then the repo root
      const first = run(entry.docDir);
      const useRoot = entry.docDir !== '' && first.reach.size === 0 && (first.broken.length || first.notes.length);
      const r = useRoot ? run('') : first;
      entry.cwdUsed = useRoot ? '' : entry.docDir;
      return r;
    }
    void acc;
    return run(normalize(entry.cwd || ''));
  }
  function joinContinuations(cmd) {
    const out = [];
    let cur = '';
    for (const l of String(cmd).split('\n')) {
      if (/\\\s*$/.test(l)) { cur += l.replace(/\\\s*$/, ' '); continue; }
      cur += l;
      if (cur.trim()) out.push(cur);
      cur = '';
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  // ---------------------------------------------------------------- the census
  const CLASSES = ['ci', 'ci-less', 'manual', 'orphan'];
  const SEVERITY = { ci: 0, 'ci-less': 1, manual: 2, orphan: 3 };
  function censusRepo(tree, opts) {
    opts = opts || {};
    const cfg = tree.config || {};
    const localNode = { version: cfg.localNode || opts.localNode || 22, known: !!(cfg.localNode || opts.localNode), source: cfg.localNodeSource || null };
    const candidates = inventory(tree);
    const wf = workflowEntries(tree);
    const entries = wf.entries.concat(scriptEntries(tree), docEntries(tree));
    const fatal = [];
    for (const p of wf.problems) fatal.push({ entry: p.what, what: p.what, why: p.why });
    const results = new Map();
    for (const e of entries) {
      if (e.broken) { results.set(e.id, Object.assign(newAcc(), { broken: [{ what: e.source, why: e.broken }] })); continue; }
      const r = evaluateEntry(tree, e, candidates, localNode);
      results.set(e.id, r);
      if (e.kind !== 'doc') for (const nu of r.notUnderstood) fatal.push({ entry: e.source, what: nu.what, why: nu.why });
    }
    // documented commands that resolve the same way are one entry with many sources
    const merged = new Map();
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      if (e.kind !== 'doc') continue;
      const r = results.get(e.id);
      const reachKey = r ? Array.from(r.reach.keys()).sort().join('|') : '';
      const brokenKey = r ? r.broken.map((b) => b.why).concat(r.notUnderstood.map((b) => b.why)).sort().join('|') : '';
      const key = `${e.command}\u0000${e.shell}\u0000${reachKey}\u0000${brokenKey}\u0000${(e.installs || []).slice().sort().join(',')}`;
      if (!merged.has(key)) { merged.set(key, e); continue; }
      const keep = merged.get(key);
      keep.sources = keep.sources.concat(e.sources);
      if (e.claim) keep.claim = true;
      e.mergedInto = keep.id;
    }
    for (let k = entries.length - 1; k >= 0; k--) if (entries[k].mergedInto) { results.delete(entries[k].id); entries.splice(k, 1); }
    // routes per file
    const files = [];
    for (const [path, cand] of candidates) {
      const routes = [];
      for (const e of entries) {
        const r = results.get(e.id);
        const hits = r && r.reach.get(path);
        if (!hits) continue;
        for (const h of hits) {
          const fileConds = h.conditions.filter((c) => c.module !== undefined);
          const runConds = h.conditions.filter((c) => c.module === undefined);
          // whether the module a file-level skip needs is installed in this route's context:
          // a CI job installs what its earlier steps pip-install; a documented block installs
          // what it tells the reader to (unknown when it says nothing); a package script, unknown
          const sat = (mod) => {
            if (!mod || e.kind === 'script') return null;
            if (e.kind === 'doc') return (e.installs || []).length ? e.installs.includes(mod) : null;
            return h.installs.includes(mod);
          };
          routes.push({ entry: e.id, kind: e.kind, via: h.via, conditions: runConds.map((c) => c.text), fileConditions: fileConds.map((c) => ({ text: c.text, module: c.module, satisfied: sat(c.module) })) });
        }
      }
      // collapse duplicate routes from the same entry
      const seen = new Set();
      const uniqRoutes = routes.filter((r) => { const k = r.entry + '|' + r.conditions.join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
      files.push({ path, kind: cand.kind, declared: cand.declared, routes: uniqRoutes });
    }
    const docReachCount = (id) => { let n = 0; const r = results.get(id); if (r) for (const p of r.reach.keys()) if (candidates.has(p)) n++; return n; };
    for (const f of files) {
      const levels = { ci: [], 'ci-less': [], manual: [] };
      for (const r of f.routes) {
        if (r.kind === 'ci') levels.ci.push(r);
        else if (r.kind === 'script') levels['ci-less'].push(r);
        else if (docReachCount(r.entry) >= 2) levels['ci-less'].push(r);
        else levels.manual.push(r);
      }
      f.class = levels.ci.length ? 'ci' : levels['ci-less'].length ? 'ci-less' : levels.manual.length ? 'manual' : 'orphan';
      const at = levels[f.class] || [];
      f.conditional = at.length > 0 && at.every((r) => r.conditions.length > 0);
      const fc = at.length && at.every((r) => r.fileConditions.length && r.fileConditions.some((c) => c.satisfied === false));
      f.skippedWhole = !!fc;
      f.allowed = null;
      for (const a of opts.allow || []) {
        if (a.repo && a.repo.toLowerCase() !== String(tree.id).toLowerCase()) continue;
        if (!globMatch(a.glob, f.path)) continue;
        if (SEVERITY[f.class] <= SEVERITY[a.upTo || 'orphan']) { f.allowed = { reason: a.reason, cite: a.cite || null, upTo: a.upTo || 'orphan' }; break; }
      }
    }
    // mentions for files no runner of substance reaches
    const needMentions = files.filter((f) => f.class === 'orphan' || f.class === 'manual').map((f) => f.path);
    const mentions = needMentions.length && tree.mentionsFor ? tree.mentionsFor(needMentions) : {};
    for (const f of files) if (mentions[f.path]) f.mentions = mentions[f.path];
    // entries summary
    const entryOut = entries.map((e) => {
      const r = results.get(e.id);
      const reached = r ? Array.from(r.reach.keys()).filter((p) => candidates.has(p)).sort() : [];
      const conditional = r ? reached.filter((p) => r.reach.get(p).every((h) => h.conditions.some((c) => c.module === undefined))) : [];
      const o = { id: e.id, kind: e.kind, source: e.source, command: e.kind === 'script' ? (e.name === 'test' ? 'npm test' : `npm run ${e.name}`) : e.command, cwd: e.kind === 'doc' ? e.cwdUsed : e.cwd, reach: reached, conditionalReach: conditional };
      if (e.kind === 'ci') Object.assign(o, { job: e.job, jobName: e.jobName, stepName: e.stepName, node: e.node, nodeKnown: e.nodeKnown });
      if (e.kind === 'script') Object.assign(o, { name: e.name, file: e.file });
      if (e.kind === 'doc') Object.assign(o, { sources: e.sources.map((s) => `${s.file}:${s.line}`), claimSources: e.sources.filter((s) => s.claim).map((s) => `${s.file}:${s.line}`), installs: e.installs });
      if (r) {
        if (r.broken.length) o.broken = r.broken.map((b) => ({ what: b.what, why: b.why }));
        if (r.notUnderstood.length) o.notUnderstood = r.notUnderstood.map((b) => ({ what: b.what, why: b.why }));
        if (r.notes.length) o.notes = r.notes.map((b) => b.why);
        if (r.versionNotes.length) o.versionNotes = r.versionNotes;
        const others = uniq(r.others.map((x) => x.what));
        if (others.length) o.others = others;
        const nonc = uniq(r.nonCandidates.map((x) => x.path));
        if (nonc.length) o.nonCandidates = nonc;
      }
      return o;
    });
    // doc drift: a documented command reaching >= 2 files, all of them inside CI's reach,
    // but fewer than CI reaches
    const ciReach = new Set();
    for (const e of entryOut) if (e.kind === 'ci') for (const p of e.reach) ciReach.add(p);
    const drift = [];
    for (const e of entryOut) {
      if (e.kind !== 'doc' || e.reach.length < 2 || !ciReach.size) continue;
      if (!e.reach.every((p) => ciReach.has(p)) || e.reach.length >= ciReach.size) continue;
      const missing = Array.from(ciReach).filter((p) => !e.reach.includes(p)).sort();
      drift.push({ entry: e.id, command: e.command, sources: e.sources, claimSources: e.claimSources, reach: e.reach.length, ciReach: ciReach.size, missing });
    }
    drift.sort((a, b) => (b.claimSources.length - a.claimSources.length) || (b.sources.length - a.sources.length));
    // documented commands that reach nothing because they are broken
    const TEST_INTENT = /--test\b|\bnpm (?:run |run-script )?(?:test|t)\b|\bnpm run [\w:-]*test[\w:-]*|\bpytest\b|\.test\.|\btest_\w*\.py|run-tests|\bnpm run verify\b|\bverify\.mjs\b/;
    const docBroken = entryOut.filter((e) => e.kind === 'doc' && TEST_INTENT.test(e.command) && e.reach.length === 0 && (e.broken || (e.versionNotes && e.versionNotes.length)))
      .map((e) => ({ entry: e.id, command: e.command, sources: e.sources, why: (e.broken || []).map((b) => b.why).concat(e.versionNotes ? e.versionNotes.map((vn) => `Node ${vn.other.node} would reach ${vn.other.files} file(s)`) : []) }));
    const docNotUnderstood = entryOut.filter((e) => e.kind === 'doc' && e.notUnderstood).map((e) => ({ entry: e.id, command: e.command, sources: e.sources, why: e.notUnderstood.map((x) => x.why) }));
    const counts = { candidates: files.length, ci: 0, 'ci-less': 0, manual: 0, orphan: 0, conditional: 0, allowed: 0, skippedWhole: 0 };
    for (const f of files) { counts[f.class]++; if (f.conditional) counts.conditional++; if (f.allowed) counts.allowed++; if (f.skippedWhole) counts.skippedWhole++; }
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    return {
      id: tree.id, label: tree.label, commit: tree.commit, localNode,
      workflows: tree.files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)),
      counts, files, entries: entryOut, drift, docBroken, docNotUnderstood, fatal,
      ciReach: ciReach.size,
    };
  }
  function census(trees, opts) {
    opts = opts || {};
    const failOn = opts.failOn || 'orphan';
    if (!(failOn in SEVERITY) || failOn === 'ci') throw new Error(`--fail-on must be one of ci-less, manual, orphan (got ${failOn})`);
    const repos = trees.map((t) => censusRepo(t, opts));
    let exit = 0;
    const failing = [];
    for (const r of repos) {
      for (const f of r.files) if (!f.allowed && SEVERITY[f.class] >= SEVERITY[failOn]) failing.push({ repo: r.id, path: f.path, class: f.class });
    }
    if (failing.length) exit = 1;
    if (repos.some((r) => r.fatal.length)) exit = 2;
    return { tool: 'reach-census', failOn, exit, failing, repos };
  }

  // ---------------------------------------------------------------- rendering
  function groupByDir(paths) {
    const m = new Map();
    for (const p of paths) { const d = dirname(p) || '.'; if (!m.has(d)) m.set(d, []); m.get(d).push(basename(p)); }
    return Array.from(m.entries()).map(([dir, names]) => ({ dir, names }));
  }
  function describeSet(paths, max) {
    max = max || 4;
    return groupByDir(paths).map((g) => `${g.dir}/ (${g.names.length}${g.names.length <= max ? ': ' + g.names.join(', ') : ''})`).join('; ');
  }
  function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }
  function renderText(result, opts) {
    opts = opts || {};
    const L = [];
    const w = (s) => L.push(s);
    w('Reach Census: which runner reaches each test file, and which CI job runs that runner.');
    w('Static: runner definitions are read as text and nothing is executed; "reached" means launched, not passed.');
    for (const r of result.repos) {
      w('');
      w(`== ${r.label}  ${r.id} @ ${r.commit ? r.commit.slice(0, 7) : '(no commit)'}  (local Node ${r.localNode.version}${r.localNode.known ? '' : ', assumed'}; ${r.workflows.length ? plural(r.workflows.length, 'workflow') : 'no workflow files'})`);
      const c = r.counts;
      w(`   ${plural(c.candidates, 'test file')}: ${c.ci} run in CI · ${c['ci-less']} CI-less · ${c.manual} manual only · ${c.orphan} orphan${c.conditional ? ` · ${c.conditional} conditional` : ''}${c.allowed ? ` · ${c.allowed} allowed` : ''}`);
      if (r.fatal.length) {
        w(`   CENSUS INCOMPLETE: ${plural(r.fatal.length, 'runner definition')} not understood; files below may be reached by them`);
        for (const f of r.fatal) w(`     ? ${f.entry}: ${f.what} — ${f.why}`);
      }
      const ci = r.entries.filter((e) => e.kind === 'ci');
      if (ci.length) {
        w('   CI steps');
        for (const e of ci) if (e.reach.length || e.broken || e.notUnderstood) w(`     ${e.source}  job ${e.job}: ${oneLine(e.command)}  → ${plural(e.reach.length, 'file')}${e.conditionalReach.length ? ` (${e.conditionalReach.length} conditional)` : ''}${e.broken ? '  BROKEN: ' + e.broken.map((b) => b.why).join('; ') : ''}`);
        const silent = ci.filter((e) => !e.reach.length && !e.broken && !e.notUnderstood);
        if (silent.length) w(`     (${plural(silent.length, 'other step')} reach no test file: ${silent.map((e) => oneLine(e.command)).join(' | ')})`);
      }
      const scripts = r.entries.filter((e) => e.kind === 'script' && (e.reach.length || e.broken || e.notUnderstood));
      if (scripts.length) {
        w('   package.json scripts that reach test files');
        for (const e of scripts) w(`     ${e.source}  ${e.command}${e.cwd ? ` (in ${e.cwd})` : ''}  → ${plural(e.reach.length, 'file')}${e.conditionalReach.length ? ` (${e.conditionalReach.length} only if ${condSummary(r, e)})` : ''}${e.broken ? '  BROKEN: ' + e.broken.map((b) => b.why).join('; ') : ''}`);
      }
      const docs = r.entries.filter((e) => e.kind === 'doc' && e.reach.length >= 2);
      if (docs.length) {
        w('   documented suite commands');
        for (const e of docs.sort((a, b) => b.reach.length - a.reach.length)) w(`     ${oneLine(e.command)}  → ${plural(e.reach.length, 'file')}${e.conditionalReach.length ? ` (${e.conditionalReach.length} conditional)` : ''}  [${e.sources.length} place${e.sources.length === 1 ? '' : 's'}: ${e.sources.slice(0, 3).join(', ')}${e.sources.length > 3 ? ', …' : ''}]`);
      }
      for (const cls of ['orphan', 'manual', 'ci-less']) {
        const fs = r.files.filter((f) => f.class === cls);
        if (!fs.length) continue;
        const title = { orphan: 'ORPHANS (no runner, no CI job, no documented command reaches them)', manual: 'MANUAL ONLY (reached only by one-file commands written in docs)', 'ci-less': 'CI-LESS (a runner reaches them; no CI job runs that runner)' }[cls];
        w(`   ${title}: ${fs.length}`);
        const byRoute = new Map();
        for (const f of fs) {
          const key = cls === 'ci-less' ? routeKey(r, f) : (cls === 'manual' ? 'documented one-file commands' : 'nothing');
          if (!byRoute.has(key)) byRoute.set(key, []);
          byRoute.get(key).push(f);
        }
        for (const [key, group] of byRoute) {
          w(`     ${describeSet(group.map((f) => f.path))}`);
          if (cls !== 'orphan') w(`       via ${key}`);
          for (const f of group) {
            if (f.allowed) w(`       allowed: ${f.path} — ${f.allowed.reason}${f.allowed.cite ? ' (' + f.allowed.cite + ')' : ''}`);
            if (f.declared && cls === 'orphan') w(`       ${f.path}: candidate because ${f.declared}`);
            if (f.mentions && f.mentions.length && cls === 'orphan') w(`       named (not as a command) at ${f.mentions.slice(0, 5).map((m) => m.file + ':' + m.line).join(', ')}${f.mentions.length > 5 ? ', …' : ''}`);
          }
        }
      }
      const cond = r.files.filter((f) => r.entries.some((e) => e.conditionalReach.includes(f.path)));
      if (cond.length) {
        w('   CONDITIONAL routes (reached only when a quoted condition holds)');
        const seen = new Set();
        for (const e of r.entries) {
          if (!e.conditionalReach.length) continue;
          const f = r.files.find((x) => x.path === e.conditionalReach[0]);
          const route = f.routes.find((x) => x.entry === e.id && x.conditions.length);
          const key = route ? route.conditions.join(' & ') : '';
          if (seen.has(key + e.conditionalReach.join())) continue;
          seen.add(key + e.conditionalReach.join());
          w(`     ${describeSet(e.conditionalReach)} via ${e.kind === 'doc' ? oneLine(e.command) : e.source}`);
          if (key) w(`       only ${key}`);
        }
      }
      const skipped = r.files.filter((f) => f.routes.some((x) => x.fileConditions.length));
      if (skipped.length) {
        w('   FILE-LEVEL SKIPS (a reached file that skips itself whole unless a module is importable)');
        for (const f of skipped) {
          const fc = f.routes.find((x) => x.fileConditions.length).fileConditions[0];
          const sat = f.routes.filter((x) => x.fileConditions.length).map((x) => `${entryLabel(r, x.entry)}: ${x.fileConditions.every((c) => c.satisfied === true) ? 'installed' : x.fileConditions.some((c) => c.satisfied === false) ? 'NOT installed' : 'unknown'}`);
          w(`     ${fc.text}`);
          w(`       ${uniq(sat).join(' · ')}`);
        }
      }
      if (r.drift.length) {
        w('   DOC DRIFT (a documented command reaches fewer of the files CI runs)');
        for (const d of r.drift) {
          w(`     ${oneLine(d.command)}: ${d.reach} of the ${d.ciReach} files CI reaches; misses ${d.missing.length}: ${describeSet(d.missing, 0)}`);
          if (d.claimSources.length) w(`       presented as the suite at ${d.claimSources.join(', ')}`);
          const rest = d.sources.filter((s) => !d.claimSources.includes(s));
          if (rest.length) w(`       also named at ${rest.slice(0, 4).join(', ')}${rest.length > 4 ? ` and ${rest.length - 4} more` : ''}`);
        }
      }
      if (r.docBroken.length) {
        w('   DOCUMENTED COMMANDS THAT REACH NOTHING');
        for (const d of r.docBroken) w(`     ${oneLine(d.command)}  [${d.sources.slice(0, 3).join(', ')}${d.sources.length > 3 ? ', …' : ''}]: ${uniq(d.why).join('; ')}`);
      }
      if (opts.verbose && r.docNotUnderstood.length) {
        w('   documented commands not understood (not counted)');
        for (const d of r.docNotUnderstood) w(`     ${oneLine(d.command)} [${d.sources[0]}]: ${uniq(d.why).join('; ')}`);
      }
    }
    w('');
    const failing = result.failing;
    if (result.exit === 2) w(`exit 2: census incomplete (a CI step or package script the census does not understand)`);
    else if (result.exit === 1) w(`exit 1: ${plural(failing.length, 'file')} at or beyond "${result.failOn}" and not in an allow list: ${failing.map((f) => f.repo + ':' + f.path).join(', ')}`);
    else w(`exit 0: no file at or beyond "${result.failOn}" outside the allow list`);
    return L.join('\n');
  }
  function oneLine(s) { return String(s).replace(/\s*\n\s*/g, ' ; ').trim(); }
  function entryLabel(r, id) {
    const e = r.entries.find((x) => x.id === id);
    if (!e) return id;
    if (e.kind === 'ci') return `CI ${e.job} (${e.source})`;
    if (e.kind === 'script') return `${e.command} (${e.file})`;
    return `${oneLine(e.command)} (${e.sources[0]})`;
  }
  function routeKey(r, f) {
    const suite = (x) => { if (x.kind === 'script') return true; const e = r.entries.find((y) => y.id === x.entry); return e && e.kind === 'doc' && e.reach.length >= 2; };
    const rs = f.routes.filter((x) => x.kind !== 'ci' && suite(x));
    return uniq(rs.map((x) => entryLabel(r, x.entry))).slice(0, 3).join('; ') + (rs.length > 3 ? '; …' : '');
  }
  function condSummary(r, e) {
    const f = r.files.find((x) => x.path === e.conditionalReach[0]);
    const route = f && f.routes.find((x) => x.entry === e.id && x.conditions.length);
    return route ? route.conditions.join(' & ') : 'a condition';
  }
  function renderMarkdown(result) {
    const L = [];
    const w = (s) => L.push(s);
    w('# Reach census');
    w('');
    w(`Policy: fail on \`${result.failOn}\`; exit ${result.exit}.`);
    for (const r of result.repos) {
      w('');
      w(`## ${r.label} (\`${r.id}\` @ \`${r.commit ? r.commit.slice(0, 7) : '-'}\`)`);
      w('');
      w('| Class | Files |');
      w('|---|---|');
      for (const k of CLASSES) w(`| ${k} | ${r.counts[k]} |`);
      w('');
      const cols = r.entries.filter((e) => e.reach.length && (e.kind !== 'doc' || e.reach.length >= 2));
      w('| File | Class | ' + cols.map((e, i) => `R${i + 1}`).join(' | ') + ' |');
      w('|---|---|' + cols.map(() => '---').join('|') + '|');
      for (const f of r.files) w(`| \`${f.path}\` | ${f.class}${f.conditional ? ' (conditional)' : ''} | ` + cols.map((e) => (e.reach.includes(f.path) ? (e.conditionalReach.includes(f.path) ? '◐' : '●') : '')).join(' | ') + ' |');
      w('');
      cols.forEach((e, i) => w(`- R${i + 1}: ${e.kind} \`${oneLine(e.command)}\` (${e.kind === 'doc' ? e.sources.slice(0, 2).join(', ') : e.source})`));
    }
    return L.join('\n') + '\n';
  }

  // A tree from a pack (snapshots/pack-*.js): the tracked file list at a commit, the contents of
  // every file the census read there, the documented commands found in its Markdown, and where
  // the census looked up mentions. A file the census needs but the pack lacks reads as null,
  // which the evaluator reports instead of guessing.
  // Sorted path lists are stored front-coded: "12|tail" means the previous path's first 12
  // characters followed by "tail". Documented commands are stored as short arrays.
  function packPaths(paths) {
    let prev = '';
    return sortPaths(paths).map((p) => { let k = 0; while (k < prev.length && k < p.length && prev[k] === p[k]) k++; prev = p; return k + '|' + p.slice(k); });
  }
  function unpackPaths(arr) {
    let prev = '';
    return arr.map((x) => { const i = x.indexOf('|'); prev = prev.slice(0, Number(x.slice(0, i))) + x.slice(i + 1); return prev; });
  }
  function packDocCommands(cmds) {
    return cmds.map((c) => { const a = [c.file, c.line, c.text, c.claim ? 1 : 0]; if ((c.installs && c.installs.length) || c.shell !== 'sh') { a.push(c.installs || []); a.push(c.shell); } return a; });
  }
  function unpackDocCommands(arr) {
    return arr.map((a) => (Array.isArray(a) ? { file: a[0], line: a[1], text: a[2], claim: !!a[3], installs: a[4] || [], shell: a[5] || 'sh' } : a));
  }
  function packFiles(pack, packs) {
    if (pack.files) return pack.files;
    if (pack.filesPacked) return unpackPaths(pack.filesPacked);
    const base = packs && packs[pack.base];
    if (!base || !(base.files || base.filesPacked)) throw new Error(`pack ${pack.key} is stored as a difference from "${pack.base}", which is not loaded`);
    const removed = new Set(pack.removed || []);
    const files = packFiles(base, packs).filter((f) => !removed.has(f)).concat(pack.added || []);
    if (pack.fileCount != null && files.length !== pack.fileCount) throw new Error(`pack ${pack.key}: ${files.length} files after applying the difference, expected ${pack.fileCount}`);
    return files;
  }
  function treeFromPack(pack, config, packs) {
    const contents = pack.contents || {};
    return makeTree({
      id: pack.id, label: (config && config.label) || pack.label || pack.id, commit: pack.commit,
      files: packFiles(pack, packs), read: (p) => (Object.prototype.hasOwnProperty.call(contents, p) ? contents[p] : null),
      docCommands: unpackDocCommands(pack.docCommands || []),
      mentionsFor: (paths) => { const out = {}; for (const p of paths) if (pack.mentions && pack.mentions[p]) out[p] = pack.mentions[p]; return out; },
      config: config || pack.config || {},
    });
  }

  // The reviewable summary committed as census.json: every file's class, every entry's reach
  // count and sources, the findings. The full result (routes and their chains) is --json.
  function compact(result) {
    return {
      tool: result.tool, failOn: result.failOn, exit: result.exit,
      failing: result.failing,
      repos: result.repos.map((r) => ({
        id: r.id, label: r.label, commit: r.commit, localNode: r.localNode, workflows: r.workflows, counts: r.counts, ciReach: r.ciReach,
        classes: Object.fromEntries(CLASSES.map((k) => [k, r.files.filter((f) => f.class === k).map((f) => f.path)])),
        conditional: r.files.filter((f) => f.conditional).map((f) => f.path),
        declared: r.files.filter((f) => f.declared).map((f) => ({ path: f.path, why: f.declared })),
        entries: r.entries.filter((e) => e.reach.length || e.broken || e.notUnderstood).map((e) => ({
          kind: e.kind, command: e.command, sources: e.kind === 'doc' ? e.sources : [e.source],
          reach: e.reach.length, conditional: e.conditionalReach.length,
          broken: e.broken ? e.broken.map((b) => b.why) : undefined,
          notUnderstood: e.notUnderstood ? e.notUnderstood.map((b) => b.why) : undefined,
        })),
        drift: r.drift.map((d) => ({ command: d.command, reach: d.reach, ciReach: d.ciReach, missing: d.missing, claimSources: d.claimSources, sources: d.sources })),
        docBroken: r.docBroken.map((d) => ({ command: d.command, sources: d.sources, why: d.why })),
        fileSkips: r.files.filter((f) => f.routes.some((x) => x.fileConditions.length)).map((f) => ({ path: f.path, conditions: uniq(f.routes.flatMap((x) => x.fileConditions.map((c) => c.text))), routes: f.routes.filter((x) => x.fileConditions.length).map((x) => ({ entry: x.kind === 'doc' ? (r.entries.find((e) => e.id === x.entry) || {}).sources[0] : (r.entries.find((e) => e.id === x.entry) || {}).source, satisfied: x.fileConditions.map((c) => c.satisfied) })) })),
        mentions: Object.fromEntries(r.files.filter((f) => f.mentions).map((f) => [f.path, f.mentions.map((m) => `${m.file}:${m.line}`)])),
        fatal: r.fatal,
      })),
    };
  }

  return {
    version: '1.0.0', CLASSES, SEVERITY, treeFromPack, packFiles, packPaths, unpackPaths, packDocCommands, unpackDocCommands, normalizeCommand, compact,
    normalize, join, dirname, basename, relativeTo,
    makeTree, view, inventory,
    shellParse, shExpand, nodeGlob, globWalk, globMatch, expandBraces, segRegex,
    parseYaml, extractDocCommands, isPlaceholder, pipInstalls,
    maskJs, analyzeNodeScript,
    workflowEntries, scriptEntries, docEntries,
    evaluateCommand: function (tree, command, o) {
      o = o || {};
      const acc = newAcc();
      const ctx = newCtx(tree, { cwd: o.cwd || '', shell: o.shell || 'sh', node: o.node || 22, nodeKnown: true, installs: o.installs || [], acc });
      ctx.candidates = o.candidates || inventory(tree);
      for (const l of joinContinuations(command)) evalLine(ctx, l);
      return {
        reach: Array.from(acc.reach.keys()).sort(),
        conditional: Array.from(acc.reach.entries()).filter(([, hs]) => hs.every((h) => h.conditions.some((c) => c.module === undefined))).map(([p]) => p).sort(),
        routes: Object.fromEntries(Array.from(acc.reach.entries()).map(([p, hs]) => [p, hs.map((h) => ({ via: h.via, conditions: h.conditions.map((c) => c.text) }))])),
        broken: acc.broken, notUnderstood: acc.notUnderstood, notes: acc.notes, others: uniq(acc.others.map((x) => x.what)), versionNotes: acc.versionNotes,
        nonCandidates: uniq(acc.nonCandidates.map((x) => x.path)),
      };
    },
    censusRepo, census, renderText, renderMarkdown, describeSet,
  };
});
