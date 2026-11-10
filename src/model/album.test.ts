import {describe, expect, it} from 'vitest';
import {albumLink, readAlbum, readCloudAlbum, type AssetUrls, type CloudRecord, type StreamPhoto} from './album';

describe('albumLink', () => {
  it('reads the links of albums shared since 2025', () => {
    expect(albumLink('https://photos.icloud.com/shared/album/006LQqDlNZv0QAHFC2VpA0xQg')).toEqual({
      kind: 'cloudkit',
      token: '006LQqDlNZv0QAHFC2VpA0xQg',
    });
  });

  it('reads the older links', () => {
    expect(albumLink('https://www.icloud.com/sharedalbum/#B0aGWZuqDGKQQ5L')).toEqual({
      kind: 'stream',
      token: 'B0aGWZuqDGKQQ5L',
    });
    expect(albumLink('https://www.icloud.com/sharedalbum/fr-fr/#B0aGWZuqDGKQQ5L')?.token).toBe('B0aGWZuqDGKQQ5L');
    expect(albumLink(' B0aGWZuqDGKQQ5L ')?.kind).toBe('stream');
  });

  it('refuses what is not one', () => {
    expect(albumLink('https://www.icloud.com/photos/#0abc')).toBeNull();
    expect(albumLink('Flightdown')).toBeNull();
  });
});

describe('readCloudAlbum', () => {
  const zone = {zoneName: 'SharedCollection-1'};
  const records: CloudRecord[] = [
    {
      recordName: 'asset-later',
      recordType: 'CPLAsset',
      fields: {assetDate: {value: 1754834400000}, masterRef: {value: {recordName: 'master-later', zoneID: zone}}},
    },
    {
      recordName: 'master-later',
      recordType: 'CPLMaster',
      fields: {
        itemType: {value: 'public.heic'},
        resJPEGThumbRes: {value: {downloadURL: 'https://cvws.icloud-content.com/B/thumb/${f}?o=1'}},
        resJPEGMedRes: {value: {downloadURL: 'https://cvws.icloud-content.com/B/medium/${f}?o=1'}},
        resJPEGMedWidth: {value: 2048},
        resJPEGMedHeight: {value: 1536},
      },
    },
    {
      recordName: 'asset-clip',
      recordType: 'CPLAsset',
      fields: {assetDate: {value: 1754830000000}, masterRef: {value: {recordName: 'master-clip'}}},
    },
    {
      recordName: 'master-clip',
      recordType: 'CPLMaster',
      fields: {
        itemType: {value: 'com.apple.quicktime-movie'},
        resJPEGThumbRes: {value: {downloadURL: 'https://x/${f}'}},
      },
    },
    {
      recordName: 'asset-earlier',
      recordType: 'CPLAsset',
      fields: {assetDate: {value: 1754820000000}, masterRef: {value: {recordName: 'master-earlier'}}},
    },
    {
      recordName: 'master-earlier',
      recordType: 'CPLMaster',
      fields: {itemType: {value: 'public.jpeg'}, resJPEGThumbRes: {value: {downloadURL: 'https://x/thumb/${f}'}}},
    },
  ];

  it('pairs each photo with its file, oldest first, and leaves videos out', () => {
    expect(readCloudAlbum(records)).toEqual([
      {
        id: 'asset-earlier',
        takenAt: '2025-08-10T10:00:00.000Z',
        width: 0,
        height: 0,
        thumb: 'https://x/thumb/photo.jpg',
        full: 'https://x/thumb/photo.jpg',
      },
      {
        id: 'asset-later',
        takenAt: '2025-08-10T14:00:00.000Z',
        width: 2048,
        height: 1536,
        thumb: 'https://cvws.icloud-content.com/B/thumb/photo.jpg?o=1',
        full: 'https://cvws.icloud-content.com/B/medium/photo.jpg?o=1',
      },
    ]);
  });
});

describe('readAlbum', () => {
  const photos: StreamPhoto[] = [
    {
      photoGuid: 'later',
      dateCreated: '2025-08-10T14:02:00Z',
      derivatives: {
        '342': {checksum: 'small-later', width: '342', height: '256'},
        '2049': {checksum: 'large-later', width: '2049', height: '1536'},
      },
    },
    {
      photoGuid: 'earlier',
      dateCreated: '2025-08-10T13:40:00Z',
      caption: 'Over the field',
      derivatives: {'1536': {checksum: 'only-earlier', width: '1536', height: '2048'}},
    },
    {photoGuid: 'clip', mediaAssetType: 'video', derivatives: {'720p': {checksum: 'video'}}},
    {photoGuid: 'missing', derivatives: {'342': {checksum: 'not-served'}}},
  ];
  const urls: AssetUrls = {
    items: {
      'small-later': {url_location: 'cvws', url_path: '/s/later?x=1'},
      'large-later': {url_location: 'cvws', url_path: '/l/later?x=1'},
      'only-earlier': {url_location: 'cvws', url_path: '/l/earlier?x=1'},
      video: {url_location: 'cvws', url_path: '/v'},
    },
    locations: {cvws: {scheme: 'https', hosts: ['cvws.icloud-content.com']}},
  };

  it('keeps the photos, oldest first, with a small and a large size', () => {
    expect(readAlbum(photos, urls)).toEqual([
      {
        id: 'earlier',
        takenAt: '2025-08-10T13:40:00Z',
        width: 1536,
        height: 2048,
        thumb: 'https://cvws.icloud-content.com/l/earlier?x=1',
        full: 'https://cvws.icloud-content.com/l/earlier?x=1',
        caption: 'Over the field',
      },
      {
        id: 'later',
        takenAt: '2025-08-10T14:02:00Z',
        width: 2049,
        height: 1536,
        thumb: 'https://cvws.icloud-content.com/s/later?x=1',
        full: 'https://cvws.icloud-content.com/l/later?x=1',
      },
    ]);
  });
});
