'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  action?: Record<string, string>;
  timestamp: Date;
}

const SUGGESTED_PROMPTS = [
  "What's in my wallet?",
  "What's my best yield option right now?",
  "Explain liquid staking to me",
  "Should I swap some SOL to USDC?",
];

export default function AurraChat() {
  const { publicKey, connected } = useWallet();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hey, I'm Aurra - your AI DeFi copilot on Solana. Connect your wallet and ask me anything about your portfolio, swaps, or yield strategies.",
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletData, setWalletData] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchPortfolio();
    }
  }, [connected, publicKey]);

  const fetchPortfolio = async () => {
    if (!publicKey) return;
    try {
      const res = await fetch(`/api/portfolio?address=${publicKey.toString()}`);
      const data = await res.json();
      setWalletData(data);
    } catch (err) {
      console.error('Portfolio fetch failed:', err);
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          walletData: walletData || { address: publicKey?.toString() },
        }),
      });

      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message || 'Sorry, I had trouble responding.',
        action: data.action,
        timestamp: new Date(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aurra-root">
      {/* Header */}
      <header className="aurra-header">
        <div className="aurra-logo">
          <span className="aurra-logo-icon">◈</span>
          <span className="aurra-logo-text">Aurra</span>
          <span className="aurra-tagline">DeFi Copilot</span>
        </div>
        <div className="aurra-header-right">
          {connected && walletData && (
            <div className="aurra-balance-pill">
              <span className="balance-dot" />
              {walletData.solBalance?.toFixed(3)} SOL
            </div>
          )}
          <WalletMultiButton />
        </div>
      </header>

      {/* Chat area */}
      <main className="aurra-main">
        <div className="aurra-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`aurra-message aurra-message--${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="aurra-avatar">◈</div>
              )}
              <div className="aurra-bubble">
                <p>{msg.content}</p>
                {msg.action && (
                  <div className="aurra-action-card">
                    <div className="action-label">⚡ Suggested Action</div>
                    <div className="action-details">
                      Swap <strong>{msg.action.amount} {msg.action.fromToken}</strong> → <strong>{msg.action.toToken}</strong>
                    </div>
                    <button className="action-btn">
                      Execute via Jupiter →
                    </button>
                  </div>
                )}
                <span className="aurra-time">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="aurra-message aurra-message--assistant">
              <div className="aurra-avatar">◈</div>
              <div className="aurra-bubble aurra-bubble--loading">
                <span /><span /><span />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested prompts */}
        {messages.length <= 1 && (
          <div className="aurra-suggestions">
            {SUGGESTED_PROMPTS.map((prompt, i) => (
              <button key={i} className="aurra-suggestion-chip" onClick={() => sendMessage(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Input */}
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
          <button
            className="aurra-send-btn"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
          >
            ↑
          </button>
        </div>
        <p className="aurra-disclaimer">Aurra provides information only. Always verify before executing transactions.</p>
      </footer>

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #080910;
          color: #e8e6f0;
          font-family: 'DM Sans', sans-serif;
          height: 100vh;
          overflow: hidden;
        }

        .aurra-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-width: 780px;
          margin: 0 auto;
          position: relative;
        }

        .aurra-root::before {
          content: '';
          position: fixed;
          top: -200px;
          left: 50%;
          transform: translateX(-50%);
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(99, 60, 255, 0.12) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        /* Header */
        .aurra-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(8,9,16,0.9);
          backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .aurra-logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .aurra-logo-icon {
          font-size: 22px;
          color: #8b5cf6;
          filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.6));
        }

        .aurra-logo-text {
          font-family: 'Syne', sans-serif;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: #fff;
        }

        .aurra-tagline {
          font-size: 11px;
          color: rgba(255,255,255,0.3);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          font-weight: 500;
          padding: 3px 8px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
        }

        .aurra-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .aurra-balance-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
          color: rgba(255,255,255,0.7);
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          padding: 6px 12px;
          border-radius: 20px;
        }

        .balance-dot {
          width: 6px;
          height: 6px;
          background: #22c55e;
          border-radius: 50%;
          box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
        }

        /* wallet adapter button override */
        .wallet-adapter-button {
          background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          height: 36px !important;
          padding: 0 16px !important;
          border-radius: 8px !important;
        }

        /* Main chat */
        .aurra-main {
          flex: 1;
          overflow-y: auto;
          padding: 24px 24px 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.1) transparent;
        }

        .aurra-messages {
          display: flex;
          flex-direction: column;
          gap: 16px;
          flex: 1;
        }

        .aurra-message {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          animation: fadeUp 0.3s ease;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .aurra-message--user {
          flex-direction: row-reverse;
        }

        .aurra-avatar {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
          box-shadow: 0 0 12px rgba(124, 58, 237, 0.4);
        }

        .aurra-bubble {
          max-width: 75%;
          padding: 12px 16px;
          border-radius: 16px;
          font-size: 14px;
          line-height: 1.6;
          position: relative;
        }

        .aurra-message--assistant .aurra-bubble {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.07);
          border-top-left-radius: 4px;
          color: #e0ddf0;
        }

        .aurra-message--user .aurra-bubble {
          background: linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(79, 70, 229, 0.3));
          border: 1px solid rgba(124, 58, 237, 0.3);
          border-top-right-radius: 4px;
          color: #f0eeff;
        }

        .aurra-bubble--loading {
          display: flex;
          gap: 5px;
          align-items: center;
          padding: 14px 18px;
        }

        .aurra-bubble--loading span {
          width: 6px;
          height: 6px;
          background: rgba(139, 92, 246, 0.7);
          border-radius: 50%;
          animation: bounce 1.2s infinite;
        }

        .aurra-bubble--loading span:nth-child(2) { animation-delay: 0.2s; }
        .aurra-bubble--loading span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }

        .aurra-time {
          display: block;
          font-size: 10px;
          color: rgba(255,255,255,0.2);
          margin-top: 6px;
          text-align: right;
        }

        /* Action card */
        .aurra-action-card {
          margin-top: 12px;
          padding: 12px;
          background: rgba(124, 58, 237, 0.1);
          border: 1px solid rgba(124, 58, 237, 0.25);
          border-radius: 10px;
        }

        .action-label {
          font-size: 11px;
          color: #a78bfa;
          font-weight: 600;
          letter-spacing: 0.5px;
          margin-bottom: 6px;
        }

        .action-details {
          font-size: 13px;
          color: #e0ddf0;
          margin-bottom: 10px;
        }

        .action-btn {
          width: 100%;
          padding: 8px;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          border: none;
          border-radius: 7px;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: opacity 0.2s;
        }

        .action-btn:hover { opacity: 0.85; }

        /* Suggestions */
        .aurra-suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 16px 0;
        }

        .aurra-suggestion-chip {
          padding: 8px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          color: rgba(255,255,255,0.6);
          font-size: 13px;
          cursor: pointer;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.2s;
        }

        .aurra-suggestion-chip:hover {
          background: rgba(124, 58, 237, 0.15);
          border-color: rgba(124, 58, 237, 0.35);
          color: #e0ddf0;
        }

        /* Footer */
        .aurra-footer {
          padding: 16px 24px 20px;
          background: rgba(8,9,16,0.9);
          backdrop-filter: blur(12px);
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .aurra-input-wrap {
          display: flex;
          gap: 10px;
          align-items: center;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 6px 6px 6px 16px;
          transition: border-color 0.2s;
        }

        .aurra-input-wrap:focus-within {
          border-color: rgba(124, 58, 237, 0.4);
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08);
        }

        .aurra-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: #e8e6f0;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          line-height: 1.5;
        }

        .aurra-input::placeholder { color: rgba(255,255,255,0.2); }

        .aurra-send-btn {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          border: none;
          border-radius: 8px;
          color: #fff;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .aurra-send-btn:hover:not(:disabled) {
          transform: scale(1.05);
          box-shadow: 0 0 12px rgba(124, 58, 237, 0.5);
        }

        .aurra-send-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .aurra-disclaimer {
          font-size: 11px;
          color: rgba(255,255,255,0.18);
          text-align: center;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
