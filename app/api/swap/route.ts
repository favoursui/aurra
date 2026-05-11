import { NextRequest, NextResponse } from 'next/server';

// ── Jupiter endpoints ──────────────────────────────────────────────────────
const BASE = process.env.JUPITER_API_KEY
  ? 'https://api.jup.ag/swap/v1'
  : 'https://lite-api.jup.ag/swap/v1';

const JUPITER_QUOTE        = `${BASE}/quote`;
const JUPITER_SWAP         = `${BASE}/swap`;
const JUPITER_TOKEN_SEARCH = 'https://lite-api.jup.ag/tokens/v1/search';

const jupHeaders = () => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}),
});

// ── Token resolution ───────────────────────────────────────────────────────
interface TokenInfo { address: string; decimals: number }

// Fast-path for the most common tokens — avoids a network round-trip
const WELL_KNOWN: Record<string, TokenInfo> = {
  SOL:     { address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC:    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT:    { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
};

// In-memory cache — persists across requests in the same Next.js process
const tokenCache = new Map<string, TokenInfo>(Object.entries(WELL_KNOWN));

async function resolveToken(symbol: string): Promise<TokenInfo> {
  const key = symbol.toUpperCase();

  if (tokenCache.has(key)) return tokenCache.get(key)!;

  console.log(`[swap] Resolving unknown token: ${symbol}`);

  const res = await fetch(
    `${JUPITER_TOKEN_SEARCH}?query=${encodeURIComponent(symbol)}&limit=10`,
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) }
  );

  if (!res.ok) throw new Error(`Token lookup failed (${res.status})`);

  const results: Array<{ address: string; symbol: string; decimals: number }> = await res.json();

  // Prefer an exact symbol match (case-insensitive) to avoid grabbing the wrong token
  const match = results.find(t => t.symbol.toUpperCase() === key) ?? results[0];

  if (!match) throw new Error(`Token not found: ${symbol}. Try using the mint address directly.`);

  const info: TokenInfo = { address: match.address, decimals: match.decimals };
  tokenCache.set(key, info);
  console.log(`[swap] Resolved ${symbol} → ${info.address} (${info.decimals} decimals)`);
  return info;
}

// ── Swap builder ───────────────────────────────────────────────────────────
async function buildSwapTransaction(
  inputToken:    TokenInfo,
  outputToken:   TokenInfo,
  amountIn:      number,
  userPublicKey: string,
  fromToken:     string,
  toToken:       string,
) {
  // 1. Quote
  const quoteUrl = `${JUPITER_QUOTE}?` + new URLSearchParams({
    inputMint:   inputToken.address,
    outputMint:  outputToken.address,
    amount:      String(amountIn),
    slippageBps: '50',
  });

  console.log('[swap] Quote:', quoteUrl);
  const quoteRes  = await fetch(quoteUrl, { headers: jupHeaders(), signal: AbortSignal.timeout(10_000) });
  const quoteText = await quoteRes.text();
  if (!quoteRes.ok) throw new Error(`Jupiter quote ${quoteRes.status}: ${quoteText.slice(0, 300)}`);

  const quote = JSON.parse(quoteText);
  if (quote.error) throw new Error(`Jupiter quote: ${quote.error}`);

  // 2. Build transaction
  const swapRes  = await fetch(JUPITER_SWAP, {
    method:  'POST',
    headers: jupHeaders(),
    body:    JSON.stringify({
      quoteResponse:            quote,
      userPublicKey,
      wrapAndUnwrapSol:         true,
      dynamicComputeUnitLimit:  true,
      prioritizationFeeLamports: 'auto',
    }),
    signal: AbortSignal.timeout(12_000),
  });

  const swapText = await swapRes.text();
  if (!swapRes.ok) throw new Error(`Jupiter swap ${swapRes.status}: ${swapText.slice(0, 300)}`);

  const swapData = JSON.parse(swapText);
  if (swapData.error)          throw new Error(`Jupiter swap: ${swapData.error}`);
  if (!swapData.swapTransaction) throw new Error('Jupiter returned no swapTransaction');

  return {
    swapTransaction: swapData.swapTransaction,
    summary: {
      fromToken,
      toToken,
      inputAmount:    amountIn / 10 ** inputToken.decimals,
      outputAmount:   parseInt(quote.outAmount) / 10 ** outputToken.decimals,
      priceImpactPct: parseFloat(quote.priceImpactPct ?? '0'),
      route: (quote.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter',
    },
  };
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromToken     = searchParams.get('fromToken');
  const toToken       = searchParams.get('toToken');
  const amount        = parseFloat(searchParams.get('amount') ?? '0');
  const userPublicKey = searchParams.get('userPublicKey');

  if (!fromToken || !toToken || !amount || !userPublicKey)
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  if (amount <= 0)
    return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 });

  try {
    // Resolve both tokens in parallel — dynamic lookup for any Solana token
    const [inputToken, outputToken] = await Promise.all([
      resolveToken(fromToken),
      resolveToken(toToken),
    ]);

    const amountIn = Math.floor(amount * 10 ** inputToken.decimals);
    const result   = await buildSwapTransaction(inputToken, outputToken, amountIn, userPublicKey, fromToken.toUpperCase(), toToken.toUpperCase());

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[swap/route]', err.message);
    return NextResponse.json({ error: err.message ?? 'Swap unavailable' }, { status: 503 });
  }
}