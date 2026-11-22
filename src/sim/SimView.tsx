import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {
  headingOf,
  hubHeight,
  restingState,
  rpmOf,
  step,
  type Controls,
  type HeliParams,
  type StepEvents,
} from './physics';
import {connectedPads, GameControllerSticks, isGameController, KeyboardSticks, readAxes, type Mapping} from './input';
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
}

/** The physics runs at this step, whatever the screen's frame rate. */
const STEP = 1 / 240;
/** The pilot's eyes. */
const EYES = new THREE.Vector3(0, 1.7, 0);

const HUEY = (huey as {zones: Partial<Record<Zone, number[]>>}).zones;

/** The Huey's zones drawn in the heli's colour, in metal, and as the rotor that spins; the motor added inside is not. */
const PAINTED: Zone[] = ['canopy', 'frame', 'boom', 'tail'];
const METAL: Zone[] = ['skids', 'shaft'];
const ROTOR: Zone[] = ['blades', 'head'];

/** The corners of some of the Huey's zones, as points. */
function corners(zones: Zone[]) {
  const points: THREE.Vector3[] = [];
  for (const zone of zones) {
    const list = HUEY[zone] ?? [];
    for (let index = 0; index + 2 < list.length; index += 3) {
      points.push(new THREE.Vector3(list[index], list[index + 1], list[index + 2]));
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
  const geometry = (zones: Zone[], originY: number) => {
    const points = corners(zones);
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
    mesh(shell, new THREE.MeshLambertMaterial({color, flatShading: true, side: THREE.DoubleSide})),
    mesh(geometry(METAL, floor), new THREE.MeshLambertMaterial({color: '#7d868e', flatShading: true})),
    // Its facets' edges, faintly, as the damage map draws them.
    new THREE.LineSegments(
      new THREE.EdgesGeometry(shell, 25),
      new THREE.LineBasicMaterial({color: '#1b1f22', transparent: true, opacity: 0.35}),
    ),
  );

  // The main rotor: its blades and head, and the disc the blades make once spinning.
  const rotor = new THREE.Group();
  rotor.position.y = (plane - floor) / radius;
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
  heli.add(rotor);
  return {heli, rotor, bladeMaterial, discMaterial};
}

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
  onInfo: (info: SimInfo) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef({wind, mapping, pad, onInfo});
  live.current = {wind, mapping, pad, onInfo};

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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 900);
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

    const typing = (event: KeyboardEvent) =>
      event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey) return;
      if (event.key.toLowerCase() === 'r') {
        state = start();
        drill = startDrill(kind, facing);
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
      const pads = connectedPads();
      const flown = pads[live.current.pad] ?? pads[0];
      if (flown) {
        controls = isGameController(flown)
          ? controller.read(flown, hoverStick)
          : readAxes(flown.axes, live.current.mapping);
      } else controls = keyboard.read(dt);

      // The wind from the left, gusting a third either way.
      const blowing = (live.current.wind / 3.6) * (1 + 0.35 * Math.sin(time * 0.7) * Math.sin(time * 0.23 + 1));
      const veer = 0.25 * Math.sin(time * 0.11);
      gust.set(Math.cos(veer), 0, Math.sin(veer)).multiplyScalar(blowing);

      const happened: StepEvents = {};
      for (spare += dt; spare >= STEP; spare -= STEP)
        Object.assign(happened, step(state, controls, params, gust, STEP));
      if (state.crashed) {
        crashedFor += dt;
        // Back on the pad once the motor is off (throttle hold, as after a real crash), or by itself after a while.
        if ((crashedFor > 1 && controls.throttle === 0) || crashedFor > 6) {
          state = start();
          crashedFor = 0;
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
      model.bladeMaterial.opacity = 1 - 0.75 * spin;
      model.discMaterial.opacity = 0.28 * spin;
      sun.position.copy(state.position).add(new THREE.Vector3(-6, 14, 5));
      sun.target.position.copy(state.position);
      if (hoverBox && drill.kind === 'hover') {
        hoverBox.material.color.set(drill.inside ? '#7ee0a0' : '#ffffff');
      }

      // The pilot's eyes follow the heli a little behind, so it moves in the view; the view narrows slowly with
      // distance so it stays a readable size.
      const aim = state.position.clone();
      aim.y += hubHeight(params) / 2;
      look.lerp(aim, 1 - Math.exp(-dt / 0.2));
      camera.lookAt(look);
      const distance = camera.position.distanceTo(aim);
      const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(2.6 / distance)), 12, 58);
      if (Math.abs(fov - camera.fov) > 0.05) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 1.5);
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);

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
  }, [params, color, kind, facing, restart]);

  if (failed) return <div className="sim-stage-failed">This browser cannot draw 3D (WebGL is off).</div>;
  return <div ref={holder} className="sim-canvas" />;
}
