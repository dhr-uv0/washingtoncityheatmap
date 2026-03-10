/**
 * WA Market Intelligence — Main Application
 * County choropleth (white→red), +/- sliders, interactive map
 */

// ── County FIPS lookup (WA = state 53) ────────────────────
const COUNTY_FIPS = {
  'Adams':'53001','Asotin':'53003','Benton':'53005','Chelan':'53007',
  'Clallam':'53009','Clark':'53011','Columbia':'53013','Cowlitz':'53015',
  'Douglas':'53017','Ferry':'53019','Franklin':'53021','Garfield':'53023',
  'Grant':'53025','Grays Harbor':'53027','Island':'53029','Jefferson':'53031',
  'King':'53033','Kitsap':'53035','Kittitas':'53037','Klickitat':'53039',
  'Lewis':'53041','Lincoln':'53043','Mason':'53045','Okanogan':'53047',
  'Pacific':'53049','Pend Oreille':'53051','Pierce':'53053','San Juan':'53055',
  'Skagit':'53057','Skamania':'53059','Snohomish':'53061','Spokane':'53063',
  'Stevens':'53065','Thurston':'53067','Wahkiakum':'53069','Walla Walla':'53071',
  'Whatcom':'53073','Whitman':'53075','Yakima':'53077'
};

// ── State ──────────────────────────────────────────────────
const state = {
  map: null,
  countyLayerMap: {},   // fips → leaflet layer
  cityMarkers: {},      // cityId → leaflet circleMarker
  countyScores: {},     // fips → { score, city }
  scoredCities: [],
  filtered: [],
  selectedCity: null,
  selectedFips: null,
  weights: { ...DEFAULT_WEIGHTS }
};

// ── Format helpers ─────────────────────────────────────────
const fmt = {
  num: n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'k' : String(n),
  usd: n => '$' + (n >= 1000 ? (n/1000).toFixed(0)+'k' : n),
  pct: n => n + '%'
};

// ── Color helpers ──────────────────────────────────────────
// White (#FFF2F2) → Deep Red (#B91C1C) gradient for map
function scoreToMapColor(score) {
  const t = Math.max(0, Math.min(1, score / 100));
  const r = Math.round(255 - 70 * t);
  const g = Math.round(242 * (1 - t * 0.98));
  const b = Math.round(242 * (1 - t * 0.98));
  return `rgb(${r},${g},${b})`;
}

function scoreToMapOpacity(score) {
  return 0.50 + 0.40 * (score / 100);
}

// Sidebar / UI elements use the same red-spectrum for consistency
function scoreToUIColor(score) {
  if (score >= 75) return '#B91C1C';
  if (score >= 60) return '#DC2626';
  if (score >= 45) return '#F87171';
  if (score >= 30) return '#FCA5A5';
  return '#94A3B8';
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── County score builder ───────────────────────────────────
// For counties with multiple tracked cities, use the highest scorer
function buildCountyScores(scoredCities) {
  const map = {};
  for (const city of scoredCities) {
    const primaryCounty = city.county.split('/')[0].trim();
    const fips = COUNTY_FIPS[primaryCounty];
    if (!fips) continue;
    if (!map[fips] || city.opportunityScore > map[fips].score) {
      map[fips] = { score: city.opportunityScore, city };
    }
  }
  return map;
}

// ── Map initialization ─────────────────────────────────────
function initMap() {
  state.map = L.map('map', {
    center: [47.35, -120.5],
    zoom: 7,
    zoomControl: false,
    preferCanvas: true,
    minZoom: 6,
    maxZoom: 13
  });

  // CartoDB Positron (light, clean — perfect background for white→red choropleth)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(state.map);

  // City/road labels on a separate pane on top
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '', subdomains: 'abcd', maxZoom: 19, opacity: 0.8
  }).addTo(state.map);

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
}

// ── Load WA county polygons (US Atlas TopoJSON via CDN) ────
async function loadCounties() {
  const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
  const us = await res.json();

  // Filter to Washington state (FIPS prefix "53")
  const all = topojson.feature(us, us.objects.counties);
  const waCounties = {
    type: 'FeatureCollection',
    features: all.features.filter(f => String(f.id).padStart(5,'0').startsWith('53'))
  };

  L.geoJSON(waCounties, {
    style: feature => countyStyle(String(feature.id).padStart(5,'0'), false),
    onEachFeature: (feature, layer) => {
      const fips = String(feature.id).padStart(5,'0');
      state.countyLayerMap[fips] = layer;
      layer.on({
        mouseover: e => countyHover(e, fips),
        mouseout:  e => countyOut(e, fips),
        click:     ()  => countyClick(fips)
      });
    }
  }).addTo(state.map);
}

function countyStyle(fips, hovered) {
  const entry = state.countyScores[fips];
  if (!entry) {
    return { fillColor: '#E2E8F0', fillOpacity: 0.45, color: '#CBD5E1', weight: 0.7 };
  }
  const base = scoreToMapOpacity(entry.score);
  return {
    fillColor: scoreToMapColor(entry.score),
    fillOpacity: hovered ? Math.min(0.95, base + 0.15) : base,
    color: hovered ? '#475569' : '#94A3B8',
    weight: hovered ? 2 : 0.8
  };
}

function countyHover(e, fips) {
  e.target.setStyle(countyStyle(fips, true));
  e.target.bringToFront();
  const entry = state.countyScores[fips];
  if (entry) showTooltip(e.originalEvent, entry.city.name, entry.score, entry.city.tier, entry.city.county.split('/')[0].trim());
}

function countyOut(e, fips) {
  if (state.selectedFips === fips) {
    e.target.setStyle({ ...countyStyle(fips, false), color: '#B91C1C', weight: 2.5 });
  } else {
    e.target.setStyle(countyStyle(fips, false));
  }
  hideTooltip();
}

function countyClick(fips) {
  const entry = state.countyScores[fips];
  if (entry) selectCity(entry.city.id);
}

function updateCountyColors() {
  state.countyScores = buildCountyScores(state.scoredCities);
  for (const [fips, layer] of Object.entries(state.countyLayerMap)) {
    if (state.selectedFips === fips) {
      layer.setStyle({ ...countyStyle(fips, false), color: '#B91C1C', weight: 2.5 });
    } else {
      layer.setStyle(countyStyle(fips, false));
    }
  }
}

// ── City dot markers ───────────────────────────────────────
function renderCityMarkers() {
  Object.values(state.cityMarkers).forEach(m => m.remove());
  state.cityMarkers = {};

  state.scoredCities.forEach(city => {
    const visible = state.filtered.some(c => c.id === city.id);
    const m = L.circleMarker([city.lat, city.lng], {
      radius: 4.5,
      fillColor: '#FFFFFF',
      color: visible ? '#334155' : '#94A3B8',
      weight: 1.5,
      fillOpacity: visible ? 0.95 : 0.3,
      opacity: visible ? 1 : 0.3
    }).addTo(state.map);

    m.on('click', () => selectCity(city.id));
    m.on('mouseover', e => showTooltip(e.originalEvent, city.name, city.opportunityScore, city.tier, city.county.split('/')[0].trim()));
    m.on('mouseout', hideTooltip);
    state.cityMarkers[city.id] = m;
  });
}

function updateMarkerStyles() {
  state.scoredCities.forEach(city => {
    const m = state.cityMarkers[city.id];
    if (!m) return;
    const visible = state.filtered.some(c => c.id === city.id);
    const selected = city.id === state.selectedCity;
    m.setStyle({
      radius: selected ? 8 : 4.5,
      fillColor: selected ? '#B91C1C' : '#FFFFFF',
      color: selected ? '#FFFFFF' : (visible ? '#334155' : '#94A3B8'),
      weight: selected ? 2.5 : 1.5,
      fillOpacity: visible ? 0.95 : 0.3,
      opacity: visible ? 1 : 0.3
    });
    if (selected) m.bringToFront();
  });
}

// ── Tooltip ────────────────────────────────────────────────
let _tip = null;

function showTooltip(e, name, score, tier, county) {
  hideTooltip();
  _tip = document.createElement('div');
  _tip.className = 'map-tooltip';
  const fill = scoreToMapColor(score);
  const dark = score > 55;
  _tip.innerHTML = `
    <div>
      <div class="tip-name">${name}</div>
      ${county ? `<div class="tip-county">${county} County</div>` : ''}
    </div>
    <div class="tip-meta">
      <span class="tip-score" style="background:${fill};color:${dark?'#fff':'#111'}">${score.toFixed(0)}</span>
      <span class="tip-tier" style="color:${getTierColor(tier)}">T${tier}</span>
    </div>`;
  document.body.appendChild(_tip);
  positionTip(e);
  state.map.on('mousemove', ev => { if (_tip) positionTip(ev.originalEvent); });
}

function positionTip(e) {
  if (!_tip) return;
  _tip.style.left = (e.clientX + 16) + 'px';
  _tip.style.top  = (e.clientY - 10) + 'px';
}

function hideTooltip() {
  if (_tip) { _tip.remove(); _tip = null; }
}

// ── City selection ─────────────────────────────────────────
function selectCity(cityId) {
  const prevFips = state.selectedFips;
  state.selectedCity = cityId;
  const city = state.scoredCities.find(c => c.id === cityId);
  if (!city) return;

  // Find county
  const fips = COUNTY_FIPS[city.county.split('/')[0].trim()] || null;
  state.selectedFips = fips;

  // Reset previous county border
  if (prevFips && state.countyLayerMap[prevFips]) {
    state.countyLayerMap[prevFips].setStyle(countyStyle(prevFips, false));
  }
  // Highlight new county
  if (fips && state.countyLayerMap[fips]) {
    state.countyLayerMap[fips].setStyle({
      ...countyStyle(fips, false), color: '#B91C1C', weight: 2.5
    });
    state.countyLayerMap[fips].bringToFront();
  }

  document.querySelectorAll('.city-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === cityId));

  state.map.flyTo([city.lat, city.lng], Math.max(state.map.getZoom(), 9), {
    animate: true, duration: 0.7
  });

  updateMarkerStyles();
  openDetailPanel(city);

  // Close mobile sidebar
  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Detail panel ───────────────────────────────────────────
function openDetailPanel(city) {
  document.getElementById('detail-panel').classList.add('open');
  const score  = city.opportunityScore;
  const uiCol  = scoreToUIColor(score);
  const mapCol = scoreToMapColor(score);
  const tCol   = getTierColor(city.tier);

  document.getElementById('p-name').textContent    = city.name;
  const countyLabel = city.county.includes('/') ? city.county + ' Counties' : city.county + ' County';
  document.getElementById('p-county').textContent  = countyLabel;
  document.getElementById('p-rank').textContent    = `#${city.rank} of ${state.scoredCities.length} cities`;

  const scoreEl = document.getElementById('p-score');
  scoreEl.textContent  = score.toFixed(0);
  scoreEl.style.color  = uiCol;

  const labelEl = document.getElementById('p-label');
  labelEl.textContent  = getOpportunityLabel(score) + ' Opportunity';
  labelEl.style.color  = uiCol;

  const tierEl = document.getElementById('p-tier');
  tierEl.textContent = getTierLabel(city.tier);
  Object.assign(tierEl.style, {
    background: hexToRgba(tCol, 0.12),
    color: tCol,
    border: `1px solid ${hexToRgba(tCol, 0.35)}`
  });

  document.getElementById('p-estimated').classList.toggle('hidden', !city.estimated);
  const notesEl = document.getElementById('p-notes');
  notesEl.textContent = city.notes || '';
  notesEl.style.display = city.notes ? '' : 'none';

  // Score breakdown bars
  const breakdown = [
    { key: 'consultingAbsence', label: 'Consulting Absence',   weight: state.weights.consultingAbsence },
    { key: 'businessAbundance', label: 'Business Abundance',   weight: state.weights.businessAbundance },
    { key: 'cityTier',          label: 'City Tier',            weight: state.weights.cityTier },
    { key: 'businessMaturity',  label: 'Business Maturity',    weight: state.weights.businessMaturity },
    { key: 'ownerDemographics', label: 'Owner Demographics',   weight: state.weights.ownerDemographics }
  ];

  document.getElementById('p-breakdown').innerHTML = breakdown.map(b => {
    const s = city.scores[b.key];
    return `
      <div class="br-row">
        <div class="br-header">
          <span class="br-label">${b.label}</span>
          <div class="br-right">
            <span class="br-score" style="color:${scoreToUIColor(s)}">${s.toFixed(0)}</span>
            <span class="br-weight">${Math.round(b.weight*100)}%</span>
          </div>
        </div>
        <div class="br-track">
          <div class="br-fill" style="width:${s}%;background:${scoreToMapColor(s)}"></div>
        </div>
      </div>`;
  }).join('');

  // Metrics grid
  const smbDensity = ((city.smbCount / city.population) * 1000).toFixed(1);
  document.getElementById('p-metrics').innerHTML = [
    { v: fmt.num(city.population),                  l: 'Population',         s: '2020 Census'  },
    { v: fmt.usd(city.medianHouseholdIncome),        l: 'Median HH Income',   s: 'ACS 2021'     },
    { v: city.consultingFirmCount,                   l: 'Consulting Firms',   s: 'CBP est.'     },
    { v: fmt.num(city.smbCount),                     l: 'SMBs (5–249 emp)',   s: 'CBP est.'     },
    { v: smbDensity + '/1k',                         l: 'SMB Density',        s: 'Derived'      },
    { v: city.businessMaturityPct + '%',             l: 'Businesses 3+ Yrs',  s: 'BLS est.'     },
    { v: city.ownerAge55PlusPct + '%',               l: 'Population 55+',     s: 'ACS 2021'     },
    { v: '+' + city.populationGrowthPct + '%',       l: 'Pop. Growth 10–20',  s: 'Census'       }
  ].map(m => `
    <div class="metric-card">
      <div class="metric-value">${m.v}</div>
      <div class="metric-label">${m.l}</div>
      <div class="metric-source">${m.s}</div>
    </div>`).join('');
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  state.selectedCity = null;
  if (state.selectedFips && state.countyLayerMap[state.selectedFips]) {
    state.countyLayerMap[state.selectedFips].setStyle(countyStyle(state.selectedFips, false));
  }
  state.selectedFips = null;
  document.querySelectorAll('.city-item').forEach(el => el.classList.remove('active'));
  updateMarkerStyles();
}

// ── Sidebar rendering ──────────────────────────────────────
function applyFilters() {
  let list = state.scoredCities;
  const tier = document.querySelector('.tier-pill.active')?.dataset.tier;
  const q = (document.getElementById('city-search').value || '').trim().toLowerCase();
  if (tier && tier !== 'all') list = list.filter(c => c.tier === parseInt(tier));
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || c.county.toLowerCase().includes(q));
  state.filtered = list;
}

function renderSidebar() {
  applyFilters();
  document.getElementById('list-count').textContent = state.filtered.length + ' cities';

  document.getElementById('city-list').innerHTML = state.filtered.map(city => {
    const score    = city.opportunityScore;
    const mapColor = scoreToMapColor(score);
    const uiColor  = scoreToUIColor(score);
    const tColor   = getTierColor(city.tier);
    const active   = state.selectedCity === city.id;
    return `
      <div class="city-item${active ? ' active' : ''}" data-id="${city.id}" onclick="selectCity('${city.id}')">
        <div class="city-rank${city.rank <= 5 ? ' top' : ''}">${city.rank}</div>
        <div class="city-swatch" style="background:${mapColor}"></div>
        <div class="city-info">
          <div class="city-name">${city.name}</div>
          <div class="city-sub">${fmt.num(city.population)} · ${fmt.usd(city.medianHouseholdIncome)}</div>
        </div>
        <div class="city-badge" style="color:${uiColor};border-color:${uiColor}">${score.toFixed(0)}</div>
        <div class="city-tier-dot" style="background:${tColor}" title="${getTierLabel(city.tier)}"></div>
      </div>`;
  }).join('');

  updateMarkerStyles();
}

function updateHeaderStats() {
  const top = state.scoredCities[0];
  const t3  = state.scoredCities.filter(c => c.tier === 3).length;
  document.getElementById('s-total').textContent = state.scoredCities.length;
  document.getElementById('s-tier3').textContent = t3;
  document.getElementById('s-top').textContent   = top?.name || '—';
  document.getElementById('s-score').textContent = top ? top.opportunityScore.toFixed(0) : '—';
  document.getElementById('s-score').style.color = top ? scoreToUIColor(top.opportunityScore) : '';
}

// ── Compute + render pipeline ──────────────────────────────
function computeAndRender() {
  state.scoredCities = scoreAllCities(CITY_DATA, state.weights);
  state.countyScores = buildCountyScores(state.scoredCities);
  renderSidebar();
  updateCountyColors();
  updateHeaderStats();
  if (state.selectedCity) {
    const city = state.scoredCities.find(c => c.id === state.selectedCity);
    if (city) openDetailPanel(city);
  }
}

// ── Sliders (+/- buttons + range) ─────────────────────────
function initSliders() {
  Object.keys(DEFAULT_WEIGHTS).forEach(key => {
    const slider  = document.getElementById(`w-${key}`);
    const display = document.getElementById(`wv-${key}`);
    if (!slider) return;

    slider.value = Math.round(state.weights[key] * 100);
    setSliderFill(slider);
    display.textContent = slider.value + '%';

    slider.addEventListener('input', () => {
      state.weights[key] = parseInt(slider.value) / 100;
      display.textContent = slider.value + '%';
      setSliderFill(slider);
      checkWeightTotal();
    });
  });

  // +/- buttons
  document.querySelectorAll('.w-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key     = btn.dataset.key;
      const delta   = parseInt(btn.dataset.delta);
      const slider  = document.getElementById(`w-${key}`);
      const display = document.getElementById(`wv-${key}`);
      const newVal  = Math.min(parseInt(slider.max), Math.max(parseInt(slider.min), parseInt(slider.value) + delta));
      slider.value              = newVal;
      state.weights[key]        = newVal / 100;
      display.textContent       = newVal + '%';
      setSliderFill(slider);
      checkWeightTotal();
    });
  });

  checkWeightTotal();
}

function setSliderFill(slider) {
  const pct = ((parseInt(slider.value) - parseInt(slider.min)) /
               (parseInt(slider.max)  - parseInt(slider.min))) * 100;
  slider.style.background = `linear-gradient(to right,#DC2626 ${pct}%,#374151 ${pct}%)`;
}

function checkWeightTotal() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  const pct   = Math.round(total * 100);
  const el    = document.getElementById('weight-total');
  const valid = Math.abs(pct - 100) <= 1;
  el.textContent = `Total: ${pct}%`;
  el.className   = 'weight-total ' + (valid ? 'valid' : 'invalid');
  document.getElementById('btn-apply-weights').disabled = !valid;
}

function resetWeights() {
  state.weights = { ...DEFAULT_WEIGHTS };
  initSliders();
}

// ── Sources table ──────────────────────────────────────────
function renderSourcesTable() {
  document.getElementById('sources-tbody').innerHTML = DATA_METADATA.sources.map(s => `
    <tr>
      <td class="src-metric">${s.metric}</td>
      <td>${s.source}</td>
      <td><span class="update-freq">${s.updateFrequency}</span></td>
    </tr>`).join('');
}

// ── Event binding ──────────────────────────────────────────
function bindEvents() {
  document.getElementById('city-search').addEventListener('input', renderSidebar);

  document.querySelectorAll('.tier-pill').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('.tier-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      renderSidebar();
    }));

  document.getElementById('panel-close').addEventListener('click', closeDetailPanel);

  // Weights toggle
  const wBtn   = document.getElementById('btn-weights');
  const wPanel = document.getElementById('weights-panel');
  wBtn.addEventListener('click', () => {
    wPanel.classList.toggle('open');
    wBtn.classList.toggle('active');
  });
  document.addEventListener('click', e => {
    if (wPanel.classList.contains('open') && !wPanel.contains(e.target) && !wBtn.contains(e.target)) {
      wPanel.classList.remove('open');
      wBtn.classList.remove('active');
    }
  });

  document.getElementById('btn-apply-weights').addEventListener('click', () => {
    computeAndRender();
    wPanel.classList.remove('open');
    wBtn.classList.remove('active');
  });
  document.getElementById('btn-reset-weights').addEventListener('click', () => {
    resetWeights();
    computeAndRender();
  });

  // Export CSV
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // Sources modal
  document.getElementById('btn-sources').addEventListener('click', () =>
    document.getElementById('sources-modal').classList.add('open'));
  document.getElementById('btn-close-sources').addEventListener('click', () =>
    document.getElementById('sources-modal').classList.remove('open'));
  document.getElementById('sources-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('sources-modal').classList.remove('open');
  });

  // Reset map
  document.getElementById('btn-reset-view').addEventListener('click', () =>
    state.map.flyTo([47.35, -120.5], 7, { animate: true, duration: 0.8 }));

  // Mobile sidebar
  document.getElementById('sidebar-toggle').addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('mobile-open'));
}

// ── Export CSV ─────────────────────────────────────────────
function exportCSV() {
  const headers = ['Rank','City','County','Tier','Score','Opportunity',
    'Population','MedianIncome','ConsultingFirms','SMBs','BusinessMaturityPct',
    'OwnerAge55PlusPct','PopGrowthPct'];
  const rows = state.scoredCities.map(c => [
    c.rank, c.name, c.county, c.tier,
    c.opportunityScore.toFixed(1), getOpportunityLabel(c.opportunityScore),
    c.population, c.medianHouseholdIncome, c.consultingFirmCount,
    c.smbCount, c.businessMaturityPct, c.ownerAge55PlusPct, c.populationGrowthPct
  ]);
  const csv = [headers, ...rows].map(r => r.map(v =>
    typeof v === 'string' && v.includes(',') ? `"${v}"` : v
  ).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'wa-market-intelligence.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initMap();

  try {
    await loadCounties();
  } catch (err) {
    console.warn('County GeoJSON failed, continuing without regions:', err);
  }

  computeAndRender();
  renderCityMarkers();
  bindEvents();
  initSliders();
  renderSourcesTable();

  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 900);
});
