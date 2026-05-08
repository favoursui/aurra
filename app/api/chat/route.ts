import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages, walletData } = await req.json();

    const systemPrompt = `You are Aurra, an intelligent DeFi copilot for Solana. You help users manage their crypto portfolio using plain, friendly language — no jargon.

You have access to the user's wallet data:
${walletData ? JSON.stringify(walletData, null, 2) : 'No wallet connected yet.'}

Your capabilities:
- Analyze portfolio composition and performance
- Explain DeFi concepts in simple terms
- Suggest swaps, yield strategies, and actions
- When a user wants to execute a swap, respond with a JSON action block like:
  <action type="swap" fromToken="USDC" toToken="SOL" amount="10" />

Rules:
- Always be concise and clear
- Never make up token prices — use the data provided
- If wallet is not connected, politely ask them to connect first
- If you suggest an action, explain what it will do and why before executing
- Always warn about risks involved in DeFi actions
- You are on Solana mainnet`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages,
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Parse any action tags from the response
    const actionMatch = content.text.match(/<action([^/]*)\/?>/);
    let action = null;
    if (actionMatch) {
      const attrs: Record<string, string> = {};
      const attrMatches = actionMatch[1].matchAll(/(\w+)="([^"]*)"/g);
      for (const match of attrMatches) {
        attrs[match[1]] = match[2];
      }
      action = attrs;
    }

    const cleanText = content.text.replace(/<action[^>]*\/?>/g, '').trim();

    return NextResponse.json({ 
      message: cleanText,
      action 
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Failed to get response' }, { status: 500 });
  }
}
