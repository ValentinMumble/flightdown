import {describe, expect, it} from 'vitest';
import {albumToken, readAlbum, type AssetUrls, type StreamPhoto} from './album';

describe('albumToken', () => {
  it('reads the token of a shared album link', () => {
    expect(albumToken('https://www.icloud.com/sharedalbum/#B0aGWZuqDGKQQ5L')).toBe('B0aGWZuqDGKQQ5L');
    expect(albumToken('https://www.icloud.com/sharedalbum/fr-fr/#B0aGWZuqDGKQQ5L')).toBe('B0aGWZuqDGKQQ5L');
    expect(albumToken(' B0aGWZuqDGKQQ5L ')).toBe('B0aGWZuqDGKQQ5L');
  });

  it('refuses what is not one', () => {
    expect(albumToken('https://www.icloud.com/photos/#0abc')).toBeNull();
    expect(albumToken('Flightdown')).toBeNull();
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
