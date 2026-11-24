import {useState} from 'react';
import type {Gear, GearGone} from '../../types';
import {useStore} from '../../data/store';
import {newId} from '../../model/ids';
import {parsePrice} from '../../model/format';
import {SheetHead, useOverlay} from '../ui';
import {Actions} from './Actions';

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

/** A radio's clock against the local time. */
const CLOCKS = [
  {value: 0, label: 'On time'},
  {value: 1, label: '1 h ahead'},
  {value: -1, label: '1 h behind'},
];

/** The radio, the charger, a simulator: the rest of the hangar. */
export function GearForm({gear}: {gear?: Gear}) {
  const {put, remove} = useStore();
  const {close, toast} = useOverlay();
  const [name, setName] = useState(gear?.name ?? '');
  const [category, setCategory] = useState<Gear['category']>(gear?.category ?? 'radio');
  const [details, setDetails] = useState(gear?.details ?? '');
  const [since, setSince] = useState(gear?.since ?? '');
  const [price, setPrice] = useState(gear?.price ? String(gear.price) : '');
  const [notes, setNotes] = useState(gear?.notes ?? '');
  const [gone, setGone] = useState<GearGone | undefined>(gear?.gone);
  const [photo, setPhoto] = useState(gear?.photo ?? '');
  const [clockAhead, setClockAhead] = useState(gear?.clockAhead ?? 0);

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
          ...(parsePrice(price) && {price: parsePrice(price)}),
          ...(notes.trim() && {notes: notes.trim()}),
          ...(photo.trim() && {photo: photo.trim()}),
          ...(category === 'radio' && clockAhead && {clockAhead}),
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
      {category === 'radio' && (
        <div className="field">
          <span className="field-label">Its clock</span>
          <div className="chips">
            {CLOCKS.map(option => (
              <button
                key={option.value}
                type="button"
                className="chip"
                aria-pressed={option.value === clockAhead}
                onClick={() => setClockAhead(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <small className="muted">
            The radio does not change its clock for summer time: its logs' times are moved back by this for the weather
            and the radio's changes since the last flight.
          </small>
        </div>
      )}
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
      <div className="field-row">
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
          <label htmlFor="gear-price">Price (€)</label>
          <input
            id="gear-price"
            className="input"
            inputMode="decimal"
            placeholder="459"
            value={price}
            onChange={event => setPrice(event.target.value)}
          />
        </div>
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
