/**
 * Wallet Module
 *
 * Re-exports all wallet handlers for use by the background message router.
 */

// State queries
export {
  handleGetWalletState,
  handleGetOnboardingState,
  handleSaveOnboardingState,
  handleClearOnboardingState,
  handleGetPendingMnemonic,
} from './state';

// Wallet creation
export {
  handleGenerateMnemonic,
  handleConfirmMnemonic,
  handleCreateWallet,
  createWalletFromMnemonic,
} from './create';

// Wallet restoration
export { handleRestoreWallet } from './restore';

// Session management (unlock/lock)
export {
  handleUnlockWallet,
  handleLockWallet,
  ensureValidAuth,
} from './session';

// Security operations (seed reveal, password change)
export {
  handleRevealSeed,
  handleGetFingerprint,
  handleChangePassword,
} from './security';

// Address derivation
export {
  getAddressForAsset,
  handleGetAddresses,
} from './addresses';

// Registration (internal, but exported for session.ts)
export {
  registerWithBackend,
  registerWithBackendRetry,
  registerWithLws,
  registerWithLwsFromUnlockedKeys,
} from './registration';

// Types
export type { DerivedKeys, RestoreHeights } from './types';
