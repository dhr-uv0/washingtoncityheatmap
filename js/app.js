/**
 * Washington State Consulting Opportunity Heat Map
 * Main Application Logic
 */

// ── State ──────────────────────────────────────────────────
const state = {
  map: null,
  markers: {},           // cityId → Leaflet circleMarker
  scoredCities: [],      // full scored + ranked dataset
  filtered: [],          // currently visible subset
  selectedCity: null,    // active city id
  weights: { ...DEFAULT_WEIGHTS },
  tierFilter: 'all',
  searchQuery: '',
  weightsOpen: false,
  sourcesOpen: false
};

// ── Formatters ─────────────────────────────────────────────
const fmt = {
  number: n => n >= 1000000
    ? (n / 1000000).toFixed(1) + 'M'
    : n >= 1000
      ? (n / 1000).toFixed(0) + 'k'
      : String(n),
  currency: n => n >= 1000
    ? '$' + (n / 1000).toFixed(0) + 'k'
    : '$' + n,
  pct: n => n.toFixed(1) + '%',
  score: n => n.toFixed(0)
};

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  computeAndRender();
  bindEvents();

  // Fade out loading overlay
  setTimeout(() => {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('hidden');
  }, 600);
});

// ── Map Initialization ─────────────────────────────────────
function initMap() {
  state.map = L.map('map', {
    center: [47.35, -120.5],
    zoom: 7,
    zoomControl: true,
    preferCanvas: true,
    minZoom: 6,
    maxZoom: 13
  });

  // Dark CartoDB tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
    opacity: 0.5
  }).addTo(state.map);

  // Base dark layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  // WA state outline (approximate bounding box highlight)
  const waBounds = [[45.54, -124.8], [49.05, -116.9]];
  L.rectangle(waBounds, {
    color: 'rgba(59,130,246,0.3)',
    weight: 1.5,
    fill: false,
    dashArray: '6 4'
  }).addTo(state.map);

  state.map.zoomControl.setPosition('bottomright');
}

// ── Compute + Render Pipeline ──────────────────────────────
function computeAndRender() {
  state.scoredCities = scoreAllCities(CITY_DATA, state.weights);
  applyFilters();
  renderSidebar();
  renderMarkers();
  updateHeaderStats();
}

function applyFilters() {
  let cities = state.scoredCities;

  if (state.tierFilter !== 'all') {
    const tier = parseInt(state.tierFilter);
    cities = cities.filter(c => c.tier === tier);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    cities = cities.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.county.toLowerCase().includes(q)
    );
  }

  state.filtered = cities;
}

// ── Header Stats ───────────────────────────────────────────
function updateHeaderStats() {
  const tier3 = state.scoredCities.filter(c => c.tier === 3);
  const topCity = state.scoredCities[0];

  document.getElementById('stat-cities').textContent = state.scoredCities.length;
  document.getElementById('stat-targets').textContent = tier3.length;
  document.getElementById('stat-top-city').textContent = topCity ? topCity.name : '—';
  document.getElementById('stat-top-score').textContent = topCity ? fmt.score(topCity.opportunityScore) : '—';
}

// ── Sidebar Rendering ──────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('city-list');
  const countEl = document.getElementById('list-count');

  countEl.textContent = `${state.filtered.length} cities`;

  list.innerHTML = state.filtered.map((city, idx) => {
    const color = getScoreColor(city.opportunityScore);
    const isActive = state.selectedCity === city.id;
    const isTop = city.rank <= 5;

    return `
      <div class="city-list-item ${isActive ? 'active' : ''}"
           data-city-id="${city.id}"
           onclick="selectCity('${city.id}')">
        <div class="city-rank ${isTop ? 'city-rank-top' : ''}">#${city.rank}</div>
        <div class="city-score-ring" style="border-color:${color}; color:${color}; background: ${hexToRgba(color, 0.08)}">
          ${fmt.score(city.opportunityScore)}
        </div>
        <div class="city-info">
          <div class="city-name">${city.name}</div>
          <div class="city-meta">
            <span class="city-meta-tag">${fmt.number(city.population)} pop</span>
            <span class="city-meta-tag">·</span>
            <span class="city-meta-tag">${fmt.currency(city.medianHouseholdIncome)} MHI</span>
          </div>
        </div>
        <div class="tier-badge" style="background:${getTierColor(city.tier)}">T${city.tier}</div>
      </div>`;
  }).join('');
}

// ── Map Markers ────────────────────────────────────────────
function renderMarkers() {
  // Clear old markers
  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  const maxScore = Math.max(...state.scoredCities.map(c => c.opportunityScore));
  const minRadius = 6;
  const maxRadius = 28;

  state.scoredCities.forEach(city => {
    const color = getScoreColor(city.opportunityScore);
    const isFiltered = state.filtered.some(c => c.id === city.id);
    const radius = minRadius + ((city.opportunityScore / maxScore) * (maxRadius - minRadius));

    const marker = L.circleMarker([city.lat, city.lng], {
      radius: radius,
      fillColor: color,
      color: isFiltered ? color : 'rgba(255,255,255,0.1)',
      weight: isFiltered ? 2 : 1,
      fillOpacity: isFiltered ? 0.78 : 0.18,
      opacity: isFiltered ? 1 : 0.3
    }).addTo(state.map);

    marker.on('click', () => selectCity(city.id));
    marker.on('mouseover', (e) => showMapTooltip(city, e));
    marker.on('mouseout', hideMapTooltip);

    state.markers[city.id] = marker;
  });
}

function updateMarkerStyles() {
  const maxScore = Math.max(...state.scoredCities.map(c => c.opportunityScore));
  const minRadius = 6;
  const maxRadius = 28;

  state.scoredCities.forEach(city => {
    const marker = state.markers[city.id];
    if (!marker) return;

    const color = getScoreColor(city.opportunityScore);
    const isFiltered = state.filtered.some(c => c.id === city.id);
    const isSelected = city.id === state.selectedCity;
    const radius = minRadius + ((city.opportunityScore / maxScore) * (maxRadius - minRadius));

    marker.setStyle({
      radius: isSelected ? radius * 1.25 : radius,
      fillColor: color,
      color: isSelected ? '#fff' : (isFiltered ? color : 'rgba(255,255,255,0.1)'),
      weight: isSelected ? 3 : (isFiltered ? 2 : 1),
      fillOpacity: isFiltered ? 0.78 : 0.18,
      opacity: isFiltered ? 1 : 0.3
    });

    if (isSelected) marker.bringToFront();
  });
}

// ── Map Tooltip ────────────────────────────────────────────
let tooltipEl = null;

function showMapTooltip(city, e) {
  hideMapTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.innerHTML = `
    <strong>${city.name}</strong> — Score: ${fmt.score(city.opportunityScore)} &nbsp;
    <span style="color:${getTierColor(city.tier)}">Tier ${city.tier}</span>
  `;
  document.body.appendChild(tooltipEl);
  moveTooltip(e.originalEvent);

  state.map.on('mousemove', (ev) => {
    if (tooltipEl) moveTooltip(ev.originalEvent);
  });
}

function moveTooltip(e) {
  if (!tooltipEl) return;
  tooltipEl.style.left = (e.clientX + 14) + 'px';
  tooltipEl.style.top  = (e.clientY - 10) + 'px';
}

function hideMapTooltip() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

// ── City Selection ─────────────────────────────────────────
function selectCity(cityId) {
  state.selectedCity = cityId;
  const city = state.scoredCities.find(c => c.id === cityId);
  if (!city) return;

  // Update sidebar highlight
  document.querySelectorAll('.city-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.cityId === cityId);
  });

  // Pan map
  state.map.flyTo([city.lat, city.lng], Math.max(state.map.getZoom(), 9), {
    animate: true, duration: 0.8
  });

  // Update marker styles
  updateMarkerStyles();

  // Open detail panel
  openDetailPanel(city);
}

// ── Detail Panel ───────────────────────────────────────────
function openDetailPanel(city) {
  const panel = document.getElementById('detail-panel');
  panel.classList.add('open');

  const color = getScoreColor(city.opportunityScore);
  const label = getOpportunityLabel(city.opportunityScore);
  const tierLabel = getTierLabel(city.tier);
  const tierColor = getTierColor(city.tier);

  document.getElementById('panel-city-name').textContent = city.name;
  document.getElementById('panel-county').textContent = `${city.county} County`;

  const scoreEl = document.getElementById('panel-score-number');
  scoreEl.textContent = fmt.score(city.opportunityScore);
  scoreEl.style.color = color;

  const labelEl = document.getElementById('panel-score-label');
  labelEl.textContent = label + ' Opportunity';
  labelEl.style.color = color;

  document.getElementById('panel-rank').textContent = `Ranked #${city.rank} of ${state.scoredCities.length} cities`;

  // Tier badge
  const tierEl = document.getElementById('panel-tier');
  tierEl.textContent = tierLabel;
  tierEl.style.background = hexToRgba(tierColor, 0.15);
  tierEl.style.color = tierColor;
  tierEl.style.border = `1px solid ${hexToRgba(tierColor, 0.4)}`;

  // Score breakdown bars
  const breakdown = [
    { key: 'consultingAbsence', label: 'Consulting Firm Absence', weight: state.weights.consultingAbsence },
    { key: 'businessAbundance', label: 'Target Business Abundance', weight: state.weights.businessAbundance },
    { key: 'cityTier',          label: 'City Tier Classification', weight: state.weights.cityTier },
    { key: 'businessMaturity',  label: 'Business Maturity (3+ yr)', weight: state.weights.businessMaturity },
    { key: 'ownerDemographics', label: 'Owner Demographics (55+)', weight: state.weights.ownerDemographics }
  ];

  const breakdownEl = document.getElementById('score-breakdown');
  breakdownEl.innerHTML = breakdown.map(item => {
    const score = city.scores[item.key];
    const barColor = getScoreColor(score);
    return `
      <div class="score-row">
        <div class="score-row-header">
          <span class="score-row-label">${item.label}</span>
          <div class="score-row-right">
            <span class="score-row-value" style="color:${barColor}">${fmt.score(score)}</span>
            <span class="score-row-weight">${Math.round(item.weight * 100)}%</span>
          </div>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width:${score}%; background:${barColor}"></div>
        </div>
      </div>`;
  }).join('');

  // Detail cards
  const smbDensity = ((city.smbCount / city.population) * 1000).toFixed(1);
  const cards = [
    { value: fmt.number(city.population),         label: 'Population',             source: '2020 Census' },
    { value: fmt.currency(city.medianHouseholdIncome), label: 'Median HH Income',  source: 'ACS 2021' },
    { value: city.consultingFirmCount,             label: 'Consulting Firms',       source: 'CBP 2021 est.' },
    { value: fmt.number(city.smbCount),            label: 'SMBs (5-249 emp)',        source: 'CBP 2021 est.' },
    { value: smbDensity + '/1k',                   label: 'SMB Density',            source: 'Derived' },
    { value: city.businessMaturityPct + '%',       label: 'Businesses 3+ Yrs',      source: 'BLS BED est.' },
    { value: city.ownerAge55PlusPct + '%',         label: 'Population 55+',         source: 'ACS 2021' },
    { value: '+' + city.populationGrowthPct + '%', label: 'Pop. Growth 2010–20',    source: '2020 Census' }
  ];

  document.getElementById('detail-grid').innerHTML = cards.map(c => `
    <div class="detail-card">
      <div class="detail-card-value">${c.value}</div>
      <div class="detail-card-label">${c.label}</div>
      <div class="detail-card-source">${c.source}</div>
    </div>`).join('');

  // Notes
  document.getElementById('panel-notes').textContent = city.notes;

  // Estimated badge
  document.getElementById('estimated-badge').classList.toggle('hidden', !city.estimated);
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  state.selectedCity = null;
  document.querySelectorAll('.city-list-item').forEach(el => el.classList.remove('active'));
  updateMarkerStyles();
}

// ── Weights Panel ──────────────────────────────────────────
function toggleWeights() {
  state.weightsOpen = !state.weightsOpen;
  document.getElementById('weights-panel').classList.toggle('open', state.weightsOpen);
  document.getElementById('btn-weights').classList.toggle('active', state.weightsOpen);
}

function initWeightSliders() {
  const keys = Object.keys(DEFAULT_WEIGHTS);
  keys.forEach(key => {
    const slider = document.getElementById(`w-${key}`);
    const display = document.getElementById(`wv-${key}`);
    if (!slider) return;

    slider.value = Math.round(state.weights[key] * 100);
    display.textContent = Math.round(state.weights[key] * 100) + '%';

    slider.addEventListener('input', () => {
      state.weights[key] = parseInt(slider.value) / 100;
      display.textContent = slider.value + '%';
      updateWeightTotal();
    });
  });
  updateWeightTotal();
}

function updateWeightTotal() {
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
  const totalEl = document.getElementById('weight-total');
  const pct = Math.round(total * 100);
  totalEl.textContent = `Total: ${pct}%`;
  const valid = Math.abs(pct - 100) <= 1;
  totalEl.className = 'weight-total ' + (valid ? 'valid' : 'invalid');
  document.getElementById('btn-apply-weights').disabled = !valid;
}

function applyWeights() {
  computeAndRender();
  // Re-open detail panel if city is selected
  if (state.selectedCity) {
    const city = state.scoredCities.find(c => c.id === state.selectedCity);
    if (city) openDetailPanel(city);
  }
}

function resetWeights() {
  state.weights = { ...DEFAULT_WEIGHTS };
  initWeightSliders();
  computeAndRender();
}

// ── Data Sources Modal ─────────────────────────────────────
function openSources() {
  document.getElementById('sources-modal').classList.add('open');
}

function closeSources() {
  document.getElementById('sources-modal').classList.remove('open');
}

function renderSourcesTable() {
  const tbody = document.getElementById('sources-tbody');
  tbody.innerHTML = DATA_METADATA.sources.map(s => `
    <tr>
      <td class="source-metric">${s.metric}</td>
      <td>${s.source}</td>
      <td><span class="update-freq">${s.updateFrequency}</span></td>
    </tr>`).join('');
}

// ── Search & Filter ────────────────────────────────────────
function handleSearch(e) {
  state.searchQuery = e.target.value.trim();
  applyFilters();
  renderSidebar();
  updateMarkerStyles();
}

function handleTierFilter(tier) {
  state.tierFilter = tier;
  document.querySelectorAll('.tier-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.tier === tier));
  applyFilters();
  renderSidebar();
  updateMarkerStyles();
}

// ── Map View Controls ──────────────────────────────────────
function resetMapView() {
  state.map.flyTo([47.35, -120.5], 7, { animate: true, duration: 0.8 });
}

function zoomIn()  { state.map.zoomIn(); }
function zoomOut() { state.map.zoomOut(); }

// ── Mobile Sidebar ─────────────────────────────────────────
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const isOpen = sidebar.classList.toggle('mobile-open');
  btn.innerHTML = isOpen
    ? '<span>✕</span> Close List'
    : '<span>☰</span> City Rankings';
}

// ── Event Binding ──────────────────────────────────────────
function bindEvents() {
  // Search
  document.getElementById('city-search').addEventListener('input', handleSearch);

  // Tier pills
  document.querySelectorAll('.tier-pill').forEach(pill =>
    pill.addEventListener('click', () => handleTierFilter(pill.dataset.tier)));

  // Panel close
  document.getElementById('panel-close').addEventListener('click', closeDetailPanel);

  // Weights
  document.getElementById('btn-weights').addEventListener('click', toggleWeights);
  document.getElementById('btn-apply-weights').addEventListener('click', () => {
    applyWeights();
    toggleWeights();
  });
  document.getElementById('btn-reset-weights').addEventListener('click', resetWeights);

  // Sources modal
  document.getElementById('btn-sources').addEventListener('click', openSources);
  document.getElementById('btn-close-sources').addEventListener('click', closeSources);
  document.getElementById('sources-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSources();
  });

  // Map controls
  document.getElementById('btn-reset-view').addEventListener('click', resetMapView);

  // Mobile
  document.getElementById('sidebar-toggle').addEventListener('click', toggleMobileSidebar);

  // Close weights panel on outside click
  document.addEventListener('click', e => {
    const panel = document.getElementById('weights-panel');
    const btn = document.getElementById('btn-weights');
    if (state.weightsOpen && !panel.contains(e.target) && !btn.contains(e.target)) {
      toggleWeights();
    }
  });

  // Close sidebar on mobile when city selected
  document.getElementById('city-list').addEventListener('click', () => {
    if (window.innerWidth < 768) {
      document.getElementById('sidebar').classList.remove('mobile-open');
      document.getElementById('sidebar-toggle').innerHTML = '<span>☰</span> City Rankings';
    }
  });

  // Init sliders
  initWeightSliders();
  renderSourcesTable();
}

// ── Utility ────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
