/**
 * WA Market Intelligence — Main Application
 * 3D spike/bar map with deck.gl ColumnLayer
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
  deckgl: null,
  waStateGeoJson: null,
  waCountiesGeoJson: null,
  scoredCities: [],
  filtered: [],
  selectedCity: null,
  weights: { ...DEFAULT_WEIGHTS },
  viewState: { longitude: -120.8, latitude: 47.1, zoom: 6.5, pitch: 55, bearing: -10 },
  _mouseX: 0,
  _mouseY: 0
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
  const g = Math.round(242 * (1 - t * 0.88));
  const b = Math.round(242 * (1 - t * 0.88));
  return `rgb(${r},${g},${b})`;
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

// ── Map initialization ─────────────────────────────────────
function initMap() {
  document.getElementById('map').addEventListener('pointermove', e => {
    state._mouseX = e.clientX;
    state._mouseY = e.clientY;
  });

  const ambientLight = new deck.AmbientLight({ color: [255, 255, 255], intensity: 0.5 });
  const directionalLight = new deck.DirectionalLight({
    color: [255, 220, 200], intensity: 1.5, direction: [-1, -1, -0.5]
  });
  const lightingEffect = new deck.LightingEffect({ ambientLight, directionalLight });

  state.deckgl = new deck.DeckGL({
    container: 'map',
    initialViewState: state.viewState,
    controller: true,
    parameters: { clearColor: [0, 0, 0, 1] },
    effects: [lightingEffect],
    onViewStateChange: ({ viewState }) => {
      // Clamp zoom: can't zoom out beyond initial WA view
      viewState = { ...viewState, zoom: Math.max(6.5, viewState.zoom) };
      state.viewState = viewState;
      state.deckgl.setProps({ viewState });
    },
    getCursor: ({ isDragging }) => isDragging ? 'grabbing' : 'default',
    layers: []
  });
}

// ── Load WA boundary data (US Atlas TopoJSON via CDN) ──────
async function loadWAData() {
  const [countiesRes, statesRes] = await Promise.all([
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json'),
    fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
  ]);
  const [countiesUs, statesUs] = await Promise.all([countiesRes.json(), statesRes.json()]);

  const allCounties = topojson.feature(countiesUs, countiesUs.objects.counties);
  state.waCountiesGeoJson = {
    type: 'FeatureCollection',
    features: allCounties.features.filter(f => String(f.id).padStart(5,'0').startsWith('53'))
  };

  const allStates = topojson.feature(statesUs, statesUs.objects.states);
  state.waStateGeoJson = {
    type: 'FeatureCollection',
    features: allStates.features.filter(f => String(f.id) === '53')
  };
}

// ── Build and push deck.gl layers ─────────────────────────
function updateLayers() {
  if (!state.deckgl) return;
  const sel = state.selectedCity;
  const layers = [];

  if (state.waStateGeoJson) {
    layers.push(new deck.GeoJsonLayer({
      id: 'wa-state',
      data: state.waStateGeoJson,
      filled: true,
      getFillColor: [8, 28, 48, 255],
      stroked: true,
      getLineColor: [80, 130, 200, 255],
      lineWidthMinPixels: 2
    }));
  }

  if (state.waCountiesGeoJson) {
    layers.push(new deck.GeoJsonLayer({
      id: 'wa-counties',
      data: state.waCountiesGeoJson,
      filled: false,
      stroked: true,
      getLineColor: [50, 85, 130, 160],
      lineWidthMinPixels: 0.8
    }));
  }

  if (state.scoredCities.length) {
    // Glow halos at city bases for topography depth effect
    layers.push(new deck.ScatterplotLayer({
      id: 'city-glow',
      data: state.scoredCities,
      getPosition: d => [d.lng, d.lat],
      getRadius: d => 5000 + (d.opportunityScore / 100) * 10000,
      getFillColor: d => {
        const t = d.opportunityScore / 100;
        return [Math.round(255 - 70 * t), Math.round(242 * (1 - t * 0.88)), Math.round(242 * (1 - t * 0.88)), Math.round(30 + t * 55)];
      },
      radiusMinPixels: 2,
      radiusMaxPixels: 25,
      updateTriggers: {
        getRadius: state.scoredCities.map(c => c.opportunityScore),
        getFillColor: state.scoredCities.map(c => c.opportunityScore)
      }
    }));

    layers.push(new deck.ColumnLayer({
      id: 'city-spikes',
      data: state.scoredCities,
      diskResolution: 12,
      radius: 5500,
      extruded: true,
      getPosition: d => [d.lng, d.lat],
      getElevation: d => 3000 + Math.pow(d.opportunityScore / 100, 1.7) * 350000,
      getFillColor: d => {
        const t = d.opportunityScore / 100;
        const isSelected = d.id === sel;
        return [
          Math.round(255 - 70 * t),
          Math.round(242 * (1 - t * 0.88)),
          Math.round(242 * (1 - t * 0.88)),
          isSelected ? 255 : 210
        ];
      },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 50],
      onHover: ({ object }) => {
        if (object) {
          showTooltip(
            { clientX: state._mouseX, clientY: state._mouseY },
            object.name, object.opportunityScore, object.tier,
            object.county ? object.county.split('/')[0].trim() : ''
          );
        } else {
          hideTooltip();
        }
      },
      onClick: ({ object }) => { if (object) selectCity(object.id); },
      updateTriggers: {
        getElevation: state.scoredCities.map(c => c.opportunityScore),
        getFillColor: [state.scoredCities.map(c => c.opportunityScore).join(), sel]
      }
    }));
  }

  state.deckgl.setProps({ layers });
}

// ── Rotation animation ─────────────────────────────────────
let _rotateRAF = null;
let _rotating  = false;

function toggleRotation() {
  _rotating = !_rotating;
  const btn = document.getElementById('btn-rotate');
  if (_rotating) {
    btn.textContent = '⏹ Stop';
    btn.classList.add('active');
    animateRotation();
  } else {
    btn.textContent = '↻ Rotate';
    btn.classList.remove('active');
    if (_rotateRAF) { cancelAnimationFrame(_rotateRAF); _rotateRAF = null; }
  }
}

function animateRotation() {
  if (!state.deckgl) return;
  state.viewState = { ...state.viewState, bearing: ((state.viewState.bearing || 0) + 0.25) % 360 };
  state.deckgl.setProps({ viewState: state.viewState });
  _rotateRAF = requestAnimationFrame(animateRotation);
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
  state.selectedCity = cityId;
  const city = state.scoredCities.find(c => c.id === cityId);
  if (!city) return;

  state.deckgl.setProps({
    viewState: {
      longitude: city.lng,
      latitude: city.lat,
      zoom: Math.max((state.viewState && state.viewState.zoom) || 6, 8.5),
      pitch: 50,
      bearing: -15,
      transitionDuration: 800,
      transitionInterpolator: new deck.FlyToInterpolator()
    }
  });

  document.querySelectorAll('.city-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === cityId));

  updateLayers();
  openDetailPanel(city);

  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Detail panel ───────────────────────────────────────────
function openDetailPanel(city) {
  document.getElementById('detail-panel').classList.add('open');
  const score  = city.opportunityScore;
  const uiCol  = scoreToUIColor(score);
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
  document.querySelectorAll('.city-item').forEach(el => el.classList.remove('active'));
  updateLayers();
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
      <div class="city-item${active ? ' active' : ''}" data-id="${city.id}" onclick="selectCity(this.dataset.id)">
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
  renderSidebar();
  updateLayers();
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

  // Reset map view
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    state.deckgl.setProps({
      viewState: {
        longitude: -120.8, latitude: 47.1, zoom: 6.5, pitch: 55, bearing: -10,
        transitionDuration: 1000,
        transitionInterpolator: new deck.FlyToInterpolator()
      }
    });
  });

  // Rotation toggle
  document.getElementById('btn-rotate').addEventListener('click', toggleRotation);

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
    await loadWAData();
  } catch (err) {
    console.warn('Map boundary data failed:', err);
  }
  computeAndRender();
  bindEvents();
  initSliders();
  renderSourcesTable();
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 900);
});
