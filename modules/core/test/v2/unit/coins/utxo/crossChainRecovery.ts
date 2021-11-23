/**
 * @prettier
 */
import * as should from 'should';
import * as nock from 'nock';
import * as utxolib from '@bitgo/utxo-lib';

import { AbstractUtxoCoin } from '../../../../../src/v2/coins';
import * as config from '../../../../../src/config';

import {
  getFixture,
  keychainsBase58,
  KeychainBase58,
  Triple,
  mockUnspent,
  shouldEqualJSON,
  utxoCoins,
  transactionHexToObj,
} from './util';
import { getSeed } from '../../../../lib/keys';
import { createFullSignedTransaction } from './util/transaction';
import { getDefaultWalletUnspentSigner } from './util/keychains';
import {
  nockBitGoPublicAddressUnspents,
  nockBitGoPublicTransaction,
  nockLitecointoolsAddressUnspents,
  nockLitecointoolsTransaction,
} from './util/nockIndexerAPI';
import { CrossChainRecoverySigned } from '../../../../../src/v2/recovery';
import { nockBitGo } from './util/nockBitGo';
import { Unspent } from '../../../../../src/v2/coins/utxo/unspent';

function nockWallet(coin: AbstractUtxoCoin, walletId: string, walletKeys: Triple<KeychainBase58>): nock.Scope {
  return nockBitGo()
    .get(`/api/v2/${coin.getChain()}/wallet/${walletId}`)
    .reply(200, {
      id: walletId,
      coin: coin.getChain(),
      label: 'crossChainRecovery',
      keys: walletKeys.map((k) => getSeed(k.pub).toString('hex')),
    })
    .persist();
}

type Address = {
  address: string;
  chain: number;
  index: number;
  coinSpecific: unknown;
};

function nockWalletAddress(coin: AbstractUtxoCoin, walletId: string, address: Address): nock.Scope {
  return nockBitGo()
    .get(`/api/v2/${coin.getChain()}/wallet/${walletId}/address/${address.address}`)
    .reply(200, {
      address: address.address,
      chain: address.chain,
      index: address.index,
      coin: coin.getChain(),
      wallet: walletId,
      coinSpecific: address.coinSpecific,
    })
    .persist();
}

function nockThirdpartyExplorerTxInfo(
  coin: AbstractUtxoCoin,
  depositTx: utxolib.bitgo.UtxoTransaction,
  depositUnspents: Unspent[],
  depositAddress: string
): nock.Scope[] {
  switch (coin.getChain()) {
    case 'ltc':
    case 'tltc':
      return [
        nockLitecointoolsTransaction(coin, depositTx, depositUnspents).persist(),
        nockLitecointoolsAddressUnspents(coin, depositTx.getId(), depositAddress, depositTx.outs).persist(),
      ];
    default:
      return [
        nockBitGoPublicTransaction(coin, depositTx, depositUnspents).persist(),
        nockBitGoPublicAddressUnspents(coin, depositTx.getId(), depositAddress, depositTx.outs).persist(),
      ];
  }
}

/**
 * Setup test for cross-chain recovery.
 *
 * Users can receive deposits on wallet addresses that are on a different chain.
 *
 * For instance, a user can receive litecoin on a bitcoin wallet.
 * This means that the litecoin blockchain has a transaction with outputs that are spendable
 * with keys that were originally created for a BitGo BTC wallet.
 * In this example, LTC is the "source coin" and BTC is the "recovery coin"
 * In cases like these we must use construct a transaction for litecoin network using keys of the
 * bitcoin wallet.
 *
 * @param sourceCoin - the coin to construct the transaction for
 * @param recoveryCoin - the coin the receiving wallet was set up for
 */
function run(sourceCoin: AbstractUtxoCoin, recoveryCoin: AbstractUtxoCoin) {
  describe(`Cross-Chain Recovery [sourceCoin=${sourceCoin.getChain()} recoveryCoin=${recoveryCoin.getChain()}]`, function () {
    const recoveryWalletId = '5abacebe28d72fbd07e0b8cbba0ff39e';
    // the address the accidental deposit went to, in both sourceCoin and addressCoin formats
    const [depositAddressSourceCoin, depositAddressRecoveryCoin] = [sourceCoin, recoveryCoin].map((coin) =>
      coin.generateAddress({ keychains: keychainsBase58, index: 0 })
    );
    // the address where we want to recover our funds to
    const recoveryAddress = sourceCoin.generateAddress({ keychains: keychainsBase58, index: 1 }).address;
    const nocks: nock.Scope[] = [];

    let depositTx: utxolib.bitgo.UtxoTransaction;

    function getDepositUnspents() {
      return [mockUnspent(sourceCoin.network, 'p2sh', 0, 1e8)];
    }

    function getDepositTransaction(): utxolib.bitgo.UtxoTransaction {
      return createFullSignedTransaction(
        sourceCoin.network,
        getDepositUnspents(),
        depositAddressSourceCoin.address,
        getDefaultWalletUnspentSigner()
      );
    }

    before('setup krsProviders', function () {
      // pretend that Keyternal accepts recoveries for all coins
      config.krsProviders.keyternal.supportedCoins = ['btc', 'bch', 'bsv', 'bcha', 'ltc', 'zec', 'dash'];
      config.krsProviders.keyternal.feeAddresses = {
        tbtc: '2Mujz9eicmgpPcdScRJTywVK3EQNHDJG3yN',
        tbch: '2Mujz9eicmgpPcdScRJTywVK3EQNHDJG3yN',
        tbsv: '2Mujz9eicmgpPcdScRJTywVK3EQNHDJG3yN',
        tbcha: '2Mujz9eicmgpPcdScRJTywVK3EQNHDJG3yN',
        tltc: 'QffXMViM8DYgPRf1Hoczjw7BS5CVdSWaBL',
        tzec: 't2ATLAhBP1uTuyiWs5DY5CPH1VuYkGUindt',
        tdash: '8euHug4dbmPy3CLawwWdeTjGLqPYEGz3Kt',
      };
    });

    before('prepare deposit tx', function () {
      depositTx = getDepositTransaction();
    });

    before('setup nocks', function () {
      nocks.push(nockWallet(recoveryCoin, recoveryWalletId, keychainsBase58));
      nocks.push(nockWalletAddress(recoveryCoin, recoveryWalletId, depositAddressRecoveryCoin));
      nocks.push(
        ...nockThirdpartyExplorerTxInfo(sourceCoin, depositTx, getDepositUnspents(), depositAddressSourceCoin.address)
      );
    });

    after(function () {
      nocks.forEach((n) => n.isDone());
    });

    let signedRecovery: CrossChainRecoverySigned;
    before('create recovery transaction', async function () {
      signedRecovery = (await sourceCoin.recoverFromWrongChain({
        recoveryCoin,
        txid: depositTx.getId(),
        recoveryAddress,
        wallet: recoveryWalletId,
        xprv: keychainsBase58[0].prv,
      })) as CrossChainRecoverySigned;
    });

    it('should match fixture', async function () {
      const signedRecoveryObj = {
        ...signedRecovery,
        tx: transactionHexToObj(signedRecovery.txHex as string, sourceCoin.network),
      };
      shouldEqualJSON(
        signedRecoveryObj,
        await getFixture(sourceCoin, `recovery/${recoveryCoin.getChain()}`, signedRecoveryObj)
      );
    });

    it('should have valid signatures', function () {
      const tx = utxolib.bitgo.createTransactionFromBuffer(
        Buffer.from(signedRecovery.txHex as string, 'hex'),
        sourceCoin.network
      );

      should.equal(tx.ins.length, depositTx.outs.length);

      tx.ins.forEach((input, i) => {
        utxolib.bitgo.verifySignature(tx, i, depositTx.outs[i].value, {}, depositTx.outs).should.eql(true);
      });
    });
  });
}

function isSupportedCrossChainRecovery(sourceCoin: AbstractUtxoCoin, recoveryCoin: AbstractUtxoCoin): boolean {
  return config.supportedCrossChainRecoveries[sourceCoin.getFamily()]?.includes(recoveryCoin.getFamily());
}

utxoCoins.forEach((coin) => {
  utxoCoins
    .filter(
      (otherCoin) =>
        coin !== otherCoin &&
        isSupportedCrossChainRecovery(coin, otherCoin) &&
        ((utxolib.coins.isMainnet(coin.network) && utxolib.coins.isMainnet(otherCoin.network)) ||
          (utxolib.coins.isTestnet(coin.network) && utxolib.coins.isTestnet(otherCoin.network)))
    )
    .forEach((otherCoin) => {
      run(coin, otherCoin);
    });
});