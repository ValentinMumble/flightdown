import type {Session} from '../../types';
import {skillLadder} from '../../model/debrief';
import {formatDay} from '../../model/format';

/**
 * The manoeuvre ladder, from hover to autorotation: rungs reached light up with the day they were first practised,
 * the next one waits in magenta.
 */
export function SkillLadder({sessions, compact = false}: {sessions: Session[]; compact?: boolean}) {
  const rungs = skillLadder(sessions);
  const reached = rungs.filter(rung => rung.first);
  const next = rungs.find(rung => !rung.first);
  const shown = compact ? [...reached.slice(-3), ...(next ? [next] : [])] : rungs;
  return (
    <ol className={`ladder ${compact ? 'compact' : ''}`}>
      {[...shown].reverse().map(rung => (
        <li key={rung.skill} className={rung.first ? 'reached' : rung === next ? 'next' : 'locked'}>
          <span className="ladder-rung" aria-hidden />
          <span className="ladder-skill">{rung.skill}</span>
          <span className="ladder-when">
            {rung.first
              ? `${formatDay(rung.first, {weekday: false, year: true})} · ${rung.sessions}×`
              : rung === next
                ? 'Next'
                : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
