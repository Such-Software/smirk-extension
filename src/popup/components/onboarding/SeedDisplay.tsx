import { useState } from 'preact/hooks';

export function SeedDisplay({
  words,
  onContinue,
  onBack,
}: {
  words: string[];
  onContinue: () => void;
  onBack: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(words.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div class="lock-screen" style={{ padding: '16px' }}>
      <h2 class="lock-title" style={{ fontSize: '18px', marginBottom: '8px' }}>
        Write Down Your Recovery Phrase
      </h2>
      <p class="lock-text" style={{ fontSize: '12px', marginBottom: '16px' }}>
        These 12 words are the ONLY way to recover your wallet. Write them down and store safely offline.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          width: '100%',
          marginBottom: '12px',
        }}
      >
        {words.map((word, i) => (
          <div key={i} class="seed-word">
            <span class="seed-word-number">{i + 1}.</span>
            {word}
          </div>
        ))}
      </div>

      <button
        class="btn btn-secondary"
        style={{ width: '100%', marginBottom: '16px' }}
        onClick={handleCopy}
      >
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          marginBottom: '16px',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed((e.target as HTMLInputElement).checked)}
        />
        I have written down my recovery phrase
      </label>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          type="button"
          class="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={onBack}
        >
          Back
        </button>
        <button
          class="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!confirmed}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
