export function OnboardingChoice({
  onCreateNew,
  onRestore,
}: {
  onCreateNew: () => void;
  onRestore: () => void;
}) {
  return (
    <div class="lock-screen">
      <img src="icons/logo_256.png" alt="Smirk" style={{ width: '80px', height: '80px', marginBottom: '16px' }} />
      <h2 class="lock-title">Welcome to Smirk</h2>
      <p class="lock-text">Non-custodial multi-currency tip wallet</p>

      <div style={{ width: '100%', maxWidth: '280px', marginTop: '24px' }}>
        <button class="btn btn-primary" style={{ width: '100%', marginBottom: '12px' }} onClick={onCreateNew}>
          Create New Wallet
        </button>
        <button class="btn btn-secondary" style={{ width: '100%' }} onClick={onRestore}>
          Restore from Seed
        </button>
      </div>
    </div>
  );
}
