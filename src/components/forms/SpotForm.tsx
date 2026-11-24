import {useState} from 'react';
import {Link} from 'react-router';
import {ChevronRight, LocateFixed, X} from 'lucide-react';
import type {Spot} from '../../types';
import {useStore} from '../../data/store';
import {newId} from '../../model/ids';
import {plural} from '../../model/format';
import {formatLocation, hasLocation, parseLocation, type LatLng} from '../../model/geo';
import {SheetHead, useOverlay} from '../ui';
import {LocationPicker} from '../LazyMaps';
import {Actions} from './Actions';
import {call} from '../../data/http';

/** A new spot, or one renamed, placed on the map, or merged into another: its sorties move there. */
export function SpotForm({spot}: {spot?: Spot}) {
  const {doc, put, patch, remove} = useStore();
  const {close, toast} = useOverlay();
  const [name, setName] = useState(spot?.name ?? '');
  const [emoji, setEmoji] = useState(spot?.emoji ?? '');
  const [notes, setNotes] = useState(spot?.notes ?? '');
  const [into, setInto] = useState('');
  const [where, setWhere] = useState<LatLng | null>(hasLocation(spot) ? {lat: spot.lat, lng: spot.lng} : null);
  const [typed, setTyped] = useState('');
  const [finding, setFinding] = useState(false);
  const sorties = spot ? doc.sorties.filter(sortie => sortie.spotId === spot.id) : [];

  const [reading, setReading] = useState(false);

  const readTyped = (text: string) => {
    setTyped(text);
    const found = parseLocation(text);
    if (found) setWhere(found);
  };
  /** Goes to what was pasted: coordinates at once, a shared Maps link (no coordinates in it) through /api/place. */
  const goTo = async (text: string) => {
    const input = text.trim();
    if (!input) return;
    const found = parseLocation(input);
    if (found) return setWhere(found);
    if (!/^https?:\/\//i.test(input)) return toast('Paste coordinates like 47.21, -1.55, or a Maps link');
    setReading(true);
    try {
      const answer = await call(`/api/place?url=${encodeURIComponent(input)}`);
      const body = await answer.json().catch(() => null);
      if (!answer.ok) throw new Error(body?.error ?? 'Could not read this link');
      setWhere(body as LatLng);
      setTyped('');
    } catch (failure) {
      toast((failure as Error).message);
    } finally {
      setReading(false);
    }
  };
  const findMe = () => {
    if (!navigator.geolocation) return toast('This browser cannot tell where you are');
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setFinding(false);
        setTyped('');
        setWhere({
          lat: Math.round(position.coords.latitude * 1e6) / 1e6,
          lng: Math.round(position.coords.longitude * 1e6) / 1e6,
        });
      },
      () => {
        setFinding(false);
        toast('Could not find where you are');
      },
      {enableHighAccuracy: true, timeout: 15000},
    );
  };

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        if (spot && into) {
          for (const sortie of sorties) patch('sorties', sortie.id, {spotId: into});
          remove('spots', spot.id);
          close();
          toast(`Merged ${sorties.length} sorties`);
          return;
        }
        if (!name.trim() && !spot) return toast('Give the spot a name');
        put('spots', {
          id: spot?.id ?? newId(),
          name: name.trim() || spot?.name || 'Spot',
          ...(emoji.trim() && {emoji: emoji.trim()}),
          ...(notes.trim() && {notes: notes.trim()}),
          ...(where && {lat: where.lat, lng: where.lng}),
        });
        close();
        toast('Spot saved');
      }}
    >
      <SheetHead title={spot ? `Edit ${spot.name}` : 'New spot'} />
      <div className="field-row" style={{gridTemplateColumns: '80px 1fr'}}>
        <div className="field">
          <label htmlFor="spot-emoji">Emoji</label>
          <input id="spot-emoji" className="input" value={emoji} onChange={event => setEmoji(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="spot-name">Name</label>
          <input id="spot-name" className="input" value={name} onChange={event => setName(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="spot-where">Location</label>
        <LocationPicker value={where} onChange={setWhere} others={doc.spots.filter(one => one.id !== spot?.id)} />
        <div className="location-row">
          <input
            id="spot-where"
            className="input"
            inputMode="text"
            placeholder="Tap the map, or paste 47.21, -1.55 or a Maps link"
            value={typed || (where ? formatLocation(where) : '')}
            disabled={reading}
            onChange={event => readTyped(event.target.value)}
            onPaste={event => {
              const pasted = event.clipboardData.getData('text');
              if (!parseLocation(pasted) && /^\s*https?:\/\//i.test(pasted)) void goTo(pasted);
            }}
            onKeyDown={event => {
              // Enter goes to the place typed; the sheet saves with its button.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void goTo(typed);
            }}
          />
          <button type="button" className="button" onClick={findMe} disabled={finding}>
            <LocateFixed size={15} /> {finding ? 'Finding…' : 'Here'}
          </button>
          {where && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear the location"
              onClick={() => {
                setWhere(null);
                setTyped('');
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="spot-notes">Notes</label>
        <textarea
          id="spot-notes"
          className="input"
          style={{minHeight: 60}}
          placeholder="Where to park, when the farmer mows"
          value={notes}
          onChange={event => setNotes(event.target.value)}
        />
      </div>
      {spot && sorties.length > 0 && (
        <Link to={`/sorties?spot=${spot.id}`} className="button small ghost" onClick={close}>
          {plural(sorties.length, 'sortie')} here <ChevronRight size={14} />
        </Link>
      )}
      {spot && (
        <div className="field">
          <label htmlFor="spot-into">Merge its {plural(sorties.length, 'sortie')} into</label>
          <select
            id="spot-into"
            className="input"
            style={{width: '100%'}}
            value={into}
            onChange={event => setInto(event.target.value)}
          >
            <option value="">Keep it apart</option>
            {doc.spots
              .filter(one => one.id !== spot.id)
              .map(one => (
                <option key={one.id} value={one.id}>
                  {one.emoji} {one.name}
                </option>
              ))}
          </select>
        </div>
      )}
      <Actions
        label={into ? 'Merge' : 'Save'}
        onDelete={
          !spot || sorties.length
            ? undefined
            : () => {
                remove('spots', spot.id);
                close();
              }
        }
      />
    </form>
  );
}
