import test from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_CHAIN_REGISTRY } from '../chainRegistry';
import { deriveEvmAccount, validateEvmAddress } from './evmAdapter';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('EVM adapter derives the standard Ethereum mnemonic vector', () => {
  const chain = WALLET_CHAIN_REGISTRY.find(item => item.id === 'ethereum')!;
  const account = deriveEvmAccount(phrase, chain);
  assert.equal(account.address.toLowerCase(), '0x9858effd232b4033e47d90003d41ec34ecaeda94');
  assert.equal(account.derivationPath, "m/44'/60'/0'/0/0");
  assert.equal(account.chainId, 'ethereum');
});

test('EVM adapter rejects unsupported families and invalid account indexes', () => {
  const bitcoin = WALLET_CHAIN_REGISTRY.find(item => item.id === 'bitcoin')!;
  assert.throws(() => deriveEvmAccount(phrase, bitcoin), /No verified EVM adapter/);
  const ethereum = WALLET_CHAIN_REGISTRY.find(item => item.id === 'ethereum')!;
  assert.throws(() => deriveEvmAccount(phrase, ethereum, -1), /Account index/);
});

test('EVM address validation accepts standard addresses and rejects malformed values', () => {
  assert.equal(validateEvmAddress('0x9858EfFD232B4033E47d90003D41EC34EcaEda94'), true);
  assert.equal(validateEvmAddress('not-an-address'), false);
  assert.equal(validateEvmAddress('0x1234'), false);
});
