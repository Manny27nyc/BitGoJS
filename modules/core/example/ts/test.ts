import { BitGo } from 'bitgo';
const bitgo = new BitGo({
  env: 'custom',
  customRootURI: 'https://testnet-03-app.bitgo-dev.com',
});
const coin = 'tavaxc';
const accessToken = 'v2xd395611d49b7a3a578602fb391dff8e02dc30b5139ef4a76dafe320a8c0f2587';
const walletId = '6214fb7bc5b9560007c58eec2ef4f4e1';

async function main() {
  bitgo.authenticateWithAccessToken({ accessToken });

  const wallet = await bitgo.coin(coin).wallets().getWallet({ id: walletId });

  const res = await wallet.sendMany({
    recipients: [{
      amount: '1000000000000000', // 0.01 tavaxc
      address: '0x2ce47e59d41f1229e48233f5d8166f2ac13d883b',
    }],
    walletPassphrase: 'test@bitgo.com',
    hop: true,
  });

  console.log(res);
}

main().catch((e) => console.error(e));
