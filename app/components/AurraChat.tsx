'use client';
import React from 'react';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  tokens: Array<{
    mint: string;
    symbol: string;
    amount: number;
    price: number;
    usdValue: number;
  }>;
}

interface SwapState {
  loading: boolean;
  quote: any;
  summary: any;
  error: string | null;
  success: string | null;
}

const SUGGESTED_PROMPTS = [
  "What's in my wallet?",
  "What's my portfolio worth in USD?",
  "Swap 10 USDC to SOL",
  "What's the best yield on Solana right now?",
];

const fmt = (n: number) => n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AurraChat() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: "Hey, I'm Aurra - your AI DeFi copilot on Solana. Connect your wallet and ask me anything about your portfolio, swaps, or yield strategies.",
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [swap, setSwap] = useState<SwapState>({ loading: false, quote: null, summary: null, error: null, success: null });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const fetchPortfolio = useCallback(async () => {
    if (!publicKey || !connection) return;
    try {
      const { PublicKey } = await import('@solana/web3.js');

      // 1. Fetch balance + token accounts from RPC in browser
      const [balanceLamports, tokenAccounts] = await Promise.all([
        connection.getBalance(publicKey),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
        }),
      ]);

      const solBalance = balanceLamports / 1e9;
      const rawTokens = tokenAccounts.value
        .map((acc: any) => ({
          mint: acc.account.data.parsed.info.mint,
          amount: acc.account.data.parsed.info.tokenAmount.uiAmount,
          decimals: acc.account.data.parsed.info.tokenAmount.decimals,
        }))
        .filter((t: any) => t.amount > 0)
        .slice(0, 20);

      // 2. Fetch token symbols from Jupiter in the browser (avoids server-side block)
      const mints = rawTokens.map((t: any) => t.mint);
      let symbolMap: Record<string, string> = {};
      try {
        const jupRes = await fetch(`https://api.jup.ag/tokens/v1/token-list/token-mints?mints=${mints.join(',')}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (jupRes.ok) {
          const jupData = await jupRes.json();
          for (const t of (jupData.tokens || jupData || [])) {
            if (t.address && t.symbol) symbolMap[t.address] = t.symbol;
          }
        }
      } catch {}

      // 3. Fetch prices from Jupiter in the browser
      let prices: Record<string, number> = {};
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      try {
        const allMints = [SOL_MINT, ...mints];
        const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${allMints.join(',')}`);
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          for (const [mint, info] of Object.entries(priceData.data || {})) {
            prices[mint] = parseFloat((info as any).price || '0');
          }
        }
      } catch {}

      const solPrice = prices[SOL_MINT] || 0;
      const solUsdValue = solBalance * solPrice;

      const tokens = rawTokens.map((t: any) => {
        const symbol = symbolMap[t.mint] || t.mint.slice(0, 6) + '...';
        const price = prices[t.mint] || 0;
        const usdValue = t.amount * price;
        return { ...t, symbol, price, usdValue };
      });

      const totalUsdValue = solUsdValue + tokens.reduce((sum, t: any) => sum + t.usdValue, 0);

      setWalletData({
        address: publicKey.toString(),
        solBalance,
        solPrice,
        solUsdValue,
        tokens,
        totalUsdValue,
      });
    } catch (err) { console.error('Portfolio fetch failed:', err); }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) fetchPortfolio();
  }, [connected, publicKey, fetchPortfolio]);

  const executeSwap = async () => {
    if (!swap.quote || !publicKey || !signTransaction) return;
    setSwap(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: swap.quote, userPublicKey: publicKey.toString() }),
      });
      const { swapTransaction, error } = await res.json();
      if (error) throw new Error(error);

      const txBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      const signed = await signTransaction(tx);
      const rawTx = signed.serialize();
      const sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(sig, 'confirmed');

      const { summary } = swap;
      setSwap({ loading: false, quote: null, summary: null, error: null, success: sig });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ Swap confirmed! Swapped ${summary.inputAmount} ${summary.fromToken} → ${summary.outputAmount.toFixed(4)} ${summary.toToken}.\n\nTx: ${sig.slice(0, 16)}...`,
        timestamp: new Date(),
      }]);
      setTimeout(fetchPortfolio, 3000);
    } catch (err: any) {
      setSwap(s => ({ ...s, loading: false, error: err.message || 'Swap failed' }));
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || loading) return;

    const userMessage: Message = { role: 'user', content: messageText, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setSwap({ loading: false, quote: null, summary: null, error: null, success: null });

    try {
      const history = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, walletData }),
      });
      const data = await res.json();

      const assistantMsg: Message = {
        role: 'assistant',
        content: data.message || 'Sorry, I had trouble responding.',
        action: data.action,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // If AI suggested a swap, fetch the quote automatically
      if (data.action?.type === 'swap' && publicKey) {
        const { fromToken, toToken, amount } = data.action;
        const quoteRes = await fetch(
          `/api/swap?fromToken=${fromToken}&toToken=${toToken}&amount=${amount}&userPublicKey=${publicKey.toString()}`
        );
        const quoteData = await quoteRes.json();
        if (!quoteData.error) {
          setSwap({ loading: false, quote: quoteData.quote, summary: quoteData.summary, error: null, success: null });
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.', timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const renderContent = (text: string) => {
    // Convert markdown table to HTML table
    const lines = text.split('\n');
    const result: React.ReactNode[] = [];
    let tableLines: string[] = [];
    let inTable = false;

    const flushTable = () => {
      if (tableLines.length < 2) { tableLines.forEach((l, i) => result.push(<p key={'tl'+i}>{l}</p>)); tableLines = []; inTable = false; return; }
      const headers = tableLines[0].split('|').map(s => s.trim()).filter(Boolean);
      const rows = tableLines.slice(2).map(r => r.split('|').map(s => s.trim()).filter(Boolean));
      result.push(
        <div key={'table'+result.length} style={{overflowX:'auto',margin:'8px 0'}}>
          <table style={{borderCollapse:'collapse',width:'100%',fontSize:'12px'}}>
            <thead><tr>{headers.map((h,i) => <th key={i} style={{padding:'6px 10px',borderBottom:'1px solid rgba(255,255,255,0.15)',color:'#a78bfa',textAlign:'left',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j} style={{padding:'5px 10px',borderBottom:'1px solid rgba(255,255,255,0.06)',color:'#e0ddf0'}}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      tableLines = []; inTable = false;
    };

    lines.forEach((line, i) => {
      if (line.startsWith('|')) {
        inTable = true;
        tableLines.push(line);
      } else {
        if (inTable) flushTable();
        if (line.startsWith('**') && line.endsWith('**')) {
          result.push(<strong key={i} style={{display:'block',marginTop:'6px',color:'#fff'}}>{line.replace(/\*\*/g,'')}</strong>);
        } else if (line === '') {
          result.push(<br key={i} />);
        } else {
          result.push(<p key={i} style={{margin:'2px 0',wordBreak:'break-word',overflowWrap:'anywhere'}}>{line}</p>);
        }
      }
    });
    if (inTable) flushTable();
    return result;
  };

  return (
    <div className="aurra-root">
      <header className="aurra-header">
        <div className="aurra-logo">
          <img src="/aurra-logo.png" alt="Aurra" className="aurra-logo-img" />
          <span className="aurra-tagline">DeFi Copilot</span>
        </div>
        <div className="aurra-header-right">
          {connected && walletData && (
            <div className="aurra-balance-pill">
              <span className="balance-dot" />
              ${fmt(walletData.totalUsdValue)}
            </div>
          )}
          {mounted && <WalletMultiButton />}
        </div>
      </header>

      {/* Portfolio strip */}
      {connected && walletData && (
        <div className="aurra-portfolio-strip">
          <div className="portfolio-item">
            <span className="portfolio-label">SOL</span>
            <span className="portfolio-value">{walletData.solBalance?.toFixed(3)}</span>
            <span className="portfolio-usd">${fmt(walletData.solUsdValue)}</span>
          </div>
          {walletData.tokens?.slice(0, 4).map(t => (
            <div key={t.mint} className="portfolio-item">
              <span className="portfolio-label">{t.symbol}</span>
              <span className="portfolio-value">{t.amount?.toFixed(2)}</span>
              <span className="portfolio-usd">${fmt(t.usdValue)}</span>
            </div>
          ))}
          <button className="portfolio-refresh" onClick={fetchPortfolio} title="Refresh">↻</button>
        </div>
      )}

      <main className="aurra-main">
        <div className="aurra-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`aurra-message aurra-message--${msg.role}`}>
              {msg.role === 'assistant' && <div className="aurra-avatar"><img src="/aurra-logo.png" alt="Aurra" style={{width:'22px',height:'22px',objectFit:'contain'}} /></div>}
              <div className="aurra-bubble">
                <div className="msg-content">{renderContent(msg.content)}</div>
                <span className="aurra-time">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}

          {/* Swap confirmation card */}
          {swap.summary && !swap.success && (
            <div className="aurra-swap-card">
              <div className="swap-card-header">⚡ Swap Preview</div>
              <div className="swap-route">
                <div className="swap-token">
                  <span className="swap-symbol">{swap.summary.fromToken}</span>
                  <span className="swap-amount">{swap.summary.inputAmount}</span>
                </div>
                <span className="swap-arrow">→</span>
                <div className="swap-token">
                  <span className="swap-symbol">{swap.summary.toToken}</span>
                  <span className="swap-amount">~{swap.summary.outputAmount?.toFixed(4)}</span>
                </div>
              </div>
              <div className="swap-meta">
                <span>Route: {swap.summary.route || 'Jupiter'}</span>
                <span>Price impact: {swap.summary.priceImpactPct?.toFixed(3)}%</span>
                <span>Slippage: 0.5%</span>
              </div>
              {swap.error && <div className="swap-error">{swap.error}</div>}
              <div className="swap-actions">
                <button className="swap-btn swap-btn--cancel" onClick={() => setSwap(s => ({ ...s, quote: null, summary: null }))}>Cancel</button>
                <button className="swap-btn swap-btn--confirm" onClick={executeSwap} disabled={swap.loading}>
                  {swap.loading ? 'Signing...' : 'Confirm Swap'}
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="aurra-message aurra-message--assistant">
              <div className="aurra-avatar"><img src="/aurra-logo.png" alt="Aurra" style={{width:'32px',height:'32px',objectFit:'contain'}} /></div>
              <div className="aurra-bubble aurra-bubble--loading"><span /><span /><span /></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length <= 1 && (
          <div className="aurra-suggestions">
            {SUGGESTED_PROMPTS.map((prompt, i) => (
              <button key={i} className="aurra-suggestion-chip" onClick={() => sendMessage(prompt)}>{prompt}</button>
            ))}
          </div>
        )}
      </main>

      <footer className="aurra-footer">
        <div className="aurra-input-wrap">
          <input
            className="aurra-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder={connected ? "Ask Aurra anything about your wallet..." : "Connect wallet to get started..."}
            disabled={loading}
          />
          <button className="aurra-send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}>↑</button>
        </div>
        <p className="aurra-disclaimer">Aurra provides information only. Always verify before executing transactions.</p>
      </footer>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080910; color: #e8e6f0; font-family: 'DM Sans', sans-serif; height: 100vh; overflow: hidden; }

        .aurra-root { display: flex; flex-direction: column; height: 100vh; max-width: 780px; margin: 0 auto; position: relative; }
        .aurra-root::before { content: ''; position: fixed; top: -200px; left: 50%; transform: translateX(-50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(99,60,255,0.12) 0%, transparent 70%); pointer-events: none; z-index: 0; }

        .wallet-adapter-modal-wrapper {
          background: #0f0f17 !important;
          border: 1px solid rgba(124,58,237,0.3) !important;
          border-radius: 16px !important;
          margin: 0 8px !important;
          padding: 16px !important;
        }
        .wallet-adapter-modal-title {
          color: #fff !important;
          font-family: 'Syne', sans-serif !important;
        }
        .wallet-adapter-modal-list .wallet-adapter-button {
          background: rgba(255,255,255,0.04) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          border-radius: 10px !important;
          color: #e0ddf0 !important;
          height: 48px !important;
          font-size: 14px !important;
        }
        .wallet-adapter-modal-list .wallet-adapter-button:hover {
          background: rgba(124,58,237,0.15) !important;
          border-color: rgba(124,58,237,0.35) !important;
        }
        .wallet-adapter-modal-list .wallet-adapter-button-end-icon,
        .wallet-adapter-modal-list .wallet-adapter-button-start-icon {
          width: 28px !important;
          height: 28px !important;
        }
        .wallet-adapter-modal-overlay {
          background: rgba(0,0,0,0.7) !important;
          backdrop-filter: blur(4px) !important;
        }
        .wallet-adapter-modal-button-close {
          background: rgba(255,255,255,0.06) !important;
        }

        .aurra-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(8,9,16,0.95); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 10; }
        .aurra-logo { display: flex; align-items: center; gap: 10px; }
        .aurra-logo-img { height: 52px; width: auto; object-fit: contain; filter: drop-shadow(0 0 8px rgba(139,92,246,0.4)); }
        .aurra-tagline { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 1.5px; text-transform: uppercase; font-weight: 500; padding: 3px 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; }
        .aurra-header-right { display: flex; align-items: center; gap: 12px; }
        .aurra-balance-pill { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #a78bfa; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.2); padding: 6px 12px; border-radius: 20px; }
        .balance-dot { width: 6px; height: 6px; background: #22c55e; border-radius: 50%; box-shadow: 0 0 6px rgba(34,197,94,0.6); }

        .wallet-adapter-button { background: linear-gradient(135deg, #7c3aed, #4f46e5) !important; font-family: 'DM Sans', sans-serif !important; font-size: 13px !important; font-weight: 500 !important; height: 36px !important; padding: 0 16px !important; border-radius: 8px !important; }

        /* Portfolio strip */
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
        .aurra-avatar { width: 38px; height: 38px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; box-shadow: 0 0 12px rgba(124,58,237,0.4); }
        .aurra-bubble { max-width: 75%; padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; position: relative; }
        .aurra-message--assistant .aurra-bubble { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-top-left-radius: 4px; color: #e0ddf0; }
        .aurra-message--user .aurra-bubble { background: linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.3)); border: 1px solid rgba(124,58,237,0.3); border-top-right-radius: 4px; color: #f0eeff; }
        .aurra-bubble--loading { display: flex; gap: 5px; align-items: center; padding: 14px 18px; }
        .aurra-bubble--loading span { width: 6px; height: 6px; background: rgba(139,92,246,0.7); border-radius: 50%; animation: bounce 1.2s infinite; }
        .aurra-bubble--loading span:nth-child(2) { animation-delay: 0.2s; }
        .aurra-bubble--loading span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-6px); opacity: 1; } }
        .aurra-time { display: block; font-size: 10px; color: rgba(255,255,255,0.2); margin-top: 6px; text-align: right; }

        /* Swap card */
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