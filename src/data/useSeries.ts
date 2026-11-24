import {useEffect, useState} from 'react';
import {useStore} from './store';
import type {TelemetrySeries} from '../types';

/**
 * The samples of these logs, all read at once: by log id, those that could be read; null while reading. Read again only
 * when the list of ids changes, not on every change to the log.
 */
export function useSeries(ids: readonly string[]): Map<string, TelemetrySeries> | null {
  const {loadSeries} = useStore();
  const key = ids.join('|');
  const [read, setRead] = useState<{key: string; series: Map<string, TelemetrySeries>} | null>(null);
  useEffect(() => {
    let current = true;
    const load = async () => {
      const wanted = key ? key.split('|') : [];
      const found = await Promise.all(wanted.map(async id => [id, await loadSeries(id).catch(() => null)] as const));
      const series = new Map(found.filter((entry): entry is [string, TelemetrySeries] => entry[1] !== null));
      if (current) setRead({key, series});
    };
    void load();
    return () => {
      current = false;
    };
  }, [key, loadSeries]);
  return read?.key === key ? read.series : null;
}
