import {useState} from 'react';
import {Link, useNavigate} from 'react-router';
import {ChevronRight, LocateFixed, Plus, Trash, X} from 'lucide-react';
import type {Battery, Gear, GearGone, Heli, HeliStatus, Pack, Spare, Spot, Tip} from '../../types';
import {useStore} from '../../data/store';
import {newId, now} from '../../model/ids';
import {formatDay, formatTimer, parseTimer, plural, today} from '../../model/format';
import {formatLocation, hasLocation, parseLocation, type LatLng} from '../../model/geo';
import {SERIES_NAMES} from '../../model/palette';
import {brokenRanking, spareStock} from '../../model/parts';
import {kindName} from '../../model/packs';
import {useSeriesColor} from '../colors';
import {HeliDot, SheetHead, Stepper, useOverlay} from '../ui';
import {LocationPicker} from '../LazyMaps';

export const STATUSES: {value: HeliStatus; label: string}[] = [
  {value: 'active', label: 'Flying'},
  {value: 'grounded', label: 'Grounded, being fixed'},
  {value: 'retired', label: 'Retired'},
  {value: 'sold', label: 'Sold'},
  {value: 'lost', label: 'Lost'},
];

function Actions({onDelete, label}: {onDelete?: () => void; label: string}) {
  return (
    <div className="form-actions">
      {onDelete ? (
        <button type="button" className="button danger" onClick={onDelete}>
          <Trash size={15} /> Delete
        </button>
      ) : (
        <span />
      )}
      <button type="submit" className="button solid">
        {label}
      </button>
    </div>
  );
}

export function HeliForm({heli}: {heli?: Heli}) {
  const {doc, put, remove} = useStore();
  const {close, toast} = useOverlay();
  const navigate = useNavigate();
  const color = useSeriesColor();
  const used = new Set(doc.helis.filter(one => one.id !== heli?.id && one.status === 'active').map(one => one.color));
  const [name, setName] = useState(heli?.name ?? '');
  const [maker, setMaker] = useState(heli?.maker ?? '');
  const [model, setModel] = useState(heli?.model ?? '');
  const [slot, setSlot] = useState(heli?.color ?? [0, 1, 2, 3, 4, 5, 6, 7].find(index => !used.has(index)) ?? 0);
  const [status, setStatus] = useState<HeliStatus>(heli?.status ?? 'active');
  const [acquired, setAcquired] = useState(heli?.acquired ?? '');
  const [timer, setTimer] = useState(heli?.timer ? formatTimer(heli.timer) : '');
  const [battery, setBattery] = useState(heli?.battery ?? '');
  const [photo, setPhoto] = useState(heli?.photo ?? '');
  const [setup, setSetup] = useState(heli?.setup ?? '');
  const sorties = heli ? doc.sorties.filter(sortie => sortie.heliId === heli.id).length : 0;

  const save = () => {
    const saved: Heli = {
      id: heli?.id ?? newId(),
      name: name.trim(),
      ...(maker.trim() && {maker: maker.trim()}),
      ...(model.trim() && {model: model.trim()}),
      color: slot,
      status,
      ...(acquired && {acquired}),
      ...(parseTimer(timer) && {timer: parseTimer(timer)!}),
      ...(battery.trim() && {battery: battery.trim()}),
      ...(photo.trim() && {photo: photo.trim()}),
      ...(setup.trim() && {setup: setup.trim()}),
      createdAt: heli?.createdAt ?? now(),
    };
    put('helis', saved);
    close();
    toast(heli ? 'Heli saved' : `${saved.name} joins the hangar`);
    if (!heli) navigate(`/helis/${saved.id}`);
  };

  const destroy = () => {
    if (!heli) return;
    if (sorties) {
      window.alert(`${heli.name} has ${sorties} sorties. Set it as retired, sold or lost instead: its sorties stay.`);
      return;
    }
    if (!window.confirm(`Delete ${heli.name}?`)) return;
    remove('helis', heli.id);
    close();
    navigate('/hangar');
  };

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        if (name.trim()) save();
      }}
    >
      <SheetHead title={heli ? `Edit ${heli.name}` : 'Add a heli'} />
      <div className="field">
        <label htmlFor="heli-name">Name</label>
        <input
          id="heli-name"
          className="input"
          value={name}
          placeholder="M2 EVO 🟠"
          onChange={event => setName(event.target.value)}
          required
          autoFocus={!heli}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="heli-maker">Maker</label>
          <input id="heli-maker" className="input" value={maker} onChange={event => setMaker(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="heli-model">Model</label>
          <input id="heli-model" className="input" value={model} onChange={event => setModel(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Colour in the charts</span>
        <div className="swatches">
          {SERIES_NAMES.map((label, index) => (
            <button
              key={label}
              type="button"
              className="swatch"
              aria-label={label}
              aria-pressed={index === slot}
              title={used.has(index) ? `${label}, used by another heli` : label}
              style={{background: color(index), opacity: used.has(index) && index !== slot ? 0.45 : 1}}
              onClick={() => setSlot(index)}
            />
          ))}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="heli-status">Status</label>
          <select
            id="heli-status"
            className="input"
            style={{width: '100%'}}
            value={status}
            onChange={event => setStatus(event.target.value as HeliStatus)}
          >
            {STATUSES.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="heli-acquired">In the hangar since</label>
          <input
            id="heli-acquired"
            className="input"
            type="date"
            value={acquired}
            onChange={event => setAcquired(event.target.value)}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="heli-timer">Time per pack</label>
          <input
            id="heli-timer"
            className="input tabular"
            placeholder="4:30"
            inputMode="numeric"
            value={timer}
            onChange={event => setTimer(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="heli-battery">Packs</label>
          <input
            id="heli-battery"
            className="input"
            placeholder="3S 750 mAh"
            value={battery}
            onChange={event => setBattery(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="heli-photo">Photo link</label>
        <input
          id="heli-photo"
          className="input"
          type="url"
          placeholder="https://…"
          value={photo}
          onChange={event => setPhoto(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="heli-setup">Setup</label>
        <textarea
          id="heli-setup"
          className="input"
          placeholder="Flybarless gains, channel map, pitch curves"
          value={setup}
          onChange={event => setSetup(event.target.value)}
        />
      </div>
      <Actions label={heli ? 'Save' : 'Add to the hangar'} onDelete={heli ? destroy : undefined} />
    </form>
  );
}

export function SpareForm({
  spare,
  name: suggested,
  heliId: suggestedHeli,
}: {
  spare?: Spare;
  name?: string;
  heliId?: string;
}) {
  const {doc, put, remove} = useStore();
  const {close, toast} = useOverlay();
  const stock = spare ? spareStock(spare, doc.sorties) : 0;
  const [name, setName] = useState(spare?.name ?? suggested ?? '');
  const [heliId, setHeliId] = useState(spare?.heliId ?? suggestedHeli ?? '');
  const [count, setCount] = useState(spare ? Math.max(0, stock) : 2);
  const [min, setMin] = useState(spare?.min ?? 1);
  const [price, setPrice] = useState(spare?.price ? String(spare.price) : '');
  const [url, setUrl] = useState(spare?.url ?? '');
  const known = brokenRanking(doc.sorties).map(part => part.name);

  const save = () => {
    const saved: Spare = {
      id: spare?.id ?? newId(),
      name: name.trim(),
      ...(heliId && {heliId}),
      count,
      countedAt: spare && count === Math.max(0, stock) ? spare.countedAt : now(),
      min,
      ...(Number(price.replace(',', '.')) > 0 && {price: Number(price.replace(',', '.'))}),
      ...(url.trim() && {url: url.trim()}),
    };
    // An unchanged count keeps its date, so parts broken since still come off it.
    if (spare && count === Math.max(0, stock)) {
      saved.count = spare.count;
    }
    put('spares', saved);
    close();
    toast(spare ? 'Spare saved' : `${saved.name} in stock`);
  };

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        if (name.trim()) save();
      }}
    >
      <SheetHead title={spare ? `Edit ${spare.name}` : 'Add a spare part'} />
      <div className="field">
        <label htmlFor="spare-name">Part</label>
        <input
          id="spare-name"
          className="input"
          list="spare-names"
          value={name}
          placeholder="Main blade"
          onChange={event => setName(event.target.value)}
          required
        />
        <datalist id="spare-names">
          {known.map(part => (
            <option key={part} value={part} />
          ))}
        </datalist>
        <span className="muted" style={{fontSize: '0.75rem'}}>
          Name it as you log broken parts: each one logged comes off the stock.
        </span>
      </div>
      <div className="field">
        <span className="field-label">Fits</span>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={!heliId} onClick={() => setHeliId('')}>
            Any heli
          </button>
          {doc.helis
            .filter(one => one.status === 'active' || one.status === 'grounded' || one.id === heliId)
            .map(one => (
              <button
                key={one.id}
                type="button"
                className="chip"
                aria-pressed={one.id === heliId}
                onClick={() => setHeliId(one.id)}
              >
                <HeliDot heli={one} /> {one.name}
              </button>
            ))}
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">In stock now</span>
          <Stepper value={count} onChange={setCount} label="in stock" />
        </div>
        <div className="field">
          <span className="field-label">Keep at least</span>
          <Stepper value={min} onChange={setMin} label="to keep" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="spare-price">Price each</label>
          <input
            id="spare-price"
            className="input"
            inputMode="decimal"
            placeholder="6.50"
            value={price}
            onChange={event => setPrice(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="spare-url">Shop link</label>
          <input
            id="spare-url"
            className="input"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={event => setUrl(event.target.value)}
          />
        </div>
      </div>
      <Actions
        label={spare ? 'Save' : 'Add'}
        onDelete={
          spare
            ? () => {
                if (!window.confirm(`Delete ${spare.name} from the spares?`)) return;
                remove('spares', spare.id);
                close();
              }
            : undefined
        }
      />
    </form>
  );
}

export function BatteryForm({battery}: {battery?: Battery}) {
  const {doc, put, remove} = useStore();
  const {close, toast} = useOverlay();
  const [name, setName] = useState(battery?.name ?? '');
  const [cells, setCells] = useState(battery?.cells ?? 3);
  const [capacity, setCapacity] = useState(battery ? String(battery.capacity) : '');
  const [packs, setPacks] = useState<Pack[]>(battery?.packs ?? []);
  const [heliIds, setHeliIds] = useState<string[]>(battery?.heliIds ?? []);
  const [bought, setBought] = useState(battery?.bought ?? '');
  const [notes, setNotes] = useState(battery?.notes ?? '');
  const [photo, setPhoto] = useState(battery?.photo ?? '');

  const savedPack = (number: number) => battery?.packs.find(pack => pack.number === number);
  const change = (number: number, update: (pack: Pack) => Pack) =>
    setPacks(current => current.map(pack => (pack.number === number ? update(pack) : pack)));
  // A pack keeps the day it got its button while it keeps the button: its older logs stay its own.
  const setButton = (number: number, button?: number) =>
    change(number, pack => {
      const saved = savedPack(number);
      return {...pack, button, since: !button ? undefined : saved?.button === button ? saved.since : today()};
    });
  // A new pack numbers on from every pack of the kinds named alike (Gens Ace 700 and 750): no two share a name.
  const addPack = () =>
    setPacks(current => {
      const alike = doc.batteries.filter(other => other.id !== battery?.id && kindName(other.name) === kindName(name));
      const numbers = [...current, ...alike.flatMap(other => other.packs)].map(pack => pack.number);
      return [...current, {number: Math.max(0, ...numbers) + 1}];
    });
  const toggleDead = (number: number) =>
    change(number, pack => ({...pack, dead: pack.dead ? undefined : (savedPack(number)?.dead ?? today())}));

  const save = () => {
    const saved: Battery = {
      id: battery?.id ?? newId(),
      name: name.trim() || `${cells}S ${capacity} mAh`,
      cells,
      capacity: Number(capacity) || 0,
      packs: packs.map(({number, button, since, dead}) => ({
        number,
        ...(button ? {button} : {}),
        ...(since && {since}),
        ...(dead && {dead}),
      })),
      heliIds,
      ...(bought && {bought}),
      ...(notes.trim() && {notes: notes.trim()}),
      ...(photo.trim() && {photo: photo.trim()}),
    };
    put('batteries', saved);
    close();
    toast('Packs saved');
  };

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        save();
      }}
    >
      <SheetHead title={battery ? `Edit ${battery.name}` : 'Add packs'} />
      <div className="field">
        <label htmlFor="battery-name">Name</label>
        <input
          id="battery-name"
          className="input"
          placeholder="Small packs"
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <span className="field-label">Cells</span>
          <Stepper value={cells} onChange={setCells} min={1} max={14} label="cell" />
        </div>
        <div className="field">
          <label htmlFor="battery-capacity">Capacity (mAh)</label>
          <input
            id="battery-capacity"
            className="input"
            inputMode="numeric"
            placeholder="750"
            value={capacity}
            onChange={event => setCapacity(event.target.value.replace(/\D/g, ''))}
            required
          />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Packs</span>
        <div className="pack-lines">
          {packs.map(pack => (
            <div key={pack.number} className="pack-line">
              <span className="pack-line-number">#{pack.number}</span>
              <select
                className="input"
                aria-label={`Pack ${pack.number}'s 6-position button`}
                value={pack.button ?? ''}
                onChange={event => setButton(pack.number, Number(event.target.value) || undefined)}
              >
                <option value="">No button</option>
                {[1, 2, 3, 4, 5, 6].map(button => (
                  <option key={button} value={button}>
                    Button {button}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="chip"
                aria-pressed={Boolean(pack.dead)}
                onClick={() => toggleDead(pack.number)}
              >
                {pack.dead ? `Dead since ${formatDay(pack.dead, {weekday: false})}` : 'Dead'}
              </button>
              {!savedPack(pack.number) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove pack ${pack.number}`}
                  onClick={() => setPacks(current => current.filter(one => one.number !== pack.number))}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="button small" style={{alignSelf: 'flex-start'}} onClick={addPack}>
          <Plus size={14} /> Add a pack
        </button>
        <span className="muted" style={{fontSize: '0.8125rem'}}>
          The button pressed before flying a pack names its logs. A dead pack keeps its charts.
        </span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="battery-bought">Bought</label>
          <input
            id="battery-bought"
            className="input"
            type="date"
            value={bought}
            onChange={event => setBought(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Flown on</span>
        <div className="chips">
          {doc.helis
            .filter(one => one.status === 'active' || one.status === 'grounded' || heliIds.includes(one.id))
            .map(one => (
              <button
                key={one.id}
                type="button"
                className="chip"
                aria-pressed={heliIds.includes(one.id)}
                onClick={() =>
                  setHeliIds(current =>
                    current.includes(one.id) ? current.filter(id => id !== one.id) : [...current, one.id],
                  )
                }
              >
                <HeliDot heli={one} /> {one.name}
              </button>
            ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="battery-photo">Photo link</label>
        <input
          id="battery-photo"
          className="input"
          type="url"
          placeholder="https://…"
          value={photo}
          onChange={event => setPhoto(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="battery-notes">Notes</label>
        <textarea
          id="battery-notes"
          className="input"
          style={{minHeight: 60}}
          value={notes}
          onChange={event => setNotes(event.target.value)}
        />
      </div>
      <Actions
        label={battery ? 'Save' : 'Add'}
        onDelete={
          battery
            ? () => {
                if (!window.confirm(`Delete ${battery.name}?`)) return;
                remove('batteries', battery.id);
                close();
              }
            : undefined
        }
      />
    </form>
  );
}

export function TipForm({tip}: {tip?: Tip}) {
  const {doc, put, remove} = useStore();
  const {close, toast} = useOverlay();
  const [title, setTitle] = useState(tip?.title ?? '');
  const [body, setBody] = useState(tip?.body ?? '');
  const [heliId, setHeliId] = useState(tip?.heliId ?? '');

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        if (!title.trim()) return;
        put('tips', {id: tip?.id ?? newId(), title: title.trim(), body: body.trim(), ...(heliId && {heliId})});
        close();
        toast('Note saved');
      }}
    >
      <SheetHead title={tip ? 'Edit note' : 'Add a note'} />
      <div className="field">
        <label htmlFor="tip-title">Title</label>
        <input
          id="tip-title"
          className="input"
          placeholder="Level the swashplate"
          value={title}
          onChange={event => setTitle(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <span className="field-label">About</span>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={!heliId} onClick={() => setHeliId('')}>
            Every heli
          </button>
          {doc.helis
            .filter(one => one.status === 'active' || one.status === 'grounded' || one.id === heliId)
            .map(one => (
              <button
                key={one.id}
                type="button"
                className="chip"
                aria-pressed={one.id === heliId}
                onClick={() => setHeliId(one.id)}
              >
                <HeliDot heli={one} /> {one.name}
              </button>
            ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="tip-body">Note</label>
        <textarea
          id="tip-body"
          className="input"
          style={{minHeight: 160}}
          value={body}
          onChange={event => setBody(event.target.value)}
        />
      </div>
      <Actions
        label="Save"
        onDelete={
          tip
            ? () => {
                if (!window.confirm(`Delete the note "${tip.title}"?`)) return;
                remove('tips', tip.id);
                close();
              }
            : undefined
        }
      />
    </form>
  );
}

/** A new spot, or one renamed, placed on the map, or merged into another: its sorties move there. */
export function SpotForm({spot}: {spot?: Spot}) {
  const {doc, put, remove} = useStore();
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
      const answer = await fetch(`/api/place?url=${encodeURIComponent(input)}`);
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
          for (const sortie of sorties) put('sorties', {...sortie, spotId: into});
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

const GEAR_CATEGORIES: {value: Gear['category']; label: string}[] = [
  {value: 'radio', label: 'Radio'},
  {value: 'charger', label: 'Charger'},
  {value: 'simulator', label: 'Simulator'},
  {value: 'other', label: 'Other'},
];

const GEAR_GONE: {value: GearGone | undefined; label: string}[] = [
  {value: undefined, label: 'In use'},
  {value: 'sold', label: 'Sold'},
  {value: 'lost', label: 'Lost'},
  {value: 'stolen', label: 'Stolen'},
];

/** The radio, the charger, a simulator: the rest of the hangar. */
export function GearForm({gear}: {gear?: Gear}) {
  const {put, remove} = useStore();
  const {close, toast} = useOverlay();
  const [name, setName] = useState(gear?.name ?? '');
  const [category, setCategory] = useState<Gear['category']>(gear?.category ?? 'radio');
  const [details, setDetails] = useState(gear?.details ?? '');
  const [since, setSince] = useState(gear?.since ?? '');
  const [notes, setNotes] = useState(gear?.notes ?? '');
  const [gone, setGone] = useState<GearGone | undefined>(gear?.gone);
  const [photo, setPhoto] = useState(gear?.photo ?? '');

  return (
    <form
      className="form"
      onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        put('gear', {
          id: gear?.id ?? newId(),
          name: name.trim(),
          category,
          ...(gone && {gone}),
          ...(details.trim() && {details: details.trim()}),
          ...(since && {since}),
          ...(notes.trim() && {notes: notes.trim()}),
          ...(photo.trim() && {photo: photo.trim()}),
        });
        close();
        toast(gear ? 'Saved' : `${name.trim()} in the hangar`);
      }}
    >
      <SheetHead title={gear ? `Edit ${gear.name}` : 'Add gear'} />
      <div className="field">
        <label htmlFor="gear-name">Name</label>
        <input
          id="gear-name"
          className="input"
          placeholder="RadioMaster TX16S MKII"
          value={name}
          onChange={event => setName(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <span className="field-label">Kind</span>
        <div className="chips">
          {GEAR_CATEGORIES.map(option => (
            <button
              key={option.value}
              type="button"
              className="chip"
              aria-pressed={option.value === category}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Still here?</span>
        <div className="chips">
          {GEAR_GONE.map(option => (
            <button
              key={option.label}
              type="button"
              className="chip"
              aria-pressed={option.value === gone}
              onClick={() => setGone(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="gear-details">Details</label>
        <input
          id="gear-details"
          className="input"
          placeholder="4-in-1 module, AG01 Hall CNC gimbals"
          value={details}
          onChange={event => setDetails(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="gear-since">Since</label>
        <input
          id="gear-since"
          className="input"
          type="date"
          value={since}
          onChange={event => setSince(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="gear-photo">Photo link</label>
        <input
          id="gear-photo"
          className="input"
          type="url"
          placeholder="https://…"
          value={photo}
          onChange={event => setPhoto(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="gear-notes">Notes</label>
        <textarea id="gear-notes" className="input" value={notes} onChange={event => setNotes(event.target.value)} />
      </div>
      <Actions
        label={gear ? 'Save' : 'Add'}
        onDelete={
          gear
            ? () => {
                if (!window.confirm(`Delete ${gear.name}?`)) return;
                remove('gear', gear.id);
                close();
              }
            : undefined
        }
      />
    </form>
  );
}
