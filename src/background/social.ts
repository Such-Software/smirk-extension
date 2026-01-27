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
import { isUnlocked, unlockedKeys, unlockedViewKeys, grinWasmKeys, setGrinWasmKeys, unlockedMnemonic } from './state';
import {
  getWalletState,
  getAuthState,
  addPendingSocialTip,
  getPendingSocialTip,
  updatePendingSocialTipStatus,
  type PendingSocialTip,
} from '@/lib/storage';
import { getAddressForAsset } from './wallet';
import { encrypt, decrypt, deriveKeyFromPassword } from '@/lib/crypto';
import {
  initGrinWallet,
  createGrinVoucherTransaction,
  claimGrinVoucher,
  getTransactionJson,
  type GrinOutput,
} from '@/lib/grin';

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

      // Get auth state for LWS registration
      const authState = await getAuthState();
      if (!authState?.userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Step 1: Generate tip wallet keys
      const tipKeys = generateXmrWowTipKeys(asset);
      tipPrivateKey = tipKeys.spendKey; // We only need to encrypt the spend key
      tipAddress = tipKeys.address;

      console.log(`[SocialTip] Generated ${asset} tip address: ${tipAddress}`);

      // Step 2: Register tip address with LWS (required for recipient to query unspent outputs)
      const tipViewKeyHex = bytesToHex(tipKeys.viewKey);
      console.log(`[SocialTip] Registering ${asset} tip address with LWS...`);
      const registerResult = await api.registerLws(authState.userId, asset, tipAddress, tipViewKeyHex);
      if (registerResult.error) {
        console.error(`[SocialTip] Failed to register tip address with LWS:`, registerResult.error);
        return { success: false, error: `Failed to register tip address with LWS: ${registerResult.error}` };
      }
      console.log(`[SocialTip] Tip address registered with LWS`);

      // Step 3: Send funds to tip address
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

    } else if (asset === 'grin') {
      // GRIN flow - uses voucher model (single-party transaction)
      // The sender creates a complete transaction with a "voucher output"
      // The blinding factor for the voucher is encrypted with recipient's pubkey
      // Whoever has the blinding factor can spend the voucher

      // Ensure Grin WASM wallet is initialized
      let keys = grinWasmKeys;
      if (!keys) {
        if (!unlockedMnemonic) {
          return { success: false, error: 'Grin wallet not initialized - please re-unlock wallet' };
        }
        keys = await initGrinWallet(unlockedMnemonic);
        setGrinWasmKeys(keys);
      }

      // Get auth state for API calls
      const authState = await getAuthState();
      if (!authState?.userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Fetch UTXOs from backend
      const outputsResult = await api.getGrinOutputs(authState.userId);
      if (outputsResult.error) {
        return { success: false, error: `Failed to fetch Grin outputs: ${outputsResult.error}` };
      }

      const { outputs: rawOutputs, next_child_index: nextChildIndex } = outputsResult.data!;

      // Filter to only unspent outputs
      const grinOutputs: GrinOutput[] = rawOutputs
        .filter(o => o.status === 'unspent')
        .map(o => ({
          id: o.id,
          keyId: o.key_id,
          nChild: o.n_child,
          amount: BigInt(o.amount),
          commitment: o.commitment,
          isCoinbase: o.is_coinbase,
          blockHeight: o.block_height ?? undefined,
        }));

      if (grinOutputs.length === 0) {
        return { success: false, error: 'No unspent Grin outputs available' };
      }

      // Get current blockchain height
      const heightsResult = await api.getBlockchainHeights();
      if (heightsResult.error || !heightsResult.data?.grin) {
        return { success: false, error: 'Failed to get Grin blockchain height' };
      }
      const currentHeight = BigInt(heightsResult.data.grin);

      console.log(`[SocialTip] Creating Grin voucher for ${amount} nanogrin`);

      // Create the voucher transaction
      let voucherResult;
      try {
        voucherResult = await createGrinVoucherTransaction(
          keys,
          grinOutputs,
          BigInt(amount),
          currentHeight,
          nextChildIndex
        );
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create voucher transaction',
        };
      }

      // Broadcast the voucher transaction
      const txJson = getTransactionJson(voucherResult.slate);
      console.log('[SocialTip] Broadcasting Grin voucher transaction...');

      const broadcastResult = await api.broadcastGrinTransaction({
        userId: authState.userId,
        slateId: voucherResult.slate.id,
        tx: txJson,
      });

      if (broadcastResult.error) {
        return { success: false, error: `Grin broadcast failed: ${broadcastResult.error}` };
      }

      console.log(`[SocialTip] Grin voucher tx broadcast: ${voucherResult.slate.id}`);

      // Mark inputs as spent
      await api.spendGrinOutputs({
        userId: authState.userId,
        txSlateId: voucherResult.slate.id,
      });

      // Record the voucher output (not spendable by sender - it's the voucher)
      // We record it but it will be marked as spent when claimed
      await api.recordGrinOutput({
        userId: authState.userId,
        keyId: voucherResult.voucherOutput.keyId,
        nChild: voucherResult.voucherOutput.nChild,
        amount: Number(voucherResult.voucherOutput.amount),
        commitment: voucherResult.voucherOutput.commitment,
        txSlateId: voucherResult.slate.id,
      });

      // Record change output if any
      if (voucherResult.changeOutput) {
        await api.recordGrinOutput({
          userId: authState.userId,
          keyId: voucherResult.changeOutput.keyId,
          nChild: voucherResult.changeOutput.nChild,
          amount: Number(voucherResult.changeOutput.amount),
          commitment: voucherResult.changeOutput.commitment,
          txSlateId: voucherResult.slate.id,
        });
      }

      // Record the send transaction
      await api.recordGrinTransaction({
        userId: authState.userId,
        slateId: voucherResult.slate.id,
        amount: Number(voucherResult.voucherOutput.amount),
        fee: Number(voucherResult.slate.fee),
        direction: 'send',
      });

      // For Grin, store voucher data for later encryption
      // We'll handle Grin specially below since we need to encrypt more data
      tipPrivateKey = voucherResult.voucherBlindingFactor;
      tipAddress = voucherResult.voucherOutput.commitment;
      fundingTxid = voucherResult.slate.id;
      actualAmount = Number(voucherResult.voucherOutput.amount);

      // Store voucher metadata for the grin-specific encryption below
      (globalThis as any).__grinVoucherProof = voucherResult.voucherOutput.proof;
      (globalThis as any).__grinVoucherNChild = voucherResult.voucherOutput.nChild;
      // Also store for local storage (clawback needs the same data)
      (globalThis as any).__grinVoucherProofForStorage = voucherResult.voucherOutput.proof;
      (globalThis as any).__grinVoucherNChildForStorage = voucherResult.voucherOutput.nChild;

    } else {
      return { success: false, error: `Social tips not supported for ${asset}` };
    }

    // Step 6: Encrypt tip private key with recipient's BTC public key using ECIES
    const recipientPubkeyBytes = hexToBytes(recipientBtcPubkey);

    let encrypted_key: string;

    if (asset === 'grin') {
      // For Grin, we need to encrypt the full voucher data:
      // - blinding factor (secret - proves ownership)
      // - commitment (identifies the UTXO)
      // - proof (range proof - needed for tx input)
      // - nChild (for reference)
      // - amount (for verification)
      const grinVoucherData = JSON.stringify({
        blindingFactor: bytesToHex(tipPrivateKey),
        commitment: tipAddress,
        proof: (globalThis as any).__grinVoucherProof,
        nChild: (globalThis as any).__grinVoucherNChild,
        amount: actualAmount,
        features: 0, // Plain output
      });

      // Clean up temp globals
      delete (globalThis as any).__grinVoucherProof;
      delete (globalThis as any).__grinVoucherNChild;

      // Encrypt the JSON data
      const voucherDataBytes = new TextEncoder().encode(grinVoucherData);
      const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(
        voucherDataBytes,
        recipientPubkeyBytes
      );
      encrypted_key = ephemeralPubkey + encryptedKey;

      console.log(`[SocialTip] Encrypted Grin voucher data (${voucherDataBytes.length} bytes)`);

    } else {
      // For other assets, just encrypt the private key
      const { encryptedKey, ephemeralPubkey } = createEncryptedTipPayload(
        tipPrivateKey,
        recipientPubkeyBytes
      );
      encrypted_key = ephemeralPubkey + encryptedKey;
    }

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

          // For Grin, we need to store the full voucher data (including proof) for clawback
          // For other assets, just store the private key
          let dataToEncrypt: Uint8Array;
          if (asset === 'grin') {
            // Retrieve the stored voucher metadata
            const grinVoucherProof = (globalThis as any).__grinVoucherProofForStorage;
            const grinVoucherNChild = (globalThis as any).__grinVoucherNChildForStorage;
            delete (globalThis as any).__grinVoucherProofForStorage;
            delete (globalThis as any).__grinVoucherNChildForStorage;

            const grinVoucherData = JSON.stringify({
              blindingFactor: bytesToHex(tipPrivateKey),
              commitment: tipAddress,
              proof: grinVoucherProof,
              nChild: grinVoucherNChild,
              amount: actualAmount,
              features: 0,
            });
            dataToEncrypt = new TextEncoder().encode(grinVoucherData);
          } else {
            dataToEncrypt = tipPrivateKey;
          }

          const encryptedTipKey = encrypt(dataToEncrypt, tipStorageKey);
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
 * Get tips the current user can claim (only confirmed tips).
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
 * Get all received tips (includes tips waiting for confirmations).
 */
export async function handleGetReceivedTips(): Promise<MessageResponse<{ tips: unknown[] }>> {
  try {
    console.log('[handleGetReceivedTips] Calling API (social received)...');
    const result = await api.getReceivedSocialTips();
    console.log('[handleGetReceivedTips] API result:', result);

    if (result.error) {
      console.log('[handleGetReceivedTips] API error:', result.error);
      return { success: false, error: result.error };
    }

    console.log('[handleGetReceivedTips] Tips count:', result.data?.tips?.length);
    return {
      success: true,
      data: { tips: result.data!.tips },
    };
  } catch (err) {
    console.error('[handleGetReceivedTips] Exception:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get received tips',
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
 *
 * For GRIN (voucher):
 * 1. Claim tip on backend to get encrypted voucher data
 * 2. Decrypt voucher data (blinding factor, commitment, proof, etc.)
 * 3. Build voucher sweep transaction using claimGrinVoucher
 * 4. Broadcast and record the new output
 */
export async function handleClaimSocialTip(
  tipId: string,
  tipAsset: AssetType
): Promise<MessageResponse<{ success: boolean; encryptedKey: string | null; txid?: string }>> {
  try {
    if (!isUnlocked) {
      return { success: false, error: 'Wallet is locked' };
    }

    // Get recipient's BTC private key for decryption (always use BTC key for ECIES)
    const btcPrivateKey = unlockedKeys.get('btc');
    if (!btcPrivateKey) {
      return { success: false, error: 'BTC key not available for decryption' };
    }

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

    // Step 2: Decrypt tip data
    // Format: ephemeralPubkey (66 hex chars = 33 bytes compressed) || encryptedData
    const ephemeralPubkeyHex = encrypted_key.slice(0, 66);
    const encryptedKeyHex = encrypted_key.slice(66);

    let decryptedData: Uint8Array;
    try {
      decryptedData = decryptTipPayload(encryptedKeyHex, ephemeralPubkeyHex, btcPrivateKey);
    } catch (err) {
      return { success: false, error: 'Failed to decrypt tip data' };
    }

    console.log(`[ClaimTip] Decrypted tip data (${decryptedData.length} bytes)`);

    let finalTxid: string;
    let actualAmount: number;

    // Handle Grin voucher claiming specially
    if (tipAsset === 'grin') {
      // Decrypted data is JSON containing voucher info
      let voucherData: {
        blindingFactor: string;
        commitment: string;
        proof: string;
        nChild: number;
        amount: number;
        features: number;
      };

      try {
        const jsonStr = new TextDecoder().decode(decryptedData);
        voucherData = JSON.parse(jsonStr);
      } catch (err) {
        return { success: false, error: 'Failed to parse Grin voucher data' };
      }

      console.log(`[ClaimTip] Grin voucher: commitment=${voucherData.commitment.slice(0, 16)}..., amount=${voucherData.amount}`);

      // Ensure Grin WASM wallet is initialized
      let keys = grinWasmKeys;
      if (!keys) {
        if (!unlockedMnemonic) {
          return { success: false, error: 'Grin wallet not initialized - please re-unlock wallet' };
        }
        keys = await initGrinWallet(unlockedMnemonic);
        setGrinWasmKeys(keys);
      }

      // Get auth state for API calls
      const authState = await getAuthState();
      if (!authState?.userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get next child index for the new output
      const outputsResult = await api.getGrinOutputs(authState.userId);
      if (outputsResult.error) {
        return { success: false, error: `Failed to fetch Grin outputs: ${outputsResult.error}` };
      }
      const nextChildIndex = outputsResult.data?.next_child_index ?? 0;

      // Get current blockchain height
      const heightsResult = await api.getBlockchainHeights();
      if (heightsResult.error || !heightsResult.data?.grin) {
        return { success: false, error: 'Failed to get Grin blockchain height' };
      }
      const currentHeight = BigInt(heightsResult.data.grin);

      // Convert blinding factor from hex to bytes
      const voucherBlindingFactor = hexToBytes(voucherData.blindingFactor);

      // Build the voucher claim transaction
      let claimResult;
      try {
        claimResult = await claimGrinVoucher(
          keys,
          {
            commitment: voucherData.commitment,
            proof: voucherData.proof,
            amount: voucherData.amount,
            features: voucherData.features,
            txSlateId: '', // Not needed for claiming
            keyId: '', // Not needed for claiming
            nChild: voucherData.nChild,
            createdAt: 0,
          },
          voucherBlindingFactor,
          nextChildIndex,
          currentHeight
        );
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to build voucher claim transaction',
        };
      }

      // Broadcast the claim transaction
      const txJson = getTransactionJson(claimResult.slate);
      console.log('[ClaimTip] Broadcasting Grin voucher claim transaction...');

      const broadcastResult = await api.broadcastGrinTransaction({
        userId: authState.userId,
        slateId: claimResult.slate.id,
        tx: txJson,
      });

      if (broadcastResult.error) {
        return { success: false, error: `Grin broadcast failed: ${broadcastResult.error}` };
      }

      console.log(`[ClaimTip] Grin voucher claim broadcast: ${claimResult.slate.id}`);

      // Record the new output
      await api.recordGrinOutput({
        userId: authState.userId,
        keyId: claimResult.outputInfo.keyId,
        nChild: claimResult.outputInfo.nChild,
        amount: Number(claimResult.outputInfo.amount),
        commitment: claimResult.outputInfo.commitment,
        txSlateId: claimResult.slate.id,
      });

      // Record the receive transaction
      await api.recordGrinTransaction({
        userId: authState.userId,
        slateId: claimResult.slate.id,
        amount: Number(claimResult.outputInfo.amount),
        fee: Number(claimResult.slate.fee),
        direction: 'receive',
      });

      finalTxid = claimResult.slate.id;
      actualAmount = Number(claimResult.outputInfo.amount);

      console.log(`[ClaimTip] Grin voucher claimed successfully: ${finalTxid}, received: ${actualAmount} nanogrin`);

      return {
        success: true,
        data: {
          success: true,
          encryptedKey: encrypted_key,
          txid: finalTxid,
        },
      };
    }

    // For non-Grin assets, decrypted data is the private key directly
    const tipPrivateKey = decryptedData;

    // Get recipient's address for the tip asset (where to sweep funds)
    const state = await getWalletState();
    const recipientKey = state.keys[tipAsset];
    if (!recipientKey) {
      return { success: false, error: `No ${tipAsset} key found in wallet` };
    }
    const recipientAddress = getAddressForAsset(tipAsset, recipientKey);

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
      console.log(`[ClaimTip] Tip address: ${tip_address}`);
      console.log(`[ClaimTip] View key (first 16): ${bytesToHex(tipViewKey).substring(0, 16)}...`);
      console.log(`[ClaimTip] Recipient address: ${recipientAddress}`);

      // Sweep funds from tip wallet to recipient
      try {
        console.log(`[ClaimTip] Calling sendXmrTransaction for ${tipAsset} sweep...`);
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
        console.log(`[ClaimTip] sendXmrTransaction returned: txHash=${txResult.txHash}, fee=${txResult.fee}, amount=${txResult.actualAmount}`);
        finalTxid = txResult.txHash;
        actualAmount = txResult.actualAmount;

        // Deactivate tip address from LWS to save server resources
        console.log(`[ClaimTip] Deactivating ${tipAsset} tip address from LWS...`);
        api.deactivateLws(tipAsset, tip_address).then(result => {
          if (result.error) {
            console.warn(`[ClaimTip] Failed to deactivate LWS address:`, result.error);
          } else {
            console.log(`[ClaimTip] LWS address deactivated`);
          }
        }).catch(err => {
          console.warn(`[ClaimTip] Failed to deactivate LWS address:`, err);
        });
      } catch (err) {
        console.error(`[ClaimTip] sendXmrTransaction FAILED for ${tipAsset}:`, err);
        console.error(`[ClaimTip] Error message:`, err instanceof Error ? err.message : String(err));
        console.error(`[ClaimTip] Error stack:`, err instanceof Error ? err.stack : 'no stack');
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

        // Deactivate tip address from LWS to save server resources
        console.log(`[Clawback] Deactivating ${tipAsset} tip address from LWS...`);
        api.deactivateLws(tipAsset, pendingTip.tipAddress).then(result => {
          if (result.error) {
            console.warn(`[Clawback] Failed to deactivate LWS address:`, result.error);
          } else {
            console.log(`[Clawback] LWS address deactivated`);
          }
        }).catch(err => {
          console.warn(`[Clawback] Failed to deactivate LWS address:`, err);
        });
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to sweep funds',
        };
      }

    } else if (tipAsset === 'grin') {
      // GRIN clawback - same as claiming, sender sweeps the voucher
      // The stored tip data is JSON containing the full voucher info

      // Decrypted data is JSON containing voucher info
      let voucherData: {
        blindingFactor: string;
        commitment: string;
        proof: string;
        nChild: number;
        amount: number;
        features: number;
      };

      try {
        const jsonStr = new TextDecoder().decode(tipPrivateKey);
        voucherData = JSON.parse(jsonStr);
      } catch (err) {
        return { success: false, error: 'Failed to parse stored Grin voucher data' };
      }

      console.log(`[Clawback] Grin voucher: commitment=${voucherData.commitment.slice(0, 16)}..., amount=${voucherData.amount}`);

      // Ensure Grin WASM wallet is initialized
      let keys = grinWasmKeys;
      if (!keys) {
        if (!unlockedMnemonic) {
          return { success: false, error: 'Grin wallet not initialized - please re-unlock wallet' };
        }
        keys = await initGrinWallet(unlockedMnemonic);
        setGrinWasmKeys(keys);
      }

      // Get auth state for API calls
      const authState = await getAuthState();
      if (!authState?.userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get next child index for the new output
      const outputsResult = await api.getGrinOutputs(authState.userId);
      if (outputsResult.error) {
        return { success: false, error: `Failed to fetch Grin outputs: ${outputsResult.error}` };
      }
      const nextChildIndex = outputsResult.data?.next_child_index ?? 0;

      // Get current blockchain height
      const heightsResult = await api.getBlockchainHeights();
      if (heightsResult.error || !heightsResult.data?.grin) {
        return { success: false, error: 'Failed to get Grin blockchain height' };
      }
      const currentHeight = BigInt(heightsResult.data.grin);

      // Convert blinding factor from hex to bytes
      const voucherBlindingFactor = hexToBytes(voucherData.blindingFactor);

      // Build the voucher sweep transaction (same as claiming)
      let claimResult;
      try {
        claimResult = await claimGrinVoucher(
          keys,
          {
            commitment: voucherData.commitment,
            proof: voucherData.proof,
            amount: voucherData.amount,
            features: voucherData.features,
            txSlateId: '',
            keyId: '',
            nChild: voucherData.nChild,
            createdAt: 0,
          },
          voucherBlindingFactor,
          nextChildIndex,
          currentHeight
        );
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to build clawback transaction',
        };
      }

      // Broadcast the clawback transaction
      const txJson = getTransactionJson(claimResult.slate);
      console.log('[Clawback] Broadcasting Grin voucher clawback transaction...');

      const broadcastResult = await api.broadcastGrinTransaction({
        userId: authState.userId,
        slateId: claimResult.slate.id,
        tx: txJson,
      });

      if (broadcastResult.error) {
        return { success: false, error: `Grin broadcast failed: ${broadcastResult.error}` };
      }

      console.log(`[Clawback] Grin voucher clawback broadcast: ${claimResult.slate.id}`);

      // Record the new output
      await api.recordGrinOutput({
        userId: authState.userId,
        keyId: claimResult.outputInfo.keyId,
        nChild: claimResult.outputInfo.nChild,
        amount: Number(claimResult.outputInfo.amount),
        commitment: claimResult.outputInfo.commitment,
        txSlateId: claimResult.slate.id,
      });

      // Record the receive transaction (clawback is a receive for the sender)
      await api.recordGrinTransaction({
        userId: authState.userId,
        slateId: claimResult.slate.id,
        amount: Number(claimResult.outputInfo.amount),
        fee: Number(claimResult.slate.fee),
        direction: 'receive',
      });

      finalTxid = claimResult.slate.id;
      actualAmount = Number(claimResult.outputInfo.amount);

      console.log(`[Clawback] Grin voucher clawed back: ${finalTxid}, recovered: ${actualAmount} nanogrin`);

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
