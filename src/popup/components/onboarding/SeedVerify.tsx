import { useState } from 'preact/hooks';

export function SeedVerify({
  words,
  verifyIndices,
  onVerified,
  onBack,
}: {
  words: string[];
  verifyIndices: number[];
  onVerified: (verifiedWords: Record<number, string>) => void;
  onBack: () => void;
}) {
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    setError('');

    // Check each word
    for (const idx of verifyIndices) {
      const input = (inputs[idx] || '').toLowerCase().trim();
      if (input !== words[idx]) {
        setError(`Word #${idx + 1} is incorrect. Please check your backup.`);
        return;
      }
    }

    onVerified(inputs);
  };

  return (
    <div class="lock-screen" style={{ padding: '16px' }}>
      <h2 class="lock-title" style={{ fontSize: '18px', marginBottom: '8px' }}>
        Verify Your Backup
      </h2>
      <p class="lock-text" style={{ fontSize: '12px', marginBottom: '16px' }}>
        Enter the following words from your recovery phrase to confirm you saved it.
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        {verifyIndices.map((idx) => (
          <div key={idx} class="form-group" style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px', display: 'block' }}>
              Word #{idx + 1}
            </label>
            <input
              type="text"
              class="form-input"
              placeholder={`Enter word #${idx + 1}`}
              value={inputs[idx] || ''}
              onInput={(e) =>
                setInputs({ ...inputs, [idx]: (e.target as HTMLInputElement).value })
              }
              autoComplete="off"
              autoCapitalize="off"
            />
          </div>
        ))}

        {error && (
          <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            class="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={onBack}
          >
            Back
          </button>
          <button type="submit" class="btn btn-primary" style={{ flex: 1 }}>
            Verify
          </button>
        </div>
      </form>
    </div>
  );
}
