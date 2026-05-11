'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  action?: Record<string, string>;
  timestamp: Date;
}

interface WalletData {
  address: string;
  solBalance: number;
  solPrice: number;
  solUsdValue: number;
  totalUsdValue: number;
  tokens: Array<{ mint: string; symbol: string; amount: number; price: number; usdValue: number }>;
}

interface SwapState {
  loading: boolean;
  swapTransaction: string | null;
  summary: any;
  error: string | null;
  success: string | null;
  useJupiterFallback: boolean;
}

const WELCOME = "Hey, I'm Aurra - your AI DeFi copilot on Solana. Connect your wallet and ask me anything about your portfolio, swaps, or yield strategies.";
const SUGGESTED_PROMPTS = [
  "What's in my wallet?", 
  "What's my portfolio worth in USD?", 
  "Swap 10 USDC to SOL", 
  "What's the best yield on Solana right now?"
];

// ── Client-side Jupiter swap builder ─────────────────────────────────────
// Jupiter APIs work fine from browsers — server-side calls get blocked/503.
const JUP_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
const JUP_SWAP  = 'https://lite-api.jup.ag/swap/v1/swap';

interface TokenInfo { address: string; decimals: number }

// Top Solana tokens — covers the vast majority of real swap requests
const WELL_KNOWN: Record<string, TokenInfo> = {
  SOL:     { address: 'So11111111111111111111111111111111111111112',  decimals: 9 },
  USDC:    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT:    { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  BONK:    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  WIF:     { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6 },
  JUP:     { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6 },
  RAY:     { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6 },
  mSOL:    { address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  decimals: 9 },
  jitoSOL: { address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',  decimals: 9 },
  bSOL:    { address: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  decimals: 9 },
  PYTH:    { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6 },
  RNDR:    { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  decimals: 8 },
  HNT:     { address: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  decimals: 8 },
  MOBILE:  { address: 'mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6',  decimals: 6 },
  POPCAT:  { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', decimals: 9 },
  WEN:     { address: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',  decimals: 5 },
  MYRO:    { address: 'HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4', decimals: 9 },
  SAMO:    { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', decimals: 9 },
  ORCA:    { address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',  decimals: 6 },
  MNGO:    { address: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',  decimals: 6 },
  STEP:    { address: 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT',  decimals: 9 },
  MEAN:    { address: 'MEANeD3XDdUmNMsRGjASkSWdC8prLYsoRJ61pPeHctD',  decimals: 6 },
  SHDW:    { address: 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y',  decimals: 9 },
  HXRO:    { address: 'HxhWkVpk5NS4Ltg5nij2G671CKXFRKK8VCBDkdxkMpLM', decimals: 8 },
};

// Runtime cache — seeded with well-known tokens, grows as user's wallet tokens are added
const tokenCache = new Map<string, TokenInfo>(Object.entries(WELL_KNOWN));

// Called before each swap to seed cache from the user's wallet (they already have the mints)
function seedFromWallet(walletTokens: Array<{ mint: string; symbol: string; decimals?: number }>) {
  for (const t of walletTokens) {
    if (t.symbol && t.mint && !tokenCache.has(t.symbol.toUpperCase())) {
      tokenCache.set(t.symbol.toUpperCase(), { address: t.mint, decimals: t.decimals ?? 6 });
    }
  }
}

function resolveToken(symbol: string): TokenInfo {
  const key = symbol.toUpperCase();
  const info = tokenCache.get(key);
  if (info) return info;
  throw new Error(
    `Token "${symbol}" not recognised. It may not be in the supported list. ` +
    `Try swapping with a different symbol or check if it's in your wallet.`
  );
}

async function buildJupiterSwapTx(
  fromSymbol: string, toSymbol: string, amount: number, userPublicKey: string,
): Promise<{ swapTransaction: string; summary: Record<string, any> }> {
  const inputToken  = resolveToken(fromSymbol);
  const outputToken = resolveToken(toSymbol);
  const amountIn = Math.floor(amount * 10 ** inputToken.decimals);
  const quoteRes = await fetch(`${JUP_QUOTE}?` + new URLSearchParams({
    inputMint: inputToken.address, outputMint: outputToken.address,
    amount: String(amountIn), slippageBps: '50',
  }));
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed (${quoteRes.status})`);
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(`Jupiter: ${quote.error}`);
  const swapRes = await fetch(JUP_SWAP, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed (${swapRes.status})`);
  const swapData = await swapRes.json();
  if (swapData.error) throw new Error(`Jupiter: ${swapData.error}`);
  if (!swapData.swapTransaction) throw new Error('Jupiter returned no transaction');
  return {
    swapTransaction: swapData.swapTransaction,
    summary: {
      fromToken: fromSymbol.toUpperCase(), toToken: toSymbol.toUpperCase(), inputAmount: amount,
      outputAmount: parseInt(quote.outAmount) / 10 ** outputToken.decimals,
      priceImpactPct: parseFloat(quote.priceImpactPct ?? '0'),
      route: (quote.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter',
    },
  };
}

// Minimal mint map kept only for any address-based references
const TOKEN_MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

const fmt = (n: number) => n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const defaultMessages = (): Message[] => [{ role: 'assistant', content: WELCOME, timestamp: new Date() }];
const loadMessages = (): Message[] => {
  if (typeof window === 'undefined') return defaultMessages();
  try {
    const saved = localStorage.getItem('aurra-messages');
    if (saved) return JSON.parse(saved).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
  } catch {}
  return defaultMessages();
};

export default function AurraChat() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>(defaultMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [swap, setSwap] = useState<SwapState>({ loading: false, swapTransaction: null, summary: null, error: null, success: null, useJupiterFallback: false });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); setMessages(loadMessages()); }, []);
  useEffect(() => { if (messages.length > 0 && mounted) { try { localStorage.setItem('aurra-messages', JSON.stringify(messages)); } catch {} } }, [messages, mounted]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = () => { try { localStorage.removeItem('aurra-messages'); } catch {} setMessages(defaultMessages()); setSwap(s => ({ ...s, swapTransaction: null, summary: null })); };

  const fetchPortfolio = useCallback(async () => {
    if (!publicKey || !connection) return;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      const [balanceLamports, tokenAccounts] = await Promise.all([
        connection.getBalance(publicKey),
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }),
      ]);
      const solBalance = balanceLamports / 1e9;
      const rawTokens = tokenAccounts.value.map((acc: any) => ({ mint: acc.account.data.parsed.info.mint, amount: acc.account.data.parsed.info.tokenAmount.uiAmount, decimals: acc.account.data.parsed.info.tokenAmount.decimals })).filter((t: any) => t.amount > 0).slice(0, 20);
      const knownSymbols: Record<string, string> = {};
      for (const [sym, mint] of Object.entries(TOKEN_MINTS)) knownSymbols[mint] = sym;
      let symbolMap: Record<string, string> = { ...knownSymbols };
      try { const res = await fetch('/api/tokens'); if (res.ok) { const list = await res.json(); if (Array.isArray(list)) for (const t of list) if (t.address && t.symbol) symbolMap[t.address] = t.symbol; } } catch {}
      let prices: Record<string, number> = {};
      const SOL_MINT = TOKEN_MINTS.SOL;
      try { const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); if (cgRes.ok) { const d = await cgRes.json(); prices[SOL_MINT] = d.solana?.usd || 0; } } catch {}
      const solPrice = prices[SOL_MINT] || 0;
      const solUsdValue = solBalance * solPrice;
      const tokens = rawTokens.map((t: any) => ({ ...t, symbol: symbolMap[t.mint] || t.mint.slice(0, 6) + '...', price: prices[t.mint] || 0, usdValue: t.amount * (prices[t.mint] || 0) }));
      const totalUsdValue = solUsdValue + tokens.reduce((s: number, t: any) => s + t.usdValue, 0);
      setWalletData({ address: publicKey.toString(), solBalance, solPrice, solUsdValue, tokens, totalUsdValue });
    } catch (err) { console.error('Portfolio fetch failed:', err); }
  }, [publicKey, connection]);

  useEffect(() => { if (connected && publicKey) fetchPortfolio(); }, [connected, publicKey, fetchPortfolio]);

  const executeSwap = async () => {
    if (!publicKey) return;

    // If server couldn't build tx, open Jupiter directly
    if (swap.useJupiterFallback && swap.summary) {
      const inMint = TOKEN_MINTS[swap.summary.fromToken] || swap.summary.fromToken;
      const outMint = TOKEN_MINTS[swap.summary.toToken] || swap.summary.toToken;
      window.open(`https://jup.ag/swap/${inMint}-${outMint}`, '_blank');
      return;
    }

    if (!swap.swapTransaction || !sendTransaction) return;
    setSwap(s => ({ ...s, loading: true, error: null }));

    try {
      // Decode base64 → Uint8Array without relying on Buffer polyfill
      const txBuf = Uint8Array.from(atob(swap.swapTransaction), c => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBuf);

      // Get fresh blockhash for accurate confirmation deadline
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');

      // sendTransaction signs + sends atomically via the connected wallet
      const sig = await sendTransaction(tx, connection, {
        skipPreflight: false,
        maxRetries: 3,
      });

      // Confirm using proper blockhash strategy (non-deprecated)
      const confirmation = await connection.confirmTransaction(
        { signature: sig, ...latestBlockhash },
        'confirmed',
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
      }

      const { summary } = swap;
      setSwap({ loading: false, swapTransaction: null, summary: null, error: null, success: sig, useJupiterFallback: false });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Swap confirmed!\n\n${summary.inputAmount} ${summary.fromToken} → ${summary.outputAmount?.toFixed(4)} ${summary.toToken}\n\nView on Solscan: https://solscan.io/tx/${sig}`,
        timestamp: new Date(),
      }]);
      setTimeout(fetchPortfolio, 3000);
    } catch (err: any) {
      // Distinguish user cancellation from actual errors
      const isRejected =
        err.message?.includes('User rejected') ||
        err.message?.includes('Transaction cancelled') ||
        err.code === 4001;
      setSwap(s => ({
        ...s,
        loading: false,
        error: isRejected ? 'You cancelled the transaction.' : (err.message || 'Swap failed. Try again.'),
      }));
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || loading) return;

    const userMessage: Message = { role: 'user', content: messageText, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setSwap({ loading: false, swapTransaction: null, summary: null, error: null, success: null, useJupiterFallback: false });

    try {
      const history = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history, walletData }) });
      const data = await res.json();

      setMessages(prev => [...prev, { role: 'assistant', content: data.message || 'Sorry, I had trouble responding.', action: data.action, timestamp: new Date() }]);

      if (data.action?.type === 'swap' && publicKey) {
        const { fromToken, toToken, amount } = data.action;
        // Show card immediately with loading spinner — Jupiter runs in browser, not server
        setSwap(s => ({ ...s, loading: true, swapTransaction: null, summary: { fromToken: fromToken.toUpperCase(), toToken: toToken.toUpperCase(), inputAmount: parseFloat(amount) }, error: null, useJupiterFallback: false }));
        try {
          // Seed token cache from user's wallet so we recognise any token they hold
          if (walletData?.tokens) seedFromWallet(walletData.tokens);
          const result = await buildJupiterSwapTx(fromToken, toToken, parseFloat(amount), publicKey.toString());
          setSwap({ loading: false, swapTransaction: result.swapTransaction, summary: result.summary, error: null, success: null, useJupiterFallback: false });
        } catch (e: any) {
          setSwap(s => ({ ...s, loading: false, error: e.message || 'Failed to build swap transaction.' }));
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.', timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = (text: string) => {
    const lines = text.split('\n');
    const result: React.ReactNode[] = [];
    let tableLines: string[] = [];
    let inTable = false;
    const flushTable = () => {
      if (tableLines.length < 2) { tableLines.forEach((l, i) => result.push(<p key={'tl' + i}>{l}</p>)); tableLines = []; inTable = false; return; }
      const headers = tableLines[0].split('|').map(s => s.trim()).filter(Boolean);
      const rows = tableLines.slice(2).map(r => r.split('|').map(s => s.trim()).filter(Boolean));
      result.push(<div key={'t' + result.length} style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}><thead><tr>{headers.map((h, i) => <th key={i} style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.15)', color: '#a78bfa', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#e0ddf0' }}>{cell}</td>)}</tr>)}</tbody></table></div>);
      tableLines = []; inTable = false;
    };
    lines.forEach((line, i) => {
      if (line.startsWith('|')) { inTable = true; tableLines.push(line); }
      else {
        if (inTable) flushTable();
        if (line.startsWith('**') && line.endsWith('**')) result.push(<strong key={i} style={{ display: 'block', marginTop: '6px', color: '#fff' }}>{line.replace(/\*\*/g, '')}</strong>);
        else if (line === '') result.push(<br key={i} />);
        else result.push(<p key={i} style={{ margin: '2px 0', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{line.startsWith('View on Solscan:') ? (<>View on Solscan: <a href={line.split(': ')[1]} target="_blank" rel="noopener noreferrer" style={{ color: '#a78bfa', textDecoration: 'underline' }}>{line.split(': ')[1]?.slice(0, 32)}…</a></>) : line}</p>);
      }
    });
    if (inTable) flushTable();
    return result;
  };

  return (
    <div className="aurra-root">
      <header className="aurra-header">
        <div className="aurra-logo">
          <img src="/aurra-logo.svg" alt="Aurra" className="aurra-logo-img" />
          <span className="aurra-tagline">DeFi Copilot</span>
        </div>
        <div className="aurra-header-right">
          {connected && walletData && <div className="aurra-balance-pill"><span className="balance-dot" />${fmt(walletData.totalUsdValue)}</div>}
          {mounted && <WalletMultiButton />}
        </div>
      </header>

      {connected && walletData && (
        <div className="aurra-portfolio-strip">
          <div className="portfolio-item"><span className="portfolio-label">SOL</span><span className="portfolio-value">{walletData.solBalance?.toFixed(3)}</span><span className="portfolio-usd">${fmt(walletData.solUsdValue)}</span></div>
          {walletData.tokens?.slice(0, 4).map(t => (<div key={t.mint} className="portfolio-item"><span className="portfolio-label">{t.symbol}</span><span className="portfolio-value">{t.amount?.toFixed(2)}</span><span className="portfolio-usd">${fmt(t.usdValue)}</span></div>))}
          <button className="portfolio-refresh" onClick={fetchPortfolio} title="Refresh">↻</button>
        </div>
      )}

      <main className="aurra-main">
        <div className="aurra-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`aurra-message aurra-message--${msg.role}`}>
              {msg.role === 'assistant' && <div className="aurra-avatar"><img src="/aurra-logo.svg" alt="Aurra" style={{ width: '22px', height: '22px', objectFit: 'contain' }} /></div>}
              <div className="aurra-bubble">
                <div className="msg-content">{renderContent(msg.content)}</div>
                <span className="aurra-time">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}

          {(swap.summary && !swap.success) && (
            <div className="aurra-swap-card">
              <div className="swap-card-header">⚡ Swap Preview</div>
              <div className="swap-route">
                <div className="swap-token"><span className="swap-symbol">{swap.summary.fromToken}</span><span className="swap-amount">{swap.summary.inputAmount}</span></div>
                <span className="swap-arrow">→</span>
                <div className="swap-token">
                  <span className="swap-symbol">{swap.summary.toToken}</span>
                  <span className="swap-amount">{swap.summary.outputAmount ? `~${swap.summary.outputAmount.toFixed(4)}` : swap.loading ? '…' : '—'}</span>
                </div>
              </div>
              {!swap.loading && !swap.error && (
                <div className="swap-meta">
                  {swap.summary.route && <span>Route: {swap.summary.route}</span>}
                  {swap.summary.priceImpactPct !== undefined && <span>Price impact: {swap.summary.priceImpactPct.toFixed(3)}%</span>}
                  <span>Slippage: 0.5%</span>
                </div>
              )}
              {swap.loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '8px 0' }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid #7c3aed', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                  Building swap transaction…
                </div>
              )}
              {swap.error && <div className="swap-error">{swap.error}</div>}
              <div className="swap-actions">
                <button className="swap-btn swap-btn--cancel" onClick={() => setSwap(s => ({ ...s, swapTransaction: null, summary: null, error: null, useJupiterFallback: false, loading: false }))}>Cancel</button>
                {swap.swapTransaction && (
                  <button className="swap-btn swap-btn--confirm" onClick={executeSwap} disabled={swap.loading}>
                    {swap.loading ? 'Signing…' : 'Confirm & Sign'}
                  </button>
                )}
              </div>
            </div>
          )}

          {loading && (
            <div className="aurra-message aurra-message--assistant">
              <div className="aurra-avatar"><img src="/aurra-logo.svg" alt="Aurra" style={{ width: '22px', height: '22px', objectFit: 'contain' }} /></div>
              <div className="aurra-bubble aurra-bubble--loading"><span /><span /><span /></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length <= 1 && (
          <div className="aurra-suggestions">
            {SUGGESTED_PROMPTS.map((prompt, i) => <button key={i} className="aurra-suggestion-chip" onClick={() => sendMessage(prompt)}>{prompt}</button>)}
          </div>
        )}
      </main>

      <footer className="aurra-footer">
        <div className="aurra-input-wrap">
          <input className="aurra-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder={connected ? 'Ask Aurra anything about your wallet...' : 'Connect wallet to get started...'} disabled={loading} />
          <button className="aurra-send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}>↑</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
          <button onClick={clearChat} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', fontSize: '11px', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>Clear chat</button>
        </div>
        <p className="aurra-disclaimer">Aurra provides information only. Always verify before executing transactions.</p>
      </footer>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080910; color: #e8e6f0; font-family: 'DM Sans', sans-serif; height: 100vh; overflow: hidden; }
        .aurra-root { display: flex; flex-direction: column; height: 100vh; max-width: 780px; margin: 0 auto; position: relative; }
        .aurra-root::before { content: ''; position: fixed; top: -200px; left: 50%; transform: translateX(-50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(99,60,255,0.12) 0%, transparent 70%); pointer-events: none; z-index: 0; }
        .wallet-adapter-modal-wrapper { background: #0f0f17 !important; border: 1px solid rgba(124,58,237,0.3) !important; border-radius: 16px !important; margin: 0 8px !important; padding: 8px !important; }
        .wallet-adapter-modal-title { color: #fff !important; font-family: 'Syne', sans-serif !important; }
        .wallet-adapter-modal-list .wallet-adapter-button { background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 10px !important; color: #e0ddf0 !important; height: 48px !important; font-size: 14px !important; }
        .wallet-adapter-modal-list .wallet-adapter-button:hover { background: rgba(124,58,237,0.15) !important; border-color: rgba(124,58,237,0.35) !important; }
        .wallet-adapter-modal-list .wallet-adapter-button-end-icon, .wallet-adapter-modal-list .wallet-adapter-button-start-icon { width: 28px !important; height: 28px !important; }
        .wallet-adapter-modal-overlay { background: rgba(0,0,0,0.7) !important; backdrop-filter: blur(4px) !important; }
        .wallet-adapter-modal-button-close { background: rgba(255,255,255,0.06) !important; }
        .aurra-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(8,9,16,0.95); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 10; }
        .aurra-logo { display: flex; align-items: center; gap: 10px; }
        .aurra-logo-img { height: 52px; width: auto; object-fit: contain; filter: drop-shadow(0 0 8px rgba(139,92,246,0.4)); }
        .aurra-tagline { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 1.5px; text-transform: uppercase; font-weight: 500; padding: 3px 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; }
        .aurra-header-right { display: flex; align-items: center; gap: 12px; }
        .aurra-balance-pill { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #a78bfa; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); padding: 6px 12px; border-radius: 20px; }
        .balance-dot { width: 6px; height: 6px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 6px rgba(34,197,94,0.6); }
        .wallet-adapter-button { background: linear-gradient(135deg, #7c3aed, #4f46e5) !important; font-family: 'DM Sans', sans-serif !important; font-size: 13px !important; font-weight: 500 !important; height: 36px !important; padding: 0 16px !important; border-radius: 8px !important; }
        .aurra-portfolio-strip { display: flex; gap: 4px; padding: 8px 24px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.05); overflow-x: auto; scrollbar-width: none; align-items: center; }
        .aurra-portfolio-strip::-webkit-scrollbar { display: none; }
        .portfolio-item { display: flex; flex-direction: column; align-items: center; padding: 6px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; min-width: 72px; flex-shrink: 0; }
        .portfolio-label { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; letter-spacing: 0.5px; }
        .portfolio-value { font-size: 13px; font-weight: 600; color: #e8e6f0; margin: 1px 0; }
        .portfolio-usd { font-size: 10px; color: #22c55e; font-weight: 500; }
        .portfolio-refresh { margin-left: auto; background: none; border: none; color: rgba(255,255,255,0.3); font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 6px; flex-shrink: 0; }
        .portfolio-refresh:hover { color: #a78bfa; background: rgba(139,92,246,0.1); }
        .aurra-main { flex: 1; overflow-y: auto; padding: 24px 24px 0; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        .aurra-messages { display: flex; flex-direction: column; gap: 16px; flex: 1; }
        .aurra-message { display: flex; gap: 12px; align-items: flex-start; animation: fadeUp 0.3s ease; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .aurra-message--user { flex-direction: row-reverse; }
        .aurra-avatar { width: 38px; height: 38px; background: transparent; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px; }
        .aurra-bubble { max-width: 75%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; position: relative; }
        .aurra-message--assistant .aurra-bubble { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-top-left-radius: 4px; color: #e0ddf0; }
        .aurra-message--user .aurra-bubble { background: linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.3)); border: 1px solid rgba(124,58,237,0.3); border-top-right-radius: 4px; color: #f0eeff; }
        .aurra-bubble--loading { display: flex; gap: 5px; align-items: center; padding: 14px 18px; }
        .aurra-bubble--loading span { width: 6px; height: 6px; background: rgba(139,92,246,0.7); border-radius: 50%; animation: bounce 1.2s infinite; }
        .aurra-bubble--loading span:nth-child(2) { animation-delay: 0.2s; }
        .aurra-bubble--loading span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-6px); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .aurra-time { display: block; font-size: 10px; color: rgba(255,255,255,0.2); margin-top: 6px; text-align: right; }
        .aurra-swap-card { background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.25); border-radius: 14px; padding: 16px; margin: 0 44px; animation: fadeUp 0.3s ease; }
        .swap-card-header { font-size: 11px; font-weight: 700; color: #a78bfa; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
        .swap-route { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .swap-token { display: flex; flex-direction: column; flex: 1; background: rgba(255,255,255,0.04); padding: 10px 12px; border-radius: 10px; }
        .swap-symbol { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 600; }
        .swap-amount { font-size: 20px; font-weight: 700; color: #fff; font-family: 'Syne', sans-serif; }
        .swap-arrow { font-size: 18px; color: #7c3aed; }
        .swap-meta { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: rgba(255,255,255,0.35); margin-bottom: 12px; }
        .swap-error { font-size: 12px; color: #f87171; background: rgba(248,113,113,0.1); padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
        .swap-actions { display: flex; gap: 8px; }
        .swap-btn { flex: 1; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; border: none; transition: all 0.2s; }
        .swap-btn--cancel { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }
        .swap-btn--cancel:hover { background: rgba(255,255,255,0.1); }
        .swap-btn--confirm { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; }
        .swap-btn--confirm:hover:not(:disabled) { box-shadow: 0 0 16px rgba(124,58,237,0.5); }
        .swap-btn--confirm:disabled { opacity: 0.5; cursor: not-allowed; }
        .aurra-suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 16px 0; }
        .aurra-suggestion-chip { padding: 8px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; color: rgba(255,255,255,0.6); font-size: 13px; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.2s; }
        .aurra-suggestion-chip:hover { background: rgba(124,58,237,0.15); border-color: rgba(124,58,237,0.35); color: #e0ddf0; }
        .aurra-footer { padding: 16px 24px 20px; background: rgba(8,9,16,0.95); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,0.05); }
        .aurra-input-wrap { display: flex; gap: 10px; align-items: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 6px 6px 6px 16px; transition: border-color 0.2s; }
        .aurra-input-wrap:focus-within { border-color: rgba(124,58,237,0.4); box-shadow: 0 0 0 3px rgba(124,58,237,0.08); }
        .aurra-input { flex: 1; background: transparent; border: none; outline: none; color: #e8e6f0; font-size: 14px; font-family: 'DM Sans', sans-serif; line-height: 1.5; }
        .aurra-input::placeholder { color: rgba(255,255,255,0.2); }
        .aurra-send-btn { width: 36px; height: 36px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border: none; border-radius: 8px; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
        .aurra-send-btn:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 0 12px rgba(124,58,237,0.5); }
        .aurra-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .aurra-disclaimer { font-size: 11px; color: rgba(255,255,255,0.18); text-align: center; margin-top: 8px; }
      `}</style>
    </div>
  );
}