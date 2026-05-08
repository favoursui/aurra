# Aurra - DeFi Copilot on Solana

> Talk to your wallet. Aurra is an AI-powered DeFi copilot that lets you manage your Solana portfolio using plain English — no dashboards, no jargon, no confusion.

---

## What is Aurra?

Aurra is a conversational interface for Solana DeFi. Instead of navigating complex protocols and dashboards, you just ask:

- *"What's in my wallet?"*
- *"What's my best yield option right now?"*
- *"Swap 50 USDC to SOL when the price dips"*
- *"How much have I lost to fees this month?"*

Aurra reads your on-chain data in real time, understands your intent, and either answers you or suggests an action to execute.

---

## Features

- **AI Chat Interface** — Powered by Claude (Anthropic), understands natural language DeFi queries
- **Live Portfolio Data** — Fetches real-time SOL balance and token holdings via Helius RPC
- **Wallet Connect** — Supports Phantom and Solflare via Solana Wallet Adapter
- **Swap Suggestions** — AI detects swap intent and surfaces actionable cards (Jupiter integration ready)
- **Clean Dark UI** — Built for focus, not noise

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + CSS-in-JS |
| AI Brain | Anthropic Claude API |
| Blockchain | Solana Web3.js |
| Wallet | Solana Wallet Adapter |
| RPC / Data | Helius |
| Swap Routing | Jupiter API (coming soon) |
| Deployment | Vercel |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Solana wallet (Phantom or Solflare)
- API keys from Anthropic and Helius (both free to get)

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/aurra.git
cd aurra
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root of the project:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key_here
```

Get your keys here:
- Anthropic API key → [console.anthropic.com](https://console.anthropic.com)
- Helius API key → [helius.dev](https://helius.dev) (free tier is sufficient)

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your wallet.

---

## Project Structure

```
aurra/
├── app/
│   ├── providers.tsx           # Solana wallet provider wrapper
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Entry point
│   ├── globals.css             # Global styles reset
│   ├── components/
│   │   └── AurraChat.tsx       # Main chat UI component
│   └── api/
│       ├── chat/
│       │   └── route.ts        # Claude AI chat endpoint
│       └── portfolio/
│           └── route.ts        # Helius wallet data endpoint
├── .env.local                  # Your API keys (never commit this)
├── .gitignore
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Roadmap

- [x] Wallet connect (Phantom, Solflare)
- [x] Live SOL + token balance fetching
- [x] AI chat with portfolio context
- [x] Swap action suggestions
- [ ] Jupiter swap execution (sign & send)
- [ ] Token price data (USD values)
- [ ] Yield opportunity scanning (Kamino, MarginFi)
- [ ] Transaction history analysis
- [ ] Mobile responsive UI
- [ ] Multi-wallet support

---

## Built For

**Solana Frontier Hackathon 2026** — [arena.colosseum.org](https://arena.colosseum.org)

---

## License

MIT