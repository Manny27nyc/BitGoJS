import { TransactionBuilder } from './transactionBuilder';
import { TransactionType } from '../baseCoin';
import { BaseCoin as CoinConfig, coins } from '@bitgo/statics';
import { Transaction } from './transaction';
import { AtaInit } from './iface';
import { InstructionBuilderTypes } from './constants';
import { PublicKey } from '@solana/web3.js';
import { isValidAmount, isValidPublicKey } from './utils';
import { BuildTransactionError } from '../baseCoin/errors';
const splToken = require('@solana/spl-token');
import assert from 'assert';
import { SolCoin } from '@bitgo/statics/dist/src/account';
import { AtaInitializationTransaction } from './ataInitializationTransaction';

export class AtaInitializationBuilder extends TransactionBuilder {
  private _mint: string;
  private _rentExemptAmount: string;
  protected _transaction: AtaInitializationTransaction;

  constructor(_coinConfig: Readonly<CoinConfig>) {
    super(_coinConfig);
    this._transaction = new AtaInitializationTransaction(_coinConfig);
  }

  protected get transactionType(): TransactionType {
    return TransactionType.AssociatedTokenAccountInitialization;
  }

  /** @inheritDoc */
  initBuilder(tx: Transaction): void {
    super.initBuilder(tx);

    for (const instruction of this._instructionsData) {
      if (instruction.type === InstructionBuilderTypes.CreateAssociatedTokenAccount) {
        const ataInitInstruction: AtaInit = instruction;

        this._mint = ataInitInstruction.params.mintAddress;
        this.validateMintOrThrow();
        this.sender(ataInitInstruction.params.ownerAddress);
      }
    }
  }

  /**
   * Sets the mint address of the associated token account
   *
   * @param mint mint name of associated token account
   */
  mint(mint: string): this {
    const token = coins.get(mint);
    if (!(token.isToken && token instanceof SolCoin)) {
      throw new BuildTransactionError('Invalid transaction: invalid mint, got: ' + this._mint);
    }
    this._mint = token.tokenAddress;
    return this;
  }

  private validateMintOrThrow() {
    if (!this._mint || !isValidPublicKey(this._mint)) {
      throw new BuildTransactionError('Invalid transaction: invalid or missing mint, got: ' + this._mint);
    }
  }

  /**
   * Used to set the minimum rent exempt amount
   *
   * @param rentExemptAmount minimum rent exempt amount in lamports
   */
  rentExemptAmount(rentExemptAmount: string): this {
    this._rentExemptAmount = rentExemptAmount;
    this.validateRentExemptAmountOrThrow();
    return this;
  }

  private validateRentExemptAmountOrThrow() {
    // _rentExemptAmount is allowed to be undefined or a valid amount if it's defined
    if (this._rentExemptAmount && !isValidAmount(this._rentExemptAmount)) {
      throw new BuildTransactionError('Invalid transaction: invalid rentExemptAmount, got: ' + this._rentExemptAmount);
    }
  }

  /** @inheritdoc */
  validateTransaction(transaction?: Transaction): void {
    super.validateTransaction(transaction);
    this.validateMintOrThrow();
    this.validateRentExemptAmountOrThrow();
  }

  /** @inheritdoc */
  protected async buildImplementation(): Promise<Transaction> {
    assert(this._sender, 'Sender must be set before building the transaction');
    assert(this._mint, 'Mint must be set before building the transaction');

    const ataPk = await splToken.getAssociatedTokenAddress(
      splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      splToken.TOKEN_PROGRAM_ID,
      new PublicKey(this._mint),
      new PublicKey(this._sender),
    );
    const ataInitData: AtaInit = {
      type: InstructionBuilderTypes.CreateAssociatedTokenAccount,
      params: {
        mintAddress: this._mint,
        ataAddress: ataPk.toString(),
        ownerAddress: this._sender,
        payerAddress: this._sender,
      },
    };
    this._instructionsData = [ataInitData];
    this._transaction.tokenAccountRentExemptAmount = this._rentExemptAmount;
    return await super.buildImplementation();
  }
}
