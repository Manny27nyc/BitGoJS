import * as bs58 from 'bs58';
import * as _ from 'lodash';
import * as nock from 'nock';
import * as openpgp from 'openpgp';
import * as should from 'should';
import * as sinon from 'sinon';

import Eddsa, { GShare, KeyShare, SignShare } from '../../../../../account-lib/dist/src/mpc/tss';
import { Keychain, Wallet } from '../../../../src';
import { SignatureShareRecord, SignatureShareType, TssUtils, TxRequest } from '../../../../src/v2/internal/tssUtils';
import { TestBitGo } from '../../../lib/test_bitgo';
import * as common from '../../../../src/common';
import { RequestTracer } from '../../../../src/v2/internal/util';

describe('TSS Utils:', async function () {
  let sandbox: sinon.SinonSandbox;
  let MPC;
  let bgUrl: string;
  let tssUtils: TssUtils;
  let wallet: Wallet;
  let bitgoKeyShare;
  const reqId = new RequestTracer;
  const coinName = 'tsol';
  const validUserPShare = '{"i":"1","y":"c4f36234dbcb78ba7efee44771692a71f1d366c70b99656922168590a63c96c2","x":"5d462225ce32327c1ad0c9b1c2263bdbdb154236fb4b3445f199f05b135d010b","prefix":"77e5611f781363b4e303bbe20bed8c62028d88ba22b47af9e77e6b134c373009"}';
  const txRequest = {
    txRequestId: 'randomId',
    unsignedTxs: [{ signableHex: 'randomhex', serializedTxHex: 'randomhex2' }],
    signatureShares: [
      { from: 'bitgo',
        to: 'user',
        share: '9d7159a76700635b10edf1fb983ce1ad1690a9686927e137cb4a70b32ad77b0e7f0394fa3ac3db433aec1097ca88ee43034d3a9fb0c4f87b63ff38fc1d1c8f4f' }],
  };
  const signablePayload = Buffer.from(txRequest.unsignedTxs[0].signableHex, 'hex');
  const validUserSignShare = {
    xShare: {
      i: '1',
      y: 'c4f36234dbcb78ba7efee44771692a71f1d366c70b99656922168590a63c96c2',
      x: '5d462225ce32327c1ad0c9b1c2263bdbdb154236fb4b3445f199f05b135d010b',
      r: '7b8dfc6dea126b4ba41125725952dfd598d4341ade0a1e9ad5aa576689503b0d',
      R: 'faad6f00bb10713aa62ad39c548d28a8641f12beb7ead7e445d4944aa66d0b06',
    },
    rShares: {
      3: {
        i: '3',
        j: '1',
        r: '5f59dbbcf2a5a0acc52453938f5551719a566ffacac619d8d14816c00405140c',
        R: 'faad6f00bb10713aa62ad39c548d28a8641f12beb7ead7e445d4944aa66d0b06',
      },
    },
  };
  const validUserToBitgoGShare = {
    i: '1',
    y: 'c4f36234dbcb78ba7efee44771692a71f1d366c70b99656922168590a63c96c2',
    gamma: 'af161aca65ed09aeb76b858b56f0260b69aeebecdb69580dcc00e84c78cea60a',
    R: 'f6546d5a44f9dd5b594f0de0c1bf80db45f15f432ccf498e651e6160a7710a83',
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  before(async function () {
    MPC = await Eddsa();
    bitgoKeyShare = await MPC.keyShare(3, 2, 3);

    const bitGoGPGKey = await openpgp.generateKey({
      userIDs: [
        {
          name: 'bitgo',
          email: 'bitgo@test.com',
        },
      ],
    });
    const constants = {
      tss: {
        bitgoPublicKey: bitGoGPGKey.publicKey,
      },
    };

    nock('https://bitgo.fakeurl')
      .persist()
      .get('/api/v1/client/constants')
      .reply(200, { ttl: 3600, constants });

    const bitgo = new TestBitGo({ env: 'mock' });
    bitgo.initializeTestVars();

    const baseCoin = bitgo.coin(coinName);

    bgUrl = common.Environments[bitgo.getEnv()].uri;

    const walletData = {
      id: '5b34252f1bf349930e34020a00000000',
      coin: 'tsol',
      keys: [
        '5b3424f91bf349930e34017500000000',
        '5b3424f91bf349930e34017600000000',
        '5b3424f91bf349930e34017700000000',
      ],
      coinSpecific: {},
    };
    wallet = new Wallet(bitgo, baseCoin, walletData);
    tssUtils = new TssUtils(bitgo, baseCoin, wallet);
  });

  describe('TSS key chains:', async function() {
    it('should generate TSS key chains', async function () {
      const userKeyShare = MPC.keyShare(1, 2, 3);
      const backupKeyShare = MPC.keyShare(2, 2, 3);
      const userGpgKey = await openpgp.generateKey({
        userIDs: [
          {
            name: 'test',
            email: 'test@test.com',
          },
        ],
      });

      const nockedBitGoKeychain = await nockBitgoKeychain({
        coin: coinName,
        userKeyShare,
        backupKeyShare,
        userGpgKey,
      });
      const nockedUserKeychain = await nockUserKeychain({ coin: coinName });
      await nockBackupKeychain({ coin: coinName });

      const bitgoKeychain = await tssUtils.createBitgoKeychain(userGpgKey, userKeyShare, backupKeyShare);
      const userKeychain = await tssUtils.createUserKeychain(
        userGpgKey,
        userKeyShare,
        backupKeyShare,
        bitgoKeychain,
        'passphrase');
      const backupKeychain = await tssUtils.createBackupKeychain(
        userGpgKey,
        userKeyShare,
        backupKeyShare,
        bitgoKeychain,
        'passphrase');

      const backupCombined = MPC.keyCombine(backupKeyShare.uShare, [userKeyShare.yShares[2], bitgoKeyShare.yShares[2]]);

      bitgoKeychain.should.deepEqual(nockedBitGoKeychain);
      userKeychain.should.deepEqual(nockedUserKeychain);

      // unencrypted `prv` property should exist on backup keychain
      JSON.stringify(backupCombined.pShare).should.equal(backupKeychain.prv);
      should.exist(backupKeychain.encryptedPrv);

    });

    it('should generate TSS key chains with optional params', async function () {
      const enterprise = 'enterprise';
      const originalPasscodeEncryptionCode = 'originalPasscodeEncryptionCode';

      const userKeyShare = MPC.keyShare(1, 2, 3);
      const backupKeyShare = MPC.keyShare(2, 2, 3);
      const userGpgKey = await openpgp.generateKey({
        userIDs: [
          {
            name: 'test',
            email: 'test@test.com',
          },
        ],
      });

      const nockedBitGoKeychain = await nockBitgoKeychain({
        coin: coinName,
        userKeyShare,
        backupKeyShare,
        userGpgKey,
      });
      const nockedUserKeychain = await nockUserKeychain({ coin: coinName });
      await nockBackupKeychain({ coin: coinName });

      const bitgoKeychain = await tssUtils.createBitgoKeychain(userGpgKey, userKeyShare, backupKeyShare, enterprise);
      const userKeychain = await tssUtils.createUserKeychain(
        userGpgKey,
        userKeyShare,
        backupKeyShare,
        bitgoKeychain,
        'passphrase',
        originalPasscodeEncryptionCode);
      const backupKeychain = await tssUtils.createBackupKeychain(
        userGpgKey,
        userKeyShare,
        backupKeyShare,
        bitgoKeychain,
        'passphrase');

      const backupCombined = MPC.keyCombine(backupKeyShare.uShare, [userKeyShare.yShares[2], bitgoKeyShare.yShares[2]]);

      bitgoKeychain.should.deepEqual(nockedBitGoKeychain);
      userKeychain.should.deepEqual(nockedUserKeychain);

      // unencrypted `prv` property should exist on backup keychain
      JSON.stringify(backupCombined.pShare).should.equal(backupKeychain.prv);
      should.exist(backupKeychain.encryptedPrv);

    });

    it('should fail to generate TSS key chains', async function () {
      const userKeyShare = MPC.keyShare(1, 2, 3);
      const backupKeyShare = MPC.keyShare(2, 2, 3);
      const userGpgKey = await openpgp.generateKey({
        userIDs: [
          {
            name: 'test',
            email: 'test@test.com',
          },
        ],
      });

      const nockedBitGoKeychain = await nockBitgoKeychain({
        coin: coinName,
        userKeyShare,
        backupKeyShare,
        userGpgKey,
      });
      const bitgoKeychain = await tssUtils.createBitgoKeychain(userGpgKey, userKeyShare, backupKeyShare);
      bitgoKeychain.should.deepEqual(nockedBitGoKeychain);

      await tssUtils.createUserKeychain(
        userGpgKey,
        userKeyShare,
        MPC.keyShare(2, 2, 3),
        bitgoKeychain,
        'passphrase')
        .should.be.rejectedWith('Failed to create user keychain - commonPubs do not match.');
      await tssUtils.createUserKeychain(
        userGpgKey,
        MPC.keyShare(1, 2, 3),
        backupKeyShare,
        bitgoKeychain,
        'passphrase')
        .should.be.rejectedWith('Failed to create user keychain - commonPubs do not match.');

      await tssUtils.createBackupKeychain(
        userGpgKey,
        MPC.keyShare(1, 2, 3),
        backupKeyShare,
        bitgoKeychain,
        'passphrase')
        .should.be.rejectedWith('Failed to create backup keychain - commonPubs do not match.');
      await tssUtils.createBackupKeychain(
        userGpgKey,
        userKeyShare,
        MPC.keyShare(2, 2, 3),
        bitgoKeychain,
        'passphrase')
        .should.be.rejectedWith('Failed to create backup keychain - commonPubs do not match.');
    });
  });

  describe('signTxRequest:', function() {
    const txRequestId = 'txRequestId';
    const userPShare = 'userPShare';
    const txRequest: TxRequest = {
      txRequestId,
      unsignedTxs: [
        {
          serializedTxHex: 'ababfefe',
          signableHex: 'deadbeef',
        }
      ]
    };

    beforeEach(function () {
      const userSignShare: SignShare = {
        xShare: {
          i: 'i',
          y: 'y',
          R: 'R',
          r: 'r',
          x: 'x',
        },
        rShares: {},
      };
      const bitGoToUserShare: SignatureShareRecord = {
        from: SignatureShareType.BITGO,
        to: SignatureShareType.USER,
        share: 'bitgoUserShare',
      };
      const userToBitGoGShare: GShare = {
        i: 'i',
        y: 'y',
        R: 'R',
        gamma: 'gamma',
      };

      const createUserSignShare = sandbox.stub(tssUtils, 'createUserSignShare');
      createUserSignShare.calledOnceWithExactly(Buffer.from('deadbeef', 'hex'), userPShare);
      createUserSignShare.resolves(userSignShare);

      const offerUserToBitgoRShare = sandbox.stub(tssUtils, 'offerUserToBitgoRShare');
      offerUserToBitgoRShare.calledOnceWithExactly('txRequestId', userSignShare);
      offerUserToBitgoRShare.resolves(undefined);

      const getBitgoToUserRShare = sandbox.stub(tssUtils, 'getBitgoToUserRShare');
      getBitgoToUserRShare.calledOnceWithExactly('txRequestId');
      getBitgoToUserRShare.resolves(bitGoToUserShare);

      const createUserToBitGoGShare = sandbox.stub(tssUtils, 'createUserToBitGoGShare');
      createUserToBitGoGShare.calledOnceWithExactly(userSignShare, bitGoToUserShare, Buffer.from('deadbeef', 'hex'));
      createUserToBitGoGShare.resolves(userToBitGoGShare);

      const sendUserToBitgoGShare = sandbox.stub(tssUtils, 'sendUserToBitgoGShare');
      sendUserToBitgoGShare.calledOnceWithExactly('txRequestId', userToBitGoGShare);
      sendUserToBitgoGShare.resolves(undefined);
    });

    it('signTxRequest should succeed with txRequest object as input', async function () {
      const getTxRequest = sandbox.stub(tssUtils, 'getTxRequest');
      getTxRequest.resolves(txRequest);
      getTxRequest.calledWith('txRequestId');

      const signedTxRequest = await tssUtils.signTxRequest(txRequest, userPShare, reqId);
      signedTxRequest.should.deepEqual(txRequest);
      sinon.assert.calledOnce(getTxRequest);

      sandbox.verifyAndRestore();
    });

    it('signTxRequest should succeed with txRequest id as input', async function () {
      const getTxRequest = sandbox.stub(tssUtils, 'getTxRequest');
      getTxRequest.resolves(txRequest);
      getTxRequest.calledWith(txRequestId);

      const signedTxRequest = await tssUtils.signTxRequest(txRequestId, userPShare, reqId);
      signedTxRequest.should.deepEqual(txRequest);
      sinon.assert.calledTwice(getTxRequest);

      sandbox.verifyAndRestore();
    });
  });

  describe('prebuildTxWithIntent:', async function() {
    it('should build single recipient tx', async function () {
      const nockedCreateTx = await nockCreateTxRequest({
        walletId: wallet.id(),
        requestBody: {
          intent: {
            intentType: 'payment',
            recipients: [{
              address: {
                address: 'recipient',
              },
              amount: {
                value: '10000',
                asset: 'tsol',
              },
            }],
          },
        },
        // don't care about the actual response - just need to make sure request body matches
        response: {},
      });

      await tssUtils.prebuildTxWithIntent({
        reqId,
        recipients: [{
          address: 'recipient',
          amount: '10000',
        }],
        intentType: 'payment',
      });

      nockedCreateTx.isDone().should.be.true();
    });

    it('should build multiple recipients with memo tx', async function () {
      const nockedCreateTx = await nockCreateTxRequest({
        walletId: wallet.id(),
        requestBody: {
          intent: {
            intentType: 'payment',
            recipients: [{
              address: {
                address: 'recipient1',
              },
              amount: {
                value: '10000',
                asset: 'tsol',
              },
            }, {
              address: {
                address: 'recipient2',
              },
              amount: {
                value: '20000',
                asset: 'tsol',
              },
            }],
            memo: 'memo',
          },
        },
        // don't care about the actual response - just need to make sure request body matches
        response: {},
      });

      await tssUtils.prebuildTxWithIntent({
        reqId,
        recipients: [{
          address: 'recipient1',
          amount: '10000',
        }, {
          address: 'recipient2',
          amount: '20000',
        }],
        memo: {
          value: 'memo',
          type: 'text',
        },
        intentType: 'payment',
      });

      nockedCreateTx.isDone().should.be.true();
    });
  });

  describe('createUserSignShare:', async function() {
    it('should succeed to create User SignShare', async function() {
      const userSignShare = await tssUtils.createUserSignShare(signablePayload, validUserPShare );
      userSignShare.should.have.properties(['xShare', 'rShares']);
      const { xShare, rShares } = userSignShare;
      xShare.should.have.property('i').and.be.a.String();
      xShare.should.have.property('y').and.be.a.String();
      xShare.should.have.property('x').and.be.a.String();
      xShare.should.have.property('r').and.be.a.String();
      xShare.should.have.property('R').and.be.a.String();
      rShares.should.have.property('3').and.be.an.Object();
      rShares['3'].should.have.property('i').and.be.a.String();
      rShares['3'].should.have.property('j').and.be.a.String();
      rShares['3'].should.have.property('r').and.be.a.String();
      rShares['3'].should.have.property('R').and.be.a.String();
    });

    it('should fail if the Pshare doesnt belong to the User', async function() {
      const invalidUserSignShare = '{"i":"3","y":"c4f36234dbcb78ba7efee44771692a71f1d366c70b99656922168590a63c96c2","x":"5d462225ce32327c1ad0c9b1c2263bdbdb154236fb4b3445f199f05b135d010b","prefix":"77e5611f781363b4e303bbe20bed8c62028d88ba22b47af9e77e6b134c373009"}';
      await tssUtils.createUserSignShare(signablePayload, invalidUserSignShare ).should.be.rejectedWith('Invalid PShare, PShare doesnt belong to the User');

    });
  });

  describe('sendSignatureShare:', async function() {
    it('should succeed to send Signature Share', async function() {
      const signatureShare = { from: 'user', to: 'bitgo', share: '128bytestring' } as SignatureShareRecord;
      const nock = await nockSendSignatureShare({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, signatureShare });
      const response = await tssUtils.sendSignatureShare( txRequest.txRequestId, signatureShare);
      response.should.deepEqual(signatureShare);
      nock.isDone().should.equal(true);
    });

    it('should fail to send Signature Share', async function() {
      const invalidSignatureShare = { from: 'bitgo', to: 'user', share: '128bytestring' } as SignatureShareRecord;
      const nock = await nockSendSignatureShare({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, signatureShare: invalidSignatureShare }, 400);
      await tssUtils.sendSignatureShare( txRequest.txRequestId, invalidSignatureShare).should.be.rejectedWith('some error' );
      nock.isDone().should.equal(true);
    });
  });

  describe('offerUserToBitgoRShare:', async function() {
    it('should succeed to send Signature Share', async function() {
      const signatureShare = { from: 'user', to: 'bitgo', share: validUserSignShare.rShares[3].r + validUserSignShare.rShares[3].R } as SignatureShareRecord;
      const nock = await nockSendSignatureShare({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, signatureShare });
      await tssUtils.offerUserToBitgoRShare( txRequest.txRequestId, validUserSignShare).should.be.fulfilled();
      nock.isDone().should.equal(true);
    });

    it('should fail if no rShare is found', async function() {
      const invalidUserSignShare = _.cloneDeep(validUserSignShare) as any ;
      delete invalidUserSignShare.rShares['3'];
      await tssUtils.offerUserToBitgoRShare( txRequest.txRequestId, invalidUserSignShare).should.be.rejectedWith('userToBitgo RShare not found');
    });

    it('should fail if the rShare found is invalid', async function() {
      const invalidUserSignShare = _.cloneDeep(validUserSignShare) as any ;
      invalidUserSignShare.rShares['3'].i = '1';
      await tssUtils.offerUserToBitgoRShare( txRequest.txRequestId, invalidUserSignShare).should.be.rejectedWith('Invalid RShare, is not from User to Bitgo');

      const invalidUserSignShare2 = _.cloneDeep(validUserSignShare) as any ;
      invalidUserSignShare2.rShares['3'].j = '3';
      await tssUtils.offerUserToBitgoRShare( txRequest.txRequestId, invalidUserSignShare2).should.be.rejectedWith('Invalid RShare, is not from User to Bitgo');
    });
  });

  describe('getBitgoToUserRShare:', async function() {
    it('should succeed to get the Bitgo to User RShare', async function() {
      const response = { txRequests: [txRequest] };
      const nock = await nockGetTxRequest({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, response });
      const bitgoToUserRShare = await tssUtils.getBitgoToUserRShare(txRequest.txRequestId);
      bitgoToUserRShare.should.deepEqual(txRequest.signatureShares[0]);
      nock.isDone().should.equal(true);
    });

    it('should fail if there is no bitgo to user RShare', async function() {
      const invalidTxRequest = _.cloneDeep(txRequest);
      invalidTxRequest.signatureShares[0].to = 'bitgo';
      invalidTxRequest.signatureShares[0].from = 'user';
      const response = { txRequests: [invalidTxRequest] };
      const nock = await nockGetTxRequest({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, response });
      await tssUtils.getBitgoToUserRShare(txRequest.txRequestId).should.be.rejectedWith('Bitgo to User RShare not found for id: ' + txRequest.txRequestId);
      nock.isDone().should.equal(true);
    });

    it('should fail if there is no signaturesShares', async function() {
      const invalidTxRequest = _.cloneDeep(txRequest);
      invalidTxRequest.signatureShares = [];
      const response = { txRequests: [invalidTxRequest] };
      const nock = await nockGetTxRequest({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, response });
      await tssUtils.getBitgoToUserRShare(txRequest.txRequestId).should.be.rejectedWith('No signatures shares found for id: ' + txRequest.txRequestId);
      nock.isDone().should.equal(true);
    });
  });

  describe('getTxRequest:', async function() {
    it('should succeed to get txRequest by id', async function () {
      const response = { txRequests: [txRequest] };
      const nock = await nockGetTxRequest({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, response });
      const txReq = await tssUtils.getTxRequest(txRequest.txRequestId);
      txReq.should.deepEqual(txRequest);
      nock.isDone().should.equal(true);
    });

    it('should fail if there are no txRequests', async function () {
      const response = { txRequests: [] };
      const nock = await nockGetTxRequest({ walletId: wallet.id(), txRequestId: txRequest.txRequestId, response });
      await tssUtils.getTxRequest(txRequest.txRequestId).should.be.rejectedWith('Unable to find TxRequest with id randomId');
      nock.isDone().should.equal(true);
    });
  });

  describe('createUserToBitGoGShare:', async function() {
    it('should succeed to create a UserToBitGo GShare', async function() {
      const userToBitgoGShare = await tssUtils.createUserToBitGoGShare(validUserSignShare, txRequest.signatureShares[0] as SignatureShareRecord, signablePayload);
      userToBitgoGShare.should.deepEqual(validUserToBitgoGShare);
    });

    it('should fail when XShare doesnt belong to the user', async function() {
      const invalidUserSignShare = _.cloneDeep(validUserSignShare) ;
      invalidUserSignShare.xShare.i = '3';
      await tssUtils.createUserToBitGoGShare(invalidUserSignShare, txRequest.signatureShares[0] as SignatureShareRecord, signablePayload).should.be.rejectedWith('Invalid XShare, doesnt belong to the User');
    });

    it('should fail when RShare doesnt belong to Bitgo', async function() {
      const invalidBitgoRShare = _.cloneDeep(txRequest.signatureShares[0]);
      invalidBitgoRShare.from = 'user';
      await tssUtils.createUserToBitGoGShare(validUserSignShare, invalidBitgoRShare as SignatureShareRecord, signablePayload).should.be.rejectedWith('Invalid RShare, is not from Bitgo to User');

      const invalidBitgoRShare2 = _.cloneDeep(txRequest.signatureShares[0]);
      invalidBitgoRShare2.to = 'bitgo';
      await tssUtils.createUserToBitGoGShare(validUserSignShare, invalidBitgoRShare2 as SignatureShareRecord, signablePayload).should.be.rejectedWith('Invalid RShare, is not from Bitgo to User');
    });
  });

  describe('sendUserToBitgoGShare:', async function() {
    it('should succeed to send User to Bitgo GShare', async function() {
      const signatureShare = {
        from: 'user',
        to: 'bitgo',
        share: validUserToBitgoGShare.R + validUserToBitgoGShare.gamma,
      } as SignatureShareRecord;
      const nock = await nockSendSignatureShare({
        walletId: wallet.id(),
        txRequestId: txRequest.txRequestId,
        signatureShare,
      });
      await tssUtils.sendUserToBitgoGShare(txRequest.txRequestId, validUserToBitgoGShare).should.be.fulfilled();
      nock.isDone().should.equal(true);
    });

    it('should fail when the GShare is not from the User', async function() {
      const invalidUserToBitgoGShare = _.cloneDeep(validUserToBitgoGShare);
      invalidUserToBitgoGShare.i = '3';
      await tssUtils.sendUserToBitgoGShare(txRequest.txRequestId, invalidUserToBitgoGShare).should.be.rejectedWith('Invalid GShare, doesnt belong to the User');
    });
  });

  describe('sendTxRequest:', async function() {
    it('should succeed to send tx request', async function() {
      const nock = await nockSendTxRequest({ coin: coinName, walletId: wallet.id(), txRequestId: txRequest.txRequestId });
      await tssUtils.sendTxRequest(txRequest.txRequestId).should.be.fulfilled();
      nock.isDone().should.equal(true);
    });
  });


  // #region Nock helpers
  async function nockBitgoKeychain(params: {
    coin: string,
    userKeyShare: KeyShare,
    backupKeyShare: KeyShare,
    userGpgKey: openpgp.SerializedKeyPair<string>,
  }): Promise<Keychain> {
    const bitgoCombined = MPC.keyCombine(bitgoKeyShare.uShare, [params.userKeyShare.yShares[3], params.backupKeyShare.yShares[3]]);
    const userGpgKeyActual = await openpgp.readKey({ armoredKey: params.userGpgKey.publicKey });

    const bitgoToUserMessage = await openpgp.createMessage({ text: bitgoKeyShare.yShares[1].u });
    const encryptedBitgoToUserMessage = await openpgp.encrypt({
      message: bitgoToUserMessage,
      encryptionKeys: [userGpgKeyActual.toPublic()],
      format: 'armored',
    });

    const bitgoToBackupMessage = await openpgp.createMessage({
      text: Buffer.from(bitgoKeyShare.yShares[2].u, 'hex').toString('hex'),
    });
    const encryptedBitgoToBackupMessage = await openpgp.encrypt({
      message: bitgoToBackupMessage,
      encryptionKeys: [userGpgKeyActual.toPublic()],
      format: 'armored',
    });


    const bitgoKeychain: Keychain = {
      id: '3',
      pub: bitgoCombined.pShare.y,
      commonPub: bs58.encode(Buffer.from(bitgoCombined.pShare.y, 'hex')),
      keyShares: [
        {
          from: 'bitgo',
          to: 'user',
          publicShare: bs58.encode(Buffer.from(bitgoKeyShare.yShares[1].y, 'hex')),
          privateShare: encryptedBitgoToUserMessage.toString(),
        },
        {
          from: 'bitgo',
          to: 'backup',
          publicShare: bs58.encode(Buffer.from(bitgoKeyShare.yShares[2].y, 'hex')),
          privateShare: encryptedBitgoToBackupMessage.toString(),
        },
      ],
    };

    nock(bgUrl)
      .post(`/api/v2/${params.coin}/key`, _.matches({ type: 'tss', source: 'bitgo' }))
      .reply(200, bitgoKeychain);

    return bitgoKeychain;
  }

  async function nockUserKeychain(params: {
    coin: string,
  }): Promise<Keychain> {
    const userKeychain: Keychain = {
      id: '1',
      pub: '',
    };

    nock('https://bitgo.fakeurl')
      .post(`/api/v2/${params.coin}/key`, _.matches({ type: 'tss', source: 'user' }))
      .reply(200, userKeychain);

    return userKeychain;
  }

  async function nockBackupKeychain(params: {
    coin: string,
  }): Promise<Keychain> {
    const backupKeychain: Keychain = {
      id: '2',
      pub: '',
    };

    nock('https://bitgo.fakeurl')
      .post(`/api/v2/${params.coin}/key`, _.matches({ type: 'tss', source: 'backup' }))
      .reply(200, backupKeychain);

    return backupKeychain;
  }

  async function nockSendTxRequest(params: {coin:string, walletId: string, txRequestId: string}): Promise<nock.Scope> {
    return nock('https://bitgo.fakeurl')
      .post(`/api/v2/${params.coin}/wallet/${params.walletId}/tx/send`, { txRequestId: params.txRequestId })
      .reply(200);
  }

  async function nockGetTxRequest(params: {walletId: string, txRequestId: string, response: any}): Promise<nock.Scope> {
    return nock('https://bitgo.fakeurl')
      .get(`/api/v2/wallet/${params.walletId}/txrequests?txRequestIds=${params.txRequestId}&latest=true`)
      .reply(200, params.response);
  }

  async function nockSendSignatureShare(params: { walletId: string, txRequestId: string, signatureShare: any}, status = 200): Promise<nock.Scope> {
    return nock('https://bitgo.fakeurl')
      .post(`/api/v2/wallet/${params.walletId}/txrequests/${params.txRequestId}/signatureshares`, params.signatureShare )
      .reply(status, (status === 200 ? params.signatureShare : { error: 'some error' }));
  }

  async function nockCreateTxRequest(params: { walletId: string, requestBody: any, response: any }): Promise<nock.Scope> {
    return nock('https://bitgo.fakeurl')
      .post(`/api/v2/wallet/${params.walletId}/txrequests`, params.requestBody)
      .reply(200, params.response);
  }

  // #endregion Nock helpers
});
