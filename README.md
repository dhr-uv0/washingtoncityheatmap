# WA Market Intelligence — Consulting Expansion Heat Map

Interactive heat map identifying optimal expansion markets in Washington State
for a consulting firm specializing in business refinement, turnaround, and M&A advisory.

---

## Live Preview

Open `index.html` directly in any modern browser — no build step required.

---

## Deploy to Netlify (recommended — free tier)

### Option A: Drag & Drop (fastest)

1. Go to [app.netlify.com](https://app.netlify.com) and log in
2. Click **"Add new site" → "Deploy manually"**
3. Drag the entire `washingtonHeatMapForChrisKeody/` folder into the upload zone
4. Your site is live in ~30 seconds at a `*.netlify.app` URL
5. Optionally connect a custom domain under **Site settings → Domain management**

### Option B: Git-connected deploy (recommended for ongoing updates)

```bash
# 1. Initialize git repo in this folder
git init
git add .
git commit -m "Initial deployment"

# 2. Push to GitHub
gh repo create wa-consulting-heatmap --public
git remote add origin https://github.com/YOUR_USERNAME/wa-consulting-heatmap.git
git push -u origin main

# 3. In Netlify UI: "Add new site" → "Import from Git" → select your repo
# Netlify auto-detects netlify.toml, sets publish directory to "."
# Every push to main auto-redeploys
```

---

## Deploy to Vercel (alternative)

```bash
npm install -g vercel
vercel --prod
# Select the project folder when prompted
# Static site detected automatically
```

---

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "Initial"
# Push to GitHub repo, then:
# Settings → Pages → Source: "Deploy from branch" → main → / (root)
```

---

## File Structure

```
washingtonHeatMapForChrisKeody/
├── index.html          # Main application (entry point)
├── css/
│   └── style.css       # All styling (dark theme, responsive)
├── js/
│   ├── data.js         # 50-city dataset with sourced metrics
│   ├── scoring.js      # Weighted opportunity scoring algorithm
│   └── app.js          # Leaflet map, UI logic, interactions
├── netlify.toml        # Netlify deployment configuration
└── README.md
```

---

## Technology Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Map | Leaflet.js 1.9.4 (CDN) | Lightweight, open-source, excellent WA tile support |
| Tiles | CartoDB Dark Matter (free) | Professional dark aesthetic, no API key required |
| Fonts | Inter via Google Fonts | Clean, modern, optimized for data dashboards |
| Hosting | Netlify / Vercel / GitHub Pages | Zero-cost static hosting, global CDN |
| Backend | None — fully static | No server needed; all scoring runs client-side |

---

## Scoring Algorithm

Five criteria combine into a single **Opportunity Score (0–100)**:

| Criterion | Default Weight | Data Source |
|-----------|---------------|-------------|
| Consulting Firm Absence | **30%** | NAICS 54161, CBP 2021 + WA SOS Registry |
| Target Business Abundance | **25%** | County Business Patterns 2021 (5–249 emp) |
| City Tier Classification | **20%** | Census 2020 + ACS 2021 (pop/income/growth composite) |
| Business Maturity (3+ yrs) | **15%** | BLS Business Employment Dynamics |
| Owner Demographics (55+) | **10%** | ACS 2021, Table B01001 |

Weights are **user-adjustable in real time** via the ⚖️ Weights panel in the UI.

### Tier System (WA-scale adaptation)

| Tier | Pop. Range | Opportunity | Strategy |
|------|-----------|-------------|----------|
| 1 | 150k+ (major hub) | Avoid | Saturated — Seattle, Bellevue |
| 2 | 50k–150k (secondary metro) | Low | High competition |
| **3** | **30k–100k (mid-market)** | **OPTIMAL** | **Sweet spot — target zone** |
| 4 | 13k–35k (smaller) | Moderate | Viable, smaller pipeline |
| 5 | <13k (micro) | Avoid | Insufficient SMB base |

---

## Data Update Schedule

| Metric | Source | Refresh Frequency |
|--------|--------|------------------|
| Population | Census ACS 1-yr (65k+ cities) | Annually |
| Median HH Income | ACS 5-year estimates | Annually (Dec) |
| Consulting Firm Count | WA SOS Business Registry scrape | Every 6 months |
| SMB Count (5–249 emp) | County Business Patterns | Annually (~18-mo lag) |
| Business Maturity | BLS Business Employment Dynamics | Annually |
| Owner Age 55+ | ACS 5-year estimates | Every 2 years |

To refresh data: update `js/data.js` with new values. Scores recalculate automatically on page load.

---

## Adding or Updating City Data

Edit `js/data.js`. Each city object follows this schema:

```javascript
{
  id: "city-slug",                // unique kebab-case ID
  name: "City Name",
  county: "County Name",
  lat: 47.1234,                   // decimal degrees
  lng: -122.5678,
  population: 55000,              // 2020 Census or ACS 1-yr
  medianHouseholdIncome: 72000,   // ACS 2021 estimate, $
  populationGrowthPct: 15.2,      // % growth 2010–2020
  consultingFirmCount: 19,        // NAICS 54161 active establishments
  smbCount: 2200,                 // 5–249 employee businesses
  businessMaturityPct: 73,        // % businesses 3+ years old
  ownerAge55PlusPct: 28,          // % population aged 55+
  tier: 3,                        // 1–5, see tier system above
  estimated: true,                // flag if any values are estimated
  dataYear: 2021,
  notes: "Brief strategic context for this market."
}
```

---

## Browser Support

Chrome 90+, Firefox 90+, Safari 14+, Edge 90+. Mobile responsive on iOS Safari and Android Chrome.
