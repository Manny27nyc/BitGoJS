import {
  Authorized,
  Lockup,
  PublicKey,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
  Transaction,
} from '@solana/web3.js';
import assert from 'assert';
import BigNumber from 'bignumber.js';
import { InstructionBuilderTypes, MEMO_PROGRAM_PK } from './constants';
import {
  AtaInit,
  InstructionParams,
  Memo,
  Nonce,
  StakingActivate,
  StakingDeactivate,
  StakingWithdraw,
  Transfer,
  WalletInit,
} from './iface';
const splToken = require('@solana/spl-token');

/**
 * Construct Solana instructions from instructions params
 *
 * @param {InstructionParams} instructionToBuild - the data containing the instruction params
 * @returns {TransactionInstruction[]} An array containing supported Solana instructions
 */
export function solInstructionFactory(instructionToBuild: InstructionParams): TransactionInstruction[] {
  switch (instructionToBuild.type) {
    case InstructionBuilderTypes.NonceAdvance:
      return advanceNonceInstruction(instructionToBuild);
    case InstructionBuilderTypes.Memo:
      return memoInstruction(instructionToBuild);
    case InstructionBuilderTypes.Transfer:
      return transferInstruction(instructionToBuild);
    case InstructionBuilderTypes.CreateNonceAccount:
      return createNonceAccountInstruction(instructionToBuild);
    case InstructionBuilderTypes.StakingActivate:
      return stakingInitializeInstruction(instructionToBuild);
    case InstructionBuilderTypes.StakingDeactivate:
      return stakingDeactivateInstruction(instructionToBuild);
    case InstructionBuilderTypes.StakingWithdraw:
      return stakingWithdrawInstruction(instructionToBuild);
    case InstructionBuilderTypes.CreateAssociatedTokenAccount:
      return createATAInstruction(instructionToBuild);
    default:
      throw new Error(`Invalid instruction type or not supported`);
  }
}

/**
 * Construct Advance Nonce Solana instructions
 *
 * @param {Nonce} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Advance Nonce Solana instruction
 */
function advanceNonceInstruction(data: Nonce): TransactionInstruction[] {
  const {
    params: { authWalletAddress, walletNonceAddress },
  } = data;
  assert(authWalletAddress, 'Missing authWalletAddress param');
  assert(walletNonceAddress, 'Missing walletNonceAddress param');
  const nonceInstruction = SystemProgram.nonceAdvance({
    noncePubkey: new PublicKey(walletNonceAddress),
    authorizedPubkey: new PublicKey(authWalletAddress),
  });
  return [nonceInstruction];
}

/**
 * Construct Memo Solana instructions
 *
 * @param {Memo} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Memo Solana instruction
 */
function memoInstruction(data: Memo): TransactionInstruction[] {
  const {
    params: { memo },
  } = data;
  assert(memo, 'Missing memo param');
  const memoInstruction = new TransactionInstruction({
    keys: [],
    programId: new PublicKey(MEMO_PROGRAM_PK),
    data: Buffer.from(memo),
  });
  return [memoInstruction];
}

/**
 * Construct Transfer Solana instructions
 *
 * @param {Transfer} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Transfer Solana instruction
 */
function transferInstruction(data: Transfer): TransactionInstruction[] {
  const {
    params: { fromAddress, toAddress, amount, mint, source, multiSigners },
  } = data;
  assert(fromAddress, 'Missing fromAddress param');
  assert(toAddress, 'Missing toAddress param');
  assert(amount, 'Missing toAddress param');
  let transferInstruction;
  if (!mint) {
    // native transfer
    transferInstruction = SystemProgram.transfer({
      fromPubkey: new PublicKey(fromAddress),
      toPubkey: new PublicKey(toAddress),
      lamports: new BigNumber(amount).toNumber(),
    });
  } else {
    // token transfer
    assert(mint, 'Missing mint');
    assert(source, 'Missing source');
    assert(multiSigners, 'Missing multiSigners');
    transferInstruction = splToken.createTransferCheckedInstruction(
      splToken.TOKEN_PROGRAM_ID,
      new PublicKey(source),
      new PublicKey(mint),
      new PublicKey(toAddress),
      new PublicKey(fromAddress),
      multiSigners,
      new BigNumber(amount).toNumber(),
      6,
    );
  }
  return [transferInstruction];
}

/**
 * Construct Create and Initialize Nonce Solana instructions
 *
 * @param {WalletInit} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Create and Initialize Nonce Solana instruction
 */
function createNonceAccountInstruction(data: WalletInit): TransactionInstruction[] {
  const {
    params: { fromAddress, nonceAddress, authAddress, amount },
  } = data;
  assert(fromAddress, 'Missing fromAddress param');
  assert(nonceAddress, 'Missing nonceAddress param');
  assert(authAddress, 'Missing authAddress param');
  assert(amount, 'Missing amount param');
  const nonceAccountInstruction = SystemProgram.createNonceAccount({
    fromPubkey: new PublicKey(fromAddress),
    noncePubkey: new PublicKey(nonceAddress),
    authorizedPubkey: new PublicKey(authAddress),
    lamports: new BigNumber(amount).toNumber(),
  });
  return nonceAccountInstruction.instructions;
}

/**
 * Construct Create Staking Account and Delegate Solana instructions
 *
 * @param {StakingActivate} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Create Staking Account and Delegate Solana instructions
 */
function stakingInitializeInstruction(data: StakingActivate): TransactionInstruction[] {
  const {
    params: { fromAddress, stakingAddress, amount, validator },
  } = data;
  assert(fromAddress, 'Missing fromAddress param');
  assert(stakingAddress, 'Missing stakingAddress param');
  assert(amount, 'Missing amount param');
  assert(validator, 'Missing validator param');

  const fromPubkey = new PublicKey(fromAddress);
  const stakePubkey = new PublicKey(stakingAddress);

  const tx = new Transaction();

  const walletInitStaking = StakeProgram.createAccount({
    fromPubkey,
    stakePubkey,
    authorized: new Authorized(fromPubkey, fromPubkey), // staker and withdrawer
    lockup: new Lockup(0, 0, fromPubkey), // Lookup sets the minimum epoch to withdraw, by default is 0,0 which means there's no minimum limit
    lamports: new BigNumber(amount).toNumber(),
  });
  tx.add(walletInitStaking);

  const delegateStaking = StakeProgram.delegate({
    stakePubkey: new PublicKey(stakingAddress),
    authorizedPubkey: new PublicKey(fromAddress),
    votePubkey: new PublicKey(validator),
  });
  tx.add(delegateStaking);

  return tx.instructions;
}

/**
 * Construct staking deactivate Solana instructions
 *
 * @param {StakingDeactivate} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing staking deactivate instruction
 */
function stakingDeactivateInstruction(data: StakingDeactivate): TransactionInstruction[] {
  const {
    params: { fromAddress, stakingAddress },
  } = data;
  assert(fromAddress, 'Missing fromAddress param');
  assert(stakingAddress, 'Missing stakingAddress param');

  const deactivateStaking = StakeProgram.deactivate({
    stakePubkey: new PublicKey(stakingAddress),
    authorizedPubkey: new PublicKey(fromAddress),
  });

  return deactivateStaking.instructions;
}

/**
 * Construct Staking Withdraw Solana instructions
 *
 * @param {StakingWithdraw} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Staking Withdraw  Solana instructions
 */
function stakingWithdrawInstruction(data: StakingWithdraw): TransactionInstruction[] {
  const {
    params: { fromAddress, stakingAddress, amount },
  } = data;
  assert(fromAddress, 'Missing fromAddress param');
  assert(stakingAddress, 'Missing stakingAddress param');
  assert(amount, 'Missing amount param');

  const withdrawStaking = StakeProgram.withdraw({
    stakePubkey: new PublicKey(stakingAddress),
    authorizedPubkey: new PublicKey(fromAddress),
    toPubkey: new PublicKey(fromAddress),
    lamports: new BigNumber(amount).toNumber(),
  });

  return withdrawStaking.instructions;
}

/**
 * Construct Create and Initialize Nonce Solana instructions
 *
 * @param {WalletInit} data - the data to build the instruction
 * @returns {TransactionInstruction[]} An array containing Create and Initialize Nonce Solana instruction
 */
function createATAInstruction(data: AtaInit): TransactionInstruction[] {
  const {
    params: { mintAddress, ataAddress, ownerAddress, payerAddress },
  } = data;
  assert(mintAddress, 'Missing mintAddress param');
  assert(ataAddress, 'Missing ataAddress param');
  assert(ownerAddress, 'Missing ownerAddress param');
  assert(payerAddress, 'Missing payerAddress param');

  const associatedTokenAccountInstruction = splToken.createAssociatedTokenAccountInstruction(
    splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
    splToken.TOKEN_PROGRAM_ID,
    new PublicKey(mintAddress),
    new PublicKey(ataAddress),
    new PublicKey(ownerAddress),
    new PublicKey(payerAddress),
  );
  return [associatedTokenAccountInstruction];
}
