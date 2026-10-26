// bluecells.js — the browser/Node twin of ladder_export.py. Reads an .xlsx as a zip of XML parts,
// extracts the Skyhook financial workbook's input ladder keyed by finance/skyhook_finance.py's row
// map, counts formula cells against cached results, and renders the same text report. Pure: no DOM,
// no network. Loads as a classic script (window.BlueCells) and via require() for the Node tests.
//
// The zip reader handles stored (method 0) and deflated (method 8) members and checks each member's
// CRC-32; inflation itself is injected (zlib.inflateRawSync in Node, DecompressionStream in the
// browser) so this file has no dependency. Every function mirrors the Python module of the same
// name; bluecells.test.mjs checks that the two agree on the snapshot workbook.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlueCells = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.1.0';

  // The workbook README sheet's legend (cell A4): BLUE = hardcoded inputs, BLACK = formulas,
  // GREEN = cross-sheet links, YELLOW fill = key assumption needing attention. RGB part of ARGB.
  const BLUE_RGB = '0000FF';
  const GREEN_RGB = '008000';
  const YELLOW_RGB = 'FFFF00';

  // Drift guard [this tool's choice], identical to ladder_export.py's LABEL_GUARD.
  const LABEL_GUARD = {
    strength_retention: 'strength retention',
    ascent_losses_ms: 'ascent losses',
    construction_launch_per_kg: 'launch price during construction',
    power_chain_efficiency: 'power chain efficiency',
    electricity_per_kwh: 'electricity cost',
    ops_wear_per_kg: 'ops + wear',
    hardware_mass_factor: 'hardware mass factor',
    customer_price_per_kg: 'price to customer',
    catches_per_day: 'catches/day',
    payload_kg: 'payload per catch',
    revenue_ramp_y1: 'revenue ramp',
    fixed_ops_M: 'fixed annual ops cost',
    tip_speed_kms: 'tip speed',
    program_fleet_capex_M: 'fleet capex',
  };
  const DESIGN_POINT_HEADER = 'SHARED DESIGN POINT';
  const CONSTANTS_HEADER = 'PHYSICAL CONSTANTS';
  const LADDER_HEADER = 'LADDER ASSUMPTIONS';
  const HEADER_ROW_FIRST_CELL = 'Parameter';

  class WorkbookError extends Error {
    constructor(m) { super(m); this.name = 'WorkbookError'; }
  }
  class LadderError extends Error {
    constructor(m) { super(m); this.name = 'LadderError'; }
  }

  // Python-style repr for the refusal messages, so both implementations say the same thing.
  function repr(v) {
    if (v === null || v === undefined) return 'None';
    if (typeof v === 'string') {
      if (v.includes("'") && !v.includes('"')) return `"${v}"`;
      return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    return String(v);
  }

  // ── bytes ──────────────────────────────────────────────────────────────────

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // MD5 (RFC 1321), the hash finance/export_grid.py's provenance_md5 uses for the workbook.
  const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const MD5_K = (() => {
    const k = new Uint32Array(64);
    for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    return k;
  })();

  function md5(bytes) {
    const len = bytes.length;
    const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
    padded.set(bytes);
    padded[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bits >>> 0, true);
    dv.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
    return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(bytes) {
    const subtle = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function utf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ── zip ────────────────────────────────────────────────────────────────────

  // Central-directory walk. Returns [{name, method, crc32, compressedSize, size, data}] where data is
  // the raw (still compressed) member bytes. ZIP64 archives are refused.
  function readZip(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new WorkbookError('not a zip archive (no end-of-central-directory record), so not an .xlsx');
    const count = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new WorkbookError('ZIP64 archives are not supported');
    const entries = [];
    let p = cdOffset;
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new WorkbookError(`central directory entry ${n} has a bad signature`);
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const compressedSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
      if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new WorkbookError(`member ${name} has a bad local header`);
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      entries.push({ name, method, crc32: crc, compressedSize, size, data: bytes.subarray(start, start + compressedSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateEntry(entry, inflateRaw) {
    let out;
    if (entry.method === 0) out = entry.data;
    else if (entry.method === 8) {
      if (typeof inflateRaw !== 'function') throw new WorkbookError(`member ${entry.name} is deflated and no inflateRaw was given`);
      out = await inflateRaw(entry.data);
      if (!(out instanceof Uint8Array)) out = new Uint8Array(out);
    } else throw new WorkbookError(`member ${entry.name} uses compression method ${entry.method}; only stored and deflate are read`);
    if (out.length !== entry.size) throw new WorkbookError(`member ${entry.name} inflated to ${out.length} bytes, expected ${entry.size}`);
    if (crc32(out) !== entry.crc32) throw new WorkbookError(`member ${entry.name} failed its CRC-32 check`);
    return out;
  }

  // ── xml ────────────────────────────────────────────────────────────────────

  function decodeEntities(s) {
    if (s == null) return '';
    return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => {
      switch (e) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'amp': return '&';
        case 'quot': return '"';
        case 'apos': return "'";
        default:
          return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      }
    });
  }

  function attrs(s) {
    const out = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(s || ''))) out[m[1]] = decodeEntities(m[2]);
    return out;
  }

  function parseWorkbookXml(xml) {
    const sheets = [];
    const re = /<sheet\b([^>]*?)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
      const a = attrs(m[1]);
      sheets.push({ name: a.name, sheetId: a.sheetId, rId: a['r:id'], state: a.state || 'visible' });
    }
    const calc = /<calcPr\b([^>]*?)\/>/.exec(xml);
    return { sheets, calcPr: calc ? attrs(calc[1]) : null };
  }

  function parseRels(xml) {
    const out = {};
    const re = /<Relationship\b([^>]*?)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
      const a = attrs(m[1]);
      let target = a.Target || '';
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = 'xl/' + target;
      out[a.Id] = target;
    }
    return out;
  }

  function textRuns(inner) {
    let s = '';
    const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
    let m;
    while ((m = re.exec(inner))) s += decodeEntities(m[1] || '');
    return s;
  }

  function parseSharedStrings(xml) {
    const out = [];
    const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
    let m;
    while ((m = re.exec(xml))) out.push(textRuns(m[1] || ''));
    return out;
  }

  function parseStyles(xml) {
    const fonts = [];
    const fontsBlock = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(xml);
    if (fontsBlock) {
      const re = /<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g;
      let m;
      while ((m = re.exec(fontsBlock[1]))) {
        const inner = m[1] || '';
        const color = /<color\b([^>]*?)\/>/.exec(inner);
        const ca = color ? attrs(color[1]) : {};
        fonts.push({ rgb: ca.rgb || null, theme: ca.theme || null, bold: /<b\b/.test(inner), italic: /<i\b/.test(inner) });
      }
    }
    const fills = [];
    const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(xml);
    if (fillsBlock) {
      const re = /<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g;
      let m;
      while ((m = re.exec(fillsBlock[1]))) {
        const inner = m[1] || '';
        const pf = /<patternFill\b([^>]*?)(?:\/>|>([\s\S]*?)<\/patternFill>)/.exec(inner);
        const pa = pf ? attrs(pf[1]) : {};
        const fg = pf && pf[2] ? /<fgColor\b([^>]*?)\/>/.exec(pf[2]) : null;
        fills.push({ pattern: pa.patternType || null, rgb: fg ? attrs(fg[1]).rgb || null : null });
      }
    }
    const xfs = [];
    const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (xfsBlock) {
      const re = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
      let m;
      while ((m = re.exec(xfsBlock[1]))) {
        const a = attrs(m[1]);
        xfs.push({ fontId: Number(a.fontId || 0), fillId: Number(a.fillId || 0) });
      }
    }
    return { fonts, fills, xfs };
  }

  function styleColours(styles, s) {
    if (s == null || !styles || s >= styles.xfs.length) return [null, null];
    const xf = styles.xfs[s];
    const font = styles.fonts[xf.fontId] || {};
    const fill = styles.fills[xf.fillId] || {};
    const frgb = font.rgb;
    const firgb = fill.pattern === 'solid' ? fill.rgb : null;
    return [frgb ? frgb.slice(-6).toUpperCase() : null, firgb ? firgb.slice(-6).toUpperCase() : null];
  }

  function splitRef(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) throw new WorkbookError(`not a cell reference: ${repr(ref)}`);
    return [m[1], Number(m[2])];
  }

  function parseSheet(xml, sharedStrings, styles) {
    const cells = [];
    const sd = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml);
    if (!sd || !sd[1]) return cells;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cellRe.exec(sd[1]))) {
      const a = attrs(m[1]);
      const inner = m[2] || '';
      const ref = a.r;
      if (!ref) continue;
      const [col, row] = splitRef(ref);
      const t = a.t || 'n';
      const s = a.s != null ? Number(a.s) : null;
      const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      const v = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
      const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
      let vText = v ? decodeEntities(v[1] || '').trim() : null;
      if (vText === '') vText = null;
      const cell = { ref, col, row, t, s, formula: null, cached: null, kind: 'empty', value: null, raw: null };
      if (f) {
        cell.formula = decodeEntities(f[2] || '');
        cell.kind = 'formula';
        cell.cached = vText;
        cell.raw = vText;
      } else if (t === 's') {
        const idx = vText != null ? Number(vText) : null;
        if (!sharedStrings || idx == null || idx >= sharedStrings.length) {
          throw new WorkbookError(`${ref} is a shared string (t="s") but the index ${repr(idx)} is not in xl/sharedStrings.xml; the part is missing or shorter than expected`);
        }
        Object.assign(cell, { kind: 'string', value: sharedStrings[idx], raw: vText });
      } else if (t === 'inlineStr') {
        const txt = textRuns(is ? is[1] : '');
        Object.assign(cell, { kind: 'string', value: txt, raw: txt });
      } else if (t === 'str') {
        Object.assign(cell, { kind: 'string', value: vText || '', raw: vText });
      } else if (t === 'b') {
        Object.assign(cell, { kind: 'bool', value: vText === '1', raw: vText });
      } else if (t === 'e') {
        Object.assign(cell, { kind: 'error', value: vText, raw: vText });
      } else if (vText == null) {
        cell.kind = 'empty';
      } else {
        const num = Number(vText);
        if (!Number.isFinite(num)) throw new WorkbookError(`${ref} is typed numeric but holds ${repr(vText)}`);
        Object.assign(cell, { kind: 'number', value: num, raw: vText });
      }
      [cell.font_rgb, cell.fill_rgb] = styles ? styleColours(styles, s) : [null, null];
      cells.push(cell);
    }
    return cells;
  }

  // ── the workbook ───────────────────────────────────────────────────────────

  async function readWorkbook(bytes, inflateRaw, name) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const entries = readZip(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    if (!byName.has('xl/workbook.xml')) throw new WorkbookError(`${name || '<bytes>'} has no xl/workbook.xml; not a spreadsheetml package`);
    const part = async (n) => utf8(await inflateEntry(byName.get(n), inflateRaw));

    const wb = parseWorkbookXml(await part('xl/workbook.xml'));
    const rels = byName.has('xl/_rels/workbook.xml.rels') ? parseRels(await part('xl/_rels/workbook.xml.rels')) : {};
    const shared = byName.has('xl/sharedStrings.xml') ? parseSharedStrings(await part('xl/sharedStrings.xml')) : null;
    const styles = byName.has('xl/styles.xml') ? parseStyles(await part('xl/styles.xml')) : null;

    const app = {};
    if (byName.has('docProps/app.xml')) {
      const x = await part('docProps/app.xml');
      for (const tag of ['Application', 'AppVersion']) {
        const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(x);
        app[tag] = m ? decodeEntities(m[1]) : null;
      }
    }
    const core = {};
    if (byName.has('docProps/core.xml')) {
      const x = await part('docProps/core.xml');
      for (const tag of ['creator', 'created', 'modified']) {
        const m = new RegExp(`<[\\w]+:${tag}\\b[^>]*>([\\s\\S]*?)</[\\w]+:${tag}>`).exec(x);
        core[tag] = m ? decodeEntities(m[1]) : null;
      }
    }

    const sheets = [];
    for (const s of wb.sheets) {
      const p = rels[s.rId];
      if (!p || !byName.has(p)) throw new WorkbookError(`sheet ${repr(s.name)} points at relationship ${repr(s.rId)} whose part is missing`);
      sheets.push({ name: s.name, part: p, state: s.state, cells: parseSheet(await part(p), shared, styles) });
    }

    const media = [];
    for (const e of [...entries].sort((x, y) => (x.name < y.name ? -1 : 1))) {
      if (e.name.startsWith('xl/media/')) {
        const blob = await inflateEntry(e, inflateRaw);
        media.push({ member: e.name, bytes: blob.length, md5: md5(blob) });
      }
    }

    return {
      file: name || '<bytes>',
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      md5: md5(bytes),
      members: entries.length,
      application: app.Application ?? null,
      app_version: app.AppVersion ?? null,
      creator: core.creator ?? null,
      created: core.created ?? null,
      modified: core.modified ?? null,
      calc_pr: wb.calcPr,
      shared_strings: shared ? shared.length : null,
      styles,
      sheets,
      media,
    };
  }

  function census(sheet) {
    const cells = sheet.cells;
    const kinds = { formula: 0, number: 0, string: 0, bool: 0, error: 0, empty: 0 };
    for (const c of cells) kinds[c.kind]++;
    const formulaCells = cells.filter((c) => c.kind === 'formula');
    const cached = formulaCells.filter((c) => c.cached != null).map((c) => c.ref);
    const blue = cells.filter((c) => c.font_rgb === BLUE_RGB);
    const green = cells.filter((c) => c.font_rgb === GREEN_RGB);
    const yellow = cells.filter((c) => c.fill_rgb === YELLOW_RGB).map((c) => c.ref);
    return {
      cells: cells.length,
      formula_cells: formulaCells.length,
      formula_cells_with_cached_value: cached.length,
      cached_refs: cached,
      literal_numbers: kinds.number,
      strings: kinds.string,
      empty: kinds.empty,
      bools: kinds.bool,
      errors: kinds.error,
      blue_cells: blue.length,
      blue_cells_with_formula: blue.filter((c) => c.kind === 'formula').map((c) => c.ref),
      blue_literal_numbers: blue.filter((c) => c.kind === 'number').length,
      green_cells: green.length,
      green_cells_without_cross_sheet_formula: green.filter((c) => !(c.kind === 'formula' && (c.formula || '').includes('!'))).map((c) => c.ref),
      yellow_fill_cells: yellow,
    };
  }

  function totals(perSheet) {
    const keys = ['cells', 'formula_cells', 'formula_cells_with_cached_value', 'literal_numbers', 'strings',
      'empty', 'blue_cells', 'blue_literal_numbers', 'green_cells'];
    const vals = Object.values(perSheet);
    const out = {};
    for (const k of keys) out[k] = vals.reduce((n, v) => n + v[k], 0);
    out.blue_cells_with_formula = vals.reduce((n, v) => n + v.blue_cells_with_formula.length, 0);
    out.yellow_fill_cells = vals.reduce((n, v) => n + v.yellow_fill_cells.length, 0);
    return out;
  }

  function grid(sheet) {
    const g = new Map();
    for (const c of sheet.cells) g.set(`${c.col}${c.row}`, c);
    return g;
  }
  function stringAt(g, col, row) {
    const c = g.get(`${col}${row}`);
    return c && c.kind === 'string' ? c.value : null;
  }

  function extractLadder(workbook, rowsMap) {
    const sheetName = rowsMap.sheet || 'Assumptions';
    const sheet = workbook.sheets.find((s) => s.name === sheetName);
    if (!sheet) {
      throw new LadderError(`no sheet named ${repr(sheetName)}; the workbook has [${workbook.sheets.map((s) => repr(s.name)).join(', ')}]. The row map (${rowsMap.source}) reads the ladder from that sheet.`);
    }
    const g = grid(sheet);
    const columns = rowsMap.columns;
    const scenarios = rowsMap.scenarios;
    const rows = rowsMap.rows;

    let headerRow = null;
    for (const c of sheet.cells) {
      if (c.col === 'A' && c.kind === 'string' && c.value === HEADER_ROW_FIRST_CELL) { headerRow = c.row; break; }
    }
    if (headerRow == null) throw new LadderError(`no header row whose column A reads ${repr(HEADER_ROW_FIRST_CELL)} on ${repr(sheetName)}`);
    for (const name of scenarios) {
      const letter = columns[name];
      const found = stringAt(g, letter, headerRow);
      if (found !== name) {
        throw new LadderError(`header ${letter}${headerRow} reads ${repr(found)}, expected the scenario column ${repr(name)} (SCENARIOS/cols in ${rowsMap.source})`);
      }
    }

    const problems = [];
    const outRows = {};
    for (const [key, row] of Object.entries(rows)) {
      const label = stringAt(g, 'A', row);
      const guard = LABEL_GUARD[key];
      if (guard == null) { problems.push(`row ${row} (${key}): no LABEL_GUARD fragment for this key; add one before trusting it`); continue; }
      if (label == null || !label.toLowerCase().includes(guard.toLowerCase())) {
        problems.push(`ladder row ${row} (${key}): column A reads ${repr(label)}, expected a label containing ${repr(guard)}`);
        continue;
      }
      const values = {}, raws = {}, refs = {};
      let blue = true;
      for (const name of scenarios) {
        const letter = columns[name];
        const ref = `${letter}${row}`;
        const c = g.get(ref);
        if (!c || c.kind === 'empty') { problems.push(`${ref} (${key}, ${name}) is empty; a ladder cell must hold a number`); continue; }
        if (c.kind === 'formula') { problems.push(`${ref} (${key}, ${name}) holds the formula =${c.formula}; a ladder cell must be a literal input (blue), not a result`); continue; }
        if (c.kind !== 'number') { problems.push(`${ref} (${key}, ${name}) holds ${repr(c.value)} (${c.kind}), not a number`); continue; }
        values[name] = c.value; raws[name] = c.raw; refs[name] = ref;
        blue = blue && c.font_rgb === BLUE_RGB;
      }
      if (Object.keys(values).length !== scenarios.length) continue;
      outRows[key] = { row, label, note: stringAt(g, 'E', row), cells: refs, values, raw: raws, blue };
    }
    if (problems.length) {
      throw new LadderError('the Assumptions sheet does not hold the ladder where the row map says:\n  - ' + problems.join('\n  - ')
        + `\n  What would help: re-read the sheet and update _LADDER_ROWS in ${rowsMap.source} (and this tool's LABEL_GUARD) together, then re-run.`);
    }
    const cols = {};
    for (const name of scenarios) cols[name] = columns[name];
    return {
      sheet: sheetName,
      header_row: headerRow,
      columns: cols,
      rows_map_source: { file: rowsMap.source, lines: rowsMap.lines },
      rows: outRows,
    };
  }

  function slug(label) {
    const head = label.split(/ — |;/)[0];
    return head.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function extractBlock(workbook, sheetName, header, stopHeaders) {
    const sheet = workbook.sheets.find((s) => s.name === sheetName);
    if (!sheet) return { sheet: sheetName, header, header_row: null, entries: {} };
    const g = grid(sheet);
    const rowsInA = [...new Set(sheet.cells.filter((c) => c.col === 'A').map((c) => c.row))].sort((a, b) => a - b);
    let start = null;
    for (const r of rowsInA) {
      const s = stringAt(g, 'A', r);
      if (s && s.toUpperCase().startsWith(header)) { start = r; break; }
    }
    const entries = {};
    if (start == null) return { sheet: sheetName, header, header_row: null, entries: {} };
    for (const r of rowsInA) {
      if (r <= start) continue;
      const label = stringAt(g, 'A', r);
      if (label && stopHeaders.some((h) => label.toUpperCase().startsWith(h))) break;
      const b = g.get(`B${r}`);
      if (label && b && b.kind === 'number') {
        let key = slug(label);
        if (key in entries) key = `${key}_row${r}`;
        entries[key] = { row: r, label, cell: `B${r}`, value: b.value, raw: b.raw, note: stringAt(g, 'E', r), blue: b.font_rgb === BLUE_RGB };
      }
    }
    return { sheet: sheetName, header, header_row: start, entries };
  }

  function legend(workbook) {
    for (const s of workbook.sheets) for (const c of s.cells) {
      if (c.kind === 'string' && c.value && c.value.startsWith('Color code:')) return c.value;
    }
    return null;
  }

  function analyze(workbook, rowsMap, provenance) {
    const perSheet = {};
    for (const s of workbook.sheets) perSheet[s.name] = census(s);
    const tot = totals(perSheet);
    const ladder = extractLadder(workbook, rowsMap);
    const design = extractBlock(workbook, ladder.sheet, DESIGN_POINT_HEADER, [CONSTANTS_HEADER, LADDER_HEADER]);
    const consts = extractBlock(workbook, ladder.sheet, CONSTANTS_HEADER, [DESIGN_POINT_HEADER, LADDER_HEADER]);

    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
    const nRows = Object.keys(ladder.rows).length, nCols = Object.keys(ladder.columns).length;
    const nMap = Object.keys(rowsMap.rows).length;
    check('ladder-rows', nRows === nMap, `${nRows} of ${nMap} rows from ${rowsMap.source} found where the map says, labels match LABEL_GUARD`);
    check('ladder-literals', true, `all ${nRows * nCols} ladder cells hold literal numbers (none is a formula)`);
    const notBlue = Object.entries(ladder.rows).filter(([, r]) => !r.blue).map(([k]) => k);
    check('ladder-blue', notBlue.length === 0, notBlue.length === 0
      ? `all ${nRows * nCols} ladder cells use the blue input font`
      : `rows not styled as inputs (blue): [${notBlue.map(repr).join(', ')}]`);
    const bf = tot.blue_cells_with_formula;
    check('no-blue-formula', bf === 0, bf ? `${tot.blue_cells} blue cells, ${bf} of them holding a formula` : `none of the ${tot.blue_cells} blue cells holds a formula`);
    const greenBad = Object.values(perSheet).reduce((n, v) => n + v.green_cells_without_cross_sheet_formula.length, 0);
    check('green-are-links', greenBad === 0, greenBad === 0
      ? `all ${tot.green_cells} green cells are formulas that reference another sheet`
      : `${greenBad} green cells are not cross-sheet formulas`);
    const nDesign = Object.keys(design.entries).length, nConst = Object.keys(consts.entries).length;
    check('design-point', nDesign > 0, `${nDesign} shared design-point rows under ${repr(DESIGN_POINT_HEADER)}; ${nConst} physical constants under ${repr(CONSTANTS_HEADER)}`);

    const cached = tot.formula_cells_with_cached_value;
    const fcl = workbook.calc_pr && workbook.calc_pr.fullCalcOnLoad != null ? workbook.calc_pr.fullCalcOnLoad : 'None';
    const finding = cached === 0
      ? `The committed workbook holds ${tot.formula_cells} formula cells and 0 cached results: every <v> under a formula is empty. The file carries inputs (${tot.literal_numbers} literal numbers, ${tot.blue_cells} blue input cells) and formulas, not results. Any number quoted as a 'workbook result' was computed elsewhere: by a spreadsheet program that recalculated on open (calcPr fullCalcOnLoad=${fcl}) and was not saved back, or by finance/skyhook_finance.py.`
      : `The workbook holds ${tot.formula_cells} formula cells, ${cached} of them with a cached result stored in the file; the rest store none.`;

    const w = workbook;
    return {
      schema: 'blue-cells/ladder/1',
      tool: `ladder_export.py ${VERSION}`,
      workbook: {
        file: w.file, bytes: w.bytes, sha256: w.sha256, md5: w.md5, members: w.members,
        application: w.application, app_version: w.app_version, creator: w.creator, created: w.created,
        modified: w.modified, calc_pr: w.calc_pr, shared_strings: w.shared_strings, media: w.media,
        sheets: w.sheets.map((s) => s.name), legend: legend(w),
      },
      ladder,
      design_point: design,
      constants: consts,
      census: { sheets: perSheet, totals: tot },
      finding,
      checks,
      provenance: provenance || null,
    };
  }

  // ── text report, byte-for-byte the Python one ──────────────────────────────

  const pad = (s, n, right) => (right ? String(s).padStart(n) : String(s).padEnd(n));
  const comma = (n) => Number(n).toLocaleString('en-US');

  function renderReport(result) {
    const wb = result.workbook;
    const L = result.ladder;
    const cols = Object.keys(L.columns);
    const lines = [];
    lines.push(`Blue Cells ${VERSION} — the Skyhook financial workbook read with zipfile + xml only`);
    lines.push(`Workbook  ${wb.file}  ${comma(wb.bytes)} bytes, ${wb.members} zip members`);
    lines.push(`  sha256  ${wb.sha256}`);
    lines.push(`  md5     ${wb.md5}  (binary, byte-for-byte; the hash finance/decision_grid.json carries as workbook_md5)`);
    const calc = wb.calc_pr || {};
    lines.push(`  written by ${wb.application || '?'} (${wb.creator || '?'}), created ${wb.created || '?'}, modified ${wb.modified || '?'}`);
    lines.push(`  calcPr fullCalcOnLoad=${calc.fullCalcOnLoad ?? '?'} calcId=${calc.calcId ?? '?'}; shared strings: ${wb.shared_strings == null ? 'none (every string is inline)' : wb.shared_strings}`);
    const prov = result.provenance || {};
    if (Object.keys(prov).length) {
      lines.push(`  provenance  ${prov.repo} ${prov.path} @ ${String(prov.commit || '').slice(0, 7)} (${prov.commitDate}); last changed ${prov.pathLastChanged}`);
    }
    lines.push(`Sheets    ${wb.sheets.join(' | ')}`);
    if (wb.legend) lines.push(`Legend    ${wb.legend}`);
    lines.push('');
    const rowObjs = Object.values(L.rows);
    const n = rowObjs.length;
    const rmin = Math.min(...rowObjs.map((r) => r.row)), rmax = Math.max(...rowObjs.map((r) => r.row));
    lines.push(`Ladder    ${L.sheet}!${L.columns[cols[0]]}${rmin}:${L.columns[cols[cols.length - 1]]}${rmax}  ${n} rows x ${cols.length} columns, keyed by ${L.rows_map_source.file} _LADDER_ROWS`);
    const wKey = Math.max(...Object.keys(L.rows).map((k) => k.length)) + 2;
    let wVal = Math.max(...cols.map((c) => Math.max(...rowObjs.map((r) => r.raw[c].length)))) + 2;
    wVal = Math.max(wVal, Math.max(...cols.map((c) => c.length)) + 2);
    lines.push('  ' + pad('key', wKey) + cols.map((c) => pad(c, wVal, true)).join('') + '  cells    label');
    for (const [key, r] of Object.entries(L.rows)) {
      const cells = `${r.cells[cols[0]]}:${r.cells[cols[cols.length - 1]]}`;
      lines.push('  ' + pad(key, wKey) + cols.map((c) => pad(r.raw[c], wVal, true)).join('') + '  ' + pad(cells, 7) + '  ' + r.label + (r.blue ? '' : '  [NOT BLUE]'));
    }
    lines.push('');
    for (const [block, title] of [[result.design_point, 'Shared design point'], [result.constants, 'Physical constants']]) {
      const e = block.entries;
      const keys = Object.keys(e);
      if (!keys.length) { lines.push(`${title}: none found under ${repr(block.header)}`); continue; }
      const refs = keys.map((k) => e[k].cell);
      lines.push(`${title}  ${block.sheet}!${refs[0]}:${refs[refs.length - 1]}`);
      const w = Math.max(...keys.map((k) => k.length)) + 2;
      for (const k of keys) {
        const v = e[k];
        lines.push('  ' + pad(k, w) + pad(v.raw, 10, true) + '  ' + pad(v.cell, 5) + '  ' + v.label + (v.note ? `  (${v.note})` : ''));
      }
      lines.push('');
    }
    const cs = result.census.sheets;
    const tot = result.census.totals;
    lines.push('Formula census (what the file stores)');
    const hdr = ['sheet', 'cells', 'formulas', 'cached', 'numbers', 'strings', 'blue', 'green', 'yellow'];
    const widths = [22, 7, 10, 8, 9, 9, 6, 7, 8];
    lines.push('  ' + hdr.map((h, i) => pad(h, widths[i], i > 0)).join(''));
    for (const [name, c] of Object.entries(cs)) {
      const row = [name, c.cells, c.formula_cells, c.formula_cells_with_cached_value, c.literal_numbers, c.strings, c.blue_cells, c.green_cells, c.yellow_fill_cells.length];
      lines.push('  ' + row.map((v, i) => pad(v, widths[i], i > 0)).join(''));
    }
    const trow = ['TOTAL', tot.cells, tot.formula_cells, tot.formula_cells_with_cached_value, tot.literal_numbers, tot.strings, tot.blue_cells, tot.green_cells, tot.yellow_fill_cells];
    lines.push('  ' + trow.map((v, i) => pad(v, widths[i], i > 0)).join(''));
    const yellow = [];
    for (const [name, c] of Object.entries(cs)) for (const r of c.yellow_fill_cells) yellow.push(`${name}!${r}`);
    if (yellow.length) lines.push(`  yellow fill (key assumption needing attention): ${yellow.join(', ')}`);
    for (const m of wb.media || []) lines.push(`  media: ${m.member} ${comma(m.bytes)} bytes md5 ${m.md5}`);
    lines.push('');
    lines.push('Finding');
    lines.push('  ' + result.finding);
    lines.push('');
    const passed = result.checks.filter((c) => c.ok).length;
    lines.push(`Checks    ${passed} of ${result.checks.length} passed`);
    for (const c of result.checks) lines.push(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
    return lines.join('\n') + '\n';
  }

  return {
    VERSION, BLUE_RGB, GREEN_RGB, YELLOW_RGB, LABEL_GUARD, WorkbookError, LadderError, repr,
    crc32, md5, sha256Hex, readZip, inflateEntry, decodeEntities, attrs, parseWorkbookXml, parseRels,
    parseSharedStrings, parseStyles, styleColours, parseSheet, readWorkbook, census, totals, extractLadder,
    extractBlock, slug, legend, analyze, renderReport,
  };
});
