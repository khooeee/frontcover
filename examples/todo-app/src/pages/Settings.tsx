import { useState } from 'react';

interface Props {
  onClearAll: () => void;
}

export default function Settings({ onClearAll }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section>
      <h2>Settings</h2>
      {confirming ? (
        <p>
          Delete every todo?{' '}
          <button
            onClick={() => {
              onClearAll();
              setConfirming(false);
            }}
          >
            Yes, delete
          </button>
          <button onClick={() => setConfirming(false)}>Cancel</button>
        </p>
      ) : (
        <button onClick={() => setConfirming(true)}>Clear all todos</button>
      )}
    </section>
  );
}
