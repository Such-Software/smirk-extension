import { useState, useEffect } from 'preact/hooks';
import type { AssetType, Theme, UserSettings } from '@/types';
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

/** Apply theme to the document body */
export function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.removeAttribute('data-theme');
  }
}

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

  // Apply theme when settings change
  useEffect(() => {
    if (settings?.theme) {
      applyTheme(settings.theme);
    }
  }, [settings?.theme]);

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
            {/* Appearance Section */}
            <div class="section-title">Appearance</div>
            <div class="settings-card">
              <label class="theme-toggle">
                <span style={{ fontSize: '13px' }}>Light mode</span>
                <div
                  class={`toggle-switch ${settings.theme === 'light' ? 'active' : ''}`}
                  onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : 'light')}
                >
                  <div class="toggle-knob" />
                </div>
              </label>
            </div>

            {/* Security Section */}
            <div class="section-title">Security</div>
            <div class="settings-card">
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px' }}>
                  Auto-lock after inactivity
                </label>
                <select
                  class="settings-select"
                  value={settings.autoLockMinutes}
                  onChange={(e) => updateSetting('autoLockMinutes', parseInt((e.target as HTMLSelectElement).value))}
                  disabled={saving}
                >
                  {AUTO_LOCK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div class="settings-hint">
                  Wallet will lock automatically after this period of inactivity
                </div>
              </div>

              {/* Show Recovery Phrase */}
              <div class="settings-card-divider">
                <button
                  class="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => setShowSeedModal(true)}
                >
                  Show Recovery Phrase
                </button>
                <div class="settings-hint">
                  View your 12-word seed phrase for backup
                </div>
              </div>
            </div>

            {/* Notifications Section */}
            <div class="section-title">Notifications</div>
            <div class="settings-card">
              <label class="theme-toggle">
                <span style={{ fontSize: '13px' }}>Notify on incoming tips</span>
                <input
                  type="checkbox"
                  checked={settings.notifyOnTip}
                  onChange={(e) => updateSetting('notifyOnTip', (e.target as HTMLInputElement).checked)}
                  disabled={saving}
                />
              </label>
            </div>

            {/* Default Asset Section */}
            <div class="section-title">Default Asset</div>
            <div class="settings-card">
              <select
                class="settings-select"
                value={settings.defaultAsset}
                onChange={(e) => updateSetting('defaultAsset', (e.target as HTMLSelectElement).value as AssetType)}
                disabled={saving}
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
            <div class="settings-card">
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
                <div style={{ fontSize: '12px', color: wasmStatus.startsWith('Error') ? 'var(--color-error)' : 'var(--color-success)' }}>
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
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSeedModal();
          }}
        >
          <div class="modal-content">
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
                <div class="seed-grid">
                  {seedWords.map((word, i) => (
                    <div key={i} class="seed-word">
                      <span class="seed-word-number">{i + 1}.</span>
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
