import { useState, useEffect } from 'preact/hooks';
import type { OnboardingState } from '@/types';
import { sendMessage } from '../shared';
import {
  OnboardingChoice,
  SeedDisplay,
  SeedVerify,
  PasswordSetup,
  RestoreWallet,
  WalletCreatingScreen,
} from './onboarding';

type OnboardingStep = 'choice' | 'generate' | 'verify' | 'password' | 'restore' | 'creating';

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<OnboardingStep>('choice');
  const [words, setWords] = useState<string[]>([]);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [verifiedWords, setVerifiedWords] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);

  // Load persisted onboarding state on mount
  useEffect(() => {
    loadOnboardingState();
  }, []);

  const loadOnboardingState = async () => {
    try {
      const result = await sendMessage<{ state: OnboardingState | null }>({
        type: 'GET_ONBOARDING_STATE',
      });

      if (result.state) {
        // Restore previous state
        if (result.state.step === 'restore') {
          setStep('choice'); // Show restore option from choice screen
        } else {
          setStep(result.state.step);
        }
        if (result.state.words) setWords(result.state.words);
        if (result.state.verifyIndices) setVerifyIndices(result.state.verifyIndices);
      }
    } catch (err) {
      console.error('Failed to load onboarding state:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveState = async (newStep: OnboardingStep, newWords?: string[], newIndices?: number[]) => {
    const state: OnboardingState = {
      step: newStep,
      words: newWords ?? words,
      verifyIndices: newIndices ?? verifyIndices,
      createdAt: Date.now(),
    };
    await sendMessage({ type: 'SAVE_ONBOARDING_STATE', state });
  };

  const clearState = async () => {
    await sendMessage({ type: 'CLEAR_ONBOARDING_STATE' });
  };

  const handleCreateNew = async () => {
    try {
      const result = await sendMessage<{ words: string[]; verifyIndices: number[] }>({
        type: 'GENERATE_MNEMONIC',
      });
      setWords(result.words);
      setVerifyIndices(result.verifyIndices);
      setStep('generate');
      // Persist state so user can click away and come back
      await saveState('generate', result.words, result.verifyIndices);
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
    }
  };

  const handleRestore = async () => {
    setStep('restore' as OnboardingStep);
    await saveState('restore' as OnboardingStep);
  };

  const handleComplete = async () => {
    await clearState();
    onComplete();
  };

  const handleBackToChoice = async () => {
    setStep('choice');
    await clearState();
  };

  if (loading) {
    return (
      <div class="lock-screen">
        <div class="spinner" />
      </div>
    );
  }

  if (step === 'restore') {
    return <RestoreWallet onComplete={handleComplete} onBack={handleBackToChoice} />;
  }

  switch (step) {
    case 'choice':
      return <OnboardingChoice onCreateNew={handleCreateNew} onRestore={handleRestore} />;
    case 'generate':
      return (
        <SeedDisplay
          words={words}
          onContinue={async () => {
            setStep('verify');
            await saveState('verify');
          }}
          onBack={handleBackToChoice}
        />
      );
    case 'verify':
      return (
        <SeedVerify
          words={words}
          verifyIndices={verifyIndices}
          onVerified={async (verified) => {
            setVerifiedWords(verified);
            setStep('password');
            await saveState('password');
          }}
          onBack={async () => {
            setStep('generate');
            await saveState('generate');
          }}
        />
      );
    case 'password':
      return (
        <PasswordSetup
          verifiedWords={verifiedWords}
          words={words}
          onComplete={handleComplete}
          onBack={handleBackToChoice}
        />
      );
    case 'creating':
      return <WalletCreatingScreen onComplete={handleComplete} />;
  }
}
