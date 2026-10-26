// Loads the six snapshots for Node (the CLI and the tests); the page loads the same files as
// classic scripts, which put them on window.TorqueData under the same keys.
const path = require('node:path');
module.exports = function loadData(dir = __dirname) {
  const s = (f) => require(path.join(dir, 'snapshots', f));
  return {
    fasteners_metric: s('fasteners_metric.js'),
    design_factors_nasa: s('design_factors_nasa.js'),
    fasteners_un: s('fasteners_un_excerpt.js'),
    endcap: s('endcap.js'),
    code: s('partforge-code.js'),
    evaluation: s('evaluation-excerpt.js'),
  };
};
