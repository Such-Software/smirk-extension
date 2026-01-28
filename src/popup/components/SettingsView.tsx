import { useState, useEffect } from 'preact/hooks';
import type { AssetType, Theme, UserSettings } from '@/types';
import type { ConnectedSite } from '@/lib/storage';
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

  // Fingerprint state
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [fingerprintPassword, setFingerprintPassword] = useState('');
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [fingerprintError, setFingerprintError] = useState('');
  const [loadingFingerprint, setLoadingFingerprint] = useState(false);

  // Change password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  // Connected sites state
  const [connectedSites, setConnectedSites] = useState<ConnectedSite[]>([]);
  const [disconnectingOrigin, setDisconnectingOrigin] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadConnectedSites();
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

  const loadConnectedSites = async () => {
    try {
      const result = await sendMessage<{ sites: ConnectedSite[] }>({ type: 'GET_CONNECTED_SITES' });
      setConnectedSites(result.sites);
    } catch (err) {
      console.error('Failed to load connected sites:', err);
    }
  };

  const handleDisconnectSite = async (origin: string) => {
    setDisconnectingOrigin(origin);
    try {
      await sendMessage<{ disconnected: boolean }>({ type: 'DISCONNECT_SITE', origin });
      setConnectedSites((prev) => prev.filter((s) => s.origin !== origin));
    } catch (err) {
      console.error('Failed to disconnect site:', err);
    } finally {
      setDisconnectingOrigin(null);
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

  const handleShowFingerprint = async () => {
    if (!fingerprintPassword) {
      setFingerprintError('Please enter your password');
      return;
    }

    setLoadingFingerprint(true);
    setFingerprintError('');

    try {
      const result = await sendMessage<{ fingerprint: string }>({
        type: 'GET_FINGERPRINT',
        password: fingerprintPassword,
      });
      setFingerprint(result.fingerprint);
    } catch (err) {
      setFingerprintError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setLoadingFingerprint(false);
    }
  };

  const closeFingerprintModal = () => {
    setShowFingerprintModal(false);
    setFingerprintPassword('');
    setFingerprint(null);
    setFingerprintError('');
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }
    if (!newPassword) {
      setPasswordError('Please enter a new password');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setChangingPassword(true);
    setPasswordError('');

    try {
      await sendMessage<{ changed: boolean }>({
        type: 'CHANGE_PASSWORD',
        oldPassword: currentPassword,
        newPassword: newPassword,
      });
      setPasswordChanged(true);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordChanged(false);
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

            {/* Connected Sites Section */}
            <div class="section-title">Connected Sites</div>
            <div class="settings-card">
              {connectedSites.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', padding: '8px 0' }}>
                  No sites connected
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {connectedSites.map((site) => (
                    <div
                      key={site.origin}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px',
                        background: 'var(--color-bg-secondary)',
                        borderRadius: '6px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '12px',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={site.origin}
                        >
                          {site.name || new URL(site.origin).hostname}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                          Connected {new Date(site.connectedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        class="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 8px', minWidth: 'unset' }}
                        onClick={() => handleDisconnectSite(site.origin)}
                        disabled={disconnectingOrigin === site.origin}
                      >
                        {disconnectingOrigin === site.origin ? '...' : 'Disconnect'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div class="settings-hint" style={{ marginTop: '8px' }}>
                Sites with access to sign messages via window.smirk API
              </div>
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

              {/* Show Fingerprint */}
              <div class="settings-card-divider">
                <button
                  class="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => setShowFingerprintModal(true)}
                >
                  Show Seed Fingerprint
                </button>
                <div class="settings-hint">
                  Unique identifier for your seed (for support)
                </div>
              </div>

              {/* Change Password */}
              <div class="settings-card-divider">
                <button
                  class="btn btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => setShowPasswordModal(true)}
                >
                  Change Password
                </button>
                <div class="settings-hint">
                  Update your wallet encryption password
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
            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '24px' }}>
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
                    background: 'var(--color-error-bg)',
                    border: '1px solid var(--color-error)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: 'var(--color-error-text-light)',
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
                    background: 'var(--color-warning-bg)',
                    border: '1px solid var(--color-yellow)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: 'var(--color-warning-text)',
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

      {/* Fingerprint Modal */}
      {showFingerprintModal && (
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFingerprintModal();
          }}
        >
          <div class="modal-content">
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', textAlign: 'center' }}>
              {fingerprint ? 'Seed Fingerprint' : 'Enter Password'}
            </h2>

            {!fingerprint ? (
              <>
                <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                  Enter your password to view your seed fingerprint.
                </p>

                <input
                  type="password"
                  class="form-input"
                  placeholder="Enter your password"
                  value={fingerprintPassword}
                  onInput={(e) => setFingerprintPassword((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleShowFingerprint();
                  }}
                  style={{ marginBottom: '12px' }}
                  autoFocus
                />

                {fingerprintError && (
                  <p style={{ color: '#ef4444', fontSize: '13px', margin: '0 0 12px' }}>
                    {fingerprintError}
                  </p>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button class="btn btn-secondary" style={{ flex: 1 }} onClick={closeFingerprintModal}>
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleShowFingerprint}
                    disabled={loadingFingerprint || !fingerprintPassword}
                  >
                    {loadingFingerprint ? <span class="spinner" style={{ width: '16px', height: '16px' }} /> : 'Show'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    background: 'var(--color-bg-secondary)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    wordBreak: 'break-all',
                    textAlign: 'center',
                  }}
                >
                  {fingerprint}
                </div>

                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
                  This fingerprint uniquely identifies your seed. You can share it with support if needed.
                </p>

                <button class="btn btn-primary" style={{ width: '100%' }} onClick={closeFingerprintModal}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePasswordModal();
          }}
        >
          <div class="modal-content">
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', textAlign: 'center' }}>
              {passwordChanged ? 'Password Changed' : 'Change Password'}
            </h2>

            {!passwordChanged ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                  <input
                    type="password"
                    class="form-input"
                    placeholder="Current password"
                    value={currentPassword}
                    onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
                    autoFocus
                  />
                  <input
                    type="password"
                    class="form-input"
                    placeholder="New password (min 8 characters)"
                    value={newPassword}
                    onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
                  />
                  <input
                    type="password"
                    class="form-input"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleChangePassword();
                    }}
                  />
                </div>

                {passwordError && (
                  <p style={{ color: '#ef4444', fontSize: '13px', margin: '0 0 12px' }}>
                    {passwordError}
                  </p>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button class="btn btn-secondary" style={{ flex: 1 }} onClick={closePasswordModal}>
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleChangePassword}
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                  >
                    {changingPassword ? <span class="spinner" style={{ width: '16px', height: '16px' }} /> : 'Change'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    background: 'var(--color-success-bg)',
                    border: '1px solid var(--color-success)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: 'var(--color-success)',
                    textAlign: 'center',
                  }}
                >
                  Your password has been changed successfully. You will need to use your new password to unlock your wallet.
                </div>

                <button class="btn btn-primary" style={{ width: '100%' }} onClick={closePasswordModal}>
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
