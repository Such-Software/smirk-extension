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
    </>
  );
}
