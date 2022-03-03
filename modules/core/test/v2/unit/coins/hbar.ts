import * as accountLib from '@bitgo/account-lib';
import { TestBitGo } from '../../../lib/test_bitgo';
import { rawTransactionForExplain } from '../../fixtures/coins/hbar';
import { randomBytes } from 'crypto';
import { Hbar } from '../../../../src/v2/coins/';
import * as should from 'should';

describe('Hedera Hashgraph:', function () {
  let bitgo;
  let basecoin;

  before(function () {
    bitgo = new TestBitGo({ env: 'mock' });
    bitgo.initializeTestVars();
    basecoin = bitgo.coin('thbar');
  });

  it('should instantiate the coin', function () {
    const basecoin = bitgo.coin('hbar');
    basecoin.should.be.an.instanceof(Hbar);
  });

  it('should check valid addresses', async function () {
    const badAddresses = ['', '0.0', 'YZ09fd-', '0.0.0.a', 'sadasdfggg', '0.2.a.b', '0.0.100?=sksjd'];
    const goodAddresses = ['0', '0.0.0', '0.0.41098', '0.0.0?memoId=84', '0.0.41098',
      '0.0.41098?memoId=2aaaaa', '0.0.41098?memoId=1', '0.0.41098?memoId=',
    ];

    badAddresses.map(addr => { basecoin.isValidAddress(addr).should.equal(false); });
    goodAddresses.map(addr => { basecoin.isValidAddress(addr).should.equal(true); });

    const hexAddress = '0x23C3E227BE97281A70A549c7dDB8d5Caad3E7C84';
    basecoin.isValidAddress(hexAddress).should.equal(false);
  });

  it('should get memoId and address', async function () {
    const addr = '0.0.41098?memoId=23233';
    const details = basecoin.getAddressDetails(addr);

    details.address.should.equal('0.0.41098');
    details.memoId.should.equal('23233');
  });

  it('should get memoId and address when memoId=null', async function () {
    const addr = '0.0.41098?memoId=';
    const details = basecoin.getAddressDetails(addr);

    details.address.should.equal('0.0.41098');
    details.memoId.should.equal('');
  });

  it('should build without a memoId if its missing for an address', async function () {
    const address = '0.0.41098';
    let memoId: string | undefined = undefined;
    let norm = basecoin.normalizeAddress({ address, memoId });
    norm.should.equal('0.0.41098');
    memoId = '';
    norm = basecoin.normalizeAddress({ address, memoId });
    norm.should.equal('0.0.41098');
  });

  it('should explain a transaction', async function () {
    const tx = JSON.parse(rawTransactionForExplain);
    const explain = await basecoin.explainTransaction(tx);

    explain.id.should.equal('0.0.43285@1600529800.643093586');
    explain.outputAmount.should.equal('2200000000');
    explain.timestamp.should.equal('1600529800.643093586');
    explain.expiration.should.equal('120');
    explain.outputs[0].amount.should.equal('2200000000');
    explain.outputs[0].address.should.equal('0.0.43283');
    explain.outputs[0].memo.should.equal('1');
    explain.fee.fee.should.equal(1160407);
    explain.changeAmount.should.equal('0');
  });

  it('should verify isWalletAddress', function () {
    const baseAddress = '0.0.41098';
    const validAddress1 = '0.0.41098?memoId=1';
    const validAddress2 = '0.0.41098?memoId=2';
    const unrelatedValidAddress = '0.1.41098?memoId=1';
    const invalidAddress = '0.0.0.a';
    basecoin.isWalletAddress({ address: validAddress1, baseAddress }).should.true();
    basecoin.isWalletAddress({ address: validAddress2, baseAddress }).should.true();
    basecoin.isWalletAddress({ address: validAddress2, baseAddress: validAddress1 }).should.true();
    basecoin.isWalletAddress({ address: unrelatedValidAddress, baseAddress }).should.false();
    should.throws(() => basecoin.isWalletAddress({ address: invalidAddress, baseAddress }), `invalid address: ${invalidAddress}`);
  });

  describe('Keypairs:', () => {
    it('should generate a keypair from random seed', function () {
      const keyPair = basecoin.generateKeyPair();
      keyPair.should.have.property('pub');
      keyPair.should.have.property('prv');

      basecoin.isValidPub(keyPair.pub).should.equal(true);
    });

    it('should generate a keypair from a seed', function () {
      const seedText = '80350b4208d381fbfe2276a326603049fe500731c46d3c9936b5ce036b51377f';
      const seed = Buffer.from(seedText, 'hex');
      const keyPair = basecoin.generateKeyPair(seed);

      keyPair.prv.should.equal('302e020100300506032b65700422042080350b4208d381fbfe2276a326603049fe500731c46d3c9936b5ce036b51377f');
      keyPair.pub.should.equal('302a300506032b65700321009cc402b5c75214269c2826e3c6119377cab6c367601338661c87a4e07c6e0333');
    });

    it('should validate a stellar seed', function () {
      basecoin.isStellarSeed('SBMWLNV75BPI2VB4G27RWOMABVRTSSF7352CCYGVELZDSHCXWCYFKXIX').should.ok();
    });

    it('should convert a stellar seed to an hbar prv', function () {
      const seed = basecoin.convertFromStellarSeed('SBMWLNV75BPI2VB4G27RWOMABVRTSSF7352CCYGVELZDSHCXWCYFKXIX');
      seed.should.equal('302e020100300506032b6570042204205965b6bfe85e8d543c36bf1b39800d633948bfdf742160d522f2391c57b0b055');
    });
  });

  describe('Sign Message', () => {
    it('should be performed', async () => {
      const keyPair = new accountLib.Hbar.KeyPair();
      const messageToSign = Buffer.from(randomBytes(32)).toString('hex');
      const signature = await basecoin.signMessage(keyPair.getKeys(), messageToSign);
      keyPair.verifySignature(messageToSign, Uint8Array.from(Buffer.from(signature, 'hex'))).should.equals(true);
    });

    it('should fail with missing private key', async () => {
      const keyPair = new accountLib.Hbar.KeyPair({ pub: '302a300506032b6570032100d8fd745361df270776a3ab1b55d5590ec00a26ab45eea37197dc9894a81fcb82' }).getKeys();
      const messageToSign = Buffer.from(randomBytes(32)).toString('hex');
      await basecoin.signMessage(keyPair, messageToSign).should.be.rejectedWith('Invalid key pair options');
    });
  });

  describe('Sign transaction:', () => {
    /**
     * Build an unsigned account-lib multi-signature send transaction
     * @param destination The destination address of the transaction
     * @param source The account sending thist ransaction
     * @param amount The amount to send to the recipient
     */
    const buildUnsignedTransaction = async function ({
      destination,
      source,
      amount = '100000',
    }) {

      const factory = accountLib.register('thbar', accountLib.Hbar.TransactionBuilderFactory);
      const txBuilder = factory.getTransferBuilder();
      txBuilder.fee({
        fee: '100000',
      });
      txBuilder.source({ address: source });
      txBuilder.to(destination);
      txBuilder.amount(amount);

      return await txBuilder.build();
    };

    it('should sign transaction', async function () {
      const key = new accountLib.Hbar.KeyPair();
      const destination = '0.0.129369';
      const source = '0.0.1234';
      const amount = '100000';

      const unsignedTransaction = await buildUnsignedTransaction({
        destination,
        source,
        amount,
      });

      const tx = await basecoin.signTransaction({
        prv: key.getKeys().prv!.toString(),
        txPrebuild: {
          txHex: unsignedTransaction.toBroadcastFormat(),
        },
      });

      const factory = accountLib.register('thbar', accountLib.Hbar.TransactionBuilderFactory);
      const txBuilder = factory.from(tx.halfSigned.txHex);
      const signedTx = await txBuilder.build();
      const txJson = signedTx.toJson();
      txJson.to.should.equal(destination);
      txJson.from.should.equal(source);
      txJson.amount.should.equal(amount);
      signedTx.signature.length.should.equal(1);
    });
  });
});
