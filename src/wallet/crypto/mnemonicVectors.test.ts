import test from 'node:test';
import assert from 'node:assert/strict';
import { HDNodeWallet } from 'ethers';

const VECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('BIP-39 known vector derives the expected first Ethereum account', () => {
  const wallet = HDNodeWallet.fromPhrase(VECTOR, undefined, "m/44'/60'/0'/0/0");
  assert.equal(wallet.address.toLowerCase(), '0x9858effd232b4033e47d90003d41ec34ecaeda94');
});

test('account index changes the derived address deterministically', () => {
  const first = HDNodeWallet.fromPhrase(VECTOR, undefined, "m/44'/60'/0'/0/0");
  const second = HDNodeWallet.fromPhrase(VECTOR, undefined, "m/44'/60'/0'/0/1");
  assert.notEqual(first.address, second.address);
  assert.equal(
    HDNodeWallet.fromPhrase(VECTOR, undefined, "m/44'/60'/0'/0/1").address,
    second.address,
  );
});
