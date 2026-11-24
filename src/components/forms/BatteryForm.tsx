import {useState} from 'react';
import {Plus, X} from 'lucide-react';
import type {Battery, Pack} from '../../types';
import {useStore} from '../../data/store';
import {newId} from '../../model/ids';
import {formatDay, today} from '../../model/format';
import {kindName} from '../../model/packs';
import {HeliDot, SheetHead, Stepper, useOverlay} from '../ui';
import {Actions} from './Actions';

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
  // A pack keeps the day it got its button while it keeps the button; moved off it, the old button goes in its
  // history until today, so its older logs stay its own.
  const setButton = (number: number, button?: number) =>
    change(number, pack => {
      const saved = savedPack(number);
      if (saved?.button === button) return {...pack, button, since: saved?.since, earlier: saved?.earlier};
      const earlier = saved?.button
        ? [...(saved.earlier ?? []), {button: saved.button, ...(saved.since && {since: saved.since}), until: today()}]
        : saved?.earlier;
      return {...pack, button, since: button ? today() : undefined, earlier};
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
      packs: packs.map(({number, button, since, earlier, dead}) => ({
        number,
        ...(button ? {button} : {}),
        ...(since && {since}),
        ...(earlier?.length && {earlier}),
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
                {pack.dead ? `Dead since ${formatDay(pack.dead, {weekday: false})}` : 'Mark as dead'}
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
