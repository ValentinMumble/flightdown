import {useEffect, useRef, useState, type ReactNode} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {ZONES, type Zone} from '../../model/debrief';
import huey from './huey.json';

/**
 * The heli drawn: a low-poly Huey (assets/huey, by Sami, CC BY 4.0), its triangles sorted into the damage zones by
 * scripts/huey.ts, a main motor added inside. It has no servos to show: their breaks stay in the list.
 */
const MODEL = huey as {zones: Partial<Record<Zone, number[]>>};

/** Edges between faces meeting at more than this angle (degrees) are drawn: the model's facets, not its every triangle. */
const EDGE_ANGLE = 25;
/** The camera looks at the heli from the front left and a little above; it turns about the heli's middle. */
const VIEW = new THREE.Vector3(-0.42, 0.21, 0.88).normalize();
const FIELD = 30;

/** The focused part's lines, the page's ink. */
const FOCUS = '#e9ecef';

/**
 * The heli in 3D, each part lit by how often it broke (`colors`, its heat; `counts`, floating over it). It turns slowly
 * until it is dragged; hovering or tapping a part focuses it (`onFocus`). Without WebGL, `fallback` shows instead.
 */
export default function DamageModel({
  colors,
  counts,
  focus,
  onFocus,
  fallback,
}: {
  colors: Record<Zone, string>;
  counts: Record<Zone, number>;
  focus: Zone | null;
  onFocus: (zone: Zone | null) => void;
  fallback: ReactNode;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<Zone, HTMLSpanElement | null>>>({});
  const materials = useRef<Partial<Record<Zone, {fill: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial}>>>({});
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.prepend(renderer.domElement);

    // Each zone the model has: its triangles, filled faintly, their edges drawn; the spot its count floats at, over it.
    const scene = new THREE.Scene();
    const solids: THREE.Mesh[] = [];
    const anchors = new Map<Zone, THREE.Vector3>();
    const made: {dispose: () => void}[] = [];
    for (const {key} of ZONES) {
      const corners = MODEL.zones[key];
      if (!corners?.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
      const fill = new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide});
      const line = new THREE.LineBasicMaterial({transparent: true});
      materials.current[key] = {fill, line};
      const solid = new THREE.Mesh(geometry, fill);
      solid.userData.zone = key;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, EDGE_ANGLE), line);
      scene.add(solid, outline);
      solids.push(solid);
      made.push(geometry, outline.geometry, fill, line);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      anchors.set(key, new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 10, (box.min.z + box.max.z) / 2));
    }

    // The camera turns about the heli's middle, far enough for the whole of it, blades included, at every angle.
    const whole = new THREE.Box3().setFromObject(scene);
    const middle = whole.getCenter(new THREE.Vector3());
    // How far it reaches from the line it turns about, at most: half the width it can take on screen.
    let across = 0;
    for (const corners of Object.values(MODEL.zones)) {
      for (let index = 0; index < corners.length; index += 3) {
        across = Math.max(across, Math.hypot(corners[index] - middle.x, corners[index + 2] - middle.z));
      }
    }
    const tall = (whole.max.y - whole.min.y) / 2;
    const camera = new THREE.PerspectiveCamera(FIELD, 1, 10, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(middle);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.rotateSpeed = 0.6;
    controls.minPolarAngle = 0.55;
    controls.maxPolarAngle = 1.9;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.8;
    // Once turned by hand, it stays where it was left.
    controls.addEventListener('start', () => (controls.autoRotate = false));
    // On a phone a swipe up or down still scrolls the page; a sideways one turns the heli.
    renderer.domElement.style.touchAction = 'pan-y';

    // A tap (a press that hardly moved) or a hover picks the part under the pointer.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const hit = (event: PointerEvent): Zone | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(solids, false);
      // The main motor sits inside the cabin: a ray through it picks it, not the shell in front of it.
      const inside = hits.find(found => found.object.userData.zone === 'motor');
      return ((inside ?? hits[0])?.object.userData.zone as Zone | undefined) ?? null;
    };
    let pressedAt: {x: number; y: number} | null = null;
    const onDown = (event: PointerEvent) => (pressedAt = {x: event.clientX, y: event.clientY});
    const onUp = (event: PointerEvent) => {
      if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) < 6) {
        focusRef.current(hit(event));
      }
      pressedAt = null;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && !pressedAt) focusRef.current(hit(event));
    };
    const onLeave = () => focusRef.current(null);
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    // On a resize, the camera steps back as far as the screen's shape needs to keep the whole heli in sight.
    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const slope = Math.tan(THREE.MathUtils.degToRad(FIELD / 2));
      const distance = Math.max(across / (slope * camera.aspect), tall / slope) * 1.08;
      const direction = camera.position.lengthSq() ? camera.position.clone().sub(middle).normalize() : VIEW;
      camera.position.copy(middle).addScaledVector(direction, distance);
    };
    const sizes = new ResizeObserver(resize);
    sizes.observe(host);
    resize();

    // Drawn only while on screen; each frame moves the counts over their parts.
    const spot = new THREE.Vector3();
    let frame = 0;
    let shown = false;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      const width = host.clientWidth;
      const height = host.clientHeight;
      for (const [zone, anchor] of anchors) {
        const label = labels.current[zone];
        if (!label) continue;
        spot.copy(anchor).project(camera);
        label.style.transform = `translate(${((spot.x + 1) / 2) * width}px, ${((1 - spot.y) / 2) * height}px) translate(-50%, -50%)`;
        // Hidden until first placed, and while its spot is behind the camera.
        label.style.visibility = spot.z < 1 ? 'visible' : 'hidden';
      }
      if (shown) frame = requestAnimationFrame(draw);
    };
    const seen = new IntersectionObserver(([entry]) => {
      shown = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (shown) frame = requestAnimationFrame(draw);
    });
    seen.observe(host);

    return () => {
      shown = false;
      cancelAnimationFrame(frame);
      seen.disconnect();
      sizes.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      for (const item of made) item.dispose();
      renderer.dispose();
      canvas.remove();
      materials.current = {};
    };
  }, []);

  // Each part in its heat, its fill stronger once it broke; the focused one's lines in ink.
  useEffect(() => {
    for (const {key} of ZONES) {
      const material = materials.current[key];
      if (!material) continue;
      material.fill.color.set(colors[key]);
      material.fill.opacity = key === focus ? 0.32 : counts[key] ? 0.16 : 0.05;
      material.line.color.set(key === focus ? FOCUS : colors[key]);
      material.line.opacity = counts[key] || key === focus ? 1 : 0.7;
    }
  }, [colors, counts, focus, failed]);

  if (failed) return <>{fallback}</>;
  return (
    <div ref={holder} className="damage-model" role="img" aria-label="Broken parts by part of the heli, in 3D">
      {ZONES.map(({key}) =>
        counts[key] && MODEL.zones[key]?.length ? (
          <span
            key={key}
            ref={element => {
              labels.current[key] = element;
            }}
            className="damage-model-count"
          >
            {counts[key]}
          </span>
        ) : null,
      )}
    </div>
  );
}
