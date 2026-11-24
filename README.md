# Flightdown 🚁

A flight log for RC helicopters: every sortie, nice stats, the fleet, and what keeps it flying.

## What it does

It looks like an 80s helicopter cockpit's green displays, made easy to read: a very dark green page, pale text in IBM
Plex Sans, a soft phosphor green for labels, numbers and what is live (Share Tech Mono for headings and numbers),
frames marked by corner brackets, a rolling counter of minutes in the air.

- **Cockpit:** the minute counter on 3D drums (they roll up at each change of tab) beside a rotor that spools up,
  packs per crash on a tape and the time in the air per crash (all time, and the last 20 sorties), the crash-free run
  in packs and days, the last five sorties by month beside the helis on the flight line (each with its own small hour
  meter, as in the Hangar), the last session at a glance (its packs and their notes, a throttle hold undone in flight,
  the link lost, a hard stop) beside the flying weather at your latest spot for three days (Open-Meteo), then the live packs
  by their buttons (flights, last flown, resistance, tiring or worn against their first reading and the freshest
  pack's) beside what changed on the radio since the last flight (edge-tx's commits).
- **Sorties:** every sortie as a flight strip (today's and yesterday's say so), a month at a time, the airtime shown on
  an hour meter (each sortie's page has its own, with its crashes, spot and indoors set in one tap). Search notes,
  parts, places and days; filter by heli, spot, crashes, a broken part, sorties with a radio log or flown indoors
  (behind one Filters button on a phone).
- **Photos:** they stay in Apple Photos, in an iCloud shared album with its public website on (its link goes in
  Settings). A sortie shows the album's photos taken that day, or the ones picked in its form.
- **Log a sortie:** heli, day, packs and time per pack (minus and plus, or typed), crashes, the last flown spots (the
  rest one tap away) and indoors, broken parts, manoeuvres practised, notes and links. Quick with one hand at the field; changes
  made without signal wait and sync later.
- **Telemetry:** add EdgeTX logs (the radio's `LOGS` folder) to a sortie. It shows a card per pack, named by the
  6-position button pressed for it (packs get buttons in the Hangar; files a few seconds apart are one pack, the radio
  splits a log when the link drops, unless their buttons differ; one row pinned under the top bar, so another pack is
  one tap away from anywhere in the charts), and for the chosen pack: voltage, current, signal and
  throttle as lanes of one recorder (each reads out at the cursor; the flight only, the quiet start and end cut, or the
  whole log; its exceedances marked along the top; crashes marked by a tap at their moment, a red line across the
  lanes; each flip and roll a gold band, its way marked, the pack's count above; the lines broken between a pack's files), under it a replay of the sticks with throttle, power and battery
  dials (the power with a mark for what the pack could still give before a cell drops to 3.3 V, from its resistance;
  the battery from its charge at rest when plugged in, less the mAh used) and an attitude ball (banked and pitched by
  the sticks, turned over through each flip the way they took it, the small heli fixed in its middle), then a caution
  panel (LOW VOLT, HIGH AMP, DEEP, LINK, NOT FULL, PACK WORN, STRIKE, RESCUE, INVERTED, each lit amber, red or green
  with why), its figures, what the log says (the pack ran flat, how much of it was used, sag per cell, when 80 % was
  used, pack resistance, the radio link, the time upside down, the flips and rolls: whole turns, the way read from the
  cyclic), its exceedance events as flight data monitoring lists them (over current, a cell under 3.3 V, the link low,
  past 85 % of the pack, a strike: the current jumping then the motor stopping), and a map of the sticks. A sortie
  flown with logs shows its exact air time, each pack as a bar (named by its button, the inverted part in violet) with
  a word or two on it (too deep, sagged, past its rating, flown hard, tiring or worn, or within its limits; none for
  a pack with no telemetry), the share upside down as a ring, and its flips and rolls, how often they came and each
  pack's. `npm run logs` brings them from the plugged-in radio.
- **Debrief:** a bar to jump between its sections, the learning curve (crashes every 10 packs), milestones, where the
  heli breaks (a damage map on a 3D Huey you turn by dragging, a part's breaks on hover or tap; the flat drawing
  while it loads; the low-poly Huey by Sami, CC BY 4.0, turned into the zones by `scripts/huey.ts`, see
  `assets/huey/CREDIT.md`), what brings it down (crash causes read from the notes), crash patterns (after a crash,
  indoors, days since the last sortie) and crashes by wind, the fleet's
  history, the skill ladder, the flying season, packs a sortie, spots, hours by heli (each heli's share as a ring, in
  its chart colour), every pack's voltage under load, each pack's resistance over time (twice its first reading is
  worn), the flips and rolls added up, pack health (resistance first to latest, its trend a flight, the flights left
  before it is worn at that rate, mAh a flight, lowest cell), the power curve (current against collective, a cloud
  a pack and the line they all make), the sticks from the logs (rescues, self-level, practice rates, idle ups, cyclic
  work, sortie by sortie), the current each idle up draws and the time a pack gives in it, and what it costs (helis
  and gear bought, crash parts priced from the spares, each heli an hour).
- **Weather:** each outdoor sortie at a located spot gets the wind, gusts, temperature and rain over the hours it flew
  (its logs', else 12 to 17), from Open-Meteo's history, filled in by the app and shown on the sortie, with an emoji
  on its strip (rain, wind, frost, or how cloudy).
- **Sim:** fly the low-poly Huey (in the heli's colour, windows added) on a page of its own, from the pilot's spot,
  with the TX16S plugged in as a USB joystick (Classic mode: the model's own outputs, so its rates, curves, idle ups
  and holds), a game controller (mode 2, drawn beside the view with the radio switch each control stands for) or the
  keyboard, these two flown through the model's own mixer from the card (its rates, curves and switches; it gives back
  the logged outputs from the logged sticks). A logged pack replays beside the sticks, or flies the heli with a stand-in pilot adding the corrections a log
  cannot hold (tuned on the November packs: 57 % flown before a crash; a crash is picked up
  and the log goes on); touching a stick takes over. Its hover pitch and current draw are fitted to the logs. Flybarless rate-mode physics sized from the heli's weight and rotor: rates that settle with a little
  overshoot, momentum (it keeps a lean and carries its speed, the FBL taking out most of the disc's blowback), a quick soft start, turbulence, translational lift, tail kick, a governor that sags, hold and autorotation, the
  rescue, self-level, ground effect, wind, crashes; the rotor and motor heard. The eyes see through a fixed lens (the heli
  shrinks as it goes away), with a zoom slider on the view. The TX16S's screen in a corner, its own
  widgets (the Cockpit, the top bar) running on the sim's flight and a simulated pack (current from the load, sized on
  the logs, volts sagging). Drills: hover in a box over the pad in each facing, and soft landings graded by touchdown
  speed.
- **Hangar:** the flight line and the helis that left (stamped sold or lost), the radio and other gear (a tab), packs and their
  cycles (each pack numbered for good, with its button and the day it died: a new pack can take a dead one's button,
  the dead one keeps its logs and charts; a pack moved to another button keeps its logs on the old one), notes. Helis and packs keep the day they were bought, helis and radios
  their price, helis their class, rotor size and weight (under the maker and model). Each heli has a data plate page (with each part's time since it last broke there, against how long it
  lasts) and its own chart colour (picked in its form). Helis, radios, packs and
  spares take a photo link; photos are lifted out of their background (`npm run cutouts`, with Apple's Vision on the Mac;
  others are cut out in the page). Spare parts in their own tab, a group a heli: each counted on a day, each break logged since
  taking one off, those below what to keep on the Cockpit's flight line (`SHOW_SPARES` in `src/model/parts.ts` hides
  them).
- **Radio:** a tab of its own: the TX16S, running the Lua that goes on it (in the browser, with Fengari), its switches
  around the screen where they sit on the radio, each saying what it does on the model where it is set (`roles.ts`,
  written by hand from the model files). Model screens: the M2 EVO's and the K110S's screens as the radio draws them
  (the K110S's Pack timer counting with its throttle), from its card, every widget in its zone (EdgeTX's own ones redrawn, LVGL ones drawn from their labels, rectangles, lines,
  triangles, circles, images and boxes). One widget: a widget built in
  [edge-tx](https://github.com/ValentinMumble/edge-tx), in a zone of its size, its Lua to edit (kept in the browser,
  downloadable as `main.lua`). Logic: under the screen, the model's logic and the radio's in words, live with the
  switches and a replay: controls, conditions, what each channel is made of now and why (a
  curve drawn, a dot where its input is), special and global functions,
  timers; pick one to light what it reads and what reads it (`logic.ts`). Idle ups: the throttle and the pitch across
  the collective stick in each idle up, practice rates dashed, from the model's own mixer, and each one's values, read
  at the stick or wherever the chart is pointed (`idleUps.ts`). Set the switches by hand (a click on one moves
  it; SH, the red rescue switch, springs back, down only while held; SF starts in hold), the 6-position buttons and the S1
  knob above the screen, the two sticks under it (dragged; all but the throttle spring back), or
  replay a logged pack: its log drives the sensors, the buttons, the S1 knob, the switches (their real positions; in older logs, the
  arming ones follow the rotor, on while the pack draws 2 A) and the outputs; a log with no mAh sensor counts the mAh
  from the current, as the radio does. Widgets read the model's global variables (mAhRe its cell count), and its timers
  run as on the radio, on its logical switches (`timers.ts`); its outputs come from its own inputs, curves and mixes
  when no log drives them (`mixer.ts`).
- **Spots:** every flying spot on a satellite map (spots close together share a pin with a count until you zoom in).
  Set a spot's GPS point by tapping the map, pasting coordinates or a Maps link, or from the phone's position; each
  sortie then shows its spot from above.
- **Phones:** a liquid glass dock (as in `papyrus/design/liquid-glass.md`): Cockpit, Sorties, Radio, Hangar and More
  (Debrief, Spots, Sim, Settings), with a round log button; swipe sideways to change tab. Add it to the home screen: it
  opens like an app, with the 🚁 icon, at once and offline at the field (as in `papyrus/guidelines/web-apps.md`),
  and reloads into a new deploy by itself.

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
