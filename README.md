# Square One: maths teaching jobs for ECTs

A website (plus Android and Mac apps) that gathers **maths teaching jobs** from
the main school job boards for an area you choose, highlights the ones that
suit **early career teachers (ECTs)**, focuses on **state schools and sixth
forms**, and puts every school on a **map with its GCSE maths and A level
results**.

![Jobs, map and school profile](docs/screenshot.png)

## Areas

Pick an area with the **Area · Change** button at the top.

- **On the website:** London (all of Greater London), Brighton & Hove, Cardiff,
  Bristol, Birmingham and Manchester (each within 10 miles). These are checked
  twice a day by the GitHub Action. Link to one with `?area=cardiff`.
- **In the Android and Mac apps:** any town, city or postcode in England or
  Wales, within 5, 10, 15 or 25 miles. The apps check the job boards
  themselves, so any place works.

To add a preset area for the website, add it to `PRESETS` in
`scripts/lib/places.mjs`.

## What it does

**Jobs tab**

- Collects maths adverts for the area from
  [Teaching Vacancies (GOV.UK)](https://teaching-vacancies.service.gov.uk)
  (England only), [MyNewTerm](https://mynewterm.com) and
  [Eteach](https://www.eteach.com). [TES](https://www.tes.com/jobs) now blocks
  automated searches, so the site links to a TES search for the area instead.
- Merges the same advert when it appears on several boards and links to each.
- Rates every job for ECTs:
  - **Suitable for ECTs**: a board marks it ECT-suitable, or the advert mentions ECTs or NQTs.
  - **Likely open to ECTs**: a classroom teacher post with no sign it needs experience.
  - **Not aimed at ECTs**: leadership/TLR roles, “minimum 3 years’ experience”, or “not suitable for ECTs”.
  - **Teacher training route**: trainee and salaried training posts.
- Picks out mentoring, induction/ECF, CPD and reduced-timetable mentions.
- Matches each advert to its school using the school registers for England and
  Wales, so it can tell state schools from independent, special and alternative
  provision schools, and show the school’s results on the job card.
- Filters: ECT suitability, school type (state is the default), sixth form or
  A level teaching, role, district, pay area and contract.

**Schools map tab**

- Every open state-funded secondary, all-through and 16–19 school, sixth form
  college and FE college in England (3,685), and every maintained secondary and
  middle school in Wales (204). The area searched is outlined on the map.
- Colour schools by **GCSE maths grade 4+**, **grade 5+**, or **A level average
  grade / UCAS points**. Schools with a maths job open now have a red ring.
- Each English school’s profile shows:
  - GCSE maths 4+ and 5+ (and English and maths 4+), the change on last year,
    and comparisons with its council area, its region and England.
  - A level average grade, **UCAS tariff points per A level and for the best
    three A levels**, the share of A level students taking maths and further
    maths, how many maths entries got A* or A, AAB+ rate and progress band.
  - Sixth form, selective/faith/single-sex status, trust, size, free school meals,
    pay area with the 2026/27 M1 salary, and links to the DfE school profile,
    Ofsted reports and the school website.
- Welsh schools show whether they are Welsh-medium, English-medium or dual
  stream, and link to My Local School and Estyn. Wales does not publish exam
  results school by school, so they have no GCSE or A level figures.

**ECT guide tab**: induction in England and Wales, 2026/27 starting pay for every
English pay area (from the official 2026 pay document), how to read an advert,
interview questions, and how the school figures are worked out.

### How UCAS points are worked out

The DfE publishes an average point score per A level entry on its own scale
(A* = 60, A = 50 … E = 10). UCAS tariff points (A* = 56, A = 48 … E = 16) are a
straight-line transformation of that scale, `tariff = 0.8 × points + 8`, so the
average converts exactly. “For best three” applies the same conversion to the
DfE’s average of each student’s best three A levels.

## Running it

Needs Node.js 20 or later. The website and the data scripts have no
dependencies; `npm install` is only needed to build the Android and Mac apps.

```bash
npm start            # serves the site at http://localhost:8080
```

The repository already contains the data in `public/data/`, so the site works
straight away. To refresh it:

```bash
npm run jobs         # re-check the job boards for every preset area (a few minutes)
npm run jobs -- --area cardiff   # just one area
npm run schools      # re-download the school registers and DfE results (~350 MB)
npm test             # unit tests for the parsers and classification rules
```

When the site is served by `npm start`, the Sources tab also has a
**Check the job boards now** button for the chosen area (limited to once
every 10 minutes per area).

## Android app

The same site is packaged as an Android app with [Capacitor](https://capacitorjs.com).
The app does one thing the website cannot: it **checks the job boards itself,
from the phone**, so it stays current without any server or GitHub Pages
setup.

- It opens instantly with the jobs it last found (or the ones it shipped with).
- It can search any town, city or postcode in England or Wales, not just the
  website's preset areas.
- When the jobs are more than 6 hours old it checks Teaching Vacancies,
  MyNewTerm and Eteach in the background (skipped when offline or in data saver
  mode). **Check now** on the Jobs tab does it on demand. Each check takes
  under a minute and uses a few megabytes of data.
- The map, school profiles and ECT guide work the same as on the website.
  School results are bundled, so they only change with a new version of the app.

### Installing

1. Download `SquareOne.apk` on the phone: from the **android-latest** release on
   GitHub once the workflow below has run on the default branch, or from the
   `SquareOne-apk` artifact of any **Build Android app** run.
2. Open it. Android will ask you to allow installs from your browser or files
   app the first time.

The APK is signed with a debug key. Builds from different machines have
different keys, so to switch from one build to another you may need to
uninstall the app first (your saved filters and cached jobs are cleared).

### Building it yourself

Needs JDK 21 and the Android SDK (platform 36, build tools 36), for example
from Android Studio.

```bash
npm install
npm run android:apk  # -> android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android # or open the project in Android Studio
```

`npm run android:sync` rebuilds `app-web/` (the website plus the job engine
from `scripts/lib` and `scripts/sources`) and copies it into the Android
project. `scripts/make-app-icons.py` redraws the launcher icon and splash
screens.

The **Build Android app** workflow (`.github/workflows/android.yml`) builds the
APK on every push that touches the app, refreshes the bundled jobs first, and
on the default branch republishes it as the `android-latest` release.

## Mac app

The site also runs as a desktop app built with [Electron](https://www.electronjs.org).
Like the Android app it checks the job boards itself: when you open it, when
the jobs are more than 6 hours old, every half hour while it stays open, and
whenever you press **Check now**. Job adverts and school websites open in
your normal browser.

### Installing

1. From the **mac-latest** release on GitHub, download
   `SquareOne-mac-arm64.dmg` for an Apple Silicon Mac (M1 or later) or
   `SquareOne-mac-x64.dmg` for an Intel Mac. It needs macOS 12 or later.
2. Open the .dmg and drag **Square One** into Applications.
3. The app is not notarised by Apple (that needs a paid developer account), so
   the first time you open it macOS will say it cannot check it. Click
   **Done**, then open **System Settings → Privacy & Security**, scroll down
   and click **Open Anyway**. Or run
   `xattr -dr com.apple.quarantine "/Applications/Square One.app"` in Terminal.

### Building it yourself

```bash
npm install
npm run desktop       # run it from source (any platform)
npm run desktop:mac   # build dist-desktop/SquareOne-mac-*.dmg (on a Mac)
```

The **Build Mac app** workflow (`.github/workflows/mac.yml`) builds both .dmg
files on a GitHub macOS runner, launches the app there to check it renders and
can fetch live jobs (`SQUAREONE_SMOKE=1`), and on the default branch
republishes them as the `mac-latest` release.

## Publishing on GitHub Pages

The workflow in `.github/workflows/update-site.yml` checks the job boards twice a
day, rebuilds the school data every Monday, and publishes the site.

1. In the repository go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge this branch into the default branch (or make it the default branch).
3. Run the workflow once from the **Actions** tab (**Update jobs and publish site → Run workflow**).

The site will then be at `https://<your-user>.github.io/<repo>/`.

## How it is built

```
public/                 the website (plain HTML, CSS and JavaScript)
  index.html, styles.css, app.js
  data/areas.json       the preset areas and when each was last checked
  data/jobs/<area>.json built by scripts/scrape-jobs.mjs
  data/schools/         built by scripts/build-schools.mjs, one file per region
  vendor/leaflet/       map library (BSD-2-Clause)
scripts/
  build-schools.mjs     school registers (England and Wales) + DfE results
  scrape-jobs.mjs       runs the job pipeline for each preset area
  sources/              one module per job board
  lib/places.mjs        preset areas, distances, pay areas
  lib/pipeline.mjs      the shared job pipeline (Node and both apps)
  lib/                  CSV/zip/ods readers, grid-to-lat/long, matching, rules
  data/establishments/  every school in each region, for matching adverts
  build-app-web.mjs     assembles app-web/ for the Android app
  make-app-icons.py     draws the app icon and splash screens
server.mjs              local static server with a refresh endpoint
desktop/                Electron main process, preload and Mac icon
android/                Capacitor Android project
capacitor.config.json   app id, name and web folder
test/                   node:test unit tests
```

If a job board is down, the scraper keeps that board’s still-open adverts from
the previous run and marks them on the Sources tab.

## Data and good manners

- School data: [Get Information About Schools](https://get-information-schools.service.gov.uk),
  the Welsh Government's [list of schools](https://www.gov.wales/address-list-schools),
  and DfE school-level results on [Explore Education Statistics](https://explore-education-statistics.service.gov.uk)
  (GCSE 2025/26 provisional, A level 2024/25), © Crown copyright,
  [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
  The three DfE data set IDs are in `scripts/build-schools.mjs`; update them when
  next year's results are published.
- Postcode lookups: [postcodes.io](https://postcodes.io) (open data).
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Job adverts belong to the boards and schools that published them. The scraper
  only reads public search results, waits between requests to each site, runs
  at most twice a day, and always links back to the original advert. Check each
  site’s terms before running it more often or reusing the data elsewhere.
- Progress 8 is not published for 2025 or 2026 (no KS2 baseline for those
  cohorts), so it is not shown.
- Pay figures are the 2026/27 M1 points from the School Teachers' Pay and
  Conditions Document 2026. Academies can set their own pay. Wales has its own
  pay document.
