import { PlusBurst } from './PlusBurst';

/** Full-screen loading state: the burst, small, while the session resolves. */
export function PlusLoader({ label = 'Loading Code+' }: { label?: string }) {
  return (
    <div className="plus-loader" role="status" aria-live="polite">
      <div style={{ width: 220 }}>
        <PlusBurst />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
