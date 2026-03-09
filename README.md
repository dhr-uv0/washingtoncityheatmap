# WA Market Intelligence — Consulting Expansion Heat Map

Interactive choropleth heat map identifying optimal expansion markets in Washington State
for a consulting firm specializing in business refinement, turnaround, and M&A advisory.

---

## Setup: GitHub → Vercel Auto-Deploy (one-time, ~10 min)

Every push to `main` auto-deploys via GitHub Actions. Do this once:

### Step 1 — Get a Vercel token
1. Go to https://vercel.com/account/tokens
2. Click **Create** → name it `github-actions` → copy the token

### Step 2 — Link the project to Vercel
Open a terminal in this folder and run:
```
vercel login
vercel link
```
- Choose your Vercel account when prompted
- After `vercel link` completes, open `.vercel/project.json` and note:
  - `projectId`
  - `orgId`

### Step 3 — Add secrets to GitHub
Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these three secrets:

| Secret name        | Value                              |
|--------------------|-------------------------------------|
| `VERCEL_TOKEN`     | Token from Step 1                   |
| `VERCEL_PROJECT_ID`| `projectId` from `.vercel/project.json` |
| `VERCEL_ORG_ID`    | `orgId` from `.vercel/project.json`     |

### Step 4 — Push to trigger first deploy
```
git add .
git commit -m "Add Vercel auto-deploy"
git push
```
Watch the **Actions** tab on GitHub — your site deploys automatically on every push to `main`.

---

## Local development

Just open `index.html` in any modern browser. No build step, no server needed.

---

## File Structure

```
├── index.html              Main application
├── css/style.css           All styling
├── js/
│   ├── data.js             50-city dataset (sourced metrics)
│   ├── scoring.js          Weighted opportunity scoring algorithm
│   └── app.js              Leaflet map + county choropleth + UI
├── .github/workflows/
│   └── deploy.yml          GitHub Actions → Vercel auto-deploy
├── vercel.json             Vercel configuration
└── netlify.toml            Netlify fallback config
```

---

## Scoring Algorithm

| Criterion | Default Weight | Rationale |
|-----------|---------------|-----------|
| Consulting Firm Absence | **30%** | Primary filter — avoid saturated markets |
| Target Business Abundance | **25%** | Addressable pipeline (5–249 emp SMBs) |
| City Tier Classification | **20%** | Tier 3 mid-markets = sweet spot |
| Business Maturity (3+ yrs) | **15%** | Exit-ready business owners |
| Owner Demographics (55+) | **10%** | Baby Boomer retirement tailwind |

All weights are adjustable in real time via the ⚖️ panel. Map colors update instantly.

### Map color scale
White → Deep Red = Low → High opportunity. County is colored by its highest-scoring tracked city.

---

## Updating city data

Edit [js/data.js](js/data.js). Data sources and recommended refresh frequencies:

| Metric | Source | Refresh |
|--------|--------|---------|
| Population | Census ACS 1-yr (65k+ cities) | Annually |
| Median HH Income | ACS 5-year Table B19013 | Annually (Dec) |
| Consulting Firm Count | WA SOS Registry scrape | Every 6 months |
| SMB Count (5–249 emp) | County Business Patterns | Annually |
| Business Maturity % | BLS Business Employment Dynamics | Annually |
| Owner Age 55+ % | ACS 5-year Table B01001 | Every 2 years |
