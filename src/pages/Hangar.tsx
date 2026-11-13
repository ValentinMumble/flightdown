import {useEffect, useMemo, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router';
import {
  BatteryCharging,
  Cable,
  ExternalLink,
  Gamepad2,
  Minus,
  Monitor,
  Pencil,
  Plug,
  Plus,
  ShoppingCart,
} from 'lucide-react';
import type {Battery, Heli} from '../types';
import {useStore} from '../data/store';
import {Card, Empty, HeliDot, PageHeader, useOverlay} from '../components/ui';
import {BatteryForm, GearForm, HeliForm, SpareForm, TipForm} from '../components/forms/HangarForms';
import {Stamp} from '../components/instruments';
import {useSeriesColor} from '../components/colors';
import {VisitorBanner} from '../components/VisitorBanner';
import {ago, formatAirtime, formatDay, formatNumber, formatPrice, formatRate, plural, today} from '../model/format';
import {SERIES_NAMES} from '../model/palette';
import {groupBy, packsSinceCrash, type GroupTally} from '../model/stats';
import {brokenRanking, partKey, spareStock} from '../model/parts';
import {now} from '../model/ids';
import {kindFlights, livePacks} from '../model/packs';
import {HeliPhoto} from '../components/HeliPhoto';

/** Spare parts, hidden for now: their tab and page come back when this is true. */
const SHOW_SPARES = false;

const VIEWS = [
  {to: '/hangar', label: 'Fleet', view: undefined},
  ...(SHOW_SPARES ? [{to: '/hangar/spares', label: 'Spares', view: 'spares'}] : []),
  {to: '/hangar/batteries', label: 'Batteries', view: 'batteries'},
  {to: '/hangar/notes', label: 'Notes', view: 'notes'},
];

/** A heli on the flight line: its picture lit in its colour, its stamp, its numbers. */
export function HeliCard({heli, tally, wide = false}: {heli: Heli; tally?: GroupTally; wide?: boolean}) {
  const {doc} = useStore();
  const color = useSeriesColor();
  const since = useMemo(
    () => packsSinceCrash(doc.sorties.filter(sortie => sortie.heliId === heli.id)),
    [doc.sorties, heli.id],
  );
  return (
    <Link
      to={`/helis/${heli.id}`}
      className={wide ? 'panel heli-card wide' : 'panel heli-card'}
      style={{['--hue' as string]: color(heli.color)}}
    >
      <div className="heli-band">
        {heli.photo ? <HeliPhoto url={heli.photo} /> : <span className="heli-glyph">🚁</span>}
        <Stamp status={heli.status} />
      </div>
      <div className="heli-body">
        <div>
          <div className="heli-name">{heli.name}</div>
          <div className="heli-model">
            {[heli.maker, heli.model].filter(Boolean).join(' ') || 'Maker and model not set'}
          </div>
        </div>
        <div className="figures">
          <div>
            <div className="figure-label">Hours</div>
            <div className="figure-value">{formatAirtime(tally?.airtime ?? 0)}</div>
          </div>
          <div>
            <div className="figure-label">Packs</div>
            <div className="figure-value">{tally?.packs ?? 0}</div>
          </div>
          <div>
            <div className="figure-label">Clean packs</div>
            <div className="figure-value">{since}</div>
          </div>
        </div>
        <div className="muted" style={{fontSize: '0.8125rem'}}>
          {tally ? `Last flown ${ago(tally.last)}` : 'Not flown yet'}
        </div>
      </div>
    </Link>
  );
}

const GEAR_ICONS = {radio: Gamepad2, charger: Plug, simulator: Monitor, other: Cable};

/** Model codes in a name ("TX16S", "AG01"): notes that mention one belong with the gear. */
const codes = (text: string) =>
  text.match(/\b[A-Z]*\d+[A-Z\d]*\b|\b[A-Z]{2,}\d*\b/g)?.filter(code => /\d/.test(code)) ?? [];

function Gear() {
  const {doc} = useStore();
  const {open} = useOverlay();
  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Radio and gear · {doc.gear.length}</h2>
        <button className="button small" onClick={() => open(<GearForm />)}>
          <Plus size={14} /> Add gear
        </button>
      </div>
      {doc.gear.length ? (
        <div className="grid grid-auto">
          {[...doc.gear]
            .sort(
              (left, right) =>
                Number(Boolean(left.gone)) - Number(Boolean(right.gone)) || left.name.localeCompare(right.name),
            )
            .map(item => {
              const Icon = GEAR_ICONS[item.category] ?? Cable;
              const keys = codes(`${item.name} ${item.details ?? ''}`);
              const related = doc.tips.filter(tip => keys.some(key => `${tip.title}\n${tip.body}`.includes(key)));
              return (
                <button
                  key={item.id}
                  className={`panel gear-card ${item.gone ? 'gone' : ''}`}
                  onClick={() => open(<GearForm gear={item} />)}
                >
                  {item.photo ? (
                    <span className="gear-photo">
                      <HeliPhoto url={item.photo} alt={item.name} />
                    </span>
                  ) : (
                    <span className="gear-icon">
                      <Icon size={22} />
                    </span>
                  )}
                  <span className="stack" style={{gap: 6}}>
                    <span className="heli-name" style={{fontSize: '1.0625rem'}}>
                      {item.name}
                    </span>
                    {item.gone && <Stamp status={item.gone} />}
                    {item.details && <span className="muted">{item.details}</span>}
                    {(item.since || item.price !== undefined) && (
                      <span className="chips">
                        {item.since && (
                          <span className="pill label">
                            Since {formatDay(item.since, {weekday: false, year: true})}
                          </span>
                        )}
                        {item.price !== undefined && <span className="pill label">{formatPrice(item.price)}</span>}
                      </span>
                    )}
                    {item.notes && <span className="caption">{item.notes}</span>}
                    {related.length > 0 && (
                      <span className="chips">
                        {related.map(tip => (
                          <Link
                            key={tip.id}
                            to="/hangar/notes"
                            className="chip"
                            onClick={event => event.stopPropagation()}
                          >
                            📒 {tip.title}
                          </Link>
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
        </div>
      ) : (
        <div className="panel">
          <Empty emoji="🎮">Your radio, charger or simulator.</Empty>
        </div>
      )}
    </>
  );
}

function Fleet() {
  const {doc} = useStore();
  const {open} = useOverlay();
  const color = useSeriesColor();
  const tallies = useMemo(
    () => new Map(groupBy(doc.sorties, sortie => sortie.heliId).map(group => [group.key, group])),
    [doc.sorties],
  );
  const byLast = (left: Heli, right: Heli) =>
    (tallies.get(right.id)?.last ?? right.createdAt).localeCompare(tallies.get(left.id)?.last ?? left.createdAt);
  const flying = doc.helis.filter(heli => heli.status === 'active' || heli.status === 'grounded').sort(byLast);
  const gone = doc.helis.filter(heli => heli.status !== 'active' && heli.status !== 'grounded').sort(byLast);
  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Flight line · {flying.length}</h2>
        <button className="button small solid" onClick={() => open(<HeliForm />)}>
          <Plus size={14} /> Add a heli
        </button>
      </div>
      {flying.length ? (
        <div className="grid grid-auto">
          {flying.map(heli => (
            <HeliCard key={heli.id} heli={heli} tally={tallies.get(heli.id)} wide={flying.length === 1} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty>No heli flying. Add one, or set one back to flying.</Empty>
        </div>
      )}

      <Gear />

      {gone.length > 0 && (
        <>
          <h2 className="section-title section-head">Left the hangar · {gone.length}</h2>
          <div className="list">
            {gone.map(heli => {
              const tally = tallies.get(heli.id);
              return (
                <Link
                  key={heli.id}
                  to={`/helis/${heli.id}`}
                  className="gone-row"
                  style={{['--hue' as string]: color(heli.color)}}
                >
                  <span className="gone-thumb">{heli.photo ? <HeliPhoto url={heli.photo} /> : '🚁'}</span>
                  <span className="row-main">
                    <span className="row-title">
                      <span className="name">{heli.name}</span>
                    </span>
                    <span className="row-sub" style={{display: 'block'}}>
                      {[heli.maker, heli.model].filter(Boolean).join(' ')}
                      {tally &&
                        ` · ${formatDay(tally.first, {weekday: false, year: true})} to ${formatDay(tally.last, {weekday: false, year: true})}`}
                    </span>
                  </span>
                  <span className="figure-value" style={{fontSize: '0.9375rem'}}>
                    {formatAirtime(tally?.airtime ?? 0)}
                  </span>
                  <Stamp status={heli.status} />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <Colours tallies={tallies} />
    </>
  );
}

/**
 * Each heli's colour in the charts, picked from the eight. A colour is dimmed for a heli when another heli flown in
 * the same months has it: the charts of those months could not tell them apart.
 */
function Colours({tallies}: {tallies: Map<string, GroupTally>}) {
  const {doc, put} = useStore();
  const {toast} = useOverlay();
  const color = useSeriesColor();
  const now = today();
  const periodOf = (heli: Heli) => {
    const first = tallies.get(heli.id)?.first ?? heli.createdAt.slice(0, 10);
    const stillHere = heli.status === 'active' || heli.status === 'grounded';
    return {first, last: stillHere ? now : (tallies.get(heli.id)?.last ?? first)};
  };
  const helis = [...doc.helis].sort((left, right) => periodOf(left).first.localeCompare(periodOf(right).first));
  // The heli whose eight colours are open: the others show only their own.
  const [picking, setPicking] = useState<string | null>(null);

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Colours</h2>
        <span className="muted small-note">Tap a colour to change it. Dimmed: taken by a heli flown then</span>
      </div>
      <div className="list">
        {helis.map(heli => {
          const period = periodOf(heli);
          const sharing = new Map<number, string>();
          for (const other of doc.helis) {
            const theirs = periodOf(other);
            if (other.id !== heli.id && theirs.first <= period.last && period.first <= theirs.last) {
              sharing.set(
                other.color,
                sharing.has(other.color) ? `${sharing.get(other.color)}, ${other.name}` : other.name,
              );
            }
          }
          const clash = sharing.get(heli.color);
          return (
            <div key={heli.id} className="colour-row" style={{['--hue' as string]: color(heli.color)}}>
              <span className="row-main">
                <span className="row-title">
                  <span className="name">{heli.name}</span>
                </span>
                <span className="row-sub">
                  {formatDay(period.first, {weekday: false, year: true})} to{' '}
                  {period.last === now ? 'now' : formatDay(period.last, {weekday: false, year: true})}
                  {clash && <span className="clash"> · same colour as {clash} then</span>}
                </span>
              </span>
              {picking !== heli.id ? (
                <button
                  type="button"
                  className="swatch current"
                  aria-label={`${heli.name} is ${(SERIES_NAMES[heli.color] ?? 'grey').toLowerCase()}: change it`}
                  style={{background: color(heli.color)}}
                  onClick={() => setPicking(heli.id)}
                />
              ) : (
                <span className="swatches small" role="group" aria-label={`${heli.name}'s colour`}>
                  {SERIES_NAMES.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      className="swatch"
                      aria-label={label}
                      aria-pressed={index === heli.color}
                      title={sharing.has(index) ? `${label}, also ${sharing.get(index)} in the same months` : label}
                      style={{background: color(index), opacity: sharing.has(index) && index !== heli.color ? 0.3 : 1}}
                      onClick={() => {
                        setPicking(null);
                        if (index === heli.color) return;
                        put('helis', {...heli, color: index});
                        toast(`${heli.name} is ${label.toLowerCase()} now`);
                      }}
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Spares() {
  const {doc, heli, put} = useStore();
  const {open} = useOverlay();
  const rows = useMemo(
    () =>
      doc.spares
        .map(spare => ({spare, stock: spareStock(spare, doc.sorties)}))
        .sort(
          (left, right) =>
            (heli(left.spare.heliId)?.name ?? '').localeCompare(heli(right.spare.heliId)?.name ?? '') ||
            left.spare.name.localeCompare(right.spare.name),
        ),
    [doc.spares, doc.sorties, heli],
  );
  const toBuy = rows.filter(({spare, stock}) => stock < spare.min);
  const cost = toBuy.reduce((sum, {spare, stock}) => sum + (spare.price ?? 0) * (spare.min - Math.max(0, stock)), 0);
  // Parts that broke more than once and are not stocked: worth keeping a few.
  const stocked = new Set(doc.spares.map(spare => partKey(spare.name)));
  const ideas = brokenRanking(doc.sorties.filter(sortie => heli(sortie.heliId)?.status === 'active'))
    .filter(part => part.qty > 1 && !stocked.has(part.key))
    .slice(0, 6);
  const adjust = (spareId: string, stock: number, change: number) => {
    const spare = doc.spares.find(one => one.id === spareId);
    if (spare) put('spares', {...spare, count: Math.max(0, stock + change), countedAt: now()});
  };

  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Spare parts · {rows.length}</h2>
        <button className="button small solid" onClick={() => open(<SpareForm />)}>
          <Plus size={14} /> Add a part
        </button>
      </div>
      {toBuy.length > 0 && (
        <div className="banner">
          <span>
            <ShoppingCart size={15} /> <b>{plural(toBuy.length, 'part')} to buy</b>
            {cost > 0 && <span className="muted"> · about {formatNumber(cost, 2)}</span>}
          </span>
        </div>
      )}
      {rows.length ? (
        <div className="list">
          {rows.map(({spare, stock}) => (
            <div key={spare.id} className="list-row">
              <div className="row-main">
                <div className="row-title">
                  {spare.heliId && <HeliDot heli={heli(spare.heliId)} />}
                  <span className="name">{spare.name}</span>
                  {spare.url && (
                    <a href={spare.url} target="_blank" rel="noreferrer" className="muted" aria-label="Shop">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <div className="row-sub">
                  {heli(spare.heliId)?.name ?? 'Any heli'} · keep {spare.min}
                  {spare.price ? ` · ${formatNumber(spare.price, 2)} each` : ''}
                </div>
              </div>
              <span className={`pill ${stock <= 0 ? 'critical' : stock < spare.min ? 'caution' : 'good'}`}>
                {Math.max(0, stock)} in stock
              </span>
              <div className="toolbar" style={{flexWrap: 'nowrap'}}>
                <button
                  className="icon-button"
                  aria-label={`One less ${spare.name}`}
                  onClick={() => adjust(spare.id, stock, -1)}
                >
                  <Minus size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`One more ${spare.name}`}
                  onClick={() => adjust(spare.id, stock, 1)}
                >
                  <Plus size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Edit ${spare.name}`}
                  onClick={() => open(<SpareForm spare={spare} />)}
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty emoji="🧰">
            No spares yet. Add the parts you keep: each broken part you log comes off their stock.
          </Empty>
        </div>
      )}
      {ideas.length > 0 && (
        <Card title="Worth keeping in stock" sub="Parts that broke more than once on helis still flying">
          <div className="chips">
            {ideas.map(part => (
              <button
                key={part.key}
                className="chip"
                onClick={() =>
                  open(<SpareForm name={part.name} heliId={part.heliIds.length === 1 ? part.heliIds[0] : undefined} />)
                }
              >
                <Plus size={13} /> {part.name} <span className="muted">× {part.qty}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * Packs in a fixed order (the store hands them back in any order): those of the helis still flying first, then the
 * others, the ones with no pack left holding a charge last; bigger packs first, then by name.
 */
function packOrder(helis: Heli[]) {
  const flying = new Set(helis.filter(one => one.status === 'active' || one.status === 'grounded').map(one => one.id));
  const rank = (battery: Battery) =>
    battery.packs.length > 0 && !livePacks(battery).length ? 2 : battery.heliIds.some(id => flying.has(id)) ? 0 : 1;
  return (left: Battery, right: Battery) =>
    rank(left) - rank(right) ||
    right.capacity - left.capacity ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id);
}

function Batteries() {
  const {doc, heli} = useStore();
  const {open} = useOverlay();
  const batteries = useMemo(() => [...doc.batteries].sort(packOrder(doc.helis)), [doc.batteries, doc.helis]);
  // Packs flown of each kind: by their buttons in the logs, else shared out (kindFlights).
  const flights = useMemo(() => kindFlights(doc.sorties, doc.batteries), [doc.sorties, doc.batteries]);
  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Packs · {doc.batteries.length}</h2>
        <button className="button small solid" onClick={() => open(<BatteryForm />)}>
          <Plus size={14} /> Add packs
        </button>
      </div>
      {doc.batteries.length ? (
        <div className="grid grid-auto">
          {batteries.map(battery => {
            const cycles = battery.packs.length ? (flights.get(battery.id) ?? 0) / battery.packs.length : 0;
            const dead = battery.packs.length - livePacks(battery).length;
            const onButtons = livePacks(battery).filter(pack => pack.button);
            return (
              <button
                key={battery.id}
                className="card battery-card"
                onClick={() => open(<BatteryForm battery={battery} />)}
              >
                {battery.photo ? (
                  <div className="battery-photo">
                    <HeliPhoto url={battery.photo} alt={battery.name} />
                  </div>
                ) : (
                  <div className="battery-icon">
                    <BatteryCharging size={22} />
                  </div>
                )}
                <div className="heli-name">{battery.name}</div>
                <div className="muted" style={{fontSize: '0.8125rem'}}>
                  {battery.packs.length} × {battery.cells}S {formatNumber(battery.capacity)} mAh
                  {dead ? <span className="battery-dead"> · {dead} dead</span> : null}
                  {battery.bought && ` · bought ${formatDay(battery.bought, {weekday: false, year: true})}`}
                </div>
                <div className="figures" style={{marginTop: 10}}>
                  <div>
                    <div className="figure-label">Cycles each</div>
                    <div className="figure-value">≈ {formatRate(cycles)}</div>
                  </div>
                  <div>
                    <div className="figure-label">Charge at 1C</div>
                    <div className="figure-value">{formatNumber(battery.capacity / 1000, 1)} A</div>
                  </div>
                  <div>
                    <div className="figure-label">Pack</div>
                    <div className="figure-value">{formatNumber(battery.cells * 3.7, 1)} V</div>
                  </div>
                </div>
                <div className="chips" style={{marginTop: 10}}>
                  {onButtons.length ? (
                    <span className="pill label">
                      {onButtons.map(pack => `#${pack.number} on ${pack.button}`).join(' · ')}
                    </span>
                  ) : null}
                  {battery.heliIds.map(id => (
                    <span key={id} className="pill">
                      <HeliDot heli={heli(id)} /> {heli(id)?.name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <Empty emoji="🔋">No packs yet. Add them to count their cycles from the packs you log.</Empty>
        </div>
      )}
    </>
  );
}

function Notes() {
  const {doc, heli} = useStore();
  const {open} = useOverlay();
  return (
    <>
      <div className="section-head">
        <h2 className="section-title">Notes · {doc.tips.length}</h2>
        <button className="button small solid" onClick={() => open(<TipForm />)}>
          <Plus size={14} /> Add a note
        </button>
      </div>
      {doc.tips.length ? (
        <div className="notes">
          {[...doc.tips]
            .sort((left, right) => left.title.localeCompare(right.title))
            .map(tip => (
              <button key={tip.id} className="card note-card" onClick={() => open(<TipForm tip={tip} />)}>
                <div className="card-title">{tip.title}</div>
                {tip.heliId && (
                  <span className="pill" style={{alignSelf: 'flex-start'}}>
                    <HeliDot heli={heli(tip.heliId)} /> {heli(tip.heliId)?.name}
                  </span>
                )}
                <p className="prose note-body">{tip.body}</p>
              </button>
            ))}
        </div>
      ) : (
        <div className="panel">
          <Empty emoji="📒">Setups, checks, tricks: keep them here.</Empty>
        </div>
      )}
    </>
  );
}

/** The hangar: the fleet, and what keeps it flying. */
export function Hangar() {
  const {view} = useParams();
  const [params, setParams] = useSearchParams();
  const {open} = useOverlay();

  useEffect(() => {
    if (params.get('add') !== '1') return;
    setParams({}, {replace: true});
    open(<HeliForm />);
  }, [params, setParams, open]);

  return (
    <div className="page">
      <PageHeader title="Hangar" sub="The helis, their gear, and what keeps them flying" />
      <VisitorBanner />
      <nav className="segmented" aria-label="Hangar">
        {VIEWS.map(item => (
          <Link key={item.to} to={item.to} aria-current={item.view === view ? 'page' : undefined} replace>
            {item.label}
          </Link>
        ))}
      </nav>
      {view === 'spares' && SHOW_SPARES ? (
        <Spares />
      ) : view === 'batteries' ? (
        <Batteries />
      ) : view === 'notes' ? (
        <Notes />
      ) : (
        <Fleet />
      )}
    </div>
  );
}
