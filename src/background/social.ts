/**
 * Social tipping background handlers.
 *
 * Handles:
 * - Social username lookup
 * - Social tip creation (with actual fund transfer + ECIES encryption)
 * - Claimable tips retrieval
 * - Tip claiming (decrypt key + sweep funds)
 * - Tip clawback
 *
 * Fund Transfer Flow (BTC/LTC):
 * 1. Sender creates tip:
 *    - Generate ephemeral tip keypair
 *    - Derive tip address from tip pubkey
 *    - Send funds from sender's wallet to tip address
 *    - Encrypt tip private key with recipient's BTC public key (ECIES)
 *    - Store encrypted_key, tip_address, funding_txid on backend
 *
 * 2. Recipient claims tip:
 *    - Fetch encrypted_key and tip_address from backend
 *    - Decrypt tip private key using recipient's BTC private key
 *    - Sweep funds from tip address to recipient's wallet
 *
 * Fund Transfer Flow (XMR/WOW):
 * 1. Sender creates tip:
 *    - Generate random spend key, derive view key and address
 *    - Send funds from sender's wallet to tip address
 *    - Encrypt spend key with recipient's BTC public key (ECIES)
 *    - Store encrypted_key, tip_address, funding_txid on backend
 *
 * 2. Recipient claims tip:
 *    - Fetch encrypted_key and tip_address from backend
 *    - Decrypt spend key, derive view key
 *    - Sweep funds from tip address to recipient's wallet
 *
 * Fund Transfer Flow (GRIN) - Voucher Model:
 * Unlike UTXO chains, Grin uses interactive Mimblewimble transactions.
 * Social tips use a "voucher" approach where the sender pre-commits funds
 * and the recipient can claim them without interaction.
 *
 * 1. Sender creates voucher:
 *    - Sender sends Grin to themselves (creates a confirmed output)
 *    - Extract the output's raw blinding factor (32 bytes)
 *    - Store voucher: { commitment, proof, amount, blinding_factor (encrypted) }
 *    - The blinding factor is encrypted with recipient's BTC public key (ECIES)
 *
 * 2. Recipient claims voucher:
 *    - Decrypt blinding factor using BTC private key
 *    - Build a "voucher sweep" transaction:
 *      - Input: voucher output (using stored blinding factor)
 *      - Output: recipient's new output (using their own key derivation)
 *    - Since claimer controls BOTH blinding factors (voucher + their output),
 *      they can build the kernel excess and sign it non-interactively
 *    - Broadcast the transaction
 *
 * Technical details for Grin voucher sweep:
 * - Kernel excess = output_blind - input_blind (no interaction needed)
 * - Claimer provides both partial signatures → can finalize themselves
 * - This is similar to a self-transfer/consolidation transaction
 * - Requires custom transaction building in grin/voucher.ts
 */

import type { MessageResponse, AssetType, SocialLookupResult, SocialTipResult } from '@/types';
import { api } from '@/lib/api';
import {
  createEncryptedTipPayload,
  decryptTipPayload,
  generatePrivateKey,
  getPublicKey,
  bytesToHex,
  hexToBytes,
  randomBytes,
} from '@/lib/crypto';
import { btcAddress, ltcAddress, xmrAddress, wowAddress } from '@/lib/address';
import { createSignedTransaction as createBtcSignedTransaction, type Utxo } from '@/lib/btc-tx';
import { sendTransaction as sendXmrTransaction, createSignedTransaction as createXmrSignedTransaction } from '@/lib/xmr-tx';
import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519';
import { isUnlocked, unlockedKeys, unlockedViewKeys } from './state';
import {
  getWalletState,
  addPendingSocialTip,
  getPendingSocialTip,
  updatePendingSocialTipStatus,
  type PendingSocialTip,
} from '@/lib/storage';
import { getAddressForAsset } from './wallet';
import { encrypt, decrypt, deriveKeyFromPassword } from '@/lib/crypto';

/**
 * Look up a social platform username to check if they're registered.
 *
 * Returns the user's public keys if registered (for encrypting tips).
 */
export async function handleLookupSocial(
  platform: string,
  username: string
): Promise<MessageResponse<SocialLookupResult>> {
  try {
    const result = await api.lookupSocial(platform, username);

    if (result.error) {
      return { success: false, error: result.error };
    }

    const data = result.data!;
    return {
      success: true,
      data: {
        registered: data.registered,
        userId: data.user_id,
        publicKeys: data.public_keys,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to lookup user',
    };
  }
}

/**
 * Generate tip address from a private key for BTC or LTC.
 */
function getBtcLtcTipAddress(asset: 'btc' | 'ltc', privateKey: Uint8Array): string {
  const publicKey = getPublicKey(privateKey, true); // compressed
  return asset === 'btc' ? btcAddress(publicKey) : ltcAddress(publicKey);
}

/**
 * Convert 32 bytes to a valid ed25519 scalar (reduce mod l).
 */
function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = 0; i < 32; i++) {
    scalar += BigInt(bytes[i]) << BigInt(8 * i);
  }
  // Reduce mod l (ed25519 curve order)
  const l = 2n ** 252n + 27742317777372353535851937790883648493n;
  return scalar % l;
}

/**
 * Convert a BigInt scalar to 32 bytes (little-endian).
 */
function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Generate XMR/WOW tip wallet keys from a random seed.
 * Returns spend key, view key, and address.
 */
function generateXmrWowTipKeys(asset: 'xmr' | 'wow'): {
  spendKey: Uint8Array;
  viewKey: Uint8Array;
  publicSpendKey: Uint8Array;
  publicViewKey: Uint8Array;
  address: string;
} {
  // Generate random bytes for spend key
  const spendKeySeed = randomBytes(32);
  const spendKeyScalar = bytesToScalar(spendKeySeed);
  const spendKey = scalarToBytes(spendKeyScalar);

  // Derive view key from spend key (Monero standard: Hs(private_spend_key))
  const viewKeySeed = sha256(spendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  const viewKey = scalarToBytes(viewKeyScalar);

  // Derive public keys
  const publicSpendKey = ed25519.ExtendedPoint.BASE.multiply(spendKeyScalar).toRawBytes();
  const publicViewKey = ed25519.ExtendedPoint.BASE.multiply(viewKeyScalar).toRawBytes();

  // Generate address
  const address = asset === 'xmr'
    ? xmrAddress(publicSpendKey, publicViewKey)
    : wowAddress(publicSpendKey, publicViewKey);

  return { spendKey, viewKey, publicSpendKey, publicViewKey, address };
}

/**
 * Derive view key from spend key (Monero standard).
 */
function deriveViewKeyFromSpendKey(spendKey: Uint8Array): Uint8Array {
  const viewKeySeed = sha256(spendKey);
  const viewKeyScalar = bytesToScalar(viewKeySeed);
  return scalarToBytes(viewKeyScalar);
}

/**
 * Create a social tip with ACTUAL fund transfer.
 *
 * For BTC/LTC targeted tips:
 * 1. Generate ephemeral tip keypair
 * 2. Derive tip address from tip public key
 * 3. Send funds from sender's wallet to tip address
 * 4. Encrypt tip private key with recipient's BTC public key (ECIES)
 * 5. Store encrypted_key, tip_address, funding_txid on backend
 *
 * For XMR/WOW targeted tips:
 * 1. Generate random spend key, derive view key and address
 * 2. Send funds from sender's wallet to tip address
 * 3. Encrypt spend key with recipient's BTC public key (ECIES)
 * 4. Store encrypted_key, tip_address, funding_txid on backend
 */
export async function handleCreateSocialTip(
  platform: string,
  username: string,
  asset: AssetType,
  amount: number,
  recipientBtcPubkey?: string
): Promise<MessageResponse<SocialTipResult>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    const isPublic = !platform || !username;

    // Grin requires voucher model - see grin/voucher.ts for implementation plan
    // Unlike UTXO chains, Grin needs custom tx building with raw blinding factors
    if (asset === 'grin') {
      return { success: false, error: 'Grin social tips use vouchers (in development). Use Grin relay send instead.' };
    }

    // Public tips are not yet implemented with real funds
    if (isPublic) {
      return { success: false, error: 'Public tips not yet implemented' };
    }

    // Targeted tip: requires recipient's BTC public key for encryption
    if (!recipientBtcPubkey) {
      return { success: false, error: 'Recipient BTC public key required for targeted tips' };
    }

    // Get sender's wallet state
    const state = await getWalletState();
    const senderKey = state.keys[asset];
    if (!senderKey) {
      return { success: false, error: `No ${asset} key found in wallet` };
    }
    const senderAddress = getAddressForAsset(asset, senderKey);

    let tipAddress: string;
    let tipPrivateKey: Uint8Array;
    let fundingTxid: string;
    let actualAmount: number;

    if (asset === 'btc' || asset === 'ltc') {
      // BTC/LTC flow
      const senderPrivateKey = unlockedKeys.get(asset);
      if (!senderPrivateKey) {
        return { success: false, error: `No ${asset} key available` };
      }

      // Step 1: Generate ephemeral tip keypair
      tipPrivateKey = generatePrivateKey();
      tipAddress = getBtcLtcTipAddress(asset, tipPrivateKey);

      console.log(`[SocialTip] Generated ${asset} tip address: ${tipAddress}`);

      // Step 2: Fetch UTXOs from sender's wallet
      const utxoResult = await api.getUtxos(asset, senderAddress);
      if (utxoResult.error || !utxoResult.data) {
        return { success: false, error: utxoResult.error || 'Failed to fetch UTXOs' };
      }

      const utxos: Utxo[] = utxoResult.data.utxos;
      if (utxos.length === 0) {
        return { success: false, error: 'No UTXOs available' };
      }

      // Step 3: Estimate fee
      const feeResult = await api.estimateFee(asset);
      const feeRate = feeResult.data?.normal ?? 10;

      // Step 4: Build and sign transaction to tip address
      let txHex: string;

      try {
        const txResult = createBtcSignedTransaction(
          asset,
          utxos,
          tipAddress,
          amount,
          senderAddress,
          senderPrivateKey,
          feeRate,
          false
        );
        txHex = txResult.txHex;
        actualAmount = txResult.actualAmount;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create transaction',
        };
      }

      // Step 5: Broadcast transaction
      const broadcastResult = await api.broadcastTx(asset, txHex);
      if (broadcastResult.error) {
        return { success: false, error: `Broadcast failed: ${broadcastResult.error}` };
      }

      fundingTxid = broadcastResult.data!.txid;
      console.log(`[SocialTip] ${asset.toUpperCase()} broadcast successful: ${fundingTxid}`);

    } else if (asset === 'xmr' || asset === 'wow') {
      // XMR/WOW flow
      const senderSpendKey = unlockedKeys.get(asset);
      const senderViewKey = unlockedViewKeys.get(asset);
      if (!senderSpendKey || !senderViewKey) {
        return { success: false, error: `No ${asset} keys available` };
      }

      // Step 1: Generate tip wallet keys
      const tipKeys = generateXmrWowTipKeys(asset);
      tipPrivateKey = tipKeys.spendKey; // We only need to encrypt the spend key
      tipAddress = tipKeys.address;

      console.log(`[SocialTip] Generated ${asset} tip address: ${tipAddress}`);

      // Step 2: Send funds to tip address
      try {
        const txResult = await sendXmrTransaction(
          asset,
          senderAddress,
          bytesToHex(senderViewKey),
          bytesToHex(senderSpendKey),
          tipAddress,
          amount,
          'mainnet',
          false
        );
        fundingTxid = txResult.txHash;
        actualAmount = txResult.actualAmount;
        console.log(`[SocialTip] ${asset.toUpperCase()} tx sent: ${fundingTxid}, amount: ${actualAmount}`);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to send transaction',
        };
      }

    } else {
      return { success: false, error: `Social tips not supported for ${asset}` };
    }

    // Step 6: Encrypt tip private key with recipient's BTC public key using ECIES
    const recipientPubkeyBytes = hexToBytes(recipientBtcPubkey);
    const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(
      tipPrivateKey,
      recipientPubkeyBytes
    );

    // Combine ephemeral pubkey and encrypted key for storage
    const encrypted_key = ephemeralPubkey + encryptedKey;

    // Step 7: Create tip on backend
    const result = await api.createSocialTip({
      platform,
      username,
      asset,
      amount: actualAmount!,
      is_public: false,
      encrypted_key,
      tip_address: tipAddress,
      funding_txid: fundingTxid!,
    });

    if (result.error) {
      console.error('[SocialTip] Backend failed after broadcast:', result.error);
      return {
        success: false,
        error: `Tip funded but backend error: ${result.error}. Funds at ${tipAddress}`,
      };
    }

    console.log(`[SocialTip] Tip created successfully: ${result.data!.tip_id}`);

    // Step 8: Store tip key locally for clawback (encrypted with wallet's encryption key)
    // Use the same salt as the wallet to derive the same encryption key
    if (state.seedSalt) {
      try {
        const saltBytes = hexToBytes(state.seedSalt);
        // We need to derive the encryption key - but we don't have the password here
        // Instead, store the tip key encrypted with a key derived from the wallet's BTC private key
        // This way, the sender can always recover their tip keys when wallet is unlocked
        const senderBtcKey = unlockedKeys.get('btc');
        if (senderBtcKey) {
          // Use BTC private key hash as encryption key for tip storage
          const tipStorageKey = sha256(senderBtcKey);
          const encryptedTipKey = encrypt(tipPrivateKey, tipStorageKey);
          const encryptedTipKeyHex = bytesToHex(encryptedTipKey);

          const pendingTip: PendingSocialTip = {
            tipId: result.data!.tip_id,
            asset,
            amount: actualAmount!,
            tipAddress,
            fundingTxid: fundingTxid!,
            encryptedTipKey: encryptedTipKeyHex,
            encryptedTipKeySalt: state.seedSalt, // Store for reference (not actually used)
            recipientPlatform: platform,
            recipientUsername: username,
            createdAt: Date.now(),
            status: 'pending',
          };

          await addPendingSocialTip(pendingTip);
          console.log(`[SocialTip] Stored tip key locally for clawback`);
        }
      } catch (err) {
        console.warn('[SocialTip] Failed to store tip key locally:', err);
        // Continue anyway - tip is created, just clawback won't work
      }
    }

    return {
      success: true,
      data: {
        tipId: result.data!.tip_id,
        status: result.data!.status,
        shareUrl: undefined,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create tip',
    };
  }
}

/**
 * Get tips the current user can claim.
 */
export async function handleGetClaimableTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    const result = await api.getClaimableTips();

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get claimable tips',
    };
  }
}

/**
 * Claim a social tip by decrypting the key and sweeping funds.
 *
 * For BTC/LTC:
 * 1. Claim tip on backend to get encrypted_key + tip_address
 * 2. Decrypt tip private key using recipient's BTC private key
 * 3. Fetch UTXOs from tip address
 * 4. Sweep all funds to recipient's wallet
 *
 * For XMR/WOW:
 * 1. Claim tip on backend to get encrypted_key + tip_address
 * 2. Decrypt spend key using recipient's BTC private key
 * 3. Derive view key from spend key
 * 4. Sweep funds from tip address to recipient's wallet
 */
export async function handleClaimSocialTip(
  tipId: string,
  tipAsset: AssetType
): Promise<MessageResponse<{ success: boolean; encryptedKey: string | null; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Grin not yet supported
    if (tipAsset === 'grin') {
      return { success: false, error: 'Grin claim not yet implemented' };
    }

    // Get recipient's BTC private key for decryption (always use BTC key for ECIES)
    const btcPrivateKey = unlockedKeys.get('btc');
    if (!btcPrivateKey) {
      return { success: false, error: 'BTC key not available for decryption' };
    }

    // Get recipient's address for the tip asset (where to sweep funds)
    const state = await getWalletState();
    const recipientKey = state.keys[tipAsset];
    if (!recipientKey) {
      return { success: false, error: `No ${tipAsset} key found in wallet` };
    }
    const recipientAddress = getAddressForAsset(tipAsset, recipientKey);

    // Step 1: Claim tip on backend to get encrypted_key and tip_address
    const result = await api.claimSocialTip(tipId);

    if (result.error) {
      return { success: false, error: result.error };
    }

    const { encrypted_key, tip_address } = result.data!;

    if (!encrypted_key) {
      return { success: false, error: 'No encrypted key in tip' };
    }

    if (!tip_address) {
      return { success: false, error: 'No tip address - this tip may not have real funds' };
    }

    console.log(`[ClaimTip] Claiming ${tipAsset} from tip address: ${tip_address}`);

    // Step 2: Decrypt tip private key
    // Format: ephemeralPubkey (66 hex chars = 33 bytes compressed) || encryptedKey
    const ephemeralPubkeyHex = encrypted_key.slice(0, 66);
    const encryptedKeyHex = encrypted_key.slice(66);

    let tipPrivateKey: Uint8Array;
    try {
      tipPrivateKey = decryptTipPayload(encryptedKeyHex, ephemeralPubkeyHex, btcPrivateKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt tip key' };
    }

    console.log(`[ClaimTip] Decrypted tip private key`);

    let finalTxid: string;
    let actualAmount: number;

    if (tipAsset === 'btc' || tipAsset === 'ltc') {
      // BTC/LTC sweep
      // Step 3: Fetch UTXOs from tip address
      const utxoResult = await api.getUtxos(tipAsset, tip_address);
      if (utxoResult.error || !utxoResult.data) {
        return { success: false, error: utxoResult.error || 'Failed to fetch tip UTXOs' };
      }

      const utxos: Utxo[] = utxoResult.data.utxos;
      if (utxos.length === 0) {
        return { success: false, error: 'No UTXOs at tip address - funds may already be claimed' };
      }

      const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);
      console.log(`[ClaimTip] Found ${utxos.length} UTXOs with total value: ${totalValue}`);

      // Step 4: Build sweep transaction
      const feeResult = await api.estimateFee(tipAsset);
      const feeRate = feeResult.data?.normal ?? 10;

      let txHex: string;

      try {
        const txResult = createBtcSignedTransaction(
          tipAsset,
          utxos,
          recipientAddress,
          0,
          recipientAddress,
          tipPrivateKey,
          feeRate,
          true // sweep mode
        );
        txHex = txResult.txHex;
        actualAmount = txResult.actualAmount;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create sweep transaction',
        };
      }

      // Step 5: Broadcast sweep transaction
      const broadcastResult = await api.broadcastTx(tipAsset, txHex);
      if (broadcastResult.error) {
        return { success: false, error: `Sweep broadcast failed: ${broadcastResult.error}` };
      }

      finalTxid = broadcastResult.data!.txid;

    } else if (tipAsset === 'xmr' || tipAsset === 'wow') {
      // XMR/WOW sweep
      // The tip private key IS the spend key
      const tipSpendKey = tipPrivateKey;
      const tipViewKey = deriveViewKeyFromSpendKey(tipSpendKey);

      console.log(`[ClaimTip] Derived view key for ${tipAsset} tip wallet`);

      // Sweep funds from tip wallet to recipient
      try {
        const txResult = await sendXmrTransaction(
          tipAsset,
          tip_address,
          bytesToHex(tipViewKey),
          bytesToHex(tipSpendKey),
          recipientAddress,
          0, // amount ignored for sweep
          'mainnet',
          true // sweep mode
        );
        finalTxid = txResult.txHash;
        actualAmount = txResult.actualAmount;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to sweep funds',
        };
      }
    } else {
      return { success: false, error: `Claiming not supported for ${tipAsset}` };
    }

    console.log(`[ClaimTip] Sweep successful: ${finalTxid}, received: ${actualAmount!} atomic units`);

    return {
      success: true,
      data: {
        success: true,
        encryptedKey: encrypted_key,
        txid: finalTxid,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to claim tip',
    };
  }
}

/**
 * Get tips sent by the current user.
 */
export async function handleGetSentSocialTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    const result = await api.getSentSocialTips();

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get sent tips',
    };
  }
}

/**
 * Clawback a tip (sender reclaims unclaimed funds).
 *
 * 1. Get stored tip key from local storage
 * 2. Decrypt tip private key using sender's BTC key
 * 3. Sweep funds from tip address back to sender's wallet
 * 4. Mark as clawed back on backend
 */
export async function handleClawbackSocialTip(
  tipId: string
): Promise<MessageResponse<{ success: boolean; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Get stored tip info
    const pendingTip = await getPendingSocialTip(tipId);
    if (!pendingTip) {
      return { success: false, error: 'Tip not found in local storage - cannot clawback' };
    }

    if (pendingTip.status !== 'pending') {
      return { success: false, error: `Tip already ${pendingTip.status}` };
    }

    const tipAsset = pendingTip.asset as AssetType;

    // Get sender's BTC key to decrypt the stored tip key
    const senderBtcKey = unlockedKeys.get('btc');
    if (!senderBtcKey) {
      return { success: false, error: 'BTC key not available' };
    }

    // Decrypt the stored tip key
    const tipStorageKey = sha256(senderBtcKey);
    let tipPrivateKey: Uint8Array;
    try {
      tipPrivateKey = decrypt(hexToBytes(pendingTip.encryptedTipKey), tipStorageKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt stored tip key' };
    }

    // Get sender's address for this asset (where to sweep funds back)
    const state = await getWalletState();
    const senderKey = state.keys[tipAsset];
    if (!senderKey) {
      return { success: false, error: `No ${tipAsset} key found in wallet` };
    }
    const senderAddress = getAddressForAsset(tipAsset, senderKey);

    console.log(`[Clawback] Sweeping ${tipAsset} from ${pendingTip.tipAddress} to ${senderAddress}`);

    let finalTxid: string;
    let actualAmount: number;

    if (tipAsset === 'btc' || tipAsset === 'ltc') {
      // BTC/LTC sweep
      const utxoResult = await api.getUtxos(tipAsset, pendingTip.tipAddress);
      if (utxoResult.error || !utxoResult.data) {
        return { success: false, error: utxoResult.error || 'Failed to fetch tip UTXOs' };
      }

      const utxos: Utxo[] = utxoResult.data.utxos;
      if (utxos.length === 0) {
        // No UTXOs - tip may have already been claimed
        // Mark as clawed back anyway on backend
        await api.clawbackSocialTip(tipId);
        await updatePendingSocialTipStatus(tipId, 'clawed_back');
        return { success: false, error: 'No funds at tip address - may have been claimed' };
      }

      const feeResult = await api.estimateFee(tipAsset);
      const feeRate = feeResult.data?.normal ?? 10;

      let txHex: string;
      try {
        const txResult = createBtcSignedTransaction(
          tipAsset,
          utxos,
          senderAddress,
          0,
          senderAddress,
          tipPrivateKey,
          feeRate,
          true // sweep mode
        );
        txHex = txResult.txHex;
        actualAmount = txResult.actualAmount;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create sweep transaction',
        };
      }

      const broadcastResult = await api.broadcastTx(tipAsset, txHex);
      if (broadcastResult.error) {
        return { success: false, error: `Sweep broadcast failed: ${broadcastResult.error}` };
      }

      finalTxid = broadcastResult.data!.txid;

    } else if (tipAsset === 'xmr' || tipAsset === 'wow') {
      // XMR/WOW sweep
      const tipSpendKey = tipPrivateKey;
      const tipViewKey = deriveViewKeyFromSpendKey(tipSpendKey);

      try {
        const txResult = await sendXmrTransaction(
          tipAsset,
          pendingTip.tipAddress,
          bytesToHex(tipViewKey),
          bytesToHex(tipSpendKey),
          senderAddress,
          0, // amount ignored for sweep
          'mainnet',
          true // sweep mode
        );
        finalTxid = txResult.txHash;
        actualAmount = txResult.actualAmount;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to sweep funds',
        };
      }
    } else {
      return { success: false, error: `Clawback not supported for ${tipAsset}` };
    }

    console.log(`[Clawback] Sweep successful: ${finalTxid}, recovered: ${actualAmount!}`);

    // Mark as clawed back on backend and locally
    await api.clawbackSocialTip(tipId);
    await updatePendingSocialTipStatus(tipId, 'clawed_back');

    return {
      success: true,
      data: { success: true, txid: finalTxid },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to clawback tip',
    };
  }
}
