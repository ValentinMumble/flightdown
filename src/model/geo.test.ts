import {describe, expect, it} from 'vitest';
import {parseLocation, worldPixel} from './geo';

describe('parseLocation', () => {
  it('reads a plain pair', () => {
    expect(parseLocation('47.218371, -1.553621')).toEqual({lat: 47.218371, lng: -1.553621});
    expect(parseLocation(' 48.8566,2.3522 ')).toEqual({lat: 48.8566, lng: 2.3522});
  });

  it('reads Google Maps links, the pin before the view', () => {
    expect(parseLocation('https://www.google.com/maps/@47.2184,-1.5536,17z')).toEqual({lat: 47.2184, lng: -1.5536});
    expect(
      parseLocation('https://www.google.com/maps/place/X/@47.2,-1.6,15z/data=!3m1!4b1!4m6!3m5!3d47.2184!4d-1.5536'),
    ).toEqual({lat: 47.2184, lng: -1.5536});
    expect(parseLocation('https://maps.google.com/?q=47.2184,-1.5536')).toEqual({lat: 47.2184, lng: -1.5536});
  });

  it('reads Apple Maps links', () => {
    expect(parseLocation('https://maps.apple.com/?ll=47.2184,-1.5536&q=Field')).toEqual({lat: 47.2184, lng: -1.5536});
    expect(parseLocation('https://maps.apple.com/?coordinate=47.2184%2C-1.5536')).toEqual({
      lat: 47.2184,
      lng: -1.5536,
    });
  });

  it('reads geo links', () => {
    expect(parseLocation('geo:47.74197,-3.40216')).toEqual({lat: 47.74197, lng: -3.40216});
  });

  it('refuses what is not a place', () => {
    expect(parseLocation('Port Barbe')).toBeNull();
    expect(parseLocation('95, 10')).toBeNull();
    expect(parseLocation('')).toBeNull();
  });
});

describe('worldPixel', () => {
  it('puts the equator and the prime meridian in the middle of the world', () => {
    expect(worldPixel({lat: 0, lng: 0}, 1)).toEqual({x: 256, y: 256});
  });
});
