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
import {FlipGuide, STAND_IN, standIn, untilCut, untilManoeuvre} from './standIn';
import {sampleAt} from '../model/telemetry';
import type {CardModel} from '../radio/card';
import {FACINGS, HOVER_HEIGHT, PAD, PAD_RADIUS, startDrill, updateDrill, type Drill, type Facing} from './drills';
import huey from '../components/charts/huey.json';
import type {Zone} from '../model/debrief';

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
  replay: {at: number; end: number; pickedUp: number} | null;
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
/** The heli may stray this share of its distance from where the eyes look before they turn after it, and they turn
 * after it over this, s. */
const LOOK_SLACK = 0.07;
const LOOK_LAG = 0.18;

const HUEY = (huey as {zones: Partial<Record<Zone, number[]>>}).zones;

/** The Huey's zones drawn in the heli's colour, in metal, and as the rotor that spins; the motor added inside is not. */
const PAINTED: Zone[] = ['canopy', 'frame', 'boom', 'tail'];
const METAL: Zone[] = ['skids', 'shaft'];
const ROTOR: Zone[] = ['blades', 'head'];

/**
 * Whether a face of the Huey's cabin is a window, by where it sits and which way it faces in the Huey's own frame
 * (nose at -x, up +y, its sides along z): the model has no glass of its own. The windscreen and the chin bubbles
 * face forward; the roof windows over the cockpit up; the cockpit door's and the cargo doors' windows face sideways
 * in the band at window height, a pillar of body left between them.
 */
function isWindow(zone: Zone, normal: THREE.Vector3, middle: THREE.Vector3) {
  if (zone === 'canopy' && normal.x < -0.35 && middle.y > -48) return true;
  if (zone === 'canopy' && normal.y > 0.6 && middle.x < -70) return true;
  return (
    (zone === 'canopy' || zone === 'frame') &&
    Math.abs(normal.z) > 0.9 &&
    middle.y > -27 &&
    middle.y < 0 &&
    ((middle.x > -92 && middle.x < -58) || (middle.x > -40 && middle.x < 25))
  );
}

/** The corners of some of the Huey's zones, as points, three a triangle; `glass` keeps only its windows, or no windows. */
function corners(zones: Zone[], glass?: boolean) {
  const points: THREE.Vector3[] = [];
  const normal = new THREE.Vector3();
  const middle = new THREE.Vector3();
  for (const zone of zones) {
    const list = HUEY[zone] ?? [];
    for (let index = 0; index + 8 < list.length; index += 9) {
      const triangle = [0, 3, 6].map(
        step => new THREE.Vector3(list[index + step], list[index + step + 1], list[index + step + 2]),
      );
      if (glass !== undefined) {
        new THREE.Triangle(triangle[0], triangle[1], triangle[2]).getNormal(normal);
        middle.copy(triangle[0]).add(triangle[1]).add(triangle[2]).divideScalar(3);
        if (isWindow(zone, normal, middle) !== glass) continue;
      }
      points.push(...triangle);
    }
  }
  return points;
}

/**
 * The low-poly Huey (the damage map's, from assets/huey: by Sami, CC BY 4.0) as the simulator's heli, in its colour,
 * one rotor radius a unit: the bottom of its skids at 0, its mast on the y axis, its nose at -z. Its main rotor apart,
 * to spin. In its own frame the nose is at -x and the side along z: it is turned a quarter round.
 */
function buildHeli(color: string) {
  const head = new THREE.Box3().setFromPoints(corners(['head']));
  const mast = head.getCenter(new THREE.Vector3());
  const radius = Math.max(...corners(['blades']).map(point => Math.hypot(point.x - mast.x, point.z - mast.z)));
  const floor = new THREE.Box3().setFromPoints(corners(['skids'])).min.y;
  const plane = new THREE.Box3().setFromPoints(corners(['blades'])).getCenter(new THREE.Vector3()).y;
  const geometry = (zones: Zone[], originY: number, glass?: boolean) => {
    const points = corners(zones, glass);
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions[index * 3] = -(point.z - mast.z) / radius;
      positions[index * 3 + 1] = (point.y - originY) / radius;
      positions[index * 3 + 2] = (point.x - mast.x) / radius;
    });
    const made = new THREE.BufferGeometry();
    made.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    made.computeVertexNormals();
    return made;
  };
  const heli = new THREE.Group();
  const mesh = (made: THREE.BufferGeometry, material: THREE.Material) => {
    const shape = new THREE.Mesh(made, material);
    shape.castShadow = true;
    return shape;
  };
  const shell = geometry(PAINTED, floor);
  heli.add(
    mesh(
      geometry(PAINTED, floor, false),
      new THREE.MeshLambertMaterial({color, flatShading: true, side: THREE.DoubleSide}),
    ),
    // The windows, dark glass that catches the sky.
    mesh(
      geometry(PAINTED, floor, true),
      new THREE.MeshPhongMaterial({
        color: '#1f3445',
        specular: '#a9cde8',
        shininess: 90,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    ),
    mesh(geometry(METAL, floor), new THREE.MeshLambertMaterial({color: '#7d868e', flatShading: true})),
    // Its facets' edges, faintly, as the damage map draws them.
    new THREE.LineSegments(
      new THREE.EdgesGeometry(shell, 25),
      new THREE.LineBasicMaterial({color: '#1b1f22', transparent: true, opacity: 0.35}),
    ),
  );

  // The main rotor: its blades and head, and the disc the blades make once spinning.
  // The disc tilts on its hub ahead of the body, as the swash leads it; the blades spin inside the tilt.
  const tilt = new THREE.Group();
  tilt.position.y = (plane - floor) / radius;
  const rotor = new THREE.Group();
  tilt.add(rotor);
  const bladeMaterial = new THREE.MeshLambertMaterial({color: '#3a4046', transparent: true, side: THREE.DoubleSide});
  rotor.add(mesh(geometry(ROTOR, plane), bladeMaterial));
  const discMaterial = new THREE.MeshBasicMaterial({
    color: '#1d2226',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  rotor.add(new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), discMaterial));
  heli.add(tilt);
  return {heli, tilt, rotor, bladeMaterial, discMaterial};
}

/** Where the sun's shadows fall, from the pilot's right towards the field (radians from +x, round towards -z). */
const SHADOW_ANGLE = Math.atan2(5, 6);

/** A field: grass, a faint metre grid near the pad, the pad, poles and trees around for depth. */
function buildField(scene: THREE.Scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({color: '#5d8c43'}),
  );
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(40, 40, '#86b56b', '#77a65c');
  grid.position.set(PAD.x, 0.003, PAD.z);
  scene.add(grid);
  const pad = new THREE.Mesh(
    new THREE.RingGeometry(PAD_RADIUS - 0.06, PAD_RADIUS, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({color: '#f4f4f0'}),
  );
  pad.position.set(PAD.x, 0.006, PAD.z);
  scene.add(pad);
  const centre = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({color: '#f4f4f0'}),
  );
  centre.position.set(PAD.x, 0.006, PAD.z);
  scene.add(centre);

  // Soft shadows on the grass where each pole and tree stands, cast away from the sun (behind the pilot's left), so
  // they sit on the ground: only the heli casts a real one.
  const blob = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const shade = new THREE.MeshBasicMaterial({color: '#1c3313', transparent: true, opacity: 0.4, depthWrite: false});
  const shadow = (x: number, z: number, length: number, width: number) => {
    const mesh = new THREE.Mesh(blob, shade);
    mesh.scale.set(length, 1, width);
    mesh.rotation.y = SHADOW_ANGLE;
    mesh.position.set(x + Math.cos(SHADOW_ANGLE) * length * 0.7, 0.008, z - Math.sin(SHADOW_ANGLE) * length * 0.7);
    scene.add(mesh);
  };
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8);
  const poleMaterial = new THREE.MeshLambertMaterial({color: '#f0a020'});
  for (const [x, z] of [
    [-8, -5],
    [8, -5],
    [0, -15],
    [-8, -15],
    [8, -15],
    [-4, 2],
    [4, 2],
  ]) {
    const mesh = new THREE.Mesh(pole, poleMaterial);
    mesh.position.set(x, 0.8, z);
    mesh.castShadow = true;
    scene.add(mesh);
    shadow(x, z, 0.7, 0.07);
  }
  // Trees in a ring, always in the same places.
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 3, 8);
  const crown = new THREE.ConeGeometry(2.2, 6, 10);
  const bark = new THREE.MeshLambertMaterial({color: '#5b4330'});
  const leaves = new THREE.MeshLambertMaterial({color: '#2f5a2a'});
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let index = 0; index < 60; index += 1) {
    const angle = random() * Math.PI * 2;
    const far = 40 + random() * 70;
    const x = Math.sin(angle) * far;
    const z = -Math.cos(angle) * far - 10;
    if (z > 15) continue;
    const size = 0.7 + random() * 0.8;
    const stem = new THREE.Mesh(trunk, bark);
    stem.position.set(x, 1.5 * size, z);
    stem.scale.setScalar(size);
    const top = new THREE.Mesh(crown, leaves);
    top.position.set(x, 5.5 * size, z);
    top.scale.setScalar(size);
    scene.add(stem, top);
    shadow(x, z, 3.2 * size, 1.9 * size);
  }
}

/** The hover drill's box: a ring at hover height over the pad, and a faint column under it. */
function buildHoverBox(scene: THREE.Scene) {
  const material = new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0.8});
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.015, 8, 64).rotateX(Math.PI / 2), material);
  ring.position.set(PAD.x, HOVER_HEIGHT, PAD.z);
  const columnMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.07,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, HOVER_HEIGHT + 0.75, 48, 1, true), columnMaterial);
  column.position.set(PAD.x, (HOVER_HEIGHT + 0.75) / 2, PAD.z);
  scene.add(ring, column);
  return {ring, column, material};
}

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
    let flips = new FlipGuide(params);
    let pickedUp = 0;
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
      const dt = Math.min(0.1, (now - last) / 1000);
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
      let loggedIdleUp = 0;
      if (replay) {
        // Each start, or start again on another pack or way of replaying, puts the heli back on the pad.
        if (replay.startedAt !== playedFrom) {
          playedFrom = replay.startedAt;
          flips = new FlipGuide(params);
          pickedUp = 0;
          state = start();
          drill = startDrill(kind, facing);
          used = 0;
        }
        const second = replay.from + (now - replay.startedAt) / 1000;
        if (second <= replayEnd(replay.series)) {
          replayAt = second;
          ghost = loggedControls(replay.series, second, mixer?.mapping ?? modelMapping(live.current.model));
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
            const steered = flips.steer(ghost, state, second, dt, replay.stretches);
            controls = standIn(
              steered.controls,
              state,
              params,
              steered.manoeuvre,
              STAND_IN,
              untilCut(replay.cuts, second),
              untilManoeuvre(replay.stretches, second),
            );
            outputs = loggedOutputs(replay.series, second);
            const se = sampleAt(replay.series.time, replay.series.channels.se, second) ?? 0;
            // Practice rates: SG down since 24 Nov 2026, SD down before.
            const down = (name: string) =>
              (sampleAt(replay.series.time, replay.series.channels[name], second) ?? -1) >= 1;
            const practice = down('sg') || down('sd');
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

      // The wind from the left, gusting a third either way.
      const blowing = (live.current.wind / 3.6) * (1 + 0.35 * Math.sin(time * 0.7) * Math.sin(time * 0.23 + 1));
      const veer = 0.25 * Math.sin(time * 0.11);
      gust.set(Math.cos(veer), 0, Math.sin(veer)).multiplyScalar(blowing);

      const happened: StepEvents = {};
      for (spare += dt; spare >= STEP; spare -= STEP)
        Object.assign(happened, step(state, controls, params, gust, STEP));
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
      const distance = camera.position.distanceTo(aim);
      const stray = aim.clone().sub(look);
      const slack = LOOK_SLACK * distance;
      if (stray.length() > slack) {
        look.addScaledVector(stray, (1 - slack / stray.length()) * (1 - Math.exp(-dt / LOOK_LAG)));
      }
      camera.lookAt(look);
      const zoomed = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(EYE_FOV) / 2) / live.current.zoom),
      );
      if (Math.abs(zoomed - camera.fov) > 0.01) {
        camera.fov = zoomed;
        camera.updateProjectionMatrix();
      }
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
          replay: replay && replayAt !== null ? {at: replayAt, end: replayEnd(replay.series), pickedUp} : null,
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
