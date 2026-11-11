# Flightdown 🚁

A flight log for RC helicopters: every sortie, nice stats, the fleet, and what keeps it flying.

## What it does

It looks like a helicopter's cockpit seen through a head-up display: near-black, frames marked by corner brackets,
small monospace labels, one soft green for anything good, a rolling counter of minutes in the air.

- **Cockpit:** the minute counter on 3D drums (they roll up at each change of tab) beside a rotor that spools up,
  packs per crash on a tape (all time, and the last 20 sorties), the crash-free run in packs and days, the last three
  sorties, the helis on the flight line, airtime over the two years up to the last sortie and the next rung of the
  skill ladder.
- **Sorties:** every sortie as a flight strip, a month at a time. Search notes, parts, places and days; filter by
  heli, spot, crashes, a broken part or sorties with a radio log (behind one Filters button on a phone).
- **Photos:** they stay in Apple Photos, in an iCloud shared album with its public website on (its link goes in
  Settings). A sortie shows the album's photos taken that day, or the ones picked in its form.
- **Log a sortie:** heli, day, packs and time per pack (minus and plus, or typed), crashes, the last flown spots (the
  rest one tap away), broken parts, manoeuvres practised, notes and links. Quick with one hand at the field; changes
  made without signal wait and sync later.
- **Telemetry:** add EdgeTX logs (the radio's `LOGS` folder) to a sortie. It shows a card per pack (files a few
  seconds apart are one pack, the radio splits a log when the link drops), and for the chosen pack: voltage, current,
  signal and throttle as lanes of one recorder (each reads out at the cursor), a map of the sticks and a replay of them
  with round throttle, current and battery dials (with a cursor on the lanes), and what the log says: the pack ran
  flat, how much of it was used, sag per cell, when 80 % was used (a timer that fits), pack resistance, the radio link.
  `npm run logs` brings them from the plugged-in radio. Debrief compares every pack's voltage under load.
- **Debrief:** a bar to jump between its sections, the learning curve (crashes every 10 packs), milestones, where the
  heli breaks (a damage map on a heli drawing), what brings it down (crash causes read from the notes), the fleet's
  history, the skill ladder, the flying season, packs a sortie, spots and hours by heli.
- **Hangar:** the flight line, the radio and other gear, the helis that left (stamped sold or lost), spare parts whose
  stock goes down as you log broken parts, packs and their cycles, notes. Each heli has a data plate page and its own
  chart colour (tap its dot in the Hangar to change it); photos are lifted out of their background (`npm run cutouts`,
  with Apple's Vision on the Mac; others are cut out in the page).
- **Spots:** every flying spot on a satellite map (spots close together share a pin with a count until you zoom in).
  Set a spot's GPS point by tapping the map, pasting coordinates or a Maps link, or from the phone's position; each
  sortie then shows its spot from above.
- **Phones:** a liquid glass dock (as in `papyrus/design/liquid-glass.md`) with a round log button; swipe sideways to
  change tab. Add it to the home screen: it opens like an app, with the 🚁 icon, and offline at the field.

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

**Radio logs:** on the radio, give each heli a special function "SD Logs" on the switch `Telem` (telemetry
streaming) at 0.2 s: it then logs every pack, one file each, from plug-in to unplug. Plug the radio in as USB storage
and run `npm run logs`. It backs up new CSV files to
`SEED_LOGS_DIR` and adds each new flight log to the sortie of its day on the heli named like the radio's model.
`--create` makes a sortie for logs with none; `--clean` then removes the backed-up logs from the radio; `--dry-run`
only prints what it would do.

**Heli photos:** `npm run cutouts` lifts every heli photo out of its background with Apple's Vision framework (macOS
14 or later) and keeps the PNGs in Redis; run it after setting a new photo. `--force` lifts them all again.

**App icons:** `swift scripts/icons.swift` draws them into `public/` from the 🚁 emoji.

## Stack

Vite, React, TypeScript, Recharts and Leaflet; six Vercel functions in `api/`; Upstash Redis. Satellite tiles from
Esri, the street map from CARTO and OpenStreetMap. `npm test` runs the Vitest
tests, `npm run format` runs Prettier.
