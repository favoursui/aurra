import { NextRequest, NextResponse } from 'next/server';

interface JupiterToken {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

// In-memory cache so we don't hammer Jupiter on every request
let tokenCache: JupiterToken[] | null = null;
let tokenCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function getTokenList(): Promise<JupiterToken[]> {
  const now = Date.now();
  if (tokenCache && now - tokenCacheTime < CACHE_TTL) return tokenCache;

  const res = await fetch('https://token.jup.ag/strict', {
    headers: { 'Accept': 'application/json' },
  });
  const data: JupiterToken[] = await res.json();
  tokenCache = data;
  tokenCacheTime = now;
  return data;
}

async function resolveToken(symbolOrMint: string): Promise<JupiterToken | null> {
  const tokens = await getTokenList();

  // If it looks like a mint address (base58, 32-44 chars), match directly
  if (symbolOrMint.length >= 32) {
    return tokens.find(t => t.address === symbolOrMint) || null;
  }

  // Otherwise match by symbol (case-insensitive, prefer exact match)
  const upper = symbolOrMint.toUpperCase();
  const exact = tokens.find(t => t.symbol.toUpperCase() === upper);
  return exact || null;
}

// GET /api/swap?fromToken=USDC&toToken=SOL&amount=10&userPublicKey=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromToken = searchParams.get('fromToken');
  const toToken = searchParams.get('toToken');
  const amount = parseFloat(searchParams.get('amount') || '0');
  const userPublicKey = searchParams.get('userPublicKey');

  if (!fromToken || !toToken || !amount || !userPublicKey) {
    return NextResponse.json({ error: 'Missing required params' }, { status: 400 });
  }

  try {
    const [inputToken, outputToken] = await Promise.all([
      resolveToken(fromToken),
      resolveToken(toToken),
    ]);

    if (!inputToken) return NextResponse.json({ error: `Token not found: ${fromToken}` }, { status: 400 });
    if (!outputToken) return NextResponse.json({ error: `Token not found: ${toToken}` }, { status: 400 });

    const amountInSmallestUnit = Math.floor(amount * Math.pow(10, inputToken.decimals));

    const quoteRes = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputToken.address}&outputMint=${outputToken.address}&amount=${amountInSmallestUnit}&slippageBps=50`,
      { headers: { 'Accept': 'application/json' } }
    );
    const quote = await quoteRes.json();

    if (quote.error) return NextResponse.json({ error: quote.error }, { status: 400 });

    const outAmount = parseInt(quote.outAmount) / Math.pow(10, outputToken.decimals);
    const priceImpact = parseFloat(quote.priceImpactPct || '0');

    return NextResponse.json({
      quote,
      summary: {
        fromToken: inputToken.symbol,
        toToken: outputToken.symbol,
        inputAmount: amount,
        outputAmount: outAmount,
        priceImpactPct: priceImpact,
        slippageBps: 50,
        route: quote.routePlan?.map((r: any) => r.swapInfo?.label).filter(Boolean).join(' → '),
      }
    });

  } catch (error) {
    console.error('Swap quote error:', error);
    return NextResponse.json({ error: 'Failed to get swap quote' }, { status: 500 });
  }
}

// POST /api/swap — builds the swap transaction for the client to sign
export async function POST(req: NextRequest) {
  try {
    const { quote, userPublicKey } = await req.json();

    if (!quote || !userPublicKey) {
      return NextResponse.json({ error: 'Missing quote or userPublicKey' }, { status: 400 });
    }

    const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    const swapData = await swapRes.json();

    if (swapData.error) {
      return NextResponse.json({ error: swapData.error }, { status: 400 });
    }

    return NextResponse.json({ swapTransaction: swapData.swapTransaction });

  } catch (error) {
    console.error('Swap build error:', error);
    return NextResponse.json({ error: 'Failed to build swap transaction' }, { status: 500 });
  }
}