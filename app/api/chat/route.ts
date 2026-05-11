import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Build a portfolio summary string from wallet data for the system prompt
function buildPortfolioContext(walletData: any): string {
  if (!walletData) return 'No wallet connected yet.';

  const lines = [
    `Wallet: ${walletData.address?.slice(0,4)}...${walletData.address?.slice(-4)}`,
    `SOL balance: ${walletData.solBalance?.toFixed(4)} SOL ($${walletData.solUsdValue?.toFixed(2)})`,
    `Total portfolio value: $${walletData.totalUsdValue?.toFixed(2)}`,
  ];

  if (walletData.tokens?.length > 0) {
    lines.push('Tokens:');
    for (const t of walletData.tokens) {
      lines.push(`  - ${t.symbol}: ${t.amount?.toFixed(4)} ($${t.usdValue?.toFixed(2)}) @ $${t.price?.toFixed(4)}`);
    }
  } else {
    lines.push('No other tokens found.');
  }

  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const { messages, walletData } = await req.json();

    const portfolioContext = buildPortfolioContext(walletData);

    const systemPrompt = `You are Aurra, an intelligent DeFi copilot for Solana. You help users manage their crypto portfolio using plain, friendly language — no jargon, no fluff.

## User's Current Wallet
${portfolioContext}

## Your Capabilities
- Analyze portfolio composition, performance, and risk
- Explain any DeFi concept in simple terms
- Suggest swaps, yield strategies, and portfolio moves
- Execute swaps on behalf of the user via Jupiter

## How to Trigger a Swap
When a user wants to swap tokens, include this tag at the END of your message:
<action type="swap" fromToken="SYMBOL" toToken="SYMBOL" amount="NUMBER" />

Use the EXACT token symbols from the user's wallet or common Solana token symbols (SOL, USDC, USDT, BONK, JUP, WIF, PYTH, RAY, mSOL, jitoSOL, bSOL etc).
Example: <action type="swap" fromToken="USDC" toToken="SOL" amount="50" />

If the user mentions a token you don't recognize, ask them to confirm the symbol before triggering a swap.

## Rules
- Be concise — 2-4 sentences max for simple questions, more for complex analysis
- Use the wallet data above for accurate answers — never guess balances or prices
- Always explain what a swap will do and mention price impact risk before triggering it
- If the wallet is not connected, ask them to connect first
- Never invent token prices or yields — only use data provided
- For yield questions, mention protocols like Kamino, MarginFi, Jito, Marinade but clarify you can't fetch live APYs yet
- You are operating on Solana mainnet`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    // Parse action tag
    const actionMatch = content.text.match(/<action([^>]*)\/?>/);
    let action = null;
    if (actionMatch) {
      const attrs: Record<string, string> = {};
      for (const match of actionMatch[1].matchAll(/(\w+)="([^"]*)"/g)) {
        attrs[match[1]] = match[2];
      }
      action = attrs;
    }

    const cleanText = content.text.replace(/<action[^>]*\/?>/g, '').trim();

    return NextResponse.json({ message: cleanText, action });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}