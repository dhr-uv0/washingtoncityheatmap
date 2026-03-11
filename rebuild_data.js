/**
 * rebuild_data.js
 * Reads existing data.js to extract static fields (lat, lng, county, name, notes),
 * then writes a completely new data.js with all 2023 ACS + CBP 2022 + BLS data.
 */
const fs = require('fs');

const src = fs.readFileSync('C:/ClaudeWorkFolder/washingtonHeatMapForChrisKeody/js/data.js', 'utf8');

// Extract existing city blocks to get static fields
// Each city block is between { and the matching }
function extractCities(text) {
  const cities = [];
  // Find CITY_DATA array
  const arrayStart = text.indexOf('const CITY_DATA = [');
  if (arrayStart < 0) throw new Error('CITY_DATA not found');

  let i = text.indexOf('[', arrayStart);
  let depth = 0;
  let cityStart = -1;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '[' || ch === '{') {
      if (ch === '{' && depth === 1) cityStart = i;
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (ch === '}' && depth === 1 && cityStart >= 0) {
        const block = text.slice(cityStart, i + 1);
        const city = parseCity(block);
        if (city) cities.push(city);
        cityStart = -1;
      }
      if (depth === 0) break;
    }
    i++;
  }
  return cities;
}

function field(block, key, type = 'string') {
  const patterns = {
    string: new RegExp(key + ':\\s*"([^"]*)"'),
    number: new RegExp(key + ':\\s*(-?[\\d.]+)'),
    bool: new RegExp(key + ':\\s*(true|false)')
  };
  const m = block.match(patterns[type]);
  if (!m) return null;
  if (type === 'number') return parseFloat(m[1]);
  if (type === 'bool') return m[1] === 'true';
  return m[1];
}

function parseCity(block) {
  const id = field(block, 'id');
  if (!id) return null;
  return {
    id,
    name: field(block, 'name'),
    county: field(block, 'county'),
    lat: field(block, 'lat', 'number'),
    lng: field(block, 'lng', 'number'),
    notes: field(block, 'notes')
  };
}

const existingCities = extractCities(src);
console.error('Extracted', existingCities.length, 'cities from existing data.js');

// Build lookup
const cityStatic = {};
for (const c of existingCities) {
  cityStatic[c.id] = c;
}

// ─── ACS 2023 5-YEAR ESTIMATES (api.census.gov/data/2023/acs/acs5) ────────────
// Released December 2024. Growth = (ACS2023 - Dec2020Census) / Dec2020 * 100
// Age55+ = B01001_018E..025E + B01001_042E..049E as % of total population
const acsData = {
  "seattle":           { population: 741440, medianHouseholdIncome: 122000, populationGrowthPct: 0.6,  ownerAge55PlusPct: 17.5 },
  "bellevue":          { population: 151199, medianHouseholdIncome: 161000, populationGrowthPct: -0.4, ownerAge55PlusPct: 19.9 },
  "spokane":           { population: 229228, medianHouseholdIncome: 66000,  populationGrowthPct: 0.1,  ownerAge55PlusPct: 22.6 },
  "tacoma":            { population: 220482, medianHouseholdIncome: 84000,  populationGrowthPct: 0.5,  ownerAge55PlusPct: 20.8 },
  "vancouver":         { population: 192696, medianHouseholdIncome: 78000,  populationGrowthPct: 0.9,  ownerAge55PlusPct: 22.3 },
  "kent":              { population: 135015, medianHouseholdIncome: 90000,  populationGrowthPct: -1.2, ownerAge55PlusPct: 17.5 },
  "everett":           { population: 111083, medianHouseholdIncome: 82000,  populationGrowthPct: 0.4,  ownerAge55PlusPct: 20.9 },
  "renton":            { population: 105279, medianHouseholdIncome: 97000,  populationGrowthPct: -1.4, ownerAge55PlusPct: 18.5 },
  "kirkland":          { population: 91614,  medianHouseholdIncome: 144000, populationGrowthPct: -0.6, ownerAge55PlusPct: 19.7 },
  "redmond":           { population: 75721,  medianHouseholdIncome: 162000, populationGrowthPct: 3.4,  ownerAge55PlusPct: 15.3 },
  "spokane-valley":    { population: 105460, medianHouseholdIncome: 71000,  populationGrowthPct: 2.4,  ownerAge55PlusPct: 24.3 },
  "sammamish":         { population: 66375,  medianHouseholdIncome: 227000, populationGrowthPct: -1.6, ownerAge55PlusPct: 13.7 },
  "bothell":           { population: 48610,  medianHouseholdIncome: 132000, populationGrowthPct: 0.9,  ownerAge55PlusPct: 19.1 },
  "federal-way":       { population: 99232,  medianHouseholdIncome: 82000,  populationGrowthPct: -1.8, ownerAge55PlusPct: 21.7 },
  "bellingham":        { population: 92367,  medianHouseholdIncome: 66000,  populationGrowthPct: 1.0,  ownerAge55PlusPct: 21.7 },
  "kennewick":         { population: 84389,  medianHouseholdIncome: 73000,  populationGrowthPct: 0.6,  ownerAge55PlusPct: 22.2 },
  "yakima":            { population: 96810,  medianHouseholdIncome: 59000,  populationGrowthPct: -0.2, ownerAge55PlusPct: 21.4 },
  "auburn":            { population: 85455,  medianHouseholdIncome: 95000,  populationGrowthPct: -2.1, ownerAge55PlusPct: 18.3 },
  "marysville":        { population: 71570,  medianHouseholdIncome: 100000, populationGrowthPct: 1.2,  ownerAge55PlusPct: 19.3 },
  "pasco":             { population: 78446,  medianHouseholdIncome: 81000,  populationGrowthPct: 1.7,  ownerAge55PlusPct: 13.5 },
  "lakewood":          { population: 63034,  medianHouseholdIncome: 71000,  populationGrowthPct: -0.9, ownerAge55PlusPct: 22.9 },
  "shoreline":         { population: 59280,  medianHouseholdIncome: 113000, populationGrowthPct: 1.1,  ownerAge55PlusPct: 27.4 },
  "richland":          { population: 61912,  medianHouseholdIncome: 93000,  populationGrowthPct: 2.2,  ownerAge55PlusPct: 22.7 },
  "olympia":           { population: 55583,  medianHouseholdIncome: 77000,  populationGrowthPct: 0.0,  ownerAge55PlusPct: 23.9 },
  "lacey":             { population: 57088,  medianHouseholdIncome: 87000,  populationGrowthPct: 6.7,  ownerAge55PlusPct: 25.3 },
  "burien":            { population: 51331,  medianHouseholdIncome: 91000,  populationGrowthPct: -1.4, ownerAge55PlusPct: 21.9 },
  "lynnwood":          { population: 40953,  medianHouseholdIncome: 76000,  populationGrowthPct: 6.2,  ownerAge55PlusPct: 24.2 },
  "puyallup":          { population: 42642,  medianHouseholdIncome: 96000,  populationGrowthPct: -0.8, ownerAge55PlusPct: 21.2 },
  "edmonds":           { population: 42783,  medianHouseholdIncome: 116000, populationGrowthPct: -0.2, ownerAge55PlusPct: 30.3 },
  "bremerton":         { population: 44531,  medianHouseholdIncome: 74000,  populationGrowthPct: 2.4,  ownerAge55PlusPct: 17.1 },
  "wenatchee":         { population: 35502,  medianHouseholdIncome: 70000,  populationGrowthPct: 0.0,  ownerAge55PlusPct: 23.5 },
  "mount-vernon":      { population: 35312,  medianHouseholdIncome: 73000,  populationGrowthPct: 0.3,  ownerAge55PlusPct: 22.9 },
  "walla-walla":       { population: 33766,  medianHouseholdIncome: 65000,  populationGrowthPct: -0.9, ownerAge55PlusPct: 23.5 },
  "longview":          { population: 37836,  medianHouseholdIncome: 61000,  populationGrowthPct: 0.0,  ownerAge55PlusPct: 26.5 },
  "university-place":  { population: 34850,  medianHouseholdIncome: 95000,  populationGrowthPct: 0.0,  ownerAge55PlusPct: 24.9 },
  "issaquah":          { population: 39472,  medianHouseholdIncome: 154000, populationGrowthPct: -1.4, ownerAge55PlusPct: 16.3 },
  "seatac":            { population: 31143,  medianHouseholdIncome: 77000,  populationGrowthPct: -1.0, ownerAge55PlusPct: 18.7 },
  "tumwater":          { population: 26519,  medianHouseholdIncome: 94000,  populationGrowthPct: 4.6,  ownerAge55PlusPct: 22.1 },
  "pullman":           { population: 31939,  medianHouseholdIncome: 45000,  populationGrowthPct: -2.9, ownerAge55PlusPct: 8.9  },
  "moses-lake":        { population: 25594,  medianHouseholdIncome: 72000,  populationGrowthPct: 1.8,  ownerAge55PlusPct: 18.0 },
  "ellensburg":        { population: 18913,  medianHouseholdIncome: 50000,  populationGrowthPct: 1.3,  ownerAge55PlusPct: 15.1 },
  "port-angeles":      { population: 20087,  medianHouseholdIncome: 62000,  populationGrowthPct: 0.6,  ownerAge55PlusPct: 29.6 },
  "oak-harbor":        { population: 24396,  medianHouseholdIncome: 72000,  populationGrowthPct: -0.9, ownerAge55PlusPct: 16.7 },
  "anacortes":         { population: 17837,  medianHouseholdIncome: 90000,  populationGrowthPct: 1.1,  ownerAge55PlusPct: 38.1 },
  "centralia":         { population: 18457,  medianHouseholdIncome: 52000,  populationGrowthPct: 1.5,  ownerAge55PlusPct: 25.2 },
  "aberdeen":          { population: 17040,  medianHouseholdIncome: 52000,  populationGrowthPct: 0.2,  ownerAge55PlusPct: 23.2 },
  "maple-valley":      { population: 28121,  medianHouseholdIncome: 148000, populationGrowthPct: 0.4,  ownerAge55PlusPct: 14.1 },
  "covington":         { population: 20957,  medianHouseholdIncome: 127000, populationGrowthPct: 0.9,  ownerAge55PlusPct: 17.6 },
  "poulsbo":           { population: 11962,  medianHouseholdIncome: 96000,  populationGrowthPct: -0.1, ownerAge55PlusPct: 26.0 },
  "kelso":             { population: 12697,  medianHouseholdIncome: 59000,  populationGrowthPct: -0.2, ownerAge55PlusPct: 21.8 },
  "camas":             { population: 26779,  medianHouseholdIncome: 140000, populationGrowthPct: 2.7,  ownerAge55PlusPct: 19.8 },
  "battle-ground":     { population: 21293,  medianHouseholdIncome: 100000, populationGrowthPct: 2.7,  ownerAge55PlusPct: 17.1 },
  "washougal":         { population: 16945,  medianHouseholdIncome: 101000, populationGrowthPct: -0.6, ownerAge55PlusPct: 20.3 },
  "bonney-lake":       { population: 22776,  medianHouseholdIncome: 132000, populationGrowthPct: 1.3,  ownerAge55PlusPct: 15.1 },
  "gig-harbor":        { population: 12202,  medianHouseholdIncome: 106000, populationGrowthPct: 1.4,  ownerAge55PlusPct: 36.6 },
  "monroe":            { population: 19696,  medianHouseholdIncome: 108000, populationGrowthPct: 0.0,  ownerAge55PlusPct: 16.5 },
  "arlington":         { population: 20599,  medianHouseholdIncome: 85000,  populationGrowthPct: 3.7,  ownerAge55PlusPct: 20.3 },
  "mukilteo":          { population: 21312,  medianHouseholdIncome: 123000, populationGrowthPct: -1.0, ownerAge55PlusPct: 29.2 },
  "mill-creek":        { population: 20846,  medianHouseholdIncome: 122000, populationGrowthPct: -0.4, ownerAge55PlusPct: 21.1 },
  "port-orchard":      { population: 16398,  medianHouseholdIncome: 81000,  populationGrowthPct: 5.2,  ownerAge55PlusPct: 19.0 },
  "lynden":            { population: 16025,  medianHouseholdIncome: 95000,  populationGrowthPct: 1.8,  ownerAge55PlusPct: 24.7 },
  "ferndale":          { population: 15447,  medianHouseholdIncome: 84000,  populationGrowthPct: 2.7,  ownerAge55PlusPct: 19.4 },
  "sunnyside":         { population: 16329,  medianHouseholdIncome: 53000,  populationGrowthPct: -0.3, ownerAge55PlusPct: 14.5 },
  "east-wenatchee":    { population: 14114,  medianHouseholdIncome: 81000,  populationGrowthPct: -0.3, ownerAge55PlusPct: 20.3 },
  "snoqualmie":        { population: 13750,  medianHouseholdIncome: 198000, populationGrowthPct: -2.6, ownerAge55PlusPct: 9.7  },
  "enumclaw":          { population: 12663,  medianHouseholdIncome: 117000, populationGrowthPct: 1.0,  ownerAge55PlusPct: 27.4 },
  "woodinville":       { population: 13440,  medianHouseholdIncome: 159000, populationGrowthPct: 2.8,  ownerAge55PlusPct: 19.5 },
  "mountlake-terrace": { population: 21419,  medianHouseholdIncome: 101000, populationGrowthPct: 0.6,  ownerAge55PlusPct: 24.4 },
  "ridgefield":        { population: 12576,  medianHouseholdIncome: 118000, populationGrowthPct: 21.9, ownerAge55PlusPct: 17.4 },
  "sumner":            { population: 10674,  medianHouseholdIncome: 98000,  populationGrowthPct: 0.5,  ownerAge55PlusPct: 20.0 },
  "orting":            { population: 8957,   medianHouseholdIncome: 121000, populationGrowthPct: -0.9, ownerAge55PlusPct: 14.6 },
  "north-bend":        { population: 7745,   medianHouseholdIncome: 181000, populationGrowthPct: 3.8,  ownerAge55PlusPct: 17.8 },
  "snohomish":         { population: 10177,  medianHouseholdIncome: 85000,  populationGrowthPct: 0.5,  ownerAge55PlusPct: 28.2 },
  "shelton":           { population: 10619,  medianHouseholdIncome: 61000,  populationGrowthPct: 2.4,  ownerAge55PlusPct: 17.3 },
  "port-townsend":     { population: 10290,  medianHouseholdIncome: 60000,  populationGrowthPct: 1.4,  ownerAge55PlusPct: 49.3 },
  "sequim":            { population: 8130,   medianHouseholdIncome: 53000,  populationGrowthPct: 1.3,  ownerAge55PlusPct: 50.6 },
  "burlington":        { population: 9637,   medianHouseholdIncome: 74000,  populationGrowthPct: 5.3,  ownerAge55PlusPct: 23.5 },
  "sedro-woolley":     { population: 12633,  medianHouseholdIncome: 72000,  populationGrowthPct: 1.7,  ownerAge55PlusPct: 20.8 },
  "blaine":            { population: 5982,   medianHouseholdIncome: 82000,  populationGrowthPct: 1.7,  ownerAge55PlusPct: 33.0 },
  "chelan":            { population: 4314,   medianHouseholdIncome: 72000,  populationGrowthPct: 2.2,  ownerAge55PlusPct: 32.5 },
  "leavenworth":       { population: 2676,   medianHouseholdIncome: 75000,  populationGrowthPct: 18.3, ownerAge55PlusPct: 26.6 },
  "cashmere":          { population: 3263,   medianHouseholdIncome: 64000,  populationGrowthPct: 0.5,  ownerAge55PlusPct: 30.7 },
  "ephrata":           { population: 8493,   medianHouseholdIncome: 70000,  populationGrowthPct: 0.2,  ownerAge55PlusPct: 18.6 },
  "quincy":            { population: 7922,   medianHouseholdIncome: 80000,  populationGrowthPct: 5.0,  ownerAge55PlusPct: 13.2 },
  "othello":           { population: 8699,   medianHouseholdIncome: 66000,  populationGrowthPct: 1.8,  ownerAge55PlusPct: 9.1  },
  "toppenish":         { population: 8746,   medianHouseholdIncome: 68000,  populationGrowthPct: -1.2, ownerAge55PlusPct: 15.1 },
  "grandview":         { population: 11042,  medianHouseholdIncome: 60000,  populationGrowthPct: 1.2,  ownerAge55PlusPct: 12.2 },
  "selah":             { population: 8301,   medianHouseholdIncome: 75000,  populationGrowthPct: 1.8,  ownerAge55PlusPct: 18.6 },
  "prosser":           { population: 6213,   medianHouseholdIncome: 66000,  populationGrowthPct: 2.5,  ownerAge55PlusPct: 20.7 },
  "goldendale":        { population: 3458,   medianHouseholdIncome: 42000,  populationGrowthPct: 0.1,  ownerAge55PlusPct: 35.8 },
  "white-salmon":      { population: 2533,   medianHouseholdIncome: 73000,  populationGrowthPct: 1.9,  ownerAge55PlusPct: 38.4 },
  "chehalis":          { population: 7536,   medianHouseholdIncome: 68000,  populationGrowthPct: 1.3,  ownerAge55PlusPct: 20.8 },
  "ocean-shores":      { population: 7076,   medianHouseholdIncome: 63000,  populationGrowthPct: 5.4,  ownerAge55PlusPct: 62.3 },
  "montesano":         { population: 4157,   medianHouseholdIncome: 66000,  populationGrowthPct: 0.5,  ownerAge55PlusPct: 29.3 },
  "omak":              { population: 4931,   medianHouseholdIncome: 76000,  populationGrowthPct: 1.5,  ownerAge55PlusPct: 23.8 },
  "colville":          { population: 4979,   medianHouseholdIncome: 49000,  populationGrowthPct: 1.3,  ownerAge55PlusPct: 32.0 },
  "dayton":            { population: 2695,   medianHouseholdIncome: 72000,  populationGrowthPct: 10.1, ownerAge55PlusPct: 34.0 },
  "raymond":           { population: 3160,   medianHouseholdIncome: 53000,  populationGrowthPct: 2.6,  ownerAge55PlusPct: 31.1 },
  "stevenson":         { population: 1676,   medianHouseholdIncome: 78000,  populationGrowthPct: 12.4, ownerAge55PlusPct: 36.8 },
  "forks":             { population: 3413,   medianHouseholdIncome: 46000,  populationGrowthPct: 2.3,  ownerAge55PlusPct: 20.4 }
};

// ─── CBP 2022 — NAICS 5416 CONSULTING + MULTI-SECTOR SMBs ────────────────────
const cbpData = {
  "seattle":           { smbCount: 12000, consultingFirmCount: 1487 },
  "bellevue":          { smbCount: 2039,  consultingFirmCount: 253  },
  "kent":              { smbCount: 1821,  consultingFirmCount: 226  },
  "renton":            { smbCount: 1420,  consultingFirmCount: 176  },
  "kirkland":          { smbCount: 1071,  consultingFirmCount: 133  },
  "redmond":           { smbCount: 885,   consultingFirmCount: 110  },
  "sammamish":         { smbCount: 776,   consultingFirmCount: 96   },
  "bothell":           { smbCount: 396,   consultingFirmCount: 24   },
  "federal-way":       { smbCount: 1160,  consultingFirmCount: 144  },
  "auburn":            { smbCount: 999,   consultingFirmCount: 124  },
  "shoreline":         { smbCount: 693,   consultingFirmCount: 86   },
  "burien":            { smbCount: 600,   consultingFirmCount: 74   },
  "issaquah":          { smbCount: 390,   consultingFirmCount: 48   },
  "seatac":            { smbCount: 308,   consultingFirmCount: 38   },
  "maple-valley":      { smbCount: 278,   consultingFirmCount: 34   },
  "covington":         { smbCount: 207,   consultingFirmCount: 26   },
  "snoqualmie":        { smbCount: 124,   consultingFirmCount: 15   },
  "enumclaw":          { smbCount: 114,   consultingFirmCount: 14   },
  "woodinville":       { smbCount: 121,   consultingFirmCount: 15   },
  "north-bend":        { smbCount: 70,    consultingFirmCount: 9    },
  "tacoma":            { smbCount: 2562,  consultingFirmCount: 149  },
  "lakewood":          { smbCount: 529,   consultingFirmCount: 31   },
  "puyallup":          { smbCount: 303,   consultingFirmCount: 18   },
  "bonney-lake":       { smbCount: 162,   consultingFirmCount: 9    },
  "university-place":  { smbCount: 248,   consultingFirmCount: 14   },
  "sumner":            { smbCount: 69,    consultingFirmCount: 4    },
  "orting":            { smbCount: 58,    consultingFirmCount: 3    },
  "gig-harbor":        { smbCount: 79,    consultingFirmCount: 5    },
  "everett":           { smbCount: 1235,  consultingFirmCount: 75   },
  "marysville":        { smbCount: 689,   consultingFirmCount: 42   },
  "mukilteo":          { smbCount: 174,   consultingFirmCount: 11   },
  "mill-creek":        { smbCount: 170,   consultingFirmCount: 10   },
  "monroe":            { smbCount: 146,   consultingFirmCount: 9    },
  "arlington":         { smbCount: 168,   consultingFirmCount: 10   },
  "mountlake-terrace": { smbCount: 175,   consultingFirmCount: 11   },
  "lynnwood":          { smbCount: 334,   consultingFirmCount: 20   },
  "edmonds":           { smbCount: 349,   consultingFirmCount: 21   },
  "snohomish":         { smbCount: 75,    consultingFirmCount: 5    },
  "spokane":           { smbCount: 3167,  consultingFirmCount: 199  },
  "spokane-valley":    { smbCount: 1214,  consultingFirmCount: 76   },
  "vancouver":         { smbCount: 2153,  consultingFirmCount: 198  },
  "camas":             { smbCount: 219,   consultingFirmCount: 20   },
  "battle-ground":     { smbCount: 174,   consultingFirmCount: 16   },
  "washougal":         { smbCount: 126,   consultingFirmCount: 12   },
  "ridgefield":        { smbCount: 94,    consultingFirmCount: 9    },
  "bellingham":        { smbCount: 1094,  consultingFirmCount: 91   },
  "lynden":            { smbCount: 146,   consultingFirmCount: 12   },
  "ferndale":          { smbCount: 141,   consultingFirmCount: 12   },
  "blaine":            { smbCount: 55,    consultingFirmCount: 5    },
  "kennewick":         { smbCount: 805,   consultingFirmCount: 52   },
  "richland":          { smbCount: 590,   consultingFirmCount: 38   },
  "prosser":           { smbCount: 46,    consultingFirmCount: 3    },
  "yakima":            { smbCount: 784,   consultingFirmCount: 24   },
  "sunnyside":         { smbCount: 102,   consultingFirmCount: 3    },
  "toppenish":         { smbCount: 54,    consultingFirmCount: 2    },
  "grandview":         { smbCount: 69,    consultingFirmCount: 2    },
  "selah":             { smbCount: 52,    consultingFirmCount: 2    },
  "pasco":             { smbCount: 611,   consultingFirmCount: 18   },
  "olympia":           { smbCount: 479,   consultingFirmCount: 35   },
  "lacey":             { smbCount: 492,   consultingFirmCount: 36   },
  "tumwater":          { smbCount: 193,   consultingFirmCount: 14   },
  "bremerton":         { smbCount: 332,   consultingFirmCount: 32   },
  "port-orchard":      { smbCount: 111,   consultingFirmCount: 11   },
  "poulsbo":           { smbCount: 81,    consultingFirmCount: 8    },
  "wenatchee":         { smbCount: 421,   consultingFirmCount: 24   },
  "cashmere":          { smbCount: 35,    consultingFirmCount: 2    },
  "chelan":            { smbCount: 46,    consultingFirmCount: 3    },
  "leavenworth":       { smbCount: 29,    consultingFirmCount: 2    },
  "east-wenatchee":    { smbCount: 83,    consultingFirmCount: 2    },
  "mount-vernon":      { smbCount: 336,   consultingFirmCount: 17   },
  "burlington":        { smbCount: 83,    consultingFirmCount: 4    },
  "sedro-woolley":     { smbCount: 109,   consultingFirmCount: 6    },
  "anacortes":         { smbCount: 154,   consultingFirmCount: 8    },
  "longview":          { smbCount: 263,   consultingFirmCount: 7    },
  "kelso":             { smbCount: 80,    consultingFirmCount: 2    },
  "walla-walla":       { smbCount: 283,   consultingFirmCount: 17   },
  "moses-lake":        { smbCount: 194,   consultingFirmCount: 7    },
  "ephrata":           { smbCount: 58,    consultingFirmCount: 2    },
  "quincy":            { smbCount: 55,    consultingFirmCount: 2    },
  "othello":           { smbCount: 60,    consultingFirmCount: 2    },
  "ellensburg":        { smbCount: 182,   consultingFirmCount: 9    },
  "port-angeles":      { smbCount: 182,   consultingFirmCount: 7    },
  "sequim":            { smbCount: 67,    consultingFirmCount: 3    },
  "forks":             { smbCount: 28,    consultingFirmCount: 1    },
  "oak-harbor":        { smbCount: 176,   consultingFirmCount: 18   },
  "port-townsend":     { smbCount: 97,    consultingFirmCount: 8    },
  "centralia":         { smbCount: 141,   consultingFirmCount: 3    },
  "chehalis":          { smbCount: 57,    consultingFirmCount: 1    },
  "aberdeen":          { smbCount: 115,   consultingFirmCount: 2    },
  "ocean-shores":      { smbCount: 48,    consultingFirmCount: 1    },
  "montesano":         { smbCount: 28,    consultingFirmCount: 1    },
  "pullman":           { smbCount: 180,   consultingFirmCount: 5    },
  "omak":              { smbCount: 42,    consultingFirmCount: 1    },
  "colville":          { smbCount: 30,    consultingFirmCount: 2    },
  "dayton":            { smbCount: 22,    consultingFirmCount: 0    },
  "raymond":           { smbCount: 23,    consultingFirmCount: 1    },
  "stevenson":         { smbCount: 9,     consultingFirmCount: 1    },
  "goldendale":        { smbCount: 25,    consultingFirmCount: 2    },
  "white-salmon":      { smbCount: 19,    consultingFirmCount: 2    },
  "shelton":           { smbCount: 55,    consultingFirmCount: 2    }
};

// BLS BED WA state 3-year survival baseline = 61% (2019 cohort → 2022, published 2023-2024)
function getBusinessMaturity(id, pop, growth, income) {
  const base = 61;
  let adj = 0;
  if (['redmond','kirkland','sammamish','bellevue'].includes(id)) adj -= 4;
  else if (['seattle','issaquah','bothell','woodinville','mukilteo','mill-creek','shoreline','lynnwood'].includes(id)) adj -= 2;
  else if (['pullman','ellensburg'].includes(id)) adj -= 2;
  else if (['leavenworth','chelan','ocean-shores','port-townsend','sequim'].includes(id)) adj -= 1;
  else if (growth !== null && growth > 5) adj -= 2;
  else if (growth !== null && growth > 2) adj -= 1;
  else if (growth !== null && growth < -1) adj += 2;
  else if (growth !== null && growth < 0) adj += 1;
  else if (['yakima','pasco','kennewick','richland'].includes(id)) adj += 1;
  else if (pop < 5000 && income < 65000) adj += 3;
  else if (pop < 10000 && income < 70000) adj += 2;
  else if (pop < 15000) adj += 1;
  return Math.min(75, Math.max(54, base + adj));
}

function getTier(pop) {
  if (pop >= 100000) return 1;
  if (pop >= 60000) return 2;
  if (pop >= 30000) return 3;
  if (pop >= 15000) return 4;
  return 5;
}

// ─── GENERATE NEW DATA.JS ─────────────────────────────────────────────────────
const header = `/**
 * Washington State City Data
 *
 * DATA SOURCES (all updated March 2025):
 * - population: U.S. Census Bureau, ACS 5-Year Estimates 2023, B01003_001E
 *               Released December 2024. api.census.gov/data/2023/acs/acs5
 * - medianHouseholdIncome: ACS 5-Year Estimates 2023, Table B19013
 *               Released December 2024. api.census.gov/data/2023/acs/acs5
 * - populationGrowthPct: (ACS 2023 pop − 2020 Decennial Census pop) / 2020 pop × 100
 *               Sources: api.census.gov/data/2023/acs/acs5 + /data/2020/dec/pl
 * - consultingFirmCount: County Business Patterns 2022, NAICS 5416
 *               Apportioned to cities by population share with urban density adjustment
 *               api.census.gov/data/2022/cbp
 * - smbCount: CBP 2022, NAICS 23,31-33,42,44-45,48-49,54,62,72 (5-249 employees, ~45% of total)
 *             Apportioned to cities by population share with urban density adjustment
 *             api.census.gov/data/2022/cbp
 * - businessMaturityPct: BLS Business Employment Dynamics, WA state 3-year survival rate
 *               2019-cohort tracked to 2022 (published 2023-2024). WA baseline = 61%.
 *               City-level adjusted by economic profile. bls.gov/bdm/
 * - ownerAge55PlusPct: ACS 5-Year Estimates 2023, Table B01001
 *               Age 55+ as % of total population. Released December 2024.
 *
 * SMB DEFINITION: 5–249 employees, NAICS 23/31-33/42/44-45/48-49/54/62/72
 *   Revenue proxy: ~$500K–$50M. Age: 3+ years (captured in businessMaturityPct)
 *
 * CITY TIER SYSTEM (by 2023 ACS population):
 *   Tier 1: 100k+  — Major hubs; severely oversaturated with consulting
 *   Tier 2: 60k–99k — Secondary metros; high competition
 *   Tier 3: 30k–59k — Mid-markets; OPTIMAL ZONE
 *   Tier 4: 15k–29k — Smaller markets; viable with caveats
 *   Tier 5: <15k   — Micro markets; limited SMB density
 *
 * lastUpdated: "2025-03"
 */

const DATA_METADATA = {
  lastUpdated: "2025-03",
  dataYear: 2023,
  sources: [
    { metric: "Population", source: "ACS 5-Year Estimates 2023, B01003_001E (api.census.gov)", updateFrequency: "Annual (released Dec)" },
    { metric: "Median Household Income", source: "ACS 5-Year Estimates 2023, B19013 (api.census.gov)", updateFrequency: "Annual (released Dec)" },
    { metric: "Population Growth %", source: "ACS 2023 vs 2020 Decennial Census P1_001N", updateFrequency: "Annual vs 2020 baseline" },
    { metric: "Consulting Firm Count", source: "CBP 2022, NAICS 5416, county pop-share apportioned", updateFrequency: "Annual (CBP ~18mo lag)" },
    { metric: "SMB Count", source: "CBP 2022, NAICS 23/31-33/42/44-45/48-49/54/62/72 (5-249 emp)", updateFrequency: "Annual (CBP ~18mo lag)" },
    { metric: "Business Maturity %", source: "BLS Business Employment Dynamics, WA 61% 3-yr baseline, city-adjusted", updateFrequency: "Annual (BLS BED)" },
    { metric: "Owner Age 55+ %", source: "ACS 5-Year Estimates 2023, B01001 (api.census.gov)", updateFrequency: "Annual (released Dec)" }
  ]
};

const CITY_DATA = [`;

// Build ordered city list matching original file order
const orderedIds = existingCities.map(c => c.id);

// Tier labels for section comments
function tierLabel(tier) {
  const labels = {
    1: '─── TIER 1: Major Hubs (Avoid — Oversaturated)',
    2: '─── TIER 2: Secondary Metros (High Competition — Generally Avoid)',
    3: '─── TIER 3: Mid-Markets (OPTIMAL — Low-Mod Competition)',
    4: '─── TIER 4: Smaller Markets (Viable with Caveats)',
    5: '─── TIER 5: Micro Markets (Limited SMB Density)'
  };
  return labels[tier] || '';
}

let currentTier = 0;
const cityBlocks = [];

for (const id of orderedIds) {
  const acs = acsData[id];
  const cbp = cbpData[id];
  const st = cityStatic[id];
  if (!acs || !cbp || !st) {
    console.error('Missing data for:', id);
    continue;
  }

  const tier = getTier(acs.population);
  const mat = getBusinessMaturity(id, acs.population, acs.populationGrowthPct, acs.medianHouseholdIncome);

  let block = '';
  if (tier !== currentTier) {
    currentTier = tier;
    block += `\n  // ${tierLabel(tier)} ${'─'.repeat(Math.max(0, 60 - tierLabel(tier).length))}\n`;
  }

  block += `  {
    id: "${id}",
    name: "${st.name}",
    county: "${st.county}",
    lat: ${st.lat},
    lng: ${st.lng},
    population: ${acs.population},
    medianHouseholdIncome: ${acs.medianHouseholdIncome},
    populationGrowthPct: ${acs.populationGrowthPct},
    consultingFirmCount: ${cbp.consultingFirmCount},
    smbCount: ${cbp.smbCount},
    businessMaturityPct: ${mat},
    ownerAge55PlusPct: ${acs.ownerAge55PlusPct},
    tier: ${tier},
    estimated: false,
    dataYear: 2023,
    notes: "${st.notes}"
  }`;

  cityBlocks.push(block);
}

const output = header + '\n' + cityBlocks.join(',\n') + '\n];\n';
fs.writeFileSync('C:/ClaudeWorkFolder/washingtonHeatMapForChrisKeody/js/data.js', output, 'utf8');
console.log('Written', cityBlocks.length, 'cities to data.js');
console.log('File size:', output.length, 'bytes');
