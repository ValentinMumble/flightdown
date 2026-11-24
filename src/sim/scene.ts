import * as THREE from 'three';
import {HOVER_HEIGHT, PAD, PAD_RADIUS} from './drills';
import huey from '../components/charts/huey.json';
import type {Zone} from '../model/debrief';

// The sim's 3D scene: the Huey built from its zones, the field around the pad, the hover drill's box.

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
export function buildHeli(color: string) {
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
export function buildField(scene: THREE.Scene) {
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
export function buildHoverBox(scene: THREE.Scene) {
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
