import {Link} from 'react-router';
import {useStore} from '../data/store';

/** Tells a visitor they are looking at a made-up log, and how to start one of their own. */
export function VisitorBanner() {
  const {mode, startLocal} = useStore();
  if (mode !== 'sample') return null;
  return (
    <div className="banner">
      <span>
        <b>A made-up log</b>, to look around. Changes are not kept.
      </span>
      <span className="toolbar">
        <button className="button small" onClick={() => startLocal('empty')}>
          Start my own
        </button>
        <Link to="/settings" className="button small solid">
          Sign in
        </Link>
      </span>
    </div>
  );
}
