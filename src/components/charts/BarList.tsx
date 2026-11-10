import type {ReactNode} from 'react';
import {Link} from 'react-router';

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  display: ReactNode;
  color?: string;
  to?: string;
}

/** Names with a value and a thin bar under each: the longest list reads best this way, sorted, one hue. */
export function BarList({items, color = 'var(--accent)'}: {items: BarItem[]; color?: string}) {
  const max = Math.max(...items.map(item => item.value), 1);
  return (
    <div className="bar-list">
      {items.map(item => {
        const body = (
          <>
            <div className="bar-line">
              <span className="name">{item.label}</span>
              <span className="value tabular">{item.display}</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{width: `${(item.value / max) * 100}%`, background: item.color ?? color}}
              />
            </div>
          </>
        );
        return item.to ? (
          <Link key={item.key} to={item.to} className="bar-item">
            {body}
          </Link>
        ) : (
          <div key={item.key} className="bar-item">
            {body}
          </div>
        );
      })}
    </div>
  );
}
