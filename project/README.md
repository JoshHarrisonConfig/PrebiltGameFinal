# PreBilt Barcode Scanning Game

Participants scan 10 unique barcodes on a handheld (Zebra TC501) and are ranked by how fast
they do it. An administrator signs in on a laptop and shows the live leaderboard on a big
screen.

## How the shared leaderboard works

Originally every piece of state (leaderboard, participants, settings, admin login) lived in
the browser's `localStorage`, so each device only ever saw its own data. Now there is one
shared copy on the server and every device talks to it:

```
 TC501 browser                        Netlify                         Admin laptop browser
┌─────────────────┐   PUT /api/plays/:id   ┌──────────────────────┐   GET /api/leaderboard  ┌──────────────────┐
│ game screen     │ ─────────────────────► │ Function  /api/*     │ ◄────────────────────── │ leaderboard      │
│  └ outbox       │  (retried until acked) │  server/api.mjs      │   every 2 s             │  screen (live)   │
└─────────────────┘                        │        │             │                         └──────────────────┘
                                           │        ▼             │   POST /api/admin/login
                                           │  Netlify Blobs       │ ◄── Bearer token for export / settings / clear
                                           │  (one JSON document) │
                                           └──────────────────────┘
```

- **Server state** lives in one JSON document in [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
  (strong consistency). Every change is a compare-and-swap on the document's ETag, so two
  devices writing at the same moment can never overwrite each other.
- **Real time = polling.** Netlify has no WebSockets. Each leaderboard screen asks for the
  board every 2 seconds (slower when its tab is in the background, with back-off when
  the network is down). A finished game appears on the big screen within a couple of seconds.
- **Nothing is lost on bad Wi-Fi.** The game screen never waits on the network. Every update
  goes through an *outbox* that stores it on the device and retries until the server confirms
  it, even across a page reload. Updates are idempotent, so a retry is always safe.
- **"Now playing".** While someone plays, their device reports in after every scan and every
  10 s. The leaderboard shows them with a progress bar and running clock. A device that goes
  silent for 45 s disappears from that list (and is recorded as abandoned after 10 minutes).
- **Admin is enforced by the server.** The admin password is checked server-side and the
  browser keeps only a signed 12-hour token. Participant emails, export, settings and
  *Clear Leaderboard* all require it. The public leaderboard contains names and times only.

## Run it locally

Requires Node 22.12 or newer.

```bash
cd project
npm install
cp .env.example .env.local      # then edit ADMIN_PASSWORD (git-ignored)
npm run dev
```

`npm run dev` serves the app **and** the same `/api/*` the production function provides,
storing data in `.data/dev-store.json`. Open `http://localhost:5173/#leaderboard` in one
browser and the game in another: they share state exactly as two real devices would.

### Try it on the TC501 over USB

The camera only works on HTTPS or `localhost`. With the device plugged in for scrcpy you can
make the laptop's dev server appear as `localhost` on the TC501 (`adb.exe` is in the scrcpy folder):

```bash
npm run dev -- --host 127.0.0.1
adb reverse tcp:5173 tcp:5173
```

Then open `http://localhost:5173` in the TC501's browser.

### Tests

```bash
npm test
```

Covers the state rules, auth, the HTTP API (including concurrent writers), the Netlify Blobs
adapter against the real SDK client, and the client outbox.

## Deploy to Netlify

The current deployment is the Netlify project `prebiltscanninggame`
(https://prebiltscanninggame.netlify.app). The original `game.theconfigteam.com` domain is attached
to a different Netlify site (`tctbarcodeapp`) and keeps serving the old, per-device version until
that domain is moved to this project. Deploy from the `project` folder, because that is where
`netlify.toml` and the function live.

1. **Set the admin password** in Netlify: *Project configuration → Environment variables*:
   `ADMIN_PASSWORD` (and optionally `ADMIN_USERNAME`, default `admin`). If it is not set, the
   server falls back to the app's original built-in password so existing setups keep
   working, and the Settings window warns about it. Do not run a real event on that default.
   Variable changes only apply to the next deploy.
2. **Deploy.** Either:
   - **CLI:** `cd project`, then `npx netlify-cli deploy --prod`. The first run logs you in and
     asks you to link the folder to an existing project or create a new one.
   - **Git:** link this repository to the project, set *Base directory* to `project`, push.
3. **Make the project public.** Netlify creates new projects as *private* for teams created since
   28 July 2026, so every visitor outside your team (including the TC501) is sent to a Netlify
   login. Open *Project configuration → General → Visitor access* and set *Project visibility*
   to *Public*. Do this after setting `ADMIN_PASSWORD` and deploying.
4. **Check it** (about 10 seconds):

   ```bash
   node scripts/smoke.mjs https://prebiltscanninggame.netlify.app
   # add SMOKE_ADMIN_PASSWORD=... to also test the admin side
   ```

   Then open the site, sign in, and press *Clear Leaderboard* to remove the test rows.

> **Node version:** the function runs on the same Node version as the build, and
> `@netlify/blobs` needs Node 22.12 or newer. `netlify.toml` asks for Node 22; if the site
> also has a `NODE_VERSION` environment variable set lower, remove or raise it.
>
> The repository root also contains an older copy of the app (without admin login). The
> deployed site is built from `project/`; the root copy is not used.

### Settings

| Variable | Purpose |
| --- | --- |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin login. Changing the password signs every admin out. |
| `AUTH_SECRET` | Optional. Signs admin sessions. If unset the server generates and stores one. |
| `BLOBS_STORE_NAME` | Optional. All deploys of a site share one store by default; give a preview/branch deploy its own name to isolate its data. |

## Event-day runbook

**Before**
1. Deploy, set `ADMIN_PASSWORD`, make the project public, run the smoke test, clear the test rows.
2. On the laptop: open the site, tap **Admin** (top right) to sign in, open the leaderboard, then open
   **Settings** to confirm they load. Keep the laptop awake and on power.
3. Put the laptop on the big screen at `https://prebiltscanninggame.netlify.app/#leaderboard` and press
   `F11` (or tap the expand icon for presentation mode). The layout scales up on wide screens; `Ctrl` + `+` / `-` fine-tunes it.

**During**
- Participants enter name + email on the TC501 and scan 10 boxes. The big screen shows them
  under *Now playing* and then ranks them. The pill under the logo shows `Live`, or
  `Reconnecting...` if the laptop loses connection (it keeps the last known results).
- If the TC501 loses Wi-Fi, play continues. The result shows *Saving your result...* and is
  delivered automatically when the network returns. Do not clear the browser data on the
  TC501 until it says `Live`.

**After**
1. **Export to Excel** (names, emails, times, and everyone who registered).
2. **Clear Leaderboard** to wipe the data for all devices.

## Design and responsive layout

The look is built on the TCT brand: deep indigo `#1a237e` / `#283593`, white text and white
primary buttons, and the original green / red / amber status colours. Everything else is a tint of
that indigo. The stylesheet is split by purpose in `src/styles/`:

| File | What it holds |
| --- | --- |
| `tokens.css` | Colours, type scale, radii, shadows, motion, spacing (change the brand here) |
| `base.css` | Reset, page background, focus rings, reduced-motion rules |
| `components.css` | Buttons, form fields, panels, status pill, avatars, skeletons |
| `login.css`, `game.css`, `leaderboard.css`, `modal.css` | One file per screen / dialog |

- **Fonts** (Space Grotesk for headings and every number, DM Sans for text) are bundled with the app,
  so they load on venue Wi-Fi and nothing is requested from a font CDN.
- **Breakpoints** (mobile-first): handheld / phone below 600 px, tablet 600-899 px, laptop and
  big screens from 900 px landscape. Above 1100 px landscape the whole interface scales with the
  window *height*, so a projector or TV shows the same composition without scrolling.
- **Big-screen leaderboard**: stepped podium for the top three, "Now playing" with live progress,
  ranks 4+ on the right. The expand icon (top right) starts *presentation mode*: fullscreen with
  the controls hidden (hover or press `Tab` to bring them back, `Esc` to leave).
- **Accessibility**: WCAG AA contrast (measured from rendered pixels), 44 px+ touch targets, visible
  keyboard focus, dialogs with focus trapping and `Esc`, screen-reader landmarks, and no
  continuous animation when the device asks for reduced motion.

## Install as an app (PWA)

The game is a Progressive Web App: it can be installed on the handheld (or a laptop / tablet), opens
full screen from its own icon, and keeps working when the network does not.

**Install:** open the site in Chrome or Edge and tap **Install app** on the login screen (or the
browser menu -> *Install app* / *Add to Home screen*). On iPhone / iPad use Share -> *Add to Home Screen*.

**What works with no network:** the app opens, a participant registers, scans all 10 barcodes and
finishes. The result is kept on the device and sent automatically when the network returns (the
leaderboard shows *Saving your result...*). Anything that needs live data (the leaderboard itself, admin
sign-in, export, settings) says it cannot reach the server instead of showing stale information:
the service worker **never** touches `/api/*`.

**Updates:** a deploy reaches installed copies by itself (checked when the app opens, every 30 minutes,
and when it comes back to the foreground). A small *A new version is ready - Refresh* notice appears,
never in the middle of a game.

| Piece | Where |
| --- | --- |
| Manifest (name, colours, icons, shortcuts, install-dialog screenshots) | `public/manifest.webmanifest` |
| Icons: the logo on TCT indigo, plus maskable, monochrome and iOS versions | `public/icons/` |
| Install-dialog screenshots (re-take them if the design changes) | `public/screenshots/` |
| Offline worker template, and the build step that fills it in (`dist/sw.js`) | `build/sw-template.js`, `build/pwa-plugin.mjs` |
| Install button, update notice, registration | `src/utils/pwa.js`, `src/components/UpdateNotice.js` |

**Try it locally.** The worker only runs in a production build (in development it would hide your edits):

```bash
npm run build && npm run preview     # then open http://localhost:4173
```

To start from scratch in Chrome: DevTools -> Application -> *Storage* -> *Clear site data*.
Netlify needs no extra setup: `netlify.toml` already serves `sw.js` with `no-cache` (so a new version is
always noticed) and the hashed files with long-lived caching.

## Data and privacy

Names and emails are now stored on the server (Netlify Blobs) until someone presses
*Clear Leaderboard*. Only the admin can read emails. Make sure the event's privacy notice
covers this, and export then clear after the event.

## API

Public: `GET /api/leaderboard`, `PUT /api/plays/:id`, `GET /api/health`.
Admin (Bearer token): `POST /api/admin/login`, `GET|PUT /api/admin/settings`,
`GET /api/admin/export`, `DELETE /api/admin/leaderboard`. See `server/api.mjs`.

Code layout: `server/` (API, rules, auth, storage), `netlify/functions/api.mjs` (Netlify entry),
`shared/` (rules used by both browser and server), `src/` (the app), `tests/`.
