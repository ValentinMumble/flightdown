import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router';
import {Plus, Trash, X} from 'lucide-react';
import type {BrokenPart, Session, Spot} from '../../types';
import {useStore} from '../../data/store';
import {newId, now} from '../../model/ids';
import {formatAirtime, formatTimer, parseTimer, today} from '../../model/format';
import {partKey, partSuggestions} from '../../model/parts';
import {SKILLS} from '../../model/skills';
import {sortSessions} from '../../model/stats';
import {HeliDot, SheetHead, Stepper, useOverlay} from '../ui';

/** Logs a session, or edits one: built to be quick at the field, on a phone, with one hand. */
export function SessionForm({session}: {session?: Session}) {
  const {doc, put, remove, heli: findHeli} = useStore();
  const {close, toast} = useOverlay();
  const navigate = useNavigate();
  const sorted = useMemo(() => sortSessions(doc.sessions), [doc.sessions]);
  const last = sorted[sorted.length - 1];

  const [date, setDate] = useState(session?.date ?? today());
  const [heliId, setHeliId] = useState(session?.heliId ?? last?.heliId ?? doc.helis[0]?.id ?? '');
  const [spotId, setSpotId] = useState<string | undefined>(session?.spotId ?? last?.spotId);
  const [newSpot, setNewSpot] = useState('');
  const [packs, setPacks] = useState(session?.packs ?? last?.packs ?? 3);
  const [timer, setTimer] = useState(
    formatTimer(session ? session.timer : (findHeli(heliId)?.timer ?? null)).replace('?', ''),
  );
  const [crashes, setCrashes] = useState<number | null>(session ? session.crashes : 0);
  const [broken, setBroken] = useState<BrokenPart[]>(session?.broken ?? []);
  const [partText, setPartText] = useState('');
  const [skills, setSkills] = useState<string[]>(session?.skills ?? []);
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [links, setLinks] = useState((session?.links ?? []).join('\n'));

  // Helis still flying first; sold and lost ones only when this session is theirs.
  const helis = doc.helis.filter(
    one => one.status === 'active' || one.status === 'grounded' || one.id === heliId || one.status === 'retired',
  );
  const spots = useMemo(() => {
    const lastUse = new Map<string, string>();
    for (const one of sorted) if (one.spotId) lastUse.set(one.spotId, one.date);
    return [...doc.spots].sort((left, right) =>
      (lastUse.get(right.id) ?? '').localeCompare(lastUse.get(left.id) ?? ''),
    );
  }, [doc.spots, sorted]);
  const suggestions = partSuggestions(heliId, doc.sessions, doc.spares)
    .filter(name => !broken.some(part => partKey(part.part) === partKey(name)))
    .slice(0, 10);
  const otherSkills = [...new Set(doc.sessions.flatMap(one => one.skills))].filter(skill => !SKILLS.includes(skill));
  const seconds = parseTimer(timer);

  const pickHeli = (id: string) => {
    setHeliId(id);
    const remembered = findHeli(id)?.timer;
    if (!session && remembered) setTimer(formatTimer(remembered));
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
    const saved: Session = {
      id: session?.id ?? newId(),
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
      telemetry: session?.telemetry ?? [],
      loggedAt: session?.loggedAt ?? now(),
    };
    put('sessions', saved);
    // The heli remembers its pack time for the next session.
    const heli = findHeli(heliId);
    if (heli && seconds && heli.timer !== seconds && !session) put('helis', {...heli, timer: seconds});
    close();
    toast(session ? 'Session saved' : `Logged: ${formatAirtime(packs * (seconds ?? 0))} in the air`);
  };

  const destroy = () => {
    if (!session || !window.confirm('Delete this session? This cannot be undone.')) return;
    remove('sessions', session.id);
    close();
    toast('Session deleted');
    navigate('/sessions');
  };

  if (!doc.helis.length) {
    return (
      <div className="form">
        <SheetHead title="Log a session" />
        <p>Add a heli to your hangar first: sessions are logged against one.</p>
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
      <SheetHead title={session ? 'Edit session' : 'Log a session'} />

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
          <label htmlFor="session-date">Day</label>
          <input
            id="session-date"
            className="input"
            type="date"
            value={date}
            max={today()}
            onChange={event => setDate(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="session-timer">Time per pack</label>
          <input
            id="session-timer"
            className="input tabular"
            inputMode="numeric"
            placeholder="4:30"
            value={timer}
            onChange={event => setTimer(event.target.value)}
          />
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
        </div>
      </div>
      {seconds !== null && (
        <div className="muted" style={{marginTop: -8, fontSize: 13}}>
          {formatAirtime(packs * seconds, true)} in the air
        </div>
      )}

      <div className="field">
        <span className="field-label">Spot</span>
        <div className="chips">
          {spots.map(spot => (
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
        <label htmlFor="session-notes">Notes</label>
        <textarea
          id="session-notes"
          className="input"
          placeholder="How it went, what to work on next"
          value={notes}
          onChange={event => setNotes(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="session-links">Photos and videos</label>
        <textarea
          id="session-links"
          className="input"
          style={{minHeight: 56}}
          placeholder="Links, one a line"
          value={links}
          onChange={event => setLinks(event.target.value)}
        />
      </div>

      <div className="form-actions">
        {session ? (
          <button type="button" className="button danger" onClick={destroy}>
            <Trash size={15} /> Delete
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button solid" disabled={!heliId || !date}>
          {session ? 'Save' : 'Log session'}
        </button>
      </div>
    </form>
  );
}
