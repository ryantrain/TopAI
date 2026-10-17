import { PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

// A legacy message in a versioned envelope keeps wallet serialization synchronous.
export function receiptTransaction(publicKey, latest, prepared) {
  const payer = new PublicKey(publicKey.toBase58());
  const transaction = new Transaction({ feePayer: payer, ...latest }).add(new TransactionInstruction({
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    programId: new PublicKey(prepared.program), data: new TextEncoder().encode(prepared.memo),
  }));
  return new VersionedTransaction(transaction.compileMessage());
}
