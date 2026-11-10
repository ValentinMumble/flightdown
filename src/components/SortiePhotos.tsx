import {useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import type {Sortie} from '../types';
import type {AlbumPhoto} from '../model/album';
import {sortiePhotos, useAlbum} from '../data/album';
import {Card, SheetHead, useOverlay} from './ui';

/** One photo full size, with the sortie's others a swipe or an arrow away. */
function PhotoViewer({photos, start}: {photos: AlbumPhoto[]; start: number}) {
  const [index, setIndex] = useState(start);
  const photo = photos[index];
  const step = (by: number) => setIndex(current => (current + by + photos.length) % photos.length);
  return (
    <div className="photo-viewer">
      <SheetHead
        title={
          photo.caption ?? new Date(photo.takenAt).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})
        }
      />
      <img src={photo.full} alt={photo.caption ?? ''} referrerPolicy="no-referrer" />
      {photos.length > 1 && (
        <div className="photo-steps">
          <button className="icon-button" aria-label="Previous photo" onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <span className="muted">
            {index + 1} of {photos.length}
          </span>
          <button className="icon-button" aria-label="Next photo" onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

/** The sortie's photos from the shared album: the ones picked for it, or else the album's photos of its day. */
export function SortiePhotos({sortie}: {sortie: Sortie}) {
  const album = useAlbum();
  const {open} = useOverlay();
  const photos = sortiePhotos(sortie, album);
  if (!photos.length) return null;
  return (
    <Card className="span-12" title="Photos" sub={sortie.photos ? undefined : 'From the shared album, taken that day'}>
      <div className="photo-grid">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            className="photo-tile"
            onClick={() => open(<PhotoViewer photos={photos} start={index} />)}
          >
            <img src={photo.thumb} alt={photo.caption ?? ''} loading="lazy" referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>
    </Card>
  );
}
