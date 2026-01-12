import { useState, useEffect } from 'preact/hooks';
import { sendMessage } from '../../shared';

export function WalletCreatingScreen({ onComplete }: { onComplete: () => void }) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if wallet was created while popup was closed
    const checkWalletState = async () => {
      try {
        const result = await sendMessage<{ hasWallet: boolean; isUnlocked: boolean }>({
          type: 'GET_WALLET_STATE',
        });

        if (result.hasWallet) {
          // Wallet was created successfully, complete onboarding
          onComplete();
        } else {
          // Still creating... keep showing this screen
          setChecking(false);
        }
      } catch (err) {
        console.error('Failed to check wallet state:', err);
        setChecking(false);
      }
    };

    checkWalletState();

    // Poll periodically in case creation finishes
    const interval = setInterval(checkWalletState, 1000);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div class="lock-screen">
      <div class="spinner" style={{ width: '48px', height: '48px', marginBottom: '24px' }} />
      <h2 class="lock-title" style={{ marginBottom: '8px' }}>
        {checking ? 'Checking...' : 'Creating Wallet'}
      </h2>
      <p class="lock-text">
        {checking ? 'Please wait...' : 'Your wallet is being created. This may take a moment...'}
      </p>
      <p class="lock-text" style={{ fontSize: '12px', marginTop: '16px', color: '#71717a' }}>
        Please keep this window open.
      </p>
    </div>
  );
}
