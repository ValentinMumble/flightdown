import {useState} from 'react';
import {useNavigate} from 'react-router';
import type {Heli, HeliStatus} from '../../types';
import {useStore} from '../../data/store';
import {newId, now} from '../../model/ids';
import {formatTimer, parsePrice, parseTimer} from '../../model/format';
import {SERIES_NAMES} from '../../model/palette';
import {useSeriesColor} from '../colors';
import {SheetHead, useOverlay} from '../ui';
import {Actions} from './Actions';

export const STATUSES: {value: HeliStatus; label: string}[] = [
  {value: 'active', label: 'Flying'},
  {value: 'grounded', label: 'Grounded, being fixed'},
  {value: 'retired', label: 'Retired'},
  {value: 'sold', label: 'Sold'},
  {value: 'lost', label: 'Lost'},
];

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
  const [price, setPrice] = useState(heli?.price ? String(heli.price) : '');
  const [timer, setTimer] = useState(heli?.timer ? formatTimer(heli.timer) : '');
  const [battery, setBattery] = useState(heli?.battery ?? '');
  const [sizeClass, setSizeClass] = useState(heli?.sizeClass ?? '');
  const [rotor, setRotor] = useState(heli?.rotor ? String(heli.rotor) : '');
  const [weight, setWeight] = useState(heli?.weight ? String(heli.weight) : '');
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
      ...(parsePrice(price) && {price: parsePrice(price)}),
      ...(parseTimer(timer) && {timer: parseTimer(timer)!}),
      ...(battery.trim() && {battery: battery.trim()}),
      // "250 class" typed whole keeps only "250": the card adds "class" itself.
      ...(sizeClass.trim() && {sizeClass: sizeClass.trim().replace(/\s*class$/i, '')}),
      ...(parsePrice(rotor) && {rotor: parsePrice(rotor)}),
      ...(parsePrice(weight) && {weight: parsePrice(weight)}),
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
      <div className="field-row three">
        <div className="field">
          <label htmlFor="heli-class">Class</label>
          <input
            id="heli-class"
            className="input"
            placeholder="280"
            value={sizeClass}
            onChange={event => setSizeClass(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="heli-rotor">Rotor (mm)</label>
          <input
            id="heli-rotor"
            className="input tabular"
            inputMode="numeric"
            placeholder="650"
            value={rotor}
            onChange={event => setRotor(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="heli-weight">Weight (g)</label>
          <input
            id="heli-weight"
            className="input tabular"
            inputMode="numeric"
            placeholder="400"
            value={weight}
            onChange={event => setWeight(event.target.value)}
          />
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
          <label htmlFor="heli-acquired">Bought</label>
          <input
            id="heli-acquired"
            className="input"
            type="date"
            value={acquired}
            onChange={event => setAcquired(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="heli-price">Price (€)</label>
        <input
          id="heli-price"
          className="input"
          inputMode="decimal"
          placeholder="999"
          value={price}
          onChange={event => setPrice(event.target.value)}
        />
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
