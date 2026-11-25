import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {
  energyAt,
  headingOf,
  hubHeight,
  restingState,
  rpmOf,
  step,
  type Controls,
  type HeliParams,
  type StepEvents,
} from './physics';
import {
  connectedPads,
  GameControllerSticks,
  isGameController,
  isLowered,
  KeyboardSticks,
  radioSwitches,
  RATES,
  readAxes,
  type Mapping,
} from './input';
import {drawAmps, idleUpOf, packVolts, type SimFeed, type SimPack} from './radioFeed';
import type {RotorSound} from './sound';
import {ModelMixer, modelMapping} from './modelMixer';
import {loggedControls, loggedOutputs, loggedSticks, replayEnd, type Replay} from './replay';
import {windAt} from './wind';
import {ReplayPilot} from './replayPilot';
import {sampleAt} from '../model/telemetry';
import {onPractice} from '../model/flying';
import type {CardModel} from '../radio/card';
import {FACINGS, PAD, startDrill, updateDrill, type Drill, type Facing} from './drills';
import {buildHeli, buildField, buildHoverBox} from './scene';

/** What the view tells the page, ten times a second. */
export interface SimInfo {
  height: number;
  climb: number;
  speed: number;
  rpm: number;
  throttle: number;
  grounded: boolean;
  crashed: string | null;
  drill: Drill;
  controls: Controls;
  /** The gamepads connected, the one flown (-1: the keyboard), and its raw axes. */
  pads: {id: string; controller: boolean}[];
  pad: number;
  axes: number[];
  /** The idle up flown (1 to 3). */
  idleUp: number;
  /** A logged pack replayed: what it flew now (as the controls), and where it is in its log (s). */
  ghost: Controls | null;
  /** Where the replay is in its log (s), its end, and how often a crash was picked up into a hover. */
  replay: {at: number; end: number; pickedUp: number; followed: number | null} | null;
}

/** The physics runs at this step, whatever the screen's frame rate. */
const STEP = 1 / 240;
/** The pilot's eyes. */
const EYES = new THREE.Vector3(0, 1.7, 0);
/**
 * The eyes' field of view at zoom 1, degrees top to bottom: a fixed lens, so the heli shrinks as it goes away as it
 * does on the field (on the pad, 5 m off, its rotor takes about a sixth of the view's height).
 */
const EYE_FOV = 30;
/** A stick moved past this (share of its travel) while a replay flies the heli: the pilot takes over. */
const TAKE_OVER = 0.25;
/** Following a replay, the sticks count as on the log's marks within this, on average over the four (share of travel). */
const FOLLOW_BAND = 0.15;
/** The heli may stray this share of its distance from where the eyes look before they turn after it, and they turn
 * after it over this, s. */
const LOOK_SLACK = 0.07;
const LOOK_LAG = 0.18;
/**
 * The heli's rotor may fill at most this share of the view's height: closer than that, the eyes step back from it
 * (straight away from it, as a pilot steps back), over this, s, and come back to where the pilot stands once it goes.
 */
const NEAR_SHARE = 0.35;
const STEP_BACK_LAG = 0.3;
/** The eyes never go lower than this, stepping back from a heli flown low over the ground. */
const LOWEST_EYES = 0.4;
/** The heli always stays within this share of the way from the view's middle to its edge: past it, the eyes turn at once. */
const IN_VIEW = 0.75;

/**
 * The simulator's 3D view: the field seen from the pilot's eyes, the heli flown by the radio, a game controller or the
 * keyboard, the drill run on it. Reports to the page ten times a second (`onInfo`). A new `restart` puts the heli
 * back on the pad; a new heli (`params`, `color`), drill or facing does too.
 */
export default function SimView({
  params,
  color,
  drill: kind,
  facing,
  wind,
  mapping,
  pad,
  restart,
  feed,
  pack,
  model,
  replay,
  onTakeOver,
  noise,
  sound,
  zoom,
  onInfo,
}: {
  params: HeliParams;
  color: string;
  drill: Drill['kind'];
  facing: Facing;
  /** km/h, from the pilot's left, gusting. */
  wind: number;
  mapping: Mapping;
  /** The gamepad to fly with (an index in the ones connected); the first when out of range. */
  pad: number;
  restart: number;
  /** What the radio screen reads: written every frame. */
  feed: {current: SimFeed};
  /** The pack flown: a fresh one each time the heli goes back on the pad. */
  pack: SimPack;
  /** The model on the radio's card for this heli, once read: a game controller and the keyboard fly through its mixer. */
  model: CardModel | null;
  /** A logged pack being replayed, or null; called when the pilot touches the sticks while it flies the heli. */
  replay: Replay | null;
  onTakeOver: () => void;
  /** The heli's sound, the page's (started by its button), and whether it is on. */
  noise: RotorSound;
  sound: boolean;
  /** The pilot's zoom on the eyes' lens (EYE_FOV at 1): more closer in, less wider. */
  zoom: number;
  onInfo: (info: SimInfo) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef({wind, mapping, pad, onInfo, pack, noise, sound, model, replay, onTakeOver, zoom});
  live.current = {wind, mapping, pad, onInfo, pack, noise, sound, model, replay, onTakeOver, zoom};

  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({antialias: true});
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const sky = new THREE.Color('#a9cde8');
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 70, 260);
    scene.add(new THREE.HemisphereLight('#e8f3ff', '#4d6b3a', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e0', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 40});
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun, sun.target);
    buildField(scene);
    const hoverBox = kind === 'hover' ? buildHoverBox(scene) : null;
    const model = buildHeli(color);
    model.heli.scale.setScalar(params.radius);
    scene.add(model.heli);

    const camera = new THREE.PerspectiveCamera(EYE_FOV, 1, 0.05, 900);
    camera.position.copy(EYES);
    const look = PAD.clone();
    // Where the eyes want to be (the pilot's place, else stepped back from a heli too close), and scratch vectors.
    const eyesWanted = new THREE.Vector3();
    const away = new THREE.Vector3();
    const toHeli = new THREE.Vector3();
    const toLook = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const still = new THREE.Quaternion();

    const heading = FACINGS.find(one => one.value === facing)?.heading ?? 0;
    const start = () => restingState(PAD, kind === 'hover' ? heading : 0);
    let state = start();
    let drill = startDrill(kind, facing);
    let crashedFor = 0;
    let controls: Controls = {roll: 0, pitch: 0, yaw: 0, collective: 0, throttle: 0};
    const keyboard = new KeyboardSticks();
    const controller = new GameControllerSticks();
    const hoverStick = params.hoverPitch / params.maxPitch;
    let time = 0;
    let spare = 0;
    let last = performance.now();
    let reported = 0;
    let bladeAngle = 0;
    let used = 0;
    let idleUp = 2;
    let mixedFor: CardModel | null = null;
    let playedFrom = -1;
    // The replay's own clock, the log's second: it moves with the physics, so a slow frame or a hidden tab never
    // leaves the heli behind the log.
    let replayClock = 0;
    let pilot: ReplayPilot | null = null;
    let pickedUp = 0;
    // Following a replay: how long the sticks were on the log's marks, of how long it played.
    let onMarks = 0;
    let followedFor = 0;
    let mixer: ModelMixer | null = null;
    // Which way up the heli is, for a game controller's collective: its stick springs back to centre, so the centre
    // is the hover pitch on the side the heli is on (upside down, the inverted one). It changes side past sideways,
    // with a margin, as the collective goes through zero in a flip.
    let side = 1;
    const mast = new THREE.Vector3();

    const typing = (event: KeyboardEvent) =>
      event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() === 'r') {
        state = start();
        drill = startDrill(kind, facing);
        used = 0;
        return;
      }
      if (keyboard.press(event.key)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => keyboard.release(event.key);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const sizes = new ResizeObserver(resize);
    sizes.observe(host);
    resize();

    const gust = new THREE.Vector3();
    let frame = 0;
    const tick = (now: number) => {
      // A replay in slow motion slows the whole sim: the heli, its log and the eyes.
      const dt = Math.min(0.1, (now - last) / 1000) * (live.current.replay?.speed ?? 1);
      last = now;
      time += dt;

      // The sticks: the gamepad picked, else the first, else the keyboard.
      const upright = mast.set(0, 1, 0).applyQuaternion(state.attitude).y;
      if (upright > 0.15) side = 1;
      else if (upright < -0.15) side = -1;
      const pads = connectedPads();
      const flown = pads[live.current.pad] ?? pads[0];
      // The model's mixer, once its card is read: a game controller or the keyboard flies through it, as the radio.
      if (live.current.model !== mixedFor) {
        mixedFor = live.current.model;
        mixer = mixedFor ? new ModelMixer(mixedFor, hoverStick) : null;
      }
      let outputs: number[] = [];
      let sticks: Controls;
      if (flown && !isGameController(flown)) {
        outputs = [...flown.axes];
        // The radio sends its outputs as axes and CH9 on as buttons: SA on CH10 and SF on CH11 when the model sends
        // them (sim_switches.py in edge-tx), else both show only as the motor's channel off cut.
        const read = readAxes(outputs, live.current.mapping);
        const switches = radioSwitches(live.current.model, flown);
        controls = {
          ...read,
          armed: switches ? switches.armed : read.throttle > 0,
          ...(switches && {throttleOn: switches.throttleOn}),
        };
        sticks = controls;
      } else {
        const centre = mixer ? (side > 0 ? mixer.hover.upright : mixer.hover.inverted) : side * hoverStick;
        sticks = flown ? controller.read(flown, centre, !!mixer) : keyboard.read(dt, !!mixer);
        const status = flown ? controller.status : keyboard.status;
        if (mixer) {
          outputs = mixer.outputs(
            {
              ail: sticks.roll,
              ele: sticks.pitch,
              rud: sticks.yaw,
              thr: sticks.collective,
              armed: status.armed,
              motor: !status.hold,
              idleUp: status.idleUp,
              level: !!sticks.level,
              practice: isLowered(sticks.rates),
              rescue: !!sticks.rescue,
              button: live.current.pack.button,
            },
            now / 1000,
          );
          controls = {
            ...readAxes(outputs, mixer.mapping),
            rescue: sticks.rescue,
            level: sticks.level,
            rates: sticks.rates,
            armed: sticks.armed,
          };
        } else controls = sticks;
      }

      // A logged pack replayed: beside the sticks, or flying the heli (put back on the pad as it starts).
      const replay = live.current.replay;
      let ghost: Controls | null = null;
      let replayAt: number | null = null;
      // Flying the log: the pilot for each physics step, as `npm run replay` scores it.
      let flying: ((second: number) => Controls) | null = null;
      let loggedIdleUp = 0;
      if (replay) {
        // Each start, or start again on another pack or way of replaying, puts the heli back on the pad.
        if (replay.startedAt !== playedFrom) {
          playedFrom = replay.startedAt;
          pilot = new ReplayPilot(replay, params);
          replayClock = replay.from;
          pickedUp = 0;
          onMarks = 0;
          followedFor = 0;
          state = start();
          drill = startDrill(kind, facing);
          used = 0;
        }
        const second = replayClock;
        if (second <= replayEnd(replay.series)) {
          replayAt = second;
          const logMapping = mixer?.mapping ?? modelMapping(live.current.model);
          ghost = loggedControls(replay.series, second, logMapping);
          // The pilot touching the sticks takes the heli back: the replay stops, the heli back on the pad.
          if (
            replay.mode === 'fly' &&
            Math.max(Math.abs(sticks.roll), Math.abs(sticks.pitch), Math.abs(sticks.yaw)) > TAKE_OVER
          ) {
            state = start();
            drill = startDrill(kind, facing);
            used = 0;
            live.current.onTakeOver();
          } else if (replay.mode === 'fly') {
            // The log flies, its flips and rolls made whole turns, the stand-in pilot adding the corrections the log
            // cannot hold (see standIn.ts).
            const flown = pilot;
            flying = at => flown?.controls(at, state, STEP, logMapping) ?? ghost!;
            // Until the first step of the frame flies it (each call moves the flip guide on).
            controls = ghost;
            outputs = loggedOutputs(replay.series, second);
            const se = sampleAt(replay.series.time, replay.series.channels.se, second) ?? 0;
            // Practice rates: SG up since 25 Nov 2026, SG down before, SD down before 24 Nov.
            const position = (name: string) => sampleAt(replay.series.time, replay.series.channels[name], second);
            const practice = onPractice(position('sg'), position('sd'), replay.start ?? '');
            loggedIdleUp = se < -0.5 ? 1 : se > 0.5 ? 3 : 2;
            sticks = {
              ...loggedSticks(replay.series, second),
              rescue: ghost.rescue,
              level: ghost.level,
              rates: RATES[practice ? 1 : 0].label,
            };
          }
        }
      }

      // Following it: the sticks on the log's marks while they are within FOLLOW_BAND of them, on average.
      if (replay?.mode === 'sticks' && ghost && replayAt !== null) {
        const off =
          (Math.abs(controls.roll - ghost.roll) +
            Math.abs(controls.pitch - ghost.pitch) +
            Math.abs(controls.yaw - ghost.yaw) +
            Math.abs(controls.collective - ghost.collective)) /
          4;
        followedFor += dt;
        if (off < FOLLOW_BAND) onMarks += dt;
      }

      // The wind from the left, gusting a third either way.
      windAt(time, live.current.wind, undefined, gust);

      const happened: StepEvents = {};
      for (spare += dt; spare >= STEP; spare -= STEP) {
        if (flying) controls = flying(replayClock);
        Object.assign(happened, step(state, controls, params, gust, STEP));
        if (replay) replayClock += STEP;
      }
      if (state.crashed) {
        crashedFor += dt;
        // A replay flying the heli goes on: picked up into a hover where it was, the log carrying on. Else back on the
        // pad by itself, a moment after the crash, a fresh pack in.
        if (live.current.replay?.mode === 'fly' && crashedFor > 0.4) {
          const where = state.position.clone().setY(Math.max(4, state.position.y));
          state = restingState(where, headingOf(state.attitude));
          state.grounded = false;
          state.energy = energyAt(params.hoverRpm, params);
          pickedUp += 1;
          crashedFor = 0;
        } else if (crashedFor > 0.6) {
          state = start();
          crashedFor = 0;
          used = 0;
        }
      } else crashedFor = 0;
      drill = updateDrill(drill, {
        dt,
        position: state.position,
        heading: headingOf(state.attitude),
        grounded: state.grounded,
        crashed: !!state.crashed,
        landed: happened.landed,
        motor: controls.throttle > 0,
      });

      // The heli, its rotor turning clockwise seen from above (the disc shows as it speeds up), the sun over it.
      model.heli.position.copy(state.position);
      model.heli.quaternion.copy(state.attitude);
      const rpm = rpmOf(state, params);
      const spin = Math.min(1, rpm / (0.5 * params.hoverRpm));
      bladeAngle += ((Math.min(rpm, 180) / 60) * Math.PI * 2 + spin * 0.9) * dt;
      model.rotor.rotation.y = -bladeAngle;
      model.tilt.rotation.x = 0.05 * state.command.x;
      model.tilt.rotation.z = 0.05 * state.command.z;
      model.bladeMaterial.opacity = 1 - 0.75 * spin;
      model.discMaterial.opacity = 0.28 * spin;

      // The pack: the current the rotor's load draws, its charge going, its volts sagging; and what the radio reads.
      const motor = controls.throttle > 0 && !state.crashed;
      const amps = drawAmps(params.mass, controls.collective, rpm / params.hoverRpm, motor);
      used += (amps * dt) / 3.6;
      if (loggedIdleUp) idleUp = loggedIdleUp;
      else if (flown && isGameController(flown)) idleUp = controller.status.idleUp;
      else if (!flown) idleUp = keyboard.status.idleUp;
      else if (motor) idleUp = idleUpOf(controls.throttle);
      feed.current = {
        // The sticks as the radio would read them (its outputs apart, when the radio or the model's mixer makes them).
        controls: sticks,
        outputs,
        idleUp,
        motor,
        rescue: !!controls.rescue,
        volts: packVolts(live.current.pack, used, amps),
        amps,
        used,
        button: live.current.pack.button,
      };
      sun.position.copy(state.position).add(new THREE.Vector3(-6, 14, 5));
      sun.target.position.copy(state.position);
      if (hoverBox && drill.kind === 'hover') {
        hoverBox.material.color.set(drill.inside ? '#7ee0a0' : '#ffffff');
      }

      // The pilot's eyes hold still while the heli stays near the middle of the view (within a share of its distance),
      // and turn after it, slowly, only for what it strays past that. Their lens is fixed, zoomed by the pilot.
      const aim = state.position.clone();
      aim.y += hubHeight(params) / 2;
      const zoomed = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(EYE_FOV) / 2) / live.current.zoom),
      );
      if (Math.abs(zoomed - camera.fov) > 0.01) {
        camera.fov = zoomed;
        camera.updateProjectionMatrix();
      }
      // Too close to the pilot (its rotor past a share of the view's height): the eyes step back from it, only as far as
      // needed, and come back once it goes. Straight away from the heli, so the view hardly turns.
      // Measured on the lens at zoom 1: zooming in is the pilot's choice to see it bigger, not a reason to step back.
      const nearest = (2 * params.radius) / (NEAR_SHARE * 2 * Math.tan(THREE.MathUtils.degToRad(EYE_FOV) / 2));
      eyesWanted.copy(EYES);
      away.copy(EYES).sub(aim);
      if (away.length() < nearest) {
        // Right on the pilot: back the way the eyes look from, towards the pilot's side of the field.
        if (away.lengthSq() < 1e-6) away.copy(camera.position).sub(look);
        away.normalize();
        eyesWanted.copy(aim).addScaledVector(away, nearest);
        eyesWanted.y = Math.max(LOWEST_EYES, eyesWanted.y);
      }
      camera.position.lerp(eyesWanted, 1 - Math.exp(-dt / STEP_BACK_LAG));
      const distance = camera.position.distanceTo(aim);
      const stray = aim.clone().sub(look);
      const slack = LOOK_SLACK * distance;
      if (stray.length() > slack) {
        look.addScaledVector(stray, (1 - slack / stray.length()) * (1 - Math.exp(-dt / LOOK_LAG)));
      }
      // Never out of the view: past a share of the way to its edge, the eyes turn at once to keep it there.
      toHeli.copy(aim).sub(camera.position).normalize();
      toLook.copy(look).sub(camera.position);
      const lookDistance = Math.max(1, toLook.length());
      toLook.normalize();
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const halfWidth = halfHeight * camera.aspect;
      const edge = IN_VIEW * Math.atan(Math.min(halfHeight, halfWidth));
      const off = toLook.angleTo(toHeli);
      if (off > edge) {
        turn.setFromUnitVectors(toLook, toHeli);
        still.identity().slerp(turn, (off - edge) / off);
        toLook.applyQuaternion(still);
        look.copy(camera.position).addScaledVector(toLook, lookDistance);
      }
      camera.lookAt(look);
      renderer.render(scene, camera);
      live.current.noise.update(
        rpm,
        params.hoverRpm,
        state.thrust / (params.mass * 9.81),
        motor,
        distance,
        live.current.sound,
      );

      if (now - reported > 100) {
        reported = now;
        live.current.onInfo({
          height: state.position.y,
          climb: state.velocity.y,
          speed: Math.hypot(state.velocity.x, state.velocity.z),
          rpm,
          throttle: controls.throttle,
          grounded: state.grounded,
          crashed: state.crashed,
          drill,
          controls,
          pads: pads.map(one => ({id: one.id, controller: isGameController(one)})),
          pad: flown ? pads.indexOf(flown) : -1,
          axes: flown ? [...flown.axes] : [],
          idleUp,
          ghost,
          replay:
            replay && replayAt !== null
              ? {
                  at: replayAt,
                  end: replayEnd(replay.series),
                  pickedUp,
                  followed: followedFor > 1 ? onMarks / followedFor : null,
                }
              : null,
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      sizes.disconnect();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [params, color, kind, facing, restart, feed]);

  if (failed) return <div className="sim-stage-failed">This browser cannot draw 3D (WebGL is off).</div>;
  return <div ref={holder} className="sim-canvas" />;
}
