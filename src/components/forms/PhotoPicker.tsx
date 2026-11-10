import {Check} from 'lucide-react';
import {photoDay, useAlbum} from '../../data/album';

/**
 * The shared album's photos from a sortie's day, to keep or leave out with a tap. Until one is tapped, the sortie
 * keeps them all (picked is null); after, it keeps the ones ticked.
 */
export function PhotoPicker({
  day,
  picked,
  onChange,
}: {
  day: string;
  picked: string[] | null;
  onChange: (next: string[]) => void;
}) {
  const album = useAlbum();
  if (album.status === 'none') return null;

  let body;
  if (album.status === 'loading') body = <p className="muted">Reading the album…</p>;
  else if (album.status === 'failed') body = <p className="muted">{album.message}</p>;
  else if (album.status === 'missing') {
    body = <p className="muted">Add your shared album in Settings to pick this day's photos.</p>;
  } else {
    const ofDay = album.album.photos.filter(photo => photoDay(photo) === day);
    const others = (picked ?? []).flatMap(
      id => album.album.photos.find(photo => photo.id === id && !ofDay.includes(photo)) ?? [],
    );
    const shown = [...ofDay, ...others];
    const isPicked = (id: string) => (picked ? picked.includes(id) : ofDay.some(photo => photo.id === id));
    body = shown.length ? (
      <div className="photo-picker">
        {shown.map(photo => (
          <button
            key={photo.id}
            type="button"
            className="photo-pick"
            aria-pressed={isPicked(photo.id)}
            aria-label={photo.caption ?? 'Photo'}
            onClick={() => {
              const current = picked ?? ofDay.map(one => one.id);
              onChange(current.includes(photo.id) ? current.filter(id => id !== photo.id) : [...current, photo.id]);
            }}
          >
            <img src={photo.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
            {isPicked(photo.id) && (
              <span className="photo-tick">
                <Check size={13} strokeWidth={3} />
              </span>
            )}
          </button>
        ))}
      </div>
    ) : (
      <p className="muted">
        No photo from that day in {album.album.name}. Add some in Photos: share them to the album, and they show here.
      </p>
    );
  }

  return (
    <div className="field">
      <span className="field-label">Photos</span>
      {body}
    </div>
  );
}
