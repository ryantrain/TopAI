'use client';
import { useState } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';

export default function SolanaReceipt({ market, onBusy, refresh }) {
  const [pending, setPending] = useState(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Receipt request failed');
    return data;
  }
  async function verify(receipt) {
    await request('/api/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt) });
    setPending(null);
    setMessage('Devnet receipt verified. Virtual credits remain in the simulator.');
    await refresh();
  }
  async function record() {
    setWorking(true); onBusy(true); setMessage('');
    try {
      if (pending) { await verify(pending); return; }
      const wallet = window.phantom?.solana;
      if (!wallet?.isPhantom) throw new Error('Open this dashboard in a browser with Phantom installed. Use a Devnet wallet funded with test SOL.');
      const prepared = await request('/api/receipt');
      const [{ Connection }, { receiptTransaction }] = await Promise.all([import('@solana/web3.js'), import('./receipt-transaction.mjs')]);
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
      const { publicKey } = await wallet.connect();
      const latest = await connection.getLatestBlockhash('confirmed');
      const transaction = receiptTransaction(publicKey, latest, prepared);
      // Wallet signs; this app sends only to the fixed Devnet RPC. No private key leaves the wallet.
      const signed = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(await signed.serialize(), { skipPreflight: false });
      const receipt = { signature, session_id: prepared.statement.session_id, round: prepared.statement.round };
      setPending(receipt);
      setMessage('Submitted to Devnet. Verify the receipt after confirmation; no need to sign again.');
    } catch (error) { setMessage(error.message || 'Wallet action was cancelled.'); }
    finally { setWorking(false); onBusy(false); }
  }
  const stale = pending && (pending.round !== market?.round || pending.session_id !== market?.session_id);
  return <section className="panel receipt-panel"><div><h2>Solana Devnet receipt <span>OPTIONAL</span></h2><p>Record a hash of this round’s trades, benchmark scores, and settlement. Wallet approval uses test SOL for the network fee. This records proof; it does not transfer tokens or execute on-chain trades.</p>{message && <p role="status" className="receipt-message">{message}</p>}{pending && <a href={`https://explorer.solana.com/tx/${pending.signature}?cluster=devnet`} target="_blank" rel="noreferrer">View submitted transaction <ArrowUpRight size={12}/></a>}{market?.receipt && <a href={market.receipt.explorer} target="_blank" rel="noreferrer">Round {market.receipt.round} · verified receipt <ArrowUpRight size={12}/></a>}{stale && <p>The market has advanced. Your submitted receipt still refers to its original round.</p>}</div><button className="receipt-button" disabled={working || market?.running || market?.phase !== 'complete' || !!market?.receipt || !!stale} onClick={record}>{working ? <Loader2 size={14} className="spin"/> : null}{pending ? 'Verify receipt' : market?.receipt ? 'Receipt recorded' : 'Record via Phantom'}</button></section>;
}
