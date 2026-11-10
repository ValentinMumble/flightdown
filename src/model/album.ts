/**
 * Sortie photos live in Apple Photos, in a shared album with its public website turned on. Its link is all Flightdown
 * keeps; the photos are read the way the album's web page reads them. Albums shared since 2025 have links like
 * https://photos.icloud.com/shared/album/006LQ… (read through CloudKit); older ones https://www.icloud.com/sharedalbum/#B0…
 * (read through Apple's shared streams).
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

export type AlbumLink = {kind: 'cloudkit' | 'stream'; token: string};

/** Which kind of shared album a link is, and its token; null when the text is not one. */
export function albumLink(link: string): AlbumLink | null {
  const text = link.trim();
  const shared = /icloud\.com\/shared\/album\/([A-Za-z0-9_-]{10,})/.exec(text);
  if (shared) return {kind: 'cloudkit', token: shared[1]};
  const stream = /icloud\.com\/sharedalbum\/(?:[a-z-]+\/)?#([A-Za-z0-9]+)/.exec(text);
  if (stream) return {kind: 'stream', token: stream[1]};
  if (/^0[A-Za-z0-9_-]{15,}$/.test(text)) return {kind: 'cloudkit', token: text};
  return /^[AB][A-Za-z0-9]{10,}$/.test(text) ? {kind: 'stream', token: text} : null;
}

/** The link kept for an album: its page, in the form Apple gave it. */
export const albumPage = ({kind, token}: AlbumLink) =>
  kind === 'cloudkit'
    ? `https://photos.icloud.com/shared/album/${token}`
    : `https://www.icloud.com/sharedalbum/#${token}`;

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

/** A CloudKit record, as its web services answer. */
export interface CloudRecord {
  recordName: string;
  recordType: string;
  fields: Record<string, {value: unknown; type?: string} | undefined>;
}

interface CloudAsset {
  downloadURL?: string;
}

/**
 * The album's photos from its CloudKit records: each photo (CPLAsset: when it was taken) points to its file
 * (CPLMaster: a thumbnail and a medium JPEG, with addresses that expire). Videos are left out.
 */
export function readCloudAlbum(records: CloudRecord[]): AlbumPhoto[] {
  const masters = new Map(
    records.filter(record => record.recordType === 'CPLMaster').map(record => [record.recordName, record]),
  );
  // Apple's addresses end with a slot for the file's name.
  const address = (asset: unknown) => (asset as CloudAsset | undefined)?.downloadURL?.replace('${f}', 'photo.jpg');
  const read: AlbumPhoto[] = [];
  for (const asset of records.filter(record => record.recordType === 'CPLAsset')) {
    const reference = asset.fields.masterRef?.value as {recordName?: string} | undefined;
    const master = reference?.recordName ? masters.get(reference.recordName) : undefined;
    if (!master || String(master.fields.itemType?.value ?? '').includes('movie')) continue;
    const thumb = address(master.fields.resJPEGThumbRes?.value);
    const full = address(master.fields.resJPEGMedRes?.value) ?? thumb;
    const taken = Number(asset.fields.assetDate?.value ?? master.fields.originalCreationDate?.value);
    if (!thumb || !full || !taken) continue;
    read.push({
      id: asset.recordName,
      takenAt: new Date(taken).toISOString(),
      width: Number(master.fields.resJPEGMedWidth?.value) || 0,
      height: Number(master.fields.resJPEGMedHeight?.value) || 0,
      thumb,
      full,
    });
  }
  return read.sort((left, right) => left.takenAt.localeCompare(right.takenAt));
}
