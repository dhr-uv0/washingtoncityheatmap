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
  viewState: { longitude: -120.5, latitude: 47.0, zoom: 5.9, pitch: 55, bearing: -10 },
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
// Multi-stop gradient: cool white → yellow → amber → orange-red → deep crimson
const COLOR_STOPS = [
  [0.00, [255, 255, 255]],  // pure white       (lowest in dataset)
  [0.30, [255, 240,  30]],  // vivid yellow
  [0.60, [255, 110,   0]],  // vivid orange
  [0.82, [220,  10,   0]],  // bright red
  [1.00, [120,   0,   0]]   // deep crimson     (highest in dataset)
];

function lerpColor(t, stops) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped <= stops[i + 1][0]) {
      const f = (clamped - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return stops[i][1].map((v, j) => Math.round(v + (stops[i + 1][1][j] - v) * f));
    }
  }
  return stops[stops.length - 1][1];
}

// Sidebar/badge uses absolute 0-100 score
function scoreToMapColor(score) {
  const [r, g, b] = lerpColor(score / 100, COLOR_STOPS);
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
    // Lock all mouse/touch input — only sliders control the view
    controller: {
      dragPan: false, scrollZoom: false, doubleClickZoom: false,
      touchZoom: false, dragRotate: false, keyboard: false
    },
    parameters: { clearColor: [0, 0, 0, 1] },
    effects: [lightingEffect],
    onViewStateChange: ({ viewState }) => {
      // Lock center on WA; clamp zoom
      viewState = {
        ...viewState,
        longitude: -120.5,
        latitude: 47.0,
        zoom: Math.max(5.9, Math.min(13, viewState.zoom))
      };
      syncRotSlider(viewState.bearing);
      syncZoomSlider(viewState.zoom);
      state.viewState = viewState;
      state.deckgl.setProps({ viewState });
    },
    getCursor: () => 'default',
    layers: []
  });
}

// ── Slider sync helpers ────────────────────────────────────
function syncRotSlider(bearing) {
  const s = document.getElementById('rotation-slider');
  const v = document.getElementById('rotation-val');
  if (!s) return;
  const b = Math.round(((bearing % 360) + 360) % 360);
  const mapped = b > 180 ? b - 360 : b;
  s.value = mapped;
  if (v) v.textContent = mapped + '°';
  setSliderFill(s);
}

function syncZoomSlider(zoom) {
  const s = document.getElementById('zoom-slider');
  if (!s) return;
  s.value = Math.round(zoom * 10);
  setZoomSliderFill(s);
}

function setZoomSliderFill(slider) {
  const pct = ((parseInt(slider.value) - parseInt(slider.min)) /
               (parseInt(slider.max) - parseInt(slider.min))) * 100;
  slider.style.background = `linear-gradient(to right,var(--blue) ${pct}%,#374151 ${pct}%)`;
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

  // Normalize scores to dataset range so full color+height spectrum always used
  const scores   = state.scoredCities.map(c => c.opportunityScore);
  const minScore = scores.length ? Math.min(...scores) : 0;
  const maxScore = scores.length ? Math.max(...scores) : 100;
  const scoreRange = maxScore - minScore || 1;
  const norm = s => (s - minScore) / scoreRange;

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
      getRadius: d => 4000 + norm(d.opportunityScore) * 12000,
      getFillColor: d => {
        const n = norm(d.opportunityScore);
        const [r, g, b] = lerpColor(n, COLOR_STOPS);
        return [r, g, b, Math.round(20 + n * 65)];
      },
      radiusMinPixels: 2,
      radiusMaxPixels: 28,
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
      getElevation: d => 2000 + Math.pow(norm(d.opportunityScore), 1.5) * 380000,
      getFillColor: d => {
        const n = norm(d.opportunityScore);
        const isSelected = d.id === sel;
        const [r, g, b] = lerpColor(n, COLOR_STOPS);
        return [r, g, b, isSelected ? 255 : 225];
      },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 60],
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
    btn.setAttribute('aria-pressed', 'true');
    btn.classList.add('active');
    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      _rotating = false;
      btn.textContent = '▶ Auto-Rotate';
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('active');
      return;
    }
    animateRotation();
  } else {
    btn.textContent = '▶ Auto-Rotate';
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('active');
    if (_rotateRAF) { cancelAnimationFrame(_rotateRAF); _rotateRAF = null; }
  }
}

function animateRotation() {
  if (!state.deckgl) return;
  const newBearing = ((state.viewState.bearing || 0) + 0.25) % 360;
  state.viewState = { ...state.viewState, bearing: newBearing };
  state.deckgl.setProps({ viewState: state.viewState });
  // Sync slider position
  const rotSlider = document.getElementById('rotation-slider');
  const rotVal    = document.getElementById('rotation-val');
  if (rotSlider) {
    const mapped = newBearing > 180 ? newBearing - 360 : newBearing;
    rotSlider.value = mapped;
    if (rotVal) rotVal.textContent = Math.round(mapped) + '°';
    setSliderFill(rotSlider);
  }
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

  // Map stays centered on WA — no fly-to
  document.querySelectorAll('.city-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === cityId));

  updateLayers();
  openDetailPanel(city);

  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
}

// ── Expansion insights generator ───────────────────────────
function generateInsights(city, scoredCities) {
  const items = [];
  const density = ((city.smbCount / city.population) * 1000).toFixed(1);
  const waMedian = 78687;
  const maEstimate = Math.round(city.consultingFirmCount * 0.20) || 0;
  const s = n => n === 1 ? '' : 's';

  // ── Consulting competition (uses SCORE, not raw count) ──────────────────
  const absScore = city.scores.consultingAbsence;
  if (city.consultingFirmCount === 0) {
    items.push({ icon: '🏆', tag: 'Zero Competition', text: `No consulting firms of any type identified in ${city.name}. For exit and succession advisory this market is completely uncontested — maximum first-mover advantage with no incumbent relationships to overcome.` });
  } else if (absScore >= 85) {
    items.push({ icon: '✅', tag: 'First-Mover Window', text: `${city.consultingFirmCount} firm${s(city.consultingFirmCount)} across all consulting categories (NAICS 5416) — approximately ${maEstimate || 1} focused on M&A or exit advisory. This market is functionally uncontested for succession mandates; early relationships become long-term referral anchors before any competitor identifies the opportunity.` });
  } else if (absScore >= 65) {
    items.push({ icon: '📋', tag: 'Low Advisory Competition', text: `${city.consultingFirmCount} consulting firm${s(city.consultingFirmCount)} total — ~${maEstimate} likely focused on exit or M&A advisory specifically. The competitive field is thin; the majority serve IT, HR, or operational niches. Entry now establishes positioning before growth attracts specialized competitors.` });
  } else if (absScore >= 45) {
    items.push({ icon: '📊', tag: 'Differentiation Required', text: `${city.consultingFirmCount} consulting firm${s(city.consultingFirmCount)} in market (~${maEstimate} M&A-relevant). Advisory competition exists but is not dominant. A focused exit-and-succession positioning creates a defensible specialty niche — lead with referral channel development over broad marketing.` });
  } else {
    items.push({ icon: '⚠️', tag: 'Competitive Market', text: `${city.consultingFirmCount} consulting firm${s(city.consultingFirmCount)} represent meaningful saturation for this market size (~${maEstimate} M&A-relevant). Entry requires a highly differentiated model, a sub-niche specialization, or an anchor referral relationship providing protected deal flow.` });
  }

  // ── SMB pipeline (uses score) ──────────────────────────────────────────
  const abScore = city.scores.businessAbundance;
  if (abScore >= 70) {
    items.push({ icon: '🏬', tag: 'High-Density Pipeline', text: `${fmt.num(city.smbCount)} target-profile SMBs at ${density}/1k residents — unusually business-dense. A solo practitioner can maintain 8–12 active advisory relationships while the pool is large enough that referral attrition doesn't constrain throughput.` });
  } else if (abScore >= 45) {
    items.push({ icon: '📊', tag: 'Sustainable Practice Pipeline', text: `${fmt.num(city.smbCount)} SMBs across target sectors — sufficient for a solo exit advisory practice at steady state. County-wide territory coverage recommended to supplement the city footprint; expect a 24–36 month relationship-building runway to target deal cadence.` });
  } else if (abScore >= 25) {
    items.push({ icon: '💡', tag: 'Thin but Viable', text: `${fmt.num(city.smbCount)} target SMBs makes ${city.name} a secondary rather than standalone practice hub. Most viable as an anchor within a multi-city territory — bundling with 1–2 adjacent markets creates a combined pipeline sufficient for consistent engagement.` });
  } else {
    items.push({ icon: '🔍', tag: 'Insufficient Pipeline — Bundle Only', text: `${fmt.num(city.smbCount)} SMBs cannot generate consistent advisory mandates as a standalone market. Treat as an ancillary market within a broader sub-regional territory centered on a higher-density primary city.` });
  }

  // ── Growth trajectory ──────────────────────────────────────────────────
  if (city.populationGrowthPct >= 10) {
    items.push({ icon: '📈', tag: 'High Growth Market', text: `+${city.populationGrowthPct}% population growth (2020–2023) signals rapid business formation. New SMBs create a future succession pipeline, though current businesses are still early-stage. Enter now to build relationships before the ownership cohort matures.` });
  } else if (city.populationGrowthPct >= 3) {
    items.push({ icon: '📊', tag: 'Steady Growth', text: `+${city.populationGrowthPct}% growth (2020–2023) reflects healthy economic expansion. A mix of established businesses approaching exit timelines and newer formations building the 5-year pipeline.` });
  } else if (city.populationGrowthPct >= 0) {
    items.push({ icon: '➡️', tag: 'Stable Market', text: `Flat growth (${city.populationGrowthPct}%, 2020–2023) — an established community whose businesses have aged organically into exit-readiness. Owners are making succession decisions now, not in five years.` });
  } else {
    items.push({ icon: '📉', tag: 'Population Declining', text: `${city.populationGrowthPct}% decline (2020–2023). Exits in this market may carry compressed valuations and urgency-driven timelines. Restructuring and ESOP advisory can be a strong value proposition alongside traditional sale mandates.` });
  }

  // ── Succession urgency (uses score) ────────────────────────────────────
  const demoScore = city.scores.ownerDemographics;
  if (demoScore >= 80) {
    items.push({ icon: '⏳', tag: 'Peak Succession Window', text: `${city.ownerAge55PlusPct}% of population is 55+ — top tier for WA succession urgency. Baby Boomer business owners here are past the planning phase and into the decision phase. This is not a market to enter in two years; it is a market to enter this cycle.` });
  } else if (demoScore >= 55) {
    items.push({ icon: '👴', tag: 'Active Succession Wave', text: `${city.ownerAge55PlusPct}% age 55+ creates a meaningful near-term succession pipeline. The leading edge of this cohort is actively engaged in exit planning now; the trailing edge provides a 5–8 year deal-flow horizon.` });
  } else if (demoScore >= 35) {
    items.push({ icon: '🌱', tag: 'Succession Pipeline Building', text: `${city.ownerAge55PlusPct}% age 55+ is at or modestly above the WA average — a developing rather than urgent succession pipeline. Worth entering for strategic positioning with a 3–5 year relationship-cultivation runway.` });
  }

  // ── Income / fee tolerance (4 tiers) ───────────────────────────────────
  const inc = city.medianHouseholdIncome;
  if (inc > waMedian * 1.3) {
    items.push({ icon: '💰', tag: 'Premium Fee Market', text: `${fmt.usd(inc)} median HH income — ${Math.round((inc/waMedian - 1)*100)}% above WA average. Owners have higher asset bases, more sophisticated planning horizons, and demonstrated ability to engage advisory at market rates. Full retainer plus success-fee structures are appropriate.` });
  } else if (inc >= waMedian) {
    items.push({ icon: '💵', tag: 'Market-Rate Fees', text: `${fmt.usd(inc)} median HH income near the WA average supports standard advisory fee structures. Success-fee-weighted arrangements will close faster than pure retainer models with this income band.` });
  } else if (inc >= waMedian * 0.8) {
    items.push({ icon: '💡', tag: 'Value-Sensitive Market', text: `${fmt.usd(inc)} median income is modestly below WA average. Lead with value demonstration — a complimentary business valuation assessment or educational workshop — to reduce friction in engagement conversion.` });
  } else {
    items.push({ icon: '🔧', tag: 'Value-Conscious Market', text: `${fmt.usd(inc)} median income is meaningfully below WA average. Contingency-weighted structures and lower retainer thresholds are recommended. Compensate with higher transaction cadence and deep referral leverage.` });
  }

  // ── Regional cluster ───────────────────────────────────────────────────
  const nearby = scoredCities
    .filter(c => c.id !== city.id && c.rank <= 25 &&
      Math.sqrt(Math.pow(c.lat - city.lat, 2) + Math.pow((c.lng - city.lng) * 0.7, 2)) < 1.2)
    .slice(0, 3);
  if (nearby.length > 0) {
    items.push({ icon: '🗺️', tag: 'Regional Cluster', text: `Near top-ranked markets: ${nearby.map(c => `${c.name} (#${c.rank})`).join(', ')}. A bundled sub-regional territory dramatically increases combined SMB pipeline and justifies a dedicated practice investment.` });
  }

  // ── Business maturity (uses score) ────────────────────────────────────
  const matScore = city.scores.businessMaturity;
  if (matScore >= 65) {
    items.push({ icon: '🏗️', tag: 'Exit-Ready Business Base', text: `${city.businessMaturityPct}% of businesses have passed the 3-year survival threshold — above the national benchmark. This population of proven, established businesses includes owners who have navigated startup risk and now face genuine succession decisions.` });
  } else if (matScore >= 40) {
    items.push({ icon: '🏗️', tag: 'Established Business Community', text: `${city.businessMaturityPct}% business maturity aligns with WA state norms — a healthy distribution for advisory practice development, with the mature cohort generating near-term exit mandates and newer businesses building the 5-year pipeline.` });
  }

  return items;
}

// ── Detail panel ───────────────────────────────────────────
function openDetailPanel(city) {
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('dp-empty').hidden = true;
  document.getElementById('dp-hero').hidden = false;
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

  const labelEl  = document.getElementById('p-label');
  const actionEl = document.getElementById('p-action');
  const labelSuffix = { 'Priority Target': 'Enter This Cycle', 'Strong Candidate': 'Plan Entry Now', 'Viable Secondary': 'Bundle With Primary', 'Monitor': 'Revisit in 2 Yrs', 'Pass': 'Insufficient Pipeline' };
  const lbl = getOpportunityLabel(score);
  labelEl.textContent  = lbl;
  labelEl.style.color  = uiCol;
  actionEl.textContent = labelSuffix[lbl] || '';
  actionEl.style.color = uiCol;

  const tierEl = document.getElementById('p-tier');
  tierEl.textContent = getTierLabel(city.tier);
  Object.assign(tierEl.style, {
    background: hexToRgba(tCol, 0.12),
    color: tCol,
    border: `1px solid ${hexToRgba(tCol, 0.35)}`
  });

  document.getElementById('p-estimated').classList.toggle('hidden', !city.estimated);

  // Market Brief (rich strategic notes)
  const notesCard = document.getElementById('p-notes-card');
  const notesTitle = document.getElementById('p-notes-title');
  if (city.notes) {
    notesCard.innerHTML = city.notes.split('\n').map(line =>
      line.trim() ? `<p class="notes-line">${line.trim()}</p>` : ''
    ).join('');
    notesCard.style.display = '';
    notesTitle.style.display = '';
  } else {
    notesCard.style.display = 'none';
    notesTitle.style.display = 'none';
  }

  // Expansion insights
  const insights = generateInsights(city, state.scoredCities);
  document.getElementById('p-insights').innerHTML = insights.map(i => `
    <div class="insight-item">
      <span class="insight-icon">${i.icon}</span>
      <div class="insight-body">
        <div class="insight-tag">${i.tag}</div>
        <div class="insight-text">${i.text}</div>
      </div>
    </div>`).join('');

  // Score breakdown bars
  const breakdown = [
    { key: 'consultingAbsence', label: 'Low Competition',      weight: state.weights.consultingAbsence },
    { key: 'businessAbundance', label: 'SMB Density',          weight: state.weights.businessAbundance },
    { key: 'cityTier',          label: 'City Size & Profile',  weight: state.weights.cityTier },
    { key: 'businessMaturity',  label: 'Established Biz',      weight: state.weights.businessMaturity },
    { key: 'ownerDemographics', label: 'Succession Urgency',   weight: state.weights.ownerDemographics }
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
    { v: fmt.num(city.population),                  l: 'Population',         s: 'ACS 2023'     },
    { v: fmt.usd(city.medianHouseholdIncome),        l: 'Median HH Income',   s: 'ACS 2023'     },
    { v: city.consultingFirmCount + ' (~' + (Math.round(city.consultingFirmCount * 0.20) || 0) + ' M&A)', l: 'Consulting Firms', s: 'CBP 2022' },
    { v: fmt.num(city.smbCount),                     l: 'SMBs (5–249 emp)',   s: 'CBP 2022'     },
    { v: smbDensity + '/1k',                         l: 'SMB Density',        s: 'Derived'      },
    { v: city.businessMaturityPct + '%',             l: 'Businesses 3+ Yrs',  s: 'BLS est.'     },
    { v: city.ownerAge55PlusPct + '%',               l: 'Population 55+',     s: 'ACS 2023'     },
    { v: city.populationGrowthPct + '%',              l: 'Pop. Growth 20–23',  s: 'ACS vs Census' }
  ].map(m => `
    <div class="metric-card">
      <div class="metric-value">${m.v}</div>
      <div class="metric-label">${m.l}</div>
      <div class="metric-source">${m.s}</div>
    </div>`).join('');
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('dp-empty').hidden = false;
  document.getElementById('dp-hero').hidden = true;
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
      <div class="city-item${active ? ' active' : ''}" data-id="${city.id}" role="listitem" tabindex="0" onclick="selectCity(this.dataset.id)">
        <div class="city-rank${city.rank <= 5 ? ' top' : ''}">${city.rank}</div>
        <div class="city-swatch" style="background:${mapColor}" aria-hidden="true"></div>
        <div class="city-info">
          <div class="city-name">${city.name}</div>
          <div class="city-sub">${fmt.num(city.population)} · ${fmt.usd(city.medianHouseholdIncome)}</div>
        </div>
        <div class="city-badge" style="color:${uiColor};border-color:${uiColor}" aria-label="Score: ${score.toFixed(0)}">${score.toFixed(0)}</div>
        <div class="city-tier-dot" style="background:${tColor}" title="${getTierLabel(city.tier)}" aria-hidden="true"></div>
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

// ── Weight rebalancing — always keeps total exactly 100% ───
function rebalanceWeights(changedKey) {
  const slider  = document.getElementById(`w-${changedKey}`);
  const changedVal = Math.min(parseInt(slider.max), Math.max(parseInt(slider.min), parseInt(slider.value)));
  slider.value = changedVal;
  state.weights[changedKey] = changedVal / 100;
  document.getElementById(`wv-${changedKey}`).textContent = changedVal + '%';
  setSliderFill(slider);

  const target = 100 - changedVal;
  const otherKeys = Object.keys(DEFAULT_WEIGHTS).filter(k => k !== changedKey);
  const otherVals = otherKeys.map(k => parseInt(document.getElementById(`w-${k}`).value));
  const otherSum  = otherVals.reduce((a, b) => a + b, 0);

  let assigned = 0;
  otherKeys.forEach((k, i) => {
    const s = document.getElementById(`w-${k}`);
    const disp = document.getElementById(`wv-${k}`);
    let v;
    if (i === otherKeys.length - 1) {
      v = target - assigned;  // last key absorbs rounding remainder
    } else if (otherSum > 0) {
      v = Math.round(otherVals[i] / otherSum * target);
    } else {
      v = Math.round(target / otherKeys.length);
    }
    v = Math.max(parseInt(s.min), Math.min(parseInt(s.max), v));
    s.value = v;
    state.weights[k] = v / 100;
    disp.textContent = v + '%';
    setSliderFill(s);
    assigned += v;
  });

  // If clamping caused the total to drift from 100, nudge the first unclamped slider
  const drift = 100 - (changedVal + assigned);
  if (drift !== 0) {
    for (const k of otherKeys) {
      const s = document.getElementById(`w-${k}`);
      const cur = parseInt(s.value);
      const nudged = cur + drift;
      if (nudged >= parseInt(s.min) && nudged <= parseInt(s.max)) {
        s.value = nudged;
        state.weights[k] = nudged / 100;
        document.getElementById(`wv-${k}`).textContent = nudged + '%';
        setSliderFill(s);
        break;
      }
    }
  }

  checkWeightTotal();
  // Show "changes pending" indicator
  const pending = document.getElementById('wp-pending');
  if (pending) pending.classList.remove('hidden');
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
    slider.addEventListener('input', () => rebalanceWeights(key));
  });

  document.querySelectorAll('.w-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key    = btn.dataset.key;
      const s      = document.getElementById(`w-${key}`);
      const newVal = Math.min(parseInt(s.max), Math.max(parseInt(s.min), parseInt(s.value) + parseInt(btn.dataset.delta)));
      s.value = newVal;
      rebalanceWeights(key);
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
  const valid = pct === 100;
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
  // City list — event delegation (more reliable than inline onclick with defer/CSP)
  const cityList = document.getElementById('city-list');
  cityList.addEventListener('click', e => {
    const item = e.target.closest('.city-item');
    if (item) selectCity(item.dataset.id);
  });
  cityList.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.city-item');
      if (item) { e.preventDefault(); selectCity(item.dataset.id); }
    }
  });

  document.getElementById('city-search').addEventListener('input', renderSidebar);

  document.querySelectorAll('.tier-pill').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('.tier-pill').forEach(x => {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      p.classList.add('active');
      p.setAttribute('aria-pressed', 'true');
      renderSidebar();
    }));

  document.getElementById('panel-close').addEventListener('click', closeDetailPanel);

  // Weights toggle
  const wBtn   = document.getElementById('btn-weights');
  const wPanel = document.getElementById('weights-panel');
  wBtn.addEventListener('click', () => {
    const isOpen = wPanel.classList.toggle('open');
    wBtn.classList.toggle('active');
    wBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
  document.addEventListener('click', e => {
    if (wPanel.classList.contains('open') && !wPanel.contains(e.target) && !wBtn.contains(e.target)) {
      wPanel.classList.remove('open');
      wBtn.classList.remove('active');
      wBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('btn-apply-weights').addEventListener('click', () => {
    computeAndRender();
    wPanel.classList.remove('open');
    wBtn.classList.remove('active');
    wBtn.setAttribute('aria-expanded', 'false');
    const pending = document.getElementById('wp-pending');
    if (pending) pending.classList.add('hidden');
  });
  document.getElementById('btn-reset-weights').addEventListener('click', () => {
    resetWeights();
    computeAndRender();
    const pending = document.getElementById('wp-pending');
    if (pending) pending.classList.add('hidden');
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
        longitude: -120.5, latitude: 47.0, zoom: 5.9, pitch: 55, bearing: -10,
        transitionDuration: 1000,
        transitionInterpolator: new deck.FlyToInterpolator()
      }
    });
  });

  // Bearing slider
  const rotSlider = document.getElementById('rotation-slider');
  if (rotSlider) {
    rotSlider.addEventListener('input', () => {
      const bearing = parseInt(rotSlider.value);
      document.getElementById('rotation-val').textContent = bearing + '°';
      setSliderFill(rotSlider);
      state.viewState = { ...state.viewState, bearing };
      state.deckgl.setProps({ viewState: state.viewState });
    });
    setSliderFill(rotSlider);
  }

  // Bearing +/- step buttons
  function stepBearing(delta) {
    const b = Math.round(((state.viewState.bearing || 0) + delta + 180 + 360) % 360) - 180;
    state.viewState = { ...state.viewState, bearing: b };
    state.deckgl.setProps({ viewState: state.viewState });
    syncRotSlider(b);
  }
  document.getElementById('btn-bear-minus').addEventListener('click', () => stepBearing(-1));
  document.getElementById('btn-bear-plus').addEventListener('click',  () => stepBearing(1));

  // Zoom slider
  const zoomSlider = document.getElementById('zoom-slider');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', () => {
      const zoom = parseInt(zoomSlider.value) / 10;
      setZoomSliderFill(zoomSlider);
      state.viewState = { ...state.viewState, zoom };
      state.deckgl.setProps({ viewState: state.viewState });
    });
    setZoomSliderFill(zoomSlider);
  }

  // Zoom +/- buttons
  function stepZoom(delta) {
    const zoom = Math.max(5.9, Math.min(13, (state.viewState.zoom || 5.9) + delta));
    state.viewState = { ...state.viewState, zoom };
    state.deckgl.setProps({ viewState: state.viewState });
    syncZoomSlider(zoom);
  }
  document.getElementById('btn-zoom-in').addEventListener('click',  () => stepZoom(0.1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => stepZoom(-0.1));

  // Spin toggle
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
  try {
    initMap();
  } catch (err) {
    console.error('Map initialization failed:', err);
    const errOverlay = document.getElementById('error-overlay');
    if (errOverlay) errOverlay.hidden = false;
  }
  try {
    await loadWAData();
  } catch (err) {
    console.warn('Map boundary data failed:', err);
  }
  bindEvents();
  initSliders();
  renderSourcesTable();
  try {
    computeAndRender();
  } catch (err) {
    console.error('App initialization failed:', err);
    const errOverlay = document.getElementById('error-overlay');
    if (errOverlay) errOverlay.hidden = false;
  }
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 900);
});
