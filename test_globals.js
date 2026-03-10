// Simulate browser script loading by executing scripts in global context
global.DEFAULT_WEIGHTS = undefined;
global.TIER_SCORES = undefined;
global.scoreAllCities = undefined;
global.CITY_DATA = undefined;

// Load data.js
eval(require('fs').readFileSync('./js/data.js', 'utf8'));

// Load scoring.js
eval(require('fs').readFileSync('./js/scoring.js', 'utf8'));

// Check if globals are accessible
console.log('7-8. Browser global accessibility:');
console.log('  DEFAULT_WEIGHTS accessible:', typeof DEFAULT_WEIGHTS !== 'undefined');
console.log('  scoreAllCities accessible:', typeof scoreAllCities !== 'undefined');
console.log('  getOpportunityLabel accessible:', typeof getOpportunityLabel !== 'undefined');
console.log('  getTierColor accessible:', typeof getTierColor !== 'undefined');
console.log('  getTierLabel accessible:', typeof getTierLabel !== 'undefined');
console.log('  CITY_DATA accessible:', typeof CITY_DATA !== 'undefined');
console.log('  TIER_SCORES accessible:', typeof TIER_SCORES !== 'undefined');

if (typeof DEFAULT_WEIGHTS !== 'undefined') {
  console.log('\n  DEFAULT_WEIGHTS value:');
  Object.entries(DEFAULT_WEIGHTS).forEach(([key, val]) => {
    console.log('    ' + key + ':', val);
  });
}
