/* The three file pairs the page and the tests diff, with what each pair is. Only the first is an
   attempt and its retry, and it is synthetic (built by build-data.mjs). Loads as a classic script
   (window.ShadowPairs) and via require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShadowPairs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return { PAIRS: [
    ['motor-retainer.scad', 'motor-retainer.retry.scad', 'a synthetic retry (built by build-data.mjs: one number moved inside the FLIGHT block)'],
    ['retainer.scad', 'retainer-fixed.scad', 'a hand correction of a dry run (tests/dryrun/cases.json: "hand-corrected from retainer.scad"), not a model retry'],
    ['ring1.scad', 'ring6-after-doctrine-fix.scad', 'two independent runs, not a retry (ring 6 is a separate run made after the doctrine fix 98df2a2)'],
  ] };
});
