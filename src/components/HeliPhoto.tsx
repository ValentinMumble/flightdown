import {useEffect, useState} from 'react';
import {cutOut} from '../model/cutout';

/** The longest side the cut-out is drawn at: sharp on a phone, quick to cut. */
const LONGEST = 900;

/** Cut-outs already made this visit, by photo URL: null when the photo could not be cut out. */
const done = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function loadImage(source: string, shared: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (shared) image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The photo did not load'));
    image.src = source;
  });
}

async function cutFrom(image: HTMLImageElement) {
  const scale = Math.min(1, LONGEST / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  // Throws when the host does not let the page read the pixels.
  const pixels = context.getImageData(0, 0, width, height);
  const box = cutOut(pixels);
  if (!box) return null;
  context.putImageData(pixels, 0, 0);
  const pad = Math.round(Math.max(box.width, box.height) * 0.02);
  const out = document.createElement('canvas');
  out.width = box.width + pad * 2;
  out.height = box.height + pad * 2;
  out.getContext('2d')?.drawImage(canvas, box.left, box.top, box.width, box.height, pad, pad, box.width, box.height);
  const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'));
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * The photo without its white background. The owner's photos come lifted on the Mac by Vision (`npm run cutouts`);
 * others are cut out here, read straight from their host when it allows it, else through /api/photo (owner's log
 * only). Null when nothing works or the photo is not on white.
 */
export function cutout(url: string) {
  const known = pending.get(url);
  if (known) return known;
  const run = async () => {
    const lifted = `/api/photo?cut=1&url=${encodeURIComponent(url)}`;
    const ready = await loadImage(lifted, false).then(
      () => true,
      () => false,
    );
    if (ready) return lifted;
    const sources: [string, boolean][] = [
      [url, true],
      [`/api/photo?url=${encodeURIComponent(url)}`, false],
    ];
    for (const [source, shared] of sources) {
      try {
        return await cutFrom(await loadImage(source, shared));
      } catch {
        // Try the next way in.
      }
    }
    return null;
  };
  const promise = run().then(result => {
    done.set(url, result);
    return result;
  });
  pending.set(url, promise);
  return promise;
}

/**
 * A heli's photo, cut out of its white background so it stands on the dark panels. A photo that cannot be cut out
 * shows as it is, on a light plate.
 */
export function HeliPhoto({url, alt = ''}: {url: string; alt?: string}) {
  const [cut, setCut] = useState<string | null | undefined>(() => done.get(url));

  useEffect(() => {
    let current = true;
    setCut(done.get(url));
    if (!done.has(url)) {
      void cutout(url).then(result => {
        if (current) setCut(result);
      });
    }
    return () => {
      current = false;
    };
  }, [url]);

  if (cut === undefined) return <span className="heli-photo waiting" aria-hidden />;
  if (cut === null) return <img src={url} alt={alt} className="heli-photo plain" referrerPolicy="no-referrer" />;
  return <img src={cut} alt={alt} className="heli-photo cut" />;
}
