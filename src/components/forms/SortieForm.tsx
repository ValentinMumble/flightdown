import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router';
import {ChevronDown, ChevronUp, Minus, Plus, Trash, X} from 'lucide-react';
import type {BrokenPart, Sortie, Spot} from '../../types';
import {useStore} from '../../data/store';
import {newId, now} from '../../model/ids';
import {formatAirtime, formatTimer, parseTimer, today} from '../../model/format';
import {partKey, partSuggestions} from '../../model/parts';
import {SKILLS} from '../../model/skills';
import {sortSorties} from '../../model/stats';
import {HeliDot, SheetHead, Stepper, useOverlay} from '../ui';
import {PhotoPicker} from './PhotoPicker';

/** The spots shown before "more": the ones flown last. */
const SPOTS_SHOWN = 6;
/** The minus and plus of the pack time move it this many seconds. */
const TIMER_STEP = 15;

/** Logs a sortie, or edits one: built to be quick at the field, on a phone, with one hand. */
export function SortieForm({sortie}: {sortie?: Sortie}) {
  const {doc, put, remove, heli: findHeli} = useStore();
  const {close, toast} = useOverlay();
  const navigate = useNavigate();
  const sorted = useMemo(() => sortSorties(doc.sorties), [doc.sorties]);
  const last = sorted[sorted.length - 1];

  const [date, setDate] = useState(sortie?.date ?? today());
  const [heliId, setHeliId] = useState(sortie?.heliId ?? last?.heliId ?? doc.helis[0]?.id ?? '');
  const [spotId, setSpotId] = useState<string | undefined>(sortie?.spotId ?? last?.spotId);
  const [newSpot, setNewSpot] = useState('');
  const [everySpot, setEverySpot] = useState(false);
  const [packs, setPacks] = useState(sortie?.packs ?? last?.packs ?? 3);
  const [timer, setTimer] = useState(
    formatTimer(sortie ? sortie.timer : (findHeli(heliId)?.timer ?? null)).replace('?', ''),
  );
  const [crashes, setCrashes] = useState<number | null>(sortie ? sortie.crashes : 0);
  const [broken, setBroken] = useState<BrokenPart[]>(sortie?.broken ?? []);
  const [partText, setPartText] = useState('');
  const [skills, setSkills] = useState<string[]>(sortie?.skills ?? []);
  const [notes, setNotes] = useState(sortie?.notes ?? '');
  const [links, setLinks] = useState((sortie?.links ?? []).join('\n'));
  const [photos, setPhotos] = useState<string[] | null>(sortie?.photos ?? null);

  // Helis still flying first; sold and lost ones only when this sortie is theirs.
  const helis = doc.helis.filter(
    one => one.status === 'active' || one.status === 'grounded' || one.id === heliId || one.status === 'retired',
  );
  // Spots flown last first (by their place in the log, so two sorties on one day keep their order), never flown last.
  const spots = useMemo(() => {
    const lastUse = new Map<string, number>();
    for (const [index, one] of sorted.entries()) if (one.spotId) lastUse.set(one.spotId, index);
    return [...doc.spots].sort((left, right) => (lastUse.get(right.id) ?? -1) - (lastUse.get(left.id) ?? -1));
  }, [doc.spots, sorted]);
  // The chosen spot always shows, even when it is not one of the last flown.
  const shownSpots = everySpot ? spots : spots.filter((spot, index) => index < SPOTS_SHOWN || spot.id === spotId);
  const suggestions = partSuggestions(heliId, doc.sorties, doc.spares)
    .filter(name => !broken.some(part => partKey(part.part) === partKey(name)))
    .slice(0, 10);
  const otherSkills = [...new Set(doc.sorties.flatMap(one => one.skills))].filter(skill => !SKILLS.includes(skill));
  const seconds = parseTimer(timer);
  const nudgeTimer = (by: number) => setTimer(formatTimer(Math.max(TIMER_STEP, (seconds ?? 0) + by)));

  const pickHeli = (id: string) => {
    setHeliId(id);
    const remembered = findHeli(id)?.timer;
    if (!sortie && remembered) setTimer(formatTimer(remembered));
  };

  const addPart = (name: string) => {
    const part = name.trim();
    if (!part) return;
    setBroken(current => {
      const known = current.find(item => partKey(item.part) === partKey(part));
      return known
        ? current.map(item => (item === known ? {...item, qty: item.qty + 1} : item))
        : [...current, {part, qty: 1}];
    });
    setPartText('');
    if (crashes === 0) setCrashes(1);
  };

  const save = () => {
    let chosenSpot = spotId;
    const typed = newSpot.trim();
    if (typed) {
      const known = doc.spots.find(spot => spot.name.toLowerCase() === typed.toLowerCase());
      if (known) chosenSpot = known.id;
      else {
        const spot: Spot = {id: newId(), name: typed};
        put('spots', spot);
        chosenSpot = spot.id;
      }
    }
    const saved: Sortie = {
      id: sortie?.id ?? newId(),
      date,
      heliId,
      ...(chosenSpot && {spotId: chosenSpot}),
      packs,
      timer: seconds,
      crashes,
      broken,
      skills,
      notes: notes.trim(),
      links: links
        .split(/\s+/)
        .map(link => link.trim())
        .filter(link => /^https?:\/\//.test(link)),
      telemetry: sortie?.telemetry ?? [],
      loggedAt: sortie?.loggedAt ?? now(),
      ...(photos && {photos}),
    };
    put('sorties', saved);
    // The heli remembers its pack time for the next sortie.
    const heli = findHeli(heliId);
    if (heli && seconds && heli.timer !== seconds && !sortie) put('helis', {...heli, timer: seconds});
    close();
    toast(sortie ? 'Sortie saved' : `Logged: ${formatAirtime(packs * (seconds ?? 0))} in the air`);
  };

  const destroy = () => {
    if (!sortie || !window.confirm('Delete this sortie? This cannot be undone.')) return;
    remove('sorties', sortie.id);
    close();
    toast('Sortie deleted');
    navigate('/sorties');
  };

  if (!doc.helis.length) {
    return (
      <div className="form">
        <SheetHead title="Log a sortie" />
        <p>Add a heli to your hangar first: sorties are logged against one.</p>
        <button
          className="button solid"
          onClick={() => {
            close();
            navigate('/hangar?add=1');
          }}
        >
          <Plus size={16} /> Add a heli
        </button>
      </div>
    );
  }

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        save();
      }}
    >
      <SheetHead title={sortie ? 'Edit sortie' : 'Log a sortie'} />

      <div className="field">
        <span className="field-label">Heli</span>
        <div className="chips">
          {helis.map(one => (
            <button
              key={one.id}
              type="button"
              className="chip"
              aria-pressed={one.id === heliId}
              onClick={() => pickHeli(one.id)}
            >
              <HeliDot heli={one} /> {one.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="sortie-date">Day</label>
          <input
            id="sortie-date"
            className="input"
            type="date"
            value={date}
            max={today()}
            onChange={event => setDate(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="sortie-timer">Time per pack</label>
          <div className="stepper">
            <button type="button" aria-label={`${TIMER_STEP} seconds less`} onClick={() => nudgeTimer(-TIMER_STEP)}>
              <Minus size={16} />
            </button>
            <input
              id="sortie-timer"
              className="stepper-input"
              inputMode="numeric"
              placeholder="4:30"
              value={timer}
              onChange={event => setTimer(event.target.value)}
            />
            <button type="button" aria-label={`${TIMER_STEP} seconds more`} onClick={() => nudgeTimer(TIMER_STEP)}>
              <Plus size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">Packs</span>
          <Stepper value={packs} onChange={setPacks} min={1} label="pack" />
        </div>
        <div className="field">
          <span className="field-label">
            Crashes {crashes === null && <span className="muted">(not counted)</span>}
          </span>
          <Stepper value={crashes ?? 0} onChange={setCrashes} label="crash" />
          {/* Not counted yet: the stepper cannot go below 0, so a clean sortie is said here. */}
          {crashes === null && (
            <button type="button" className="chip" style={{alignSelf: 'flex-start'}} onClick={() => setCrashes(0)}>
              No crash
            </button>
          )}
        </div>
      </div>
      {seconds !== null && (
        <div className="muted" style={{marginTop: -8, fontSize: '0.8125rem'}}>
          {formatAirtime(packs * seconds, true)} in the air
        </div>
      )}

      <div className="field">
        <span className="field-label">Spot</span>
        <div className="chips">
          {shownSpots.map(spot => (
            <button
              key={spot.id}
              type="button"
              className="chip"
              aria-pressed={spot.id === spotId && !newSpot}
              onClick={() => {
                setSpotId(spot.id === spotId ? undefined : spot.id);
                setNewSpot('');
              }}
            >
              {spot.emoji} {spot.name}
            </button>
          ))}
          {spots.length > SPOTS_SHOWN && (
            <button type="button" className="chip more" onClick={() => setEverySpot(!everySpot)}>
              {everySpot ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {everySpot ? 'Fewer' : `${spots.length - shownSpots.length} more`}
            </button>
          )}
        </div>
        <input
          className="input"
          placeholder="Somewhere new"
          value={newSpot}
          onChange={event => setNewSpot(event.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">Broken parts</span>
        {broken.length > 0 && (
          <div className="list">
            {broken.map((part, index) => (
              <div key={`${part.part}-${index}`} className="list-row" style={{padding: '8px 10px 8px 14px'}}>
                <span className="row-main">
                  {part.part}
                  {part.note && <span className="muted"> · {part.note}</span>}
                </span>
                <div style={{width: 130}}>
                  <Stepper
                    value={part.qty}
                    min={1}
                    label={part.part}
                    onChange={qty => setBroken(current => current.map(item => (item === part ? {...item, qty} : item)))}
                  />
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${part.part}`}
                  onClick={() => setBroken(current => current.filter(item => item !== part))}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="chips">
            {suggestions.map(name => (
              <button key={name} type="button" className="chip" onClick={() => addPart(name)}>
                <Plus size={13} /> {name}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar">
          <input
            className="input"
            style={{flex: 1}}
            placeholder="Another part"
            value={partText}
            onChange={event => setPartText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addPart(partText);
              }
            }}
          />
          <button type="button" className="button" onClick={() => addPart(partText)} disabled={!partText.trim()}>
            Add
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Practised</span>
        <div className="chips">
          {[...SKILLS, ...otherSkills].map(skill => (
            <button
              key={skill}
              type="button"
              className="chip"
              aria-pressed={skills.includes(skill)}
              onClick={() =>
                setSkills(current =>
                  current.includes(skill) ? current.filter(item => item !== skill) : [...current, skill],
                )
              }
            >
              {skill}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="sortie-notes">Notes</label>
        <textarea
          id="sortie-notes"
          className="input"
          placeholder="How it went, what to work on next"
          value={notes}
          onChange={event => setNotes(event.target.value)}
        />
      </div>

      <PhotoPicker day={date} picked={photos} onChange={setPhotos} />

      <div className="field">
        <label htmlFor="sortie-links">Videos and links</label>
        <textarea
          id="sortie-links"
          className="input"
          style={{minHeight: 56}}
          placeholder="Links, one a line"
          value={links}
          onChange={event => setLinks(event.target.value)}
        />
      </div>

      <div className="form-actions">
        {sortie ? (
          <button type="button" className="button danger" onClick={destroy}>
            <Trash size={15} /> Delete
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button solid" disabled={!heliId || !date}>
          {sortie ? 'Save' : 'Log sortie'}
        </button>
      </div>
    </form>
  );
}
