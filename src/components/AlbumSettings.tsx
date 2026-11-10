import {useState} from 'react';
import {Images} from 'lucide-react';
import {reloadAlbum, useAlbum} from '../data/album';
import {plural} from '../model/format';
import {Card, useOverlay} from './ui';

/**
 * Where the sorties' photos live: an iCloud shared album with its public website on. Its link is kept on the server;
 * the album itself stays in Apple Photos.
 */
export function AlbumSettings() {
  const album = useAlbum();
  const {toast} = useOverlay();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (value: string) => {
    setBusy(true);
    const answer = await fetch('/api/album', {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({link: value}),
    }).catch(() => null);
    const body = await answer?.json().catch(() => null);
    setBusy(false);
    if (!answer?.ok) return toast(body?.error ?? 'Could not reach the server');
    setLink('');
    toast(value ? `${body.name}: ${plural(body.count, 'photo')}` : 'Album forgotten');
    void reloadAlbum();
  };

  return (
    <Card className="span-6" title="Photos" sub="Sortie photos stay in Apple Photos, in a shared album">
      {album.status === 'ready' && (
        <p className="caption" style={{marginTop: 0}}>
          <Images size={14} style={{verticalAlign: -2}} /> {album.album.name} ·{' '}
          {plural(album.album.photos.length, 'photo')} ·{' '}
          <a href={album.album.link} target="_blank" rel="noreferrer" className="link">
            open
          </a>
        </p>
      )}
      {album.status === 'loading' && <p className="caption">Reading the album…</p>}
      {album.status === 'failed' && <p className="caption">{album.message}</p>}
      {album.status === 'missing' && (
        <p className="caption">
          In Photos: make a shared album, turn on Public Website in its settings, then paste its link here. Photos taken
          on a sortie's day show on that sortie.
        </p>
      )}
      <form
        className="location-row"
        onSubmit={event => {
          event.preventDefault();
          if (link.trim()) void save(link.trim());
        }}
      >
        <input
          className="input"
          placeholder="https://www.icloud.com/sharedalbum/#…"
          value={link}
          onChange={event => setLink(event.target.value)}
          aria-label="Shared album link"
        />
        <button className="button" disabled={busy}>
          {busy ? 'Reading…' : 'Save'}
        </button>
        {album.status === 'ready' && (
          <button type="button" className="button" onClick={() => void save('')}>
            Forget
          </button>
        )}
      </form>
    </Card>
  );
}
