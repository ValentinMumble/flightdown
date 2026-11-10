import {useState} from 'react';
import {CloudOff, Download, KeyRound, LogOut} from 'lucide-react';
import {useStore} from '../data/store';
import {Card, PageHeader, useOverlay} from '../components/ui';
import {plural, today} from '../model/format';
import {AlbumSettings} from '../components/AlbumSettings';

export function Settings() {
  const {mode, doc, waiting, error, signIn, signOut, resetLocal, startLocal} = useStore();
  const {toast} = useOverlay();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await signIn(key.trim());
      setKey('');
      toast('Signed in: your log is here');
    } catch (failure) {
      setProblem((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportLog = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `flightdown-${today()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="page">
      <PageHeader title="Settings" back="/" />
      <div className="bento">
        <Card className="span-6" title="Your log">
          {mode === 'owner' ? (
            <div className="form">
              <p>
                Signed in. The log is saved online and opens on every device you sign in on.
                {waiting > 0 && (
                  <span className="pill caution" style={{marginLeft: 8}}>
                    <CloudOff size={12} /> {plural(waiting, 'change')} waiting for a connection
                  </span>
                )}
              </p>
              {error && <p className="pill critical">{error}</p>}
              <button className="button" onClick={() => void signOut()}>
                <LogOut size={15} /> Sign out of this browser
              </button>
            </div>
          ) : (
            <form
              className="form"
              onSubmit={event => {
                event.preventDefault();
                if (key.trim()) void submit();
              }}
            >
              <p className="muted">
                {mode === 'local'
                  ? 'Your log lives in this browser only. Sign in with the owner key to open the log saved online.'
                  : 'You are looking at a made-up log. Sign in with the owner key to open the real one.'}
              </p>
              <div className="toolbar">
                <input
                  className="input"
                  style={{flex: 1}}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Owner key"
                  value={key}
                  onChange={event => setKey(event.target.value)}
                />
                <button className="button solid" disabled={busy || !key.trim()}>
                  <KeyRound size={15} /> Sign in
                </button>
              </div>
              {problem && <p className="pill critical">{problem}</p>}
            </form>
          )}
        </Card>

        {mode === 'owner' && <AlbumSettings />}

        <Card className="span-6" title="Backup" sub="Everything in the log, as a JSON file">
          <button className="button" onClick={exportLog}>
            <Download size={15} /> Download the log
          </button>
          {mode === 'local' && (
            <button
              className="button danger"
              style={{marginLeft: 8}}
              onClick={() => {
                if (window.confirm('Delete the log kept in this browser? This cannot be undone.')) resetLocal();
              }}
            >
              Delete this browser’s log
            </button>
          )}
          {mode === 'sample' && (
            <button className="button" style={{marginLeft: 8}} onClick={() => startLocal('empty')}>
              Start my own log
            </button>
          )}
        </Card>
      </div>
    </div>
  );
}
