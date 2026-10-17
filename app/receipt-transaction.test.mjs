import assert from 'node:assert/strict';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { receiptTransaction } from './receipt-transaction.mjs';

const signer = await Keypair.generate();
const prepared = { program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', memo: 'agent-exchange:v1:test-round:1:abc123' };
const transaction = receiptTransaction(signer.publicKey, {blockhash:'11111111111111111111111111111111',lastValidBlockHeight:100n}, prepared);
assert.equal(transaction.message.instructions.length, 1);
assert.equal(transaction.message.header.numRequiredSignatures, 1);
assert.equal(transaction.message.accountKeys[0].toBase58(), signer.publicKey.toBase58());
await transaction.sign([signer]);
const wire = transaction.serialize();
assert.ok(wire instanceof Uint8Array);
const restored = VersionedTransaction.deserialize(wire);
assert.equal(restored.version, 'legacy');
assert.equal(restored.message.accountKeys[restored.message.instructions[0].programIdIndex].toBase58(), prepared.program);
console.log('Receipt transaction: one memo, one signer, signed wire round-trip passed. No RPC calls.');
