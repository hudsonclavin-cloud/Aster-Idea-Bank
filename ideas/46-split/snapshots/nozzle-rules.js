/* The design rules and empirical constants idea 32 (Bell) uses, each with an exact quote that bell.test.mjs
 * finds in snapshots/nozzle-sources.txt (verbatim pdftotext lines of NASA SP-8120 and NASA SP-125; OCR errors
 * kept). Where the text layer garbles a printed number, `scan` says what the rendered page shows and where it
 * was checked. Hand-transcribed; nothing here is typed from memory. Classic script and require(). */
(function (root) {
  var RULES = {
    separation: {
      // Schilling (1962), as given by SP-8120 section 2.1.2.1.3: separation occurs when the wall pressure falls to
      // pAmb * a * (pAmb / pc)^b.
      a: 0.583, b: 0.195,
      quote: 'Pwall/Pamb    =   0.583       (Pamb/P)°"195',
      scan: 'Pwall/Pamb = 0.583 (Pamb/Pc)^0.195 (SP-8120 printed page 17, PDF page 31, rendered at 200 dpi)',
      src: 'SP8120',
      early: { ratio: 0.4, quote: 'when the ratio of exit pressure to ambient pressure was equal to 0.4', src: 'SP8120' },
      margin: { fraction: 0.20, quote: 'exit wall pressure is within 20 percent of the separation    pressure', src: 'SP8120' },
    },
    bell: {
      // Rao's thrust-optimised parabola as SP-125 lays it out: upstream arc 1.5 Rt, downstream arc 0.382 Rt,
      // a parabola from N to E; length as a fraction of a 15-degree cone with the same throat, arc and area ratio.
      upstreamArc: 1.5, upstreamQuote: 'with a radius of 1.5 Rt',
      downstreamArc: 0.382, downstreamQuote: 'circular arc of radius 0.382 R t',
      referenceConeDeg: 15, referenceQuote: '15°-half-angle   conical nozzle having the same expansion          area ratio',
      lengthQuote: 'R t (Vc-1) + R(sec a -1)', lengthScan: 'Ln = [Rt (sqrt(eps) - 1) + R (sec a - 1)] / tan a, SP-125 equation (4-7)',
      parabolaQuote: 'a canted-parabola                            contour', lossQuote: '0.25      percent',
      src: 'SP125',
      // SP-8120's own recommendations, shown on the page beside SP-125's construction (not used in the geometry):
      sp8120UpstreamQuote: 'radius ratio at about 1.0',
    },
    cone: {
      // lambda = (1 + cos a) / 2, SP-125 equation (4-8); 0.983 at 15 degrees.
      lambdaQuote: 'A=i(ltcosa)', lambdaScan: 'lambda = 1/2 (1 + cos a), SP-125 equation (4-8)', check15: 0.983,
      check15Quote: 'conical nozzle with a = 15° and A= 0.983',
      downstreamArc: 0.75, downstreamQuote: 'should not be made smaller than about 0.75', downstreamSrc: 'SP8120',
    },
    sources: {
      SP8120: 'NASA SP-8120, Liquid Rocket Engine Nozzles (NASA Space Vehicle Design Criteria, 1976), NTRS 19770009165',
      SP125: 'NASA SP-125, Design of Liquid Propellant Rocket Engines, 2nd ed. (D. K. Huzel and D. H. Huang, 1971), NTRS 19710019929',
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = RULES;
  else root.NOZZLE_RULES = RULES;
})(typeof self !== 'undefined' ? self : this);
