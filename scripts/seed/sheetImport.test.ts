import {describe, expect, it} from 'vitest';
import {importSheets, splitEmoji} from './sheetImport';
import {cellKey, type Cell, type Sheet} from './xlsx';

/** A log laid out like a Google Sheets flight log: totals on top, a header, a year on its own row. */
function logSheet(): Sheet {
  const rows: Cell[][] = [
    [null, 'Total sorties 🚁', 3],
    [],
    [
      'Date 📅',
      'Machine 🚁',
      'Location📍',
      'Packs 🔋',
      'Timer ⏱️',
      'Duration ⏳',
      'Crashes 💥',
      'Broken parts 🔧',
      'Comms 📝',
    ],
    [2023],
    [44960, 'M2 EVO 🟠', 'CVAN 🛶', 4, 300 / 86400, 0.0125, 1, '- Main shaft\n- Servo arm x2', 'Practicing figure 8s'],
    ['26/02/2023', 'M1', 'Kerdiret', 1, '04:00 m', '00:04 h', '?', '', 'First flight with M1'],
    [45000, 'M2 EVO 🟠', 'Kerdiret 🏡', 2, 280 / 86400, 0.01, 0, '', 'Last flight before sell'],
    [45001, 'M2 EVO ⚪️', '🏠', 1, 300 / 86400, 0.003, 2, '- 🚁', 'Lost it over the woods'],
  ];
  return {name: 'Logs', rows, links: new Map([[cellKey(5, 8), 'https://photos.google.com/photo/abc']])};
}

describe('splitEmoji', () => {
  it('keeps the name apart from its emoji', () => {
    expect(splitEmoji('Port Barbe 🐎')).toEqual({name: 'Port Barbe', emoji: '🐎'});
    expect(splitEmoji('🏠')).toEqual({name: 'Home', emoji: '🏠'});
    expect(splitEmoji('Other')).toEqual({name: 'Other', emoji: undefined});
  });
});

describe('importSheets', () => {
  const {doc, report} = importSheets([
    logSheet(),
    {name: 'Tips', rows: [['Tips & tricks'], ['Level swashplate']], links: new Map()},
  ]);

  it('reads every sortie row and skips the year rows', () => {
    expect(report.sorties).toBe(4);
    expect(report.skipped).toEqual([]);
    const [first, second] = [...doc.sorties].sort((left, right) => left.date.localeCompare(right.date));
    expect(first.date).toBe('2023-02-03');
    expect(first.timer).toBe(300);
    expect(first.broken).toEqual([
      {part: 'Main shaft', qty: 1},
      {part: 'Servo arm', qty: 2},
    ]);
    expect(first.skills).toEqual(['Figure 8']);
    expect(second.crashes).toBeNull();
    expect(second.timer).toBe(240);
    expect(second.links).toEqual(['https://photos.google.com/photo/abc']);
  });

  it('makes one spot of a place written with and without its emoji', () => {
    expect(doc.spots.map(spot => `${spot.emoji ?? ''}${spot.name}`).sort()).toEqual(['🏠Home', '🏡Kerdiret', '🛶CVAN']);
  });

  it('fills in each heli: maker, colour from its emoji, lost or sold', () => {
    const byName = Object.fromEntries(doc.helis.map(heli => [heli.name, heli]));
    expect(byName['M2 EVO 🟠'].color).toBe(1);
    expect(byName['M2 EVO 🟠'].maker).toBe('OMPHobby');
    expect(byName['M2 EVO 🟠'].status).toBe('sold');
    expect(byName['M2 EVO 🟠'].timer).toBe(280);
    expect(byName['M2 EVO ⚪️'].status).toBe('lost');
    expect(new Set(doc.helis.map(heli => heli.color)).size).toBe(3);
  });

  it('turns other tabs into notes', () => {
    expect(doc.tips).toEqual([expect.objectContaining({title: 'Tips', body: 'Tips & tricks\nLevel swashplate'})]);
  });
});
