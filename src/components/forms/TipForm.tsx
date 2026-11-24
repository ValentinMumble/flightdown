import {useState} from 'react';
import type {Tip} from '../../types';
import {useStore} from '../../data/store';
import {newId} from '../../model/ids';
import {HeliDot, SheetHead, useOverlay} from '../ui';
import {Actions} from './Actions';

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
