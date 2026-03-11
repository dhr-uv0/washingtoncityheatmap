#!/usr/bin/env node
/**
 * scripts/update-data.js
 *
 * Monthly data refresh for WA Consulting Heatmap.
 * Fetches the latest available data from public government APIs and
 * rebuilds js/data.js in place.
 *
 * Sources:
 *   - U.S. Census Bureau ACS 5-Year Estimates (latest vintage)
 *     api.census.gov/data/{year}/acs/acs5
 *   - U.S. Census Bureau 2020 Decennial Census (growth baseline)
 *     api.census.gov/data/2020/dec/pl
 *   - U.S. Census Bureau County Business Patterns (latest vintage)
 *     api.census.gov/data/{year}/cbp
 *   - BLS Business Employment Dynamics (WA state survival rate)
 *     bls.gov/bdm/ — state-level only; city values derived from WA baseline
 *
 * Usage: node scripts/update-data.js
 * Requires: Node.js 18+ (uses built-in fetch)
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH = path.resolve(__dirname, '../js/data.js');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// Find the latest ACS 5-year vintage available (try current year - 2, then -3)
async function findLatestAcsVintage() {
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 1; y >= 2020; y--) {
    try {
      await get(`https://api.census.gov/data/${y}/acs/acs5?get=NAME&for=state:53`);
      console.log(`Using ACS vintage: ${y}`);
      return y;
    } catch(_) { /* try older */ }
  }
  throw new Error('No ACS 5-year vintage found');
}

// Find the latest CBP vintage available
async function findLatestCbpVintage() {
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 2; y >= 2019; y--) {
    try {
      await get(`https://api.census.gov/data/${y}/cbp?get=NAME,ESTAB&for=state:53&NAICS2017=00`);
      console.log(`Using CBP vintage: ${y}`);
      return y;
    } catch(_) { /* try older */ }
  }
  throw new Error('No CBP vintage found');
}

// ─── FETCH CENSUS DATA ────────────────────────────────────────────────────────

async function fetchAcsData(vintage) {
  const base = `https://api.census.gov/data/${vintage}/acs/acs5`;
  const state = 'state:53';

  console.log('Fetching population + income...');
  const popInc = await get(`${base}?get=NAME,B01003_001E,B19013_001E&for=place:*&in=${state}`);

  console.log('Fetching age 55+ brackets...');
  const ageCols = [
    'B01001_018E','B01001_019E','B01001_020E','B01001_021E',
    'B01001_022E','B01001_023E','B01001_024E','B01001_025E',
    'B01001_042E','B01001_043E','B01001_044E','B01001_045E',
    'B01001_046E','B01001_047E','B01001_048E','B01001_049E'
  ];
  const ageData = await get(
    `${base}?get=NAME,B01003_001E,${ageCols.join(',')}&for=place:*&in=${state}`
  );

  console.log('Fetching 2020 Decennial Census population (growth baseline)...');
  const dec2020 = await get(
    `https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*&in=${state}`
  );

  // Build lookups keyed by "CityName city"
  function buildLookup(data, ...valCols) {
    const h = data[0];
    const nameIdx = h.indexOf('NAME');
    const idxs = valCols.map(c => h.indexOf(c));
    const result = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = row[nameIdx].replace(/, Washington$/, '');
      result[name] = idxs.map(idx => {
        const v = parseInt(row[idx]);
        return (isNaN(v) || v < 0) ? null : v;
      });
    }
    return result;
  }

  const popIncMap  = buildLookup(popInc,  'B01003_001E', 'B19013_001E');
  const dec2020Map = buildLookup(dec2020, 'P1_001N');

  // Age 55+ lookup
  const ageH = ageData[0];
  const ageNameIdx = ageH.indexOf('NAME');
  const ageTotalIdx = ageH.indexOf('B01003_001E');
  const ageColIdxs = ageCols.map(c => ageH.indexOf(c));
  const age55Map = {};
  for (let i = 1; i < ageData.length; i++) {
    const row = ageData[i];
    const name = row[ageNameIdx].replace(/, Washington$/, '');
    const total = parseInt(row[ageTotalIdx]);
    if (!total || total <= 0) continue;
    let sum55 = 0;
    for (const idx of ageColIdxs) {
      const v = parseInt(row[idx]);
      if (!isNaN(v) && v >= 0) sum55 += v;
    }
    age55Map[name] = Math.round(sum55 / total * 1000) / 10;
  }

  // Combine into per-city object keyed by our city IDs
  const CITY_NAMES = {
    "seattle":           "Seattle city",
    "bellevue":          "Bellevue city",
    "spokane":           "Spokane city",
    "tacoma":            "Tacoma city",
    "vancouver":         "Vancouver city",
    "kent":              "Kent city",
    "everett":           "Everett city",
    "renton":            "Renton city",
    "kirkland":          "Kirkland city",
    "redmond":           "Redmond city",
    "spokane-valley":    "Spokane Valley city",
    "sammamish":         "Sammamish city",
    "bothell":           "Bothell city",
    "federal-way":       "Federal Way city",
    "bellingham":        "Bellingham city",
    "kennewick":         "Kennewick city",
    "yakima":            "Yakima city",
    "auburn":            "Auburn city",
    "marysville":        "Marysville city",
    "pasco":             "Pasco city",
    "lakewood":          "Lakewood city",
    "shoreline":         "Shoreline city",
    "richland":          "Richland city",
    "olympia":           "Olympia city",
    "lacey":             "Lacey city",
    "burien":            "Burien city",
    "lynnwood":          "Lynnwood city",
    "puyallup":          "Puyallup city",
    "edmonds":           "Edmonds city",
    "bremerton":         "Bremerton city",
    "wenatchee":         "Wenatchee city",
    "mount-vernon":      "Mount Vernon city",
    "walla-walla":       "Walla Walla city",
    "longview":          "Longview city",
    "university-place":  "University Place city",
    "issaquah":          "Issaquah city",
    "seatac":            "SeaTac city",
    "tumwater":          "Tumwater city",
    "pullman":           "Pullman city",
    "moses-lake":        "Moses Lake city",
    "ellensburg":        "Ellensburg city",
    "port-angeles":      "Port Angeles city",
    "oak-harbor":        "Oak Harbor city",
    "anacortes":         "Anacortes city",
    "centralia":         "Centralia city",
    "aberdeen":          "Aberdeen city",
    "maple-valley":      "Maple Valley city",
    "covington":         "Covington city",
    "poulsbo":           "Poulsbo city",
    "kelso":             "Kelso city",
    "camas":             "Camas city",
    "battle-ground":     "Battle Ground city",
    "washougal":         "Washougal city",
    "bonney-lake":       "Bonney Lake city",
    "gig-harbor":        "Gig Harbor city",
    "monroe":            "Monroe city",
    "arlington":         "Arlington city",
    "mukilteo":          "Mukilteo city",
    "mill-creek":        "Mill Creek city",
    "port-orchard":      "Port Orchard city",
    "lynden":            "Lynden city",
    "ferndale":          "Ferndale city",
    "sunnyside":         "Sunnyside city",
    "east-wenatchee":    "East Wenatchee city",
    "snoqualmie":        "Snoqualmie city",
    "enumclaw":          "Enumclaw city",
    "woodinville":       "Woodinville city",
    "mountlake-terrace": "Mountlake Terrace city",
    "ridgefield":        "Ridgefield city",
    "sumner":            "Sumner city",
    "orting":            "Orting city",
    "north-bend":        "North Bend city",
    "snohomish":         "Snohomish city",
    "shelton":           "Shelton city",
    "port-townsend":     "Port Townsend city",
    "sequim":            "Sequim city",
    "burlington":        "Burlington city",
    "sedro-woolley":     "Sedro-Woolley city",
    "blaine":            "Blaine city",
    "chelan":            "Chelan city",
    "leavenworth":       "Leavenworth city",
    "cashmere":          "Cashmere city",
    "ephrata":           "Ephrata city",
    "quincy":            "Quincy city",
    "othello":           "Othello city",
    "toppenish":         "Toppenish city",
    "grandview":         "Grandview city",
    "selah":             "Selah city",
    "prosser":           "Prosser city",
    "goldendale":        "Goldendale city",
    "white-salmon":      "White Salmon city",
    "chehalis":          "Chehalis city",
    "ocean-shores":      "Ocean Shores city",
    "montesano":         "Montesano city",
    "omak":              "Omak city",
    "colville":          "Colville city",
    "dayton":            "Dayton city",
    "raymond":           "Raymond city",
    "stevenson":         "Stevenson city",
    "forks":             "Forks city"
  };

  const result = {};
  for (const [id, censusName] of Object.entries(CITY_NAMES)) {
    const pi = popIncMap[censusName];
    const pop2020Row = dec2020Map[censusName];
    const pop2023 = pi ? pi[0] : null;
    const pop2020 = pop2020Row ? pop2020Row[0] : null;
    const growth = (pop2023 && pop2020 && pop2020 > 0)
      ? Math.round((pop2023 - pop2020) / pop2020 * 1000) / 10
      : null;
    result[id] = {
      population:            pop2023,
      medianHouseholdIncome: pi ? (pi[1] ? Math.round(pi[1] / 1000) * 1000 : null) : null,
      populationGrowthPct:   growth,
      ownerAge55PlusPct:     age55Map[censusName] ?? null
    };
  }
  return { data: result, vintage };
}

// ─── FETCH CBP DATA ───────────────────────────────────────────────────────────

async function fetchCbpData(vintage) {
  const base = `https://api.census.gov/data/${vintage}/cbp`;
  const state = 'state:53';

  console.log(`Fetching CBP ${vintage} consulting (NAICS 5416)...`);
  const consulting = await get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=5416`);

  console.log(`Fetching CBP ${vintage} SMB sectors...`);
  const sectors = await Promise.all([
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=23`),      // construction
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=31-33`),   // manufacturing
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=42`),      // wholesale
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=44-45`),   // retail
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=48-49`),   // transport
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=54`),      // professional
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=62`),      // healthcare
    get(`${base}?get=NAME,ESTAB&for=county:*&in=${state}&NAICS2017=72`),      // food/hospitality
  ]);

  function parseCounty(data) {
    const h = data[0];
    const nameIdx = h.indexOf('NAME');
    const estabIdx = h.indexOf('ESTAB');
    const result = {};
    for (let i = 1; i < data.length; i++) {
      const m = data[i][nameIdx].match(/^(.+?) County,/);
      if (m) result[m[1]] = parseInt(data[i][estabIdx]) || 0;
    }
    return result;
  }

  const consultingByCounty = parseCounty(consulting);
  const sectorMaps = sectors.map(parseCounty);

  // Sum all SMB sectors per county, apply 45% for 5-249 employee band
  const counties = new Set([
    ...Object.keys(consultingByCounty),
    ...sectorMaps.flatMap(m => Object.keys(m))
  ]);

  const smbByCounty = {};
  for (const county of counties) {
    const total = sectorMaps.reduce((sum, m) => sum + (m[county] || 0), 0);
    smbByCounty[county] = Math.round(total * 0.45);
  }

  // City → county mapping
  const CITY_COUNTY = {
    "seattle":"King","bellevue":"King","kent":"King","renton":"King","kirkland":"King",
    "redmond":"King","sammamish":"King","bothell":"Snohomish","federal-way":"King",
    "auburn":"King","shoreline":"King","burien":"King","issaquah":"King","seatac":"King",
    "maple-valley":"King","covington":"King","snoqualmie":"King","enumclaw":"King",
    "woodinville":"King","north-bend":"King",
    "tacoma":"Pierce","lakewood":"Pierce","puyallup":"Pierce","bonney-lake":"Pierce",
    "university-place":"Pierce","sumner":"Pierce","orting":"Pierce","gig-harbor":"Pierce",
    "everett":"Snohomish","marysville":"Snohomish","mukilteo":"Snohomish",
    "mill-creek":"Snohomish","monroe":"Snohomish","arlington":"Snohomish",
    "mountlake-terrace":"Snohomish","lynnwood":"Snohomish","edmonds":"Snohomish",
    "snohomish":"Snohomish",
    "spokane":"Spokane","spokane-valley":"Spokane",
    "vancouver":"Clark","camas":"Clark","battle-ground":"Clark","washougal":"Clark","ridgefield":"Clark",
    "bellingham":"Whatcom","lynden":"Whatcom","ferndale":"Whatcom","blaine":"Whatcom",
    "kennewick":"Benton","richland":"Benton","prosser":"Benton",
    "yakima":"Yakima","sunnyside":"Yakima","toppenish":"Yakima","grandview":"Yakima","selah":"Yakima",
    "pasco":"Franklin",
    "olympia":"Thurston","lacey":"Thurston","tumwater":"Thurston",
    "bremerton":"Kitsap","port-orchard":"Kitsap","poulsbo":"Kitsap",
    "wenatchee":"Chelan","cashmere":"Chelan","chelan":"Chelan","leavenworth":"Chelan",
    "east-wenatchee":"Douglas",
    "mount-vernon":"Skagit","burlington":"Skagit","sedro-woolley":"Skagit","anacortes":"Skagit",
    "longview":"Cowlitz","kelso":"Cowlitz",
    "walla-walla":"Walla Walla",
    "moses-lake":"Grant","ephrata":"Grant","quincy":"Grant","othello":"Grant",
    "ellensburg":"Kittitas",
    "port-angeles":"Clallam","sequim":"Clallam","forks":"Clallam",
    "oak-harbor":"Island",
    "port-townsend":"Jefferson",
    "centralia":"Lewis","chehalis":"Lewis",
    "aberdeen":"Grays Harbor","ocean-shores":"Grays Harbor","montesano":"Grays Harbor",
    "pullman":"Whitman",
    "omak":"Okanogan",
    "colville":"Stevens",
    "dayton":"Columbia",
    "raymond":"Pacific",
    "stevenson":"Skamania",
    "goldendale":"Klickitat","white-salmon":"Klickitat",
    "shelton":"Mason"
  };

  // County populations for apportionment denominator
  const COUNTY_POPS = {
    "King":2310000,"Pierce":935000,"Snohomish":845000,"Spokane":565000,
    "Clark":510000,"Whatcom":240000,"Benton":210000,"Yakima":258000,
    "Franklin":105000,"Thurston":305000,"Kitsap":275000,"Chelan":79000,
    "Douglas":45000,"Skagit":132000,"Cowlitz":113000,"Walla Walla":62000,
    "Grant":98000,"Kittitas":48000,"Clallam":76000,"Island":88000,
    "Jefferson":34000,"Lewis":82000,"Grays Harbor":74000,"Whitman":51000,
    "Okanogan":43000,"Stevens":47000,"Columbia":4100,"Pacific":24000,
    "Skamania":12500,"Klickitat":23000,"Mason":65000
  };

  return { consultingByCounty, smbByCounty, CITY_COUNTY, COUNTY_POPS, vintage };
}

// ─── COMPUTE CITY-LEVEL CBP VALUES ────────────────────────────────────────────

function computeCityBusiness(acsData, cbp) {
  const { consultingByCounty, smbByCounty, CITY_COUNTY, COUNTY_POPS } = cbp;
  const result = {};

  for (const [id, county] of Object.entries(CITY_COUNTY)) {
    const cityPop = acsData[id]?.population || 5000;
    const countyPop = COUNTY_POPS[county] || 100000;
    const share = Math.min(cityPop / countyPop, 0.85);

    let density = 1.0;
    if (cityPop > 200000) density = 1.8;
    else if (cityPop > 100000) density = 1.5;
    else if (cityPop > 50000) density = 1.3;
    else if (cityPop > 20000) density = 1.1;

    result[id] = {
      smbCount:            Math.round((smbByCounty[county] || 0) * share * density),
      consultingFirmCount: Math.round((consultingByCounty[county] || 0) * share * density)
    };
  }
  return result;
}

// ─── BUSINESS MATURITY (BLS BED — WA state baseline, city-adjusted) ───────────

function getBusinessMaturity(id, pop, growth, income) {
  // WA state 3-year survival baseline from BLS BED (2019 cohort → 2022): 61%
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
  if (pop >= 60000)  return 2;
  if (pop >= 30000)  return 3;
  if (pop >= 15000)  return 4;
  return 5;
}

// ─── PARSE STATIC FIELDS FROM EXISTING DATA.JS ────────────────────────────────

function extractStaticFields(src) {
  const cities = [];
  let i = src.indexOf('const CITY_DATA = [');
  if (i < 0) throw new Error('CITY_DATA not found in data.js');
  i = src.indexOf('[', i);
  let depth = 0, cityStart = -1;

  while (i < src.length) {
    const ch = src[i];
    if (ch === '[' || ch === '{') {
      if (ch === '{' && depth === 1) cityStart = i;
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (ch === '}' && depth === 1 && cityStart >= 0) {
        const block = src.slice(cityStart, i + 1);
        const get = (key, type = 'str') => {
          const p = { str: new RegExp(key + ':\\s*"([^"]*)"'), num: new RegExp(key + ':\\s*(-?[\\d.]+)') };
          const m = block.match(p[type]);
          return m ? (type === 'num' ? parseFloat(m[1]) : m[1]) : null;
        };
        const id = get('id');
        if (id) cities.push({ id, name: get('name'), county: get('county'), lat: get('lat','num'), lng: get('lng','num'), notes: get('notes') });
        cityStart = -1;
      }
      if (depth === 0) break;
    }
    i++;
  }
  return cities;
}

// ─── BUILD DATA.JS ────────────────────────────────────────────────────────────

function buildDataJs(staticCities, acsData, cbpCityData, acsVintage, cbpVintage) {
  const now = new Date();
  const updated = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const header = `/**
 * Washington State City Data
 *
 * DATA SOURCES — auto-refreshed monthly by GitHub Actions:
 * - population:            ACS 5-Year Estimates ${acsVintage}, B01003_001E (api.census.gov)
 * - medianHouseholdIncome: ACS 5-Year Estimates ${acsVintage}, B19013 (api.census.gov)
 * - populationGrowthPct:   ACS ${acsVintage} vs 2020 Decennial Census P1_001N (api.census.gov)
 * - ownerAge55PlusPct:     ACS 5-Year Estimates ${acsVintage}, B01001 (api.census.gov)
 * - consultingFirmCount:   CBP ${cbpVintage}, NAICS 5416, county-apportioned (api.census.gov)
 * - smbCount:              CBP ${cbpVintage}, NAICS 23/31-33/42/44-45/48-49/54/62/72
 *                          5-249 employees (~45% of total), county-apportioned (api.census.gov)
 * - businessMaturityPct:   BLS BED WA state 3-yr survival baseline (61%), city-adjusted
 *
 * SMB DEFINITION: 5–249 employees, NAICS 23/31-33/42/44-45/48-49/54/62/72
 * TIER SYSTEM:  1=100k+  2=60-99k  3=30-59k  4=15-29k  5=<15k  (by ACS pop)
 * lastUpdated: "${updated}"
 */

const DATA_METADATA = {
  lastUpdated: "${updated}",
  dataYear: ${acsVintage},
  sources: [
    {
      metric: "Population",
      source: "U.S. Census Bureau, ACS 5-Year Estimates ${acsVintage} (B01003_001E)",
      updateFrequency: "Annual (ACS 5-yr, released Dec)"
    },
    {
      metric: "Median Household Income",
      source: "U.S. Census Bureau, ACS 5-Year Estimates ${acsVintage}, Table B19013",
      updateFrequency: "Annual (ACS 5-yr, released Dec)"
    },
    {
      metric: "Population Growth %",
      source: "ACS ${acsVintage} vs 2020 Decennial Census (P1_001N)",
      updateFrequency: "Annual vs fixed 2020 baseline"
    },
    {
      metric: "Consulting Firm Count",
      source: "County Business Patterns ${cbpVintage}, NAICS 5416 — city pop-share apportioned",
      updateFrequency: "Annual (CBP ~18-month lag)"
    },
    {
      metric: "SMB Count",
      source: "CBP ${cbpVintage}, NAICS 23/31-33/42/44-45/48-49/54/62/72 (5-249 emp) — city apportioned",
      updateFrequency: "Annual (CBP ~18-month lag)"
    },
    {
      metric: "Business Maturity %",
      source: "BLS Business Employment Dynamics, WA state 3-yr survival (61% baseline), city-adjusted",
      updateFrequency: "Annual (BLS BED)"
    },
    {
      metric: "Owner Age 55+ %",
      source: "U.S. Census Bureau, ACS 5-Year Estimates ${acsVintage}, Table B01001",
      updateFrequency: "Annual (ACS 5-yr, released Dec)"
    }
  ]
};

const CITY_DATA = [`;

  const TIER_LABELS = {
    1: '─── TIER 1: Major Hubs (Avoid — Oversaturated)',
    2: '─── TIER 2: Secondary Metros (High Competition — Generally Avoid)',
    3: '─── TIER 3: Mid-Markets (OPTIMAL — Low-Mod Competition)',
    4: '─── TIER 4: Smaller Markets (Viable with Caveats)',
    5: '─── TIER 5: Micro Markets (Limited SMB Density)'
  };

  let currentTier = 0;
  const blocks = [];

  for (const st of staticCities) {
    const acs = acsData[st.id];
    const cbp = cbpCityData[st.id];
    if (!acs || !cbp) { console.warn('Skipping', st.id, '- missing data'); continue; }

    const pop   = acs.population            ?? 0;
    const inc   = acs.medianHouseholdIncome ?? 0;
    const gr    = acs.populationGrowthPct   ?? 0;
    const age   = acs.ownerAge55PlusPct     ?? 0;
    const tier  = getTier(pop);
    const mat   = getBusinessMaturity(st.id, pop, gr, inc);

    let block = '';
    if (tier !== currentTier) {
      currentTier = tier;
      block += `\n  // ${TIER_LABELS[tier]} ${'─'.repeat(Math.max(0, 58 - TIER_LABELS[tier].length))}\n`;
    }
    block += `  {
    id: "${st.id}",
    name: "${st.name}",
    county: "${st.county}",
    lat: ${st.lat},
    lng: ${st.lng},
    population: ${pop},
    medianHouseholdIncome: ${inc},
    populationGrowthPct: ${gr},
    consultingFirmCount: ${cbp.consultingFirmCount},
    smbCount: ${cbp.smbCount},
    businessMaturityPct: ${mat},
    ownerAge55PlusPct: ${age},
    tier: ${tier},
    estimated: false,
    dataYear: ${acsVintage},
    notes: "${st.notes || ''}"
  }`;
    blocks.push(block);
  }

  return header + '\n' + blocks.join(',\n') + '\n];\n';
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== WA Heatmap Data Refresh ===');
  console.log('Started:', new Date().toISOString());

  const staticCities = extractStaticFields(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log('Static fields loaded for', staticCities.length, 'cities');

  const acsVintage = await findLatestAcsVintage();
  const cbpVintage = await findLatestCbpVintage();

  const { data: acsData } = await fetchAcsData(acsVintage);
  const cbpRaw = await fetchCbpData(cbpVintage);
  const cbpCityData = computeCityBusiness(acsData, cbpRaw);

  const output = buildDataJs(staticCities, acsData, cbpCityData, acsVintage, cbpVintage);
  fs.writeFileSync(DATA_PATH, output, 'utf8');

  const cities = staticCities.length;
  const updated = Object.values(acsData).filter(d => d.population).length;
  console.log(`Written ${cities} cities (${updated} with live ACS data) to data.js`);
  console.log('ACS vintage:', acsVintage, '| CBP vintage:', cbpVintage);
  console.log('Finished:', new Date().toISOString());
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
