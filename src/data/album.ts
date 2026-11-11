import {useEffect, useState} from 'react';
import type {Sortie} from '../types';
import type {AlbumPhoto} from '../model/album';
import {toDay} from '../model/format';
import {useStore} from './store';

export interface Album {
  link: string;
  name: string;
  photos: AlbumPhoto[];
}

export type AlbumState =
  | {status: 'none'}
  | {status: 'loading'}
  | {status: 'missing'}
  | {status: 'failed'; message: string}
  | {status: 'ready'; album: Album};

/** Read again after this: Apple's photo addresses expire after a few hours. */
const FRESH = 20 * 60 * 1000;

let copy: {at: number; state: AlbumState} | null = null;
let reading: Promise<AlbumState> | null = null;
const listeners = new Set<(state: AlbumState) => void>();

async function read(): Promise<AlbumState> {
  const answer = await fetch('/api/album').catch(() => null);
  if (!answer) return {status: 'failed', message: 'The server could not be reached, so the album was not read.'};
  const body = await answer.json().catch(() => null);
  if (answer.status === 404) return {status: 'missing'};
  if (!answer.ok) return {status: 'failed', message: body?.error ?? `The server answered ${answer.status}`};
  return {status: 'ready', album: body as Album};
}

/** Reads the album (again), and tells every page that shows it. */
export function reloadAlbum() {
  reading ??= read().then(state => {
    copy = {at: Date.now(), state};
    reading = null;
    for (const listener of listeners) listener(state);
    return state;
  });
  return reading;
}

/**
 * The shared album of the sorties' photos, read once for every page and again when it gets old. Only the owner's log
 * has one.
 */
export function useAlbum(): AlbumState {
  const {mode} = useStore();
  const [state, setState] = useState<AlbumState>(() =>
    mode === 'owner' ? (copy?.state ?? {status: 'loading'}) : {status: 'none'},
  );

  useEffect(() => {
    if (mode !== 'owner') {
      setState({status: 'none'});
      return;
    }
    listeners.add(setState);
    if (copy) setState(copy.state);
    if (!copy || Date.now() - copy.at > FRESH) void reloadAlbum();
    return () => {
      listeners.delete(setState);
    };
  }, [mode]);

  return state;
}

/** The day a photo was taken, in this browser's time zone, as the sorties count days. */
export const photoDay = (photo: AlbumPhoto) => (photo.takenAt ? toDay(new Date(photo.takenAt)) : '');

/** A sortie's photos: the ones picked for it, or else the album's photos taken that day. */
export function sortiePhotos(sortie: Sortie, state: AlbumState): AlbumPhoto[] {
  if (state.status !== 'ready') return [];
  const {photos} = state.album;
  if (sortie.photos) return sortie.photos.flatMap(id => photos.find(photo => photo.id === id) ?? []);
  return photos.filter(photo => photoDay(photo) === sortie.date);
}
