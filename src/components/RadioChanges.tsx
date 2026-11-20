import {useEffect, useMemo, useState} from 'react';
import {useStore} from '../data/store';
import {Empty} from './ui';
import {Panel} from './instruments';
import {lastSession, sessionEnd} from '../model/session';
import {sortSorties} from '../model/stats';
import {ago} from '../model/format';

/** Where the radio's card lives (as api/_lib/edgetx.ts reads it): its commits are what changed on the radio. */
const REPO = 'ValentinMumble/edge-tx';
/** A list fetched is kept this long before GitHub is asked again (it allows 60 requests an hour without a token). */
const KEEP_MS = 30 * 60 * 1000;
const KEPT = 'flightdown.radio-changes';

interface Change {
  title: string;
  date: string;
  url: string;
}

/** The commits list kept for this `since`, while fresh enough: none when it is missing, old or unreadable. */
function kept(since: string): {changes: Change[]; at: number} | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEPT) ?? 'null');
    return stored && stored.since === since ? stored : null;
  } catch {
    return null;
  }
}

function keep(since: string, changes: Change[]) {
  try {
    localStorage.setItem(KEPT, JSON.stringify({since, changes, at: Date.now()}));
  } catch {
    // Not kept: GitHub is asked again next time.
  }
}

/**
 * What changed on the radio since the last flight: edge-tx's commits since the latest session's last log ended, each
 * its first line, to check on the bench before flying (a faster idle up, a knob, a new warning).
 */
export function RadioChanges({className = ''}: {className?: string}) {
  const {doc} = useStore();
  const since = useMemo(() => {
    const session = lastSession(sortSorties(doc.sorties));
    return session ? (sessionEnd(session)?.toISOString() ?? `${session.date}T23:59:59Z`) : null;
  }, [doc.sorties]);
  const [changes, setChanges] = useState<Change[] | null>(() => (since ? (kept(since)?.changes ?? null) : null));
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!since) return;
    const stored = kept(since);
    if (stored) setChanges(stored.changes);
    if (stored && Date.now() - stored.at < KEEP_MS) return;
    let current = true;
    const fetchChanges = async () => {
      try {
        const answer = await fetch(`https://api.github.com/repos/${REPO}/commits?since=${since}&per_page=10`);
        if (!answer.ok) throw new Error(`GitHub answered ${answer.status}`);
        const commits = (await answer.json()) as {
          html_url: string;
          commit: {message: string; author: {date: string}};
        }[];
        const found = commits.map(commit => ({
          title: commit.commit.message.split('\n')[0],
          date: commit.commit.author.date,
          url: commit.html_url,
        }));
        keep(since, found);
        if (current) {
          setChanges(found);
          setOffline(false);
        }
      } catch {
        if (current) setOffline(true);
      }
    };
    void fetchChanges();
    return () => {
      current = false;
    };
  }, [since]);

  return (
    <Panel label="Radio changes to test" note="On the radio's card since your last flight" className={className}>
      {!since ? (
        <Empty>No flight with radio logs yet.</Empty>
      ) : changes === null ? (
        <Empty>{offline ? 'No connection to GitHub.' : 'Looking…'}</Empty>
      ) : changes.length === 0 ? (
        <Empty>Nothing changed since your last flight.</Empty>
      ) : (
        <ul className="radio-changes">
          {changes.map(change => (
            <li key={change.url}>
              <a href={change.url} target="_blank" rel="noreferrer">
                {change.title}
              </a>
              <small>{ago(change.date.slice(0, 10))}</small>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
