/* Idea 40's Dormand-Prince 5(4) integrator and 3x3 inverse, excerpted verbatim from ideas/40-long-coast/coast.js (lines 77-82 and 106-146) by
 * ideas/43-lumpy/build-sample.mjs; do not edit. Classic script (window.LumpyIntegrator) and require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LumpyIntegrator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // ---- coast.js lines 77-82
  function inv3(M) {
    var a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7], i = M[8];
    var A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc;
    if (!(Math.abs(det) > 0) || !isFinite(det)) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  // ---- coast.js lines 106-146
  var DP = {
    c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
    a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
      [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
    e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]   // b5 - b4
  };
  /**
   * Integrate y' = f(t, y) from t0 to t1 (either direction). Error control on the first `nErr` components only, each
   * scaled by atol[i] + rtol |y_i|, or, when opts.scale(t, y) gives [length, speed], by atol[i] + rtol times those (the
   * kernel passes the distance and speed relative to the nearer of the Sun and the Earth, so the departure hyperbola is
   * held to the same relative accuracy as the cruise). Returns {y, steps, rejected, h} or {failed}.
   */
  function dopri(f, t0, y0, t1, opts) {
    var n = y0.length, nErr = opts.nErr || n, rtol = opts.rtol, atol = opts.atol, dir = t1 >= t0 ? 1 : -1;
    var h = Math.min(Math.abs(opts.h || (t1 - t0) / 100), Math.abs(t1 - t0)) * dir, t = t0, y = y0.slice(), steps = 0, rej = 0;
    var k = [f(t, y)], ytmp = new Array(n), maxSteps = opts.maxSteps || 2e5;
    if (t1 === t0) return { y: y, steps: 0, rejected: 0, h: h };
    while (dir * (t1 - t) > 0) {
      if (dir * (t + h - t1) > 0) h = t1 - t;
      for (var s = 1; s < 7; s++) {
        for (var i = 0; i < n; i++) { var acc = 0, row = DP.a[s]; for (var j = 0; j < s; j++) acc += row[j] * k[j][i]; ytmp[i] = y[i] + h * acc; }
        k[s] = f(t + DP.c[s] * h, ytmp.slice());
      }
      var err = 0, L = opts.scale ? opts.scale(t, y) : null;
      for (var q = 0; q < nErr; q++) {
        var ei = 0; for (var m = 0; m < 7; m++) ei += DP.e[m] * k[m][q];
        var sc = atol[q] + rtol * (L ? L[q < 3 ? 0 : 1] : Math.max(Math.abs(y[q]), Math.abs(ytmp[q])));
        var r = h * ei / sc; err = Math.max(err, Math.abs(r));
      }
      if (!(err <= 1) && isFinite(err)) {
        h *= Math.max(0.2, 0.9 * Math.pow(err, -0.2)); rej++;
        if (Math.abs(h) < 1e-6) return { failed: 'step size underflow at t = ' + t };
        continue;
      }
      if (!isFinite(err)) { h *= 0.2; rej++; if (Math.abs(h) < 1e-6) return { failed: 'non-finite derivative at t = ' + t }; continue; }
      t = (dir * (t1 - (t + h)) <= 0) ? t1 : t + h; y = ytmp.slice(); k[0] = k[6]; steps++;
      h *= Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2));
      if (steps > maxSteps) return { failed: 'more than ' + maxSteps + ' steps' };
    }
    return { y: y, steps: steps, rejected: rej, h: h };
  }
  return { dopri: dopri, inv3: inv3 };
});
