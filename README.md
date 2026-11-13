# Flightdown 🚁

A flight log for RC helicopters: every sortie, nice stats, the fleet, and what keeps it flying.

## What it does

It looks like an 80s helicopter cockpit's green displays, made easy to read: a very dark green page, pale text in IBM
Plex Sans, a soft phosphor green for labels, numbers and what is live (Share Tech Mono for headings and numbers),
frames marked by corner brackets, a rolling counter of minutes in the air.

- **Cockpit:** the minute counter on 3D drums (they roll up at each change of tab) beside a rotor that spools up,
  packs per crash on a tape (all time, and the last 20 sorties), the crash-free run in packs and days, the last five
  sorties beside the helis on the flight line, the live packs by their buttons (flights, last flown, resistance, tiring
  or worn against their first reading and the freshest pack's) beside the next rung of the skill ladder, and airtime
  month by month over the two years up to the last sortie.
- **Sorties:** every sortie as a flight strip, a month at a time. Search notes, parts, places and days; filter by
  heli, spot, crashes, a broken part or sorties with a radio log (behind one Filters button on a phone).
- **Photos:** they stay in Apple Photos, in an iCloud shared album with its public website on (its link goes in
  Settings). A sortie shows the album's photos taken that day, or the ones picked in its form.
- **Log a sortie:** heli, day, packs and time per pack (minus and plus, or typed), crashes, the last flown spots (the
  rest one tap away), broken parts, manoeuvres practised, notes and links. Quick with one hand at the field; changes
  made without signal wait and sync later.
- **Telemetry:** add EdgeTX logs (the radio's `LOGS` folder) to a sortie. It shows a card per pack, named by the
  6-position button pressed for it (packs get buttons in the Hangar; files a few seconds apart are one pack, the radio
  splits a log when the link drops, unless their buttons differ), and for the chosen pack: voltage, current, signal and
  throttle as lanes of one recorder (each reads out at the cursor; the flight only, the quiet start and end cut, or the
  whole log), under it a replay of the sticks with round throttle, current and battery dials (the battery from the pack
  its button names: its charge at rest when plugged in, less the mAh used; a cursor on the lanes) and a small heli that
  rolls, tilts and turns with the sticks and turns over through each flip the way they took it, then its figures, a
  map of the sticks, and what the log says: the pack ran flat, how much of it was used, sag per cell, when 80 % was
  used (a timer that fits), pack resistance, the radio link, the time upside down (the collective held past the other
  side of hover under load for 3 s or more, shaded on the lanes), the flips and rolls (back, front, left, right: whole
  turns, over onto its back and on round the same way, the way read from the cyclic). A sortie flown with logs shows
  its exact air time, each pack as a bar (named by its button, the inverted part in violet), the share upside down as
  a ring, and its flips and rolls. `npm run logs` brings them from the plugged-in radio. Debrief compares every pack's
  voltage under load, and each pack's resistance over time (named by its button, from the voltage drop when the current
  jumps: twice its first reading is worn), and adds up the flips and rolls.
- **Debrief:** a bar to jump between its sections, the learning curve (crashes every 10 packs), milestones, where the
  heli breaks (a damage map on a heli drawing), what brings it down (crash causes read from the notes), the fleet's
  history, the skill ladder, the flying season, packs a sortie, spots, and hours by heli (each heli's share as a ring,
  in its chart colour).
- **Hangar:** the flight line, the radio and other gear, the helis that left (stamped sold or lost), packs and their
  cycles (each pack numbered for good, with its button and the day it died: a new pack can take a dead one's button,
  the dead one keeps its logs and charts), notes. Helis and packs keep the day they were bought, helis and radios
  their price. Each heli has a data plate page and its own chart colour (picked in its form). Helis, radios and packs
  take a photo link; photos are lifted out of their background (`npm run cutouts`, with Apple's Vision on the Mac;
  others are cut out in the page). Spare parts are hidden for now (`SHOW_SPARES` in `src/model/parts.ts`).
- **Radio:** a tab of its own: the TX16S, running the Lua that goes on it (in the browser, with Fengari), its switches
  around the screen where they sit on the radio, each saying what it does on the model where it is set (`roles.ts`,
  written by hand from the model files). Model screens: the M2 EVO's and M4's screens as the radio draws them, from its
  card, every widget in its zone (EdgeTX's own ones redrawn, LVGL ones drawn from their labels, rectangles, lines,
  triangles, circles, images and boxes). One widget: a widget built in
  [edge-tx](https://github.com/ValentinMumble/edge-tx), in a zone of its size, its Lua to edit (kept in the browser,
  downloadable as `main.lua`). Logic: under the screen, the model's logic and the radio's in words, live with the
  switches and a replay: controls, conditions, what each channel is made of now and why, special and global functions,
  timers; pick one to light what it reads and what reads it (`logic.ts`). Set the switches by hand (a click on one moves
  it; SH, the red rescue switch, springs back, down only while held; SF starts in hold) and the 6-position buttons, or
  replay a logged pack: its log drives the sensors, the buttons, the switches (their real positions; in older logs, the
  arming ones follow the rotor, on while the pack draws 2 A) and the outputs; a log with no mAh sensor counts the mAh
  from the current, as the radio does. Widgets read the model's global variables (mAhRe its cell count), and its timers
  run as on the radio, on its logical switches (`timers.ts`); its outputs come from its own inputs, curves and mixes
  when no log drives them (`mixer.ts`).
- **Spots:** every flying spot on a satellite map (spots close together share a pin with a count until you zoom in).
  Set a spot's GPS point by tapping the map, pasting coordinates or a Maps link, or from the phone's position; each
  sortie then shows its spot from above.
- **Phones:** a liquid glass dock (as in `papyrus/design/liquid-glass.md`): Cockpit, Sorties, Radio, Hangar and More
  (Debrief, Spots, Settings), with a round log button; swipe sideways to change tab. Add it to the home screen: it opens like an app, with the 🚁 icon, and offline at the field.

Visitors see a made-up log, or keep their own in their browser.

## Run it

```sh
npm install
npm run dev
```

It opens on http://127.0.0.1:5194 and serves `/api/*` itself, with the variables of `.env.local` (see
[.env.example](.env.example)). Without them it shows the made-up log.

**Owner mode** keeps the log in Upstash Redis, under `flightdown:*` keys. Set `OWNER_KEY` and the store's
`KV_REST_API_URL` and `KV_REST_API_TOKEN`, then open `/#owner=<OWNER_KEY>` once (or type the key in Settings).

**Seed** the store once from a Google Sheets log and the radio's logs: `npm run seed` reads `SEED_SHEET_ID` and
`SEED_LOGS_DIR`. `--dry-run` only prints what it read; `--force` replaces a log already there.

**Radio logs:** on the radio, give each heli a special function "SD Logs" on the switch `Telem` (telemetry streaming) at
0.2 s: it then logs every pack, one file each, from plug-in to unplug. Plug the radio in as USB storage and run `npm run
logs`. It backs up new CSV files to `SEED_LOGS_DIR` and adds each new flight log to the sortie of its day on the heli
named like the radio's model. `--create` makes a sortie for logs with none, on the heli of that name still flying, its
time per pack the logs' time with the motor under load; a sortie counts at least the packs its logs show, and
`--recount` checks every sortie for that; `--clean` then removes the backed-up logs from the radio; `--dry-run` only
prints what it would do.

**Heli photos:** `npm run cutouts` lifts every heli photo out of its background with Apple's Vision framework (macOS
14 or later) and keeps the PNGs in Redis; run it after setting a new photo. `--force` lifts them all again.

**Radio:** the Radio tab reads the radio's card from [edge-tx](https://github.com/ValentinMumble/edge-tx), whose
`sd-card/` is the card as it should be: `/api/radio` gives the kept models' screens and logic, the radio's settings,
and the Lua widgets and pictures they use. On Vercel it reads GitHub (kept five minutes, so a push there shows within
that); in `npm run dev` it reads the edge-tx checkout beside this one (`EDGETX_DIR` for another place), its built
widgets fresh from `npm run dev` there, so a save shows at once. `EDGETX_SOURCE=github` reads GitHub locally too.

**Reading logs again:** `npm run reread` reads every log Flightdown has from its backup in `SEED_LOGS_DIR` again, so
what the reader learned since (the switches, the 6-position button) reaches older logs. `--dry-run` only prints.

**App icons:** `swift scripts/icons.swift` draws them into `public/` from the 🚁 emoji.

## Stack

Vite, React, TypeScript, Recharts and Leaflet; six Vercel functions in `api/`; Upstash Redis. Satellite tiles from
Esri, the street map from CARTO and OpenStreetMap. `npm test` runs the Vitest
tests, `npm run format` runs Prettier.
