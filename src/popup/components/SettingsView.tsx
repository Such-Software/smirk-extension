import { useState, useEffect } from 'preact/hooks';
import type { AssetType, UserSettings } from '@/types';
import { ASSETS, sendMessage } from '../shared';
import { initWasm, getWasmVersion } from '@/lib/xmr-tx';

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 0, label: 'Never' },
];

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [wasmStatus, setWasmStatus] = useState<string | null>(null);

  // Seed reveal state
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [seedWords, setSeedWords] = useState<string[] | null>(null);
  const [seedError, setSeedError] = useState('');
  const [revealingSeeed, setRevealingSeed] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const result = await sendMessage<{ settings: UserSettings }>({ type: 'GET_SETTINGS' });
      setSettings(result.settings);
    } catch (err) {
      setError('Failed to load settings');
    }
  };

  const updateSetting = async <K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    if (!settings) return;

    setSaving(true);
    setError('');

    try {
      const result = await sendMessage<{ settings: UserSettings }>({
        type: 'UPDATE_SETTINGS',
        settings: { [key]: value },
      });
      setSettings(result.settings);
    } catch (err) {
      setError('Failed to save setting');
    } finally {
      setSaving(false);
    }
  };

  const handleRevealSeed = async () => {
    if (!seedPassword) {
      setSeedError('Please enter your password');
      return;
    }

    setRevealingSeed(true);
    setSeedError('');

    try {
      const result = await sendMessage<{ words: string[] }>({
        type: 'REVEAL_SEED',
        password: seedPassword,
      });
      setSeedWords(result.words);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setRevealingSeed(false);
    }
  };

  const closeSeedModal = () => {
    setShowSeedModal(false);
    setSeedPassword('');
    setSeedWords(null);
    setSeedError('');
  };

  return (
    <>
      <header class="header">
        <button class="btn btn-icon" onClick={onBack} title="Back">←</button>
        <h1 style={{ flex: 1, textAlign: 'center' }}>Settings</h1>
        <div style={{ width: '32px' }} /> {/* Spacer for centering */}
      </header>

      <div class="content">
        {error && (
          <div class="error-box" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {!settings ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <span class="spinner" />
          </div>
        ) : (
          <>
            {/* Security Section */}
            <div class="section-title">Security</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                  Auto-lock after inactivity
                </label>
                <select
                  value={settings.autoLockMinutes}
                  onChange={(e) => updateSetting('autoLockMinutes', parseInt((e.target as HTMLSelectElement).value))}
                  disabled={saving}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #3f3f46',
                    background: '#18181b',
                    color: '#fff',
                    fontSize: '14px',
                  }}
                >
                  {AUTO_LOCK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>
                  Wallet will lock automatically after this period of inactivity
                </div>
              </div>

              {/* Show Recovery Phrase */}
              <div style={{ borderTop: '1px solid #3f3f46', paddingTop: '12px' }}>
                <button
                  class="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => setShowSeedModal(true)}
                >
                  Show Recovery Phrase
                </button>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '4px' }}>
                  View your 12-word seed phrase for backup
                </div>
              </div>
            </div>

            {/* Notifications Section */}
            <div class="section-title">Notifications</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '13px' }}>Notify on incoming tips</span>
                <input
                  type="checkbox"
                  checked={settings.notifyOnTip}
                  onChange={(e) => updateSetting('notifyOnTip', (e.target as HTMLInputElement).checked)}
                  disabled={saving}
                  style={{ width: '18px', height: '18px' }}
                />
              </label>
            </div>

            {/* Default Asset Section */}
            <div class="section-title">Default Asset</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <select
                value={settings.defaultAsset}
                onChange={(e) => updateSetting('defaultAsset', (e.target as HTMLSelectElement).value as AssetType)}
                disabled={saving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #3f3f46',
                  background: '#18181b',
                  color: '#fff',
                  fontSize: '14px',
                }}
              >
                {(['btc', 'ltc', 'xmr', 'wow', 'grin'] as AssetType[]).map((asset) => (
                  <option key={asset} value={asset}>
                    {ASSETS[asset].name} ({ASSETS[asset].symbol})
                  </option>
                ))}
              </select>
            </div>

            {/* Debug Section */}
            <div class="section-title">Debug</div>
            <div
              style={{
                background: '#27272a',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
              }}
            >
              <button
                class="btn btn-secondary"
                style={{ width: '100%', marginBottom: '8px' }}
                onClick={async () => {
                  setWasmStatus('Loading...');
                  try {
                    await initWasm();
                    const version = await getWasmVersion();
                    setWasmStatus(`WASM OK - v${version}`);
                  } catch (err) {
                    setWasmStatus(`Error: ${(err as Error).message}`);
                  }
                }}
              >
                Test WASM Loading
              </button>
              {wasmStatus && (
                <div style={{ fontSize: '12px', color: wasmStatus.startsWith('Error') ? '#ef4444' : '#22c55e' }}>
                  {wasmStatus}
                </div>
              )}
            </div>

            {/* Version Info */}
            <div style={{ textAlign: 'center', fontSize: '11px', color: '#71717a', marginTop: '24px' }}>
              Smirk Wallet v0.1.0
            </div>
          </>
        )}
      </div>

      {/* Seed Reveal Modal */}
      {showSeedModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSeedModal();
          }}
        >
          <div
            style={{
              background: '#18181b',
              borderRadius: '12px',
              padding: '20px',
              width: '100%',
              maxWidth: '340px',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', textAlign: 'center' }}>
              {seedWords ? 'Recovery Phrase' : 'Enter Password'}
            </h2>

            {!seedWords ? (
              <>
                {/* Warning */}
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: '#fca5a5',
                  }}
                >
                  <strong>Warning:</strong> Never share your recovery phrase. Anyone with these
                  words can steal your funds.
                </div>

                {/* Password Input */}
                <input
                  type="password"
                  class="form-input"
                  placeholder="Enter your password"
                  value={seedPassword}
                  onInput={(e) => setSeedPassword((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRevealSeed();
                  }}
                  style={{ marginBottom: '12px' }}
                  autoFocus
                />

                {seedError && (
                  <p style={{ color: '#ef4444', fontSize: '13px', margin: '0 0 12px' }}>
                    {seedError}
                  </p>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    class="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={closeSeedModal}
                  >
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleRevealSeed}
                    disabled={revealingSeeed || !seedPassword}
                  >
                    {revealingSeeed ? <span class="spinner" style={{ width: '16px', height: '16px' }} /> : 'Reveal'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Seed Words Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '8px',
                    marginBottom: '16px',
                  }}
                >
                  {seedWords.map((word, i) => (
                    <div
                      key={i}
                      style={{
                        background: '#27272a',
                        borderRadius: '6px',
                        padding: '8px',
                        fontSize: '12px',
                        textAlign: 'center',
                      }}
                    >
                      <span style={{ color: '#71717a', marginRight: '4px' }}>{i + 1}.</span>
                      {word}
                    </div>
                  ))}
                </div>

                {/* Warning */}
                <div
                  style={{
                    background: 'rgba(234, 179, 8, 0.1)',
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: '#fde047',
                  }}
                >
                  Write these words down and store them safely. This is the only way to recover
                  your wallet if you lose access.
                </div>

                <button
                  class="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={closeSeedModal}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
