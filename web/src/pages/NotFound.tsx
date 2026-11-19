import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PlusBurst } from '../components/PlusBurst';

export function NotFound() {
  useEffect(() => {
    document.title = 'Not found · Code+';
  }, []);
  return (
    <main className="not-found">
      <div style={{ width: 220 }}>
        <PlusBurst />
      </div>
      <h1>404</h1>
      <p>That page exited with a non-zero status. It may have moved, or it never existed.</p>
      <Link to="/problems" className="btn btn-primary">
        Back to problems
      </Link>
    </main>
  );
}
