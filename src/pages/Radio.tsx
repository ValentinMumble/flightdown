import {lazy, Suspense} from 'react';
import {PageHeader} from '../components/ui';
import {VisitorBanner} from '../components/VisitorBanner';

const RadioView = lazy(() => import('./RadioView'));

/** The TX16S, a tab of its own: its screens as the radio draws them, its switches and logic, set by hand or replayed. */
export function Radio() {
  return (
    <div className="page">
      <PageHeader title="Radio" sub="The TX16S: its screens, switches and logic, by hand or replayed" />
      <VisitorBanner />
      <Suspense fallback={<div className="panel radio-loading">Starting the radio…</div>}>
        <RadioView />
      </Suspense>
    </div>
  );
}
