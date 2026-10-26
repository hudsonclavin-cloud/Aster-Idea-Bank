/*
 * Blob Basis: the pure part. No DOM, no file system, no git, no clock.
 *
 * A provenance hash is only checkable if you know which bytes it was taken on. For a text file in
 * a git checkout there are at least six candidates, and they can all differ:
 *
 *              as-is        LF-normalised (CRLF -> LF)    CRLF-synthesised (bare LF -> CRLF)
 *   disk       disk         disk-lf                       disk-crlf
 *   blob       blob         blob-lf                       blob-crlf
 *
 * "disk" is the bytes under test (normally the working-tree file), "blob" the committed blob at a
 * revision (`git cat-file blob REV:path`, which is also what a static host serves for a text file).
 * This module hashes each candidate three ways (sha256, md5, and the git blob id, which is sha1 of
 * "blob <length>\0" + bytes), groups candidates whose bytes are identical, and says which candidate
 * a recorded hash matches. The CLI (blob-basis.mjs) supplies the bytes; the page (app.js) supplies
 * them from a file the reader picks. Both use the functions below.
 *
 * The hash functions are written out here (FIPS 180-4 SHA-256 and SHA-1, RFC 1321 MD5) so the page
 * works from file:// with nothing installed; the tests check them against node:crypto. The CLI can
 * pass node:crypto in as `hasher` for speed.
 *
 * Loads as a classic script (window.BlobBasis) and with require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlobBasis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CR = 13;
  var LF = 10;
  // git's own "is this binary?" test looks for a NUL in the first 8,000 bytes (FIRST_FEW_BYTES in
  // git's xdiff-interface.c). Used only to warn that EOL transforms of a binary file are not
  // something git would ever produce.
  var BINARY_SNIFF_BYTES = 8000;

  // ---------------------------------------------------------------------------------------------
  // Hash functions. Round constants are computed from their definitions rather than typed in:
  // SHA-256 K = first 32 bits of the fractional parts of the cube roots of the first 64 primes,
  // H0 = the same of the square roots of the first 8 primes (FIPS 180-4 §4.2.2, §5.3.3); MD5
  // T[i] = floor(2^32 * |sin(i + 1)|) (RFC 1321 §3.4). SHA-1's four constants are
  // floor(2^30 * sqrt(n)) for n = 2, 3, 5, 10 (FIPS 180-4 §4.2.1).
  function primes(n) {
    var out = [];
    for (var c = 2; out.length < n; c++) {
      var isP = true;
      for (var i = 0; i < out.length && out[i] * out[i] <= c; i++) if (c % out[i] === 0) { isP = false; break; }
      if (isP) out.push(c);
    }
    return out;
  }
  function frac32(x) {
    return ((x - Math.floor(x)) * 4294967296) >>> 0;
  }
  var P64 = primes(64);
  var SHA256_K = new Int32Array(64);
  for (var ki = 0; ki < 64; ki++) SHA256_K[ki] = frac32(Math.cbrt(P64[ki])) | 0;
  var SHA256_H0 = [];
  for (var hi = 0; hi < 8; hi++) SHA256_H0.push(frac32(Math.sqrt(P64[hi])) | 0);
  var SHA1_K = [2, 3, 5, 10].map(function (n) { return Math.floor(Math.sqrt(n) * 1073741824) | 0; });
  var MD5_T = new Int32Array(64);
  for (var ti = 0; ti < 64; ti++) MD5_T[ti] = Math.floor(Math.abs(Math.sin(ti + 1)) * 4294967296) | 0;
  var MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

  function hex32be(words) {
    var s = '';
    for (var i = 0; i < words.length; i++) s += ('00000000' + (words[i] >>> 0).toString(16)).slice(-8);
    return s;
  }
  function hex32le(words) {
    var s = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i] >>> 0;
      for (var b = 0; b < 4; b++) s += ('0' + ((w >>> (8 * b)) & 255).toString(16)).slice(-2);
    }
    return s;
  }

  // The final one or two 64-byte blocks: the bytes after the last full block, 0x80, zeros, and the
  // message length in bits (big-endian for SHA, little-endian for MD5).
  function tail(bytes, littleEndian) {
    var n = bytes.length;
    var rem = n % 64;
    var t = new Uint8Array(rem < 56 ? 64 : 128);
    t.set(bytes.subarray(n - rem), 0);
    t[rem] = 0x80;
    var bitsLo = (n * 8) >>> 0;
    var bitsHi = Math.floor((n * 8) / 4294967296) >>> 0;
    var e = t.length;
    for (var i = 0; i < 4; i++) {
      if (littleEndian) {
        t[e - 8 + i] = (bitsLo >>> (8 * i)) & 255;
        t[e - 4 + i] = (bitsHi >>> (8 * i)) & 255;
      } else {
        t[e - 1 - i] = (bitsLo >>> (8 * i)) & 255;
        t[e - 5 - i] = (bitsHi >>> (8 * i)) & 255;
      }
    }
    return t;
  }

  function sha256(bytes) {
    var H = SHA256_H0.slice();
    var W = new Int32Array(64);
    var K = SHA256_K;
    function block(b, off) {
      for (var i = 0; i < 16; i++) {
        var j = off + 4 * i;
        W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
      }
      for (i = 16; i < 64; i++) {
        var w15 = W[i - 15];
        var w2 = W[i - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var full = bytes.length - (bytes.length % 64);
    for (var off = 0; off < full; off += 64) block(bytes, off);
    var t = tail(bytes, false);
    for (off = 0; off < t.length; off += 64) block(t, off);
    return hex32be(H);
  }

  function sha1(bytes) {
    var H = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0];
    var W = new Int32Array(80);
    function block(b, off) {
      for (var i = 0; i < 16; i++) {
        var j = off + 4 * i;
        W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
      }
      for (i = 16; i < 80; i++) {
        var x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
        W[i] = (x << 1) | (x >>> 31);
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4];
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (bb & c) | (~bb & d); k = SHA1_K[0]; }
        else if (i < 40) { f = bb ^ c ^ d; k = SHA1_K[1]; }
        else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = SHA1_K[2]; }
        else { f = bb ^ c ^ d; k = SHA1_K[3]; }
        var tmp = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    var full = bytes.length - (bytes.length % 64);
    for (var off = 0; off < full; off += 64) block(bytes, off);
    var t = tail(bytes, false);
    for (off = 0; off < t.length; off += 64) block(t, off);
    return hex32be(H);
  }

  function md5(bytes) {
    var H = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    var M = new Int32Array(16);
    function block(b, off) {
      for (var i = 0; i < 16; i++) {
        var j = off + 4 * i;
        M[i] = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16) | (b[j + 3] << 24);
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3];
      for (i = 0; i < 64; i++) {
        var f, g;
        if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
        else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
        var s = MD5_S[(i >> 4) * 4 + (i % 4)];
        var x = (a + f + MD5_T[i] + M[g]) | 0;
        a = d; d = c; c = bb;
        bb = (bb + ((x << s) | (x >>> (32 - s)))) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    }
    var full = bytes.length - (bytes.length % 64);
    for (var off = 0; off < full; off += 64) block(bytes, off);
    var t = tail(bytes, true);
    for (off = 0; off < t.length; off += 64) block(t, off);
    return hex32le(H);
  }

  function asciiBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }

  // git's object id for a blob: sha1 over "blob <decimal length>\0" followed by the bytes.
  function blobHeader(n) {
    return asciiBytes('blob ' + n + '\u0000');
  }
  function gitBlobIdPure(bytes) {
    var h = blobHeader(bytes.length);
    var all = new Uint8Array(h.length + bytes.length);
    all.set(h, 0);
    all.set(bytes, h.length);
    return sha1(all);
  }

  var PURE = {
    name: 'pure-js',
    sha256: sha256,
    md5: md5,
    blobId: gitBlobIdPure,
  };

  // ---------------------------------------------------------------------------------------------
  // Line endings.

  function eolStats(bytes) {
    var crlf = 0, bareLf = 0, bareCr = 0, nul = false;
    var n = bytes.length;
    for (var i = 0; i < n; i++) {
      var b = bytes[i];
      if (b === LF) {
        if (i > 0 && bytes[i - 1] === CR) crlf++;
        else bareLf++;
      } else if (b === CR) {
        if (i + 1 >= n || bytes[i + 1] !== LF) bareCr++;
      } else if (b === 0 && i < BINARY_SNIFF_BYTES) nul = true;
    }
    return { bytes: n, crlf: crlf, bareLf: bareLf, bareCr: bareCr, binary: nul };
  }

  // CRLF -> LF. A lone CR is left alone, as git's text conversion leaves it (a CR not followed by LF
  // is not a line ending to git). Returns the same array when there is nothing to change.
  function toLf(bytes) {
    var n = bytes.length, count = 0, i;
    for (i = 1; i < n; i++) if (bytes[i] === LF && bytes[i - 1] === CR) count++;
    if (!count) return bytes;
    var out = new Uint8Array(n - count);
    var o = 0;
    for (i = 0; i < n; i++) {
      if (bytes[i] === CR && i + 1 < n && bytes[i + 1] === LF) continue;
      out[o++] = bytes[i];
    }
    return out;
  }

  // Bare LF -> CRLF: what a CRLF checkout (core.autocrlf=true, or eol=crlf) writes for an LF blob.
  // An LF that already has a CR before it is left alone, so the transform is idempotent.
  function toCrlf(bytes) {
    var n = bytes.length, count = 0, i;
    for (i = 0; i < n; i++) if (bytes[i] === LF && (i === 0 || bytes[i - 1] !== CR)) count++;
    if (!count) return bytes;
    var out = new Uint8Array(n + count);
    var o = 0;
    for (i = 0; i < n; i++) {
      if (bytes[i] === LF && (i === 0 || bytes[i - 1] !== CR)) out[o++] = CR;
      out[o++] = bytes[i];
    }
    return out;
  }

  function sameBytes(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // The six bases.

  var SOURCES = ['disk', 'blob'];
  var TRANSFORMS = [
    { key: '', label: 'as-is', fn: function (b) { return b; } },
    { key: '-lf', label: 'LF-normalised', fn: toLf },
    { key: '-crlf', label: 'CRLF-synthesised', fn: toCrlf },
  ];
  var BASIS_NAMES = ['disk', 'disk-lf', 'disk-crlf', 'blob', 'blob-lf', 'blob-crlf'];

  // toCrlf only inserts a CR before each bare LF, so its statistics follow from the input's: every
  // bare LF becomes a CRLF, nothing else changes (a bare CR is by definition not followed by an LF,
  // so no insertion touches it). toLf has no such shortcut: "\r\r\n" becomes "\r\n", which
  // turns a bare CR into a CRLF, so its statistics are counted afresh.
  function crlfStatsFrom(st) {
    return { bytes: st.bytes + st.bareLf, crlf: st.crlf + st.bareLf, bareLf: 0, bareCr: st.bareCr, binary: st.binary };
  }

  // sources: { disk: Uint8Array|null, blob: Uint8Array|null, diskWhy?, blobWhy? } (null = unavailable,
  // with the reason in diskWhy / blobWhy). hasher: { sha256, md5, blobId, equal? } taking a
  // Uint8Array. Byte-identical candidates are hashed once and share an equivalence `family`.
  function computeBases(sources, hasher) {
    hasher = hasher || PURE;
    var equal = hasher.equal || sameBytes;
    var distinct = []; // { bytes, family, hashes, stats, lf, crlf }
    function intern(bytes, stats) {
      for (var d = 0; d < distinct.length; d++) {
        var e = distinct[d];
        if (e.bytes === bytes || (e.bytes.length === bytes.length && equal(e.bytes, bytes))) return e;
      }
      var entry = {
        bytes: bytes,
        family: distinct.length + 1,
        hashes: { sha256: hasher.sha256(bytes), md5: hasher.md5(bytes), blobId: hasher.blobId(bytes) },
        stats: stats || eolStats(bytes),
        lf: null,
        crlf: null,
      };
      distinct.push(entry);
      return entry;
    }
    var rows = [];
    for (var s = 0; s < SOURCES.length; s++) {
      var src = SOURCES[s];
      var raw = sources[src];
      if (!raw) {
        for (var u = 0; u < TRANSFORMS.length; u++) {
          rows.push({ name: src + TRANSFORMS[u].key, source: src, transform: TRANSFORMS[u].label, available: false, why: sources[src + 'Why'] || src + ' bytes unavailable' });
        }
        continue;
      }
      var base = intern(raw, null);
      // Transforms are worked out once per distinct byte string: when the blob is the disk bytes,
      // its LF and CRLF forms are the disk's.
      if (!base.lf) base.lf = base.stats.crlf ? intern(toLf(base.bytes), null) : base;
      if (!base.crlf) base.crlf = base.stats.bareLf ? intern(toCrlf(base.bytes), crlfStatsFrom(base.stats)) : base;
      var entries = [base, base.lf, base.crlf];
      for (var t = 0; t < TRANSFORMS.length; t++) {
        var e = entries[t];
        rows.push({
          name: src + TRANSFORMS[t].key,
          source: src,
          transform: TRANSFORMS[t].label,
          available: true,
          family: e.family,
          bytes: e.bytes.length,
          sha256: e.hashes.sha256,
          md5: e.hashes.md5,
          blobId: e.hashes.blobId,
          stats: e.stats,
          binary: base.stats.binary,
        });
      }
    }
    // For each row, the other rows with the same bytes (so a report can print "= disk").
    for (var r = 0; r < rows.length; r++) {
      rows[r].sameAs = [];
      if (!rows[r].available) continue;
      for (var q = 0; q < rows.length; q++) {
        if (q !== r && rows[q].available && rows[q].family === rows[r].family) rows[r].sameAs.push(rows[q].name);
      }
    }
    return { rows: rows, families: distinct.length };
  }

  function row(bases, name) {
    for (var i = 0; i < bases.rows.length; i++) if (bases.rows[i].name === name) return bases.rows[i];
    return null;
  }

  // How the bytes under test relate to the committed blob.
  //   IDENTICAL      disk == blob, byte for byte
  //   CRLF-CHECKOUT  disk == blob-crlf: exactly what a CRLF checkout of this blob writes
  //   EOL-ONLY       disk-lf == blob-lf: same content, line endings differ some other way (mixed
  //                  endings, or a blob committed with CRLF checked out as LF)
  //   DIRTY          the content differs beyond line endings
  //   UNTRACKED / NOT-ON-DISK / UNAVAILABLE   one side is missing (reason given)
  var VERDICT_TEXT = {
    IDENTICAL: 'the bytes under test are the committed blob, byte for byte',
    'CRLF-CHECKOUT': 'the bytes under test are the committed blob with a CR added before every LF, exactly what a CRLF checkout writes',
    'EOL-ONLY': 'same content as the committed blob once line endings are normalised, but not a plain CRLF checkout of it (mixed or otherwise different endings)',
    DIRTY: 'the content differs from the committed blob beyond line endings',
  };
  function workingVerdict(bases, missing) {
    var disk = row(bases, 'disk');
    var blob = row(bases, 'blob');
    if (!disk.available && !blob.available) return { code: 'UNAVAILABLE', text: 'neither the bytes under test nor the committed blob could be read: ' + disk.why + '; ' + blob.why };
    if (!disk.available) return { code: 'NOT-ON-DISK', text: disk.why };
    if (!blob.available) return { code: (missing && missing.blobCode) || 'UNAVAILABLE', text: 'blob basis unavailable: ' + blob.why };
    var code;
    if (disk.family === blob.family) code = 'IDENTICAL';
    else if (disk.family === row(bases, 'blob-crlf').family) code = 'CRLF-CHECKOUT';
    else if (row(bases, 'disk-lf').family === row(bases, 'blob-lf').family) code = 'EOL-ONLY';
    else code = 'DIRTY';
    return { code: code, text: VERDICT_TEXT[code] };
  }

  // ---------------------------------------------------------------------------------------------
  // Recorded hashes.

  // A recorded value by length: 64 hex = sha256, 40 = git blob id (sha1), 32 = md5; 8 to 31 hex is
  // an abbreviated value ("b278dd55...") matched as a prefix of every algorithm.
  function classifyHex(value) {
    var v = String(value == null ? '' : value).trim().replace(/(…|\.\.\.)$/, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(v)) return { ok: false, value: v, why: 'not a hexadecimal string' };
    if (v.length === 64) return { ok: true, value: v, algo: 'sha256', prefix: false };
    if (v.length === 40) return { ok: true, value: v, algo: 'blobId', prefix: false };
    if (v.length === 32) return { ok: true, value: v, algo: 'md5', prefix: false };
    if (v.length >= 8 && v.length < 32) return { ok: true, value: v, algo: 'prefix', prefix: true };
    return { ok: false, value: v, why: v.length < 8 ? 'shorter than 8 hex digits: too short to name a basis' : 'length ' + v.length + ' is not 32 (md5), 40 (git blob id) or 64 (sha256)' };
  }

  var ALGO_LABEL = { sha256: 'sha256', md5: 'md5', blobId: 'git blob id' };

  // Which bases a recorded value matches. `bytes` (optional) is a byte count recorded next to the
  // hash; it is checked against the matching basis and, when nothing matches, used to say which
  // basis has that length.
  function matchHash(value, bases, recordedBytes) {
    var c = classifyHex(value);
    if (!c.ok) return { ok: false, code: 'INVALID', value: c.value, why: c.why };
    var algos = c.algo === 'prefix' ? ['sha256', 'md5', 'blobId'] : [c.algo];
    var matches = [];
    var full = null;
    var algoHit = null;
    for (var i = 0; i < bases.rows.length; i++) {
      var r = bases.rows[i];
      if (!r.available) continue;
      for (var a = 0; a < algos.length; a++) {
        var h = r[algos[a]];
        if (c.prefix ? h.indexOf(c.value) === 0 : h === c.value) {
          matches.push(r.name);
          full = h;
          algoHit = algos[a];
          break;
        }
      }
    }
    var byName = {};
    matches.forEach(function (m) { byName[m] = true; });
    var blobAvailable = !!(row(bases, 'blob') && row(bases, 'blob').available);
    var code;
    if (byName.blob) code = 'BLOB-BASIS';
    else if (byName['blob-crlf']) code = 'CRLF-BASIS';
    else if (byName['blob-lf']) code = 'LF-BASIS';
    else if (matches.length) code = 'WORKTREE-BASIS';
    else code = 'NO-MATCH';
    var out = {
      ok: true,
      code: code,
      value: c.value,
      algo: algoHit || c.algo,
      prefix: c.prefix,
      fullHash: full,
      matches: matches,
      blobAvailable: blobAvailable,
    };
    // A basis is told apart from the others only if its hash differs from theirs.
    var avail = bases.rows.filter(function (r) { return r.available; });
    out.discriminating = matches.length > 0 && matches.length < avail.length;
    if (recordedBytes != null && isFinite(recordedBytes)) {
      out.recordedBytes = Number(recordedBytes);
      if (matches.length) {
        var mr = row(bases, matches[0]);
        out.bytesAgree = mr.bytes === out.recordedBytes;
      } else {
        out.bytesAgree = null;
        out.basesWithThoseBytes = avail.filter(function (r) { return r.bytes === out.recordedBytes; }).map(function (r) { return r.name; });
      }
    }
    return out;
  }

  var MATCH_TEXT = {
    'BLOB-BASIS': 'taken on the committed blob: reproducible from any clone with git cat-file blob',
    'CRLF-BASIS': 'taken on a CRLF copy of the committed blob: reproducible only by adding a CR before every LF',
    'LF-BASIS': 'taken on the LF-normalised committed blob (the blob itself holds CRLF)',
    'WORKTREE-BASIS': 'matches only the bytes under test, not the committed blob: reproducible only from this copy',
    'NO-MATCH': 'matches none of the six bases',
    'HISTORY': 'matches an older committed version of the file, not the one at this revision',
  };

  // In a browser there is no git. Given the committed blob id alone (the output of
  // `git rev-parse REV:path`), the committed bytes can still be recovered when one of this copy's
  // three forms has that id: a git blob id is sha1 over the content, so a match means the content
  // is the blob's (short of a SHA-1 collision, the same trust git itself places in the id).
  // `diskBases` is computeBases({ disk: bytes, blob: null }).
  function inferBlob(diskBytes, diskBases, committedBlobId) {
    var id = String(committedBlobId == null ? '' : committedBlobId).trim().toLowerCase();
    if (!id) return { blob: null, code: 'NO-ID', why: 'no committed blob id given; a browser has no git, so the blob basis needs the output of git rev-parse REV:path' };
    if (!/^[0-9a-f]{40}$/.test(id)) return { blob: null, code: 'BAD-ID', why: 'a git blob id is 40 hexadecimal digits' };
    var forms = { disk: function (b) { return b; }, 'disk-lf': toLf, 'disk-crlf': toCrlf };
    var names = ['disk', 'disk-lf', 'disk-crlf'];
    for (var i = 0; i < names.length; i++) {
      var r = row(diskBases, names[i]);
      if (r && r.available && r.blobId === id) return { blob: forms[names[i]](diskBytes), code: 'FOUND', via: names[i] };
    }
    return { blob: null, code: 'NOT-FOUND', why: 'none of this copy\'s three forms has blob id ' + id.slice(0, 12) + '\u2026: its content differs from that blob beyond line endings, or the id belongs to another file or revision' };
  }

  // ---------------------------------------------------------------------------------------------
  // Scanning a provenance JSON for recorded hashes.

  function pointerEscape(k) {
    return String(k).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  // Every string that looks like a file hash: 64 hex (sha256), 32 hex (md5), or 40 hex under a key
  // naming a blob. Other 40-hex strings (commit ids such as solverCommit) are listed separately as
  // `ids`, because they name a commit, not file bytes. The file a hash is about comes from `map`
  // (key name or JSON pointer -> path), else a sibling "path" string; otherwise it is unresolved.
  // A sibling "bytes" number is carried along as the recorded byte count.
  function scanJson(doc, map) {
    map = map || {};
    var hashes = [];
    var ids = [];
    function visit(node, ptr) {
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) visit(node[i], ptr + '/' + i);
        return;
      }
      if (!node || typeof node !== 'object') return;
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v = node[key];
        var p = ptr + '/' + pointerEscape(key);
        if (typeof v === 'string' && /^[0-9a-fA-F]+$/.test(v)) {
          var len = v.length;
          var isHash = len === 64 || len === 32 || (len === 40 && /blob/i.test(key));
          if (isHash) {
            var mapped = map[p] != null ? map[p] : map[key];
            var path = mapped != null ? mapped : typeof node.path === 'string' ? node.path : null;
            hashes.push({
              pointer: p,
              key: key,
              value: v.toLowerCase(),
              algo: len === 64 ? 'sha256' : len === 32 ? 'md5' : 'blobId',
              path: path,
              pathFrom: mapped != null ? 'map' : path != null ? 'sibling path' : null,
              recordedBytes: typeof node.bytes === 'number' ? node.bytes : null,
            });
          } else if (len === 40) {
            ids.push({ pointer: p, key: key, value: v.toLowerCase() });
          }
        } else if (v && typeof v === 'object') visit(v, p);
      }
    }
    visit(doc, '');
    return { hashes: hashes, ids: ids };
  }

  // ---------------------------------------------------------------------------------------------
  // Small formatting helpers shared by the CLI and the page.

  function group3(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // A deterministic ~1 KB LF text for the unit tests and the page's samples. Plain ASCII, one
  // record per line, ending with a newline; no real data.
  function sampleText() {
    var lines = ['{"sample": "blob-basis line-ending fixture (not data)", "rows": ['];
    for (var i = 1; i <= 24; i++) {
      var a = (i * 7919) % 1000;
      var b = (i * 104729) % 10000;
      lines.push('  {"i": ' + i + ', "a": ' + a + ', "b": ' + b + '}' + (i < 24 ? ',' : ''));
    }
    lines.push(']}');
    return lines.join('\n') + '\n';
  }
  // Variants of the sample for the four verdicts: the LF original, its CRLF twin, a mixed copy
  // (every third line CRLF), and a mixed copy with one digit changed.
  function sampleVariants() {
    var lf = asciiBytes(sampleText());
    var crlf = toCrlf(lf);
    var text = sampleText().split('\n');
    var mixedText = text.map(function (l, i) { return i < text.length - 1 && i % 3 === 0 ? l + '\r' : l; }).join('\n');
    var mixed = asciiBytes(mixedText);
    var edited = asciiBytes(mixedText.replace('"a": 919', '"a": 918'));
    return { lf: lf, crlf: crlf, mixed: mixed, edited: edited };
  }

  return {
    sha256: sha256,
    sha1: sha1,
    md5: md5,
    gitBlobId: gitBlobIdPure,
    blobHeader: blobHeader,
    PURE: PURE,
    BINARY_SNIFF_BYTES: BINARY_SNIFF_BYTES,
    eolStats: eolStats,
    crlfStatsFrom: crlfStatsFrom,
    toLf: toLf,
    toCrlf: toCrlf,
    sameBytes: sameBytes,
    BASIS_NAMES: BASIS_NAMES,
    computeBases: computeBases,
    row: row,
    workingVerdict: workingVerdict,
    inferBlob: inferBlob,
    VERDICT_TEXT: VERDICT_TEXT,
    classifyHex: classifyHex,
    matchHash: matchHash,
    MATCH_TEXT: MATCH_TEXT,
    ALGO_LABEL: ALGO_LABEL,
    scanJson: scanJson,
    group3: group3,
    asciiBytes: asciiBytes,
    sampleText: sampleText,
    sampleVariants: sampleVariants,
  };
});
