/**
 * Sortie photos live in Apple Photos, in a shared album with its public website turned on. Its link
 * (https://www.icloud.com/sharedalbum/#B0…) is all Flightdown keeps; the photos are read from the same feed the
 * album's web page uses.
 */

/** A photo of the album, as the page shows it. Apple's addresses expire after a while: they are fetched again. */
export interface AlbumPhoto {
  /** Apple's id for the photo: what a sortie keeps. */
  id: string;
  /** When it was taken (ISO, UTC). */
  takenAt: string;
  width: number;
  height: number;
  /** A small version for lists, and the largest the album keeps. */
  thumb: string;
  full: string;
  caption?: string;
}

/** The token of a shared album's link ("B0aGWZuqDGKQQ5L"), or null when the text is not one. */
export function albumToken(link: string): string | null {
  const text = link.trim();
  const fromLink = /icloud\.com\/sharedalbum\/(?:[a-z-]+\/)?#([A-Za-z0-9]+)/.exec(text);
  if (fromLink) return fromLink[1];
  return /^[AB][A-Za-z0-9]{10,}$/.test(text) ? text : null;
}

interface StreamDerivative {
  checksum: string;
  width?: string | number;
  height?: string | number;
}

export interface StreamPhoto {
  photoGuid: string;
  dateCreated?: string;
  batchDateCreated?: string;
  width?: string | number;
  height?: string | number;
  caption?: string;
  mediaAssetType?: string;
  derivatives: Record<string, StreamDerivative>;
}

export interface AssetUrls {
  items: Record<string, {url_location: string; url_path: string}>;
  locations: Record<string, {scheme: string; hosts: string[]}>;
}

/**
 * The album's photos from Apple's two answers: the stream (photos and their sizes) and the addresses of each size.
 * Videos are left out: a sortie keeps photos.
 */
export function readAlbum(photos: StreamPhoto[], urls: AssetUrls): AlbumPhoto[] {
  const address = (checksum: string) => {
    const item = urls.items[checksum];
    if (!item) return null;
    const location = urls.locations[item.url_location];
    return `${location?.scheme ?? 'https'}://${location?.hosts[0] ?? item.url_location}${item.url_path}`;
  };
  const read: AlbumPhoto[] = [];
  for (const photo of photos) {
    if (photo.mediaAssetType === 'video') continue;
    const sizes = Object.values(photo.derivatives)
      .map(derivative => ({
        ...derivative,
        side: Math.max(Number(derivative.width) || 0, Number(derivative.height) || 0),
      }))
      .filter(derivative => address(derivative.checksum))
      .sort((left, right) => left.side - right.side);
    if (!sizes.length) continue;
    const largest = sizes[sizes.length - 1];
    const small = sizes.find(derivative => derivative.side >= 300) ?? largest;
    read.push({
      id: photo.photoGuid,
      takenAt: photo.dateCreated ?? photo.batchDateCreated ?? '',
      width: Number(largest.width) || Number(photo.width) || 0,
      height: Number(largest.height) || Number(photo.height) || 0,
      thumb: address(small.checksum)!,
      full: address(largest.checksum)!,
      ...(photo.caption && {caption: photo.caption}),
    });
  }
  return read.sort((left, right) => left.takenAt.localeCompare(right.takenAt));
}
