import {useState} from 'react';
import type {Spare} from '../../types';
import {useStore} from '../../data/store';
import {newId, now} from '../../model/ids';
import {brokenRanking, spareStock} from '../../model/parts';
import {HeliDot, SheetHead, Stepper, useOverlay} from '../ui';
import {Actions} from './Actions';

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
  const [photo, setPhoto] = useState(spare?.photo ?? '');
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
      ...(photo.trim() && {photo: photo.trim()}),
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
          <label htmlFor="spare-price">Price each (€)</label>
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
      <div className="field">
        <label htmlFor="spare-photo">Photo link</label>
        <input
          id="spare-photo"
          className="input"
          type="url"
          placeholder="https://…"
          value={photo}
          onChange={event => setPhoto(event.target.value)}
        />
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
