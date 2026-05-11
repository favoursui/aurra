import { NextRequest, NextResponse } from 'next/server';

const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`;

const TOKEN_MINTS: Record<string, { address: string; decimals: number }> = {
  SOL:     { address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  USDC:    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT:    { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  BONK:    { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
  JUP:     { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6 },
  WIF:     { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6 },
  PYTH:    { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6 },
  mSOL:    { address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9 },
  jitoSOL: { address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9 },
  RAY:     { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6 },
};

async function getQuoteAndSwapTx(
  inputToken: { address: string; decimals: number },
  outputToken: { address: string; decimals: number },
  amountIn: number,
  userPublicKey: string,
  fromToken: string,
  toToken: string,
) {
  // Try Helius first
  try {
    const quoteRes = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'quote', method: 'getQuote',
        params: { inputMint: inputToken.address, outputMint: outputToken.address, amount: amountIn, slippageBps: 50 },
      }),
    });
    const quoteData = await quoteRes.json();
    if (!quoteData.error && quoteData.result) {
      const quote = quoteData.result;
      const swapRes = await fetch(HELIUS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'swap', method: 'getSwapTransaction',
          params: { quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' },
        }),
      });
      const swapData = await swapRes.json();
      if (!swapData.error && swapData.result?.swapTransaction) {
        const outAmount = parseInt(quote.outAmount) / Math.pow(10, outputToken.decimals);
        return {
          swapTransaction: swapData.result.swapTransaction,
          summary: { fromToken, toToken, inputAmount: amountIn / Math.pow(10, inputToken.decimals), outputAmount: outAmount, priceImpactPct: parseFloat(quote.priceImpactPct || '0'), route: quote.routePlan?.map((r: any) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter' },
        };
      }
    }
  } catch {}

  // Fall back to Jupiter directly
  const quoteRes = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${inputToken.address}&outputMint=${outputToken.address}&amount=${amountIn}&slippageBps=50`,
    { headers: { Accept: 'application/json' } }
  );
  const quote = await quoteRes.json();
  if (quote.error) throw new Error(quote.error);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 'auto' }),
  });
  const swapData = await swapRes.json();
  if (swapData.error) throw new Error(swapData.error);

  const outAmount = parseInt(quote.outAmount) / Math.pow(10, outputToken.decimals);
  return {
    swapTransaction: swapData.swapTransaction,
    summary: { fromToken, toToken, inputAmount: amountIn / Math.pow(10, inputToken.decimals), outputAmount: outAmount, priceImpactPct: parseFloat(quote.priceImpactPct || '0'), route: quote.routePlan?.map((r: any) => r.swapInfo?.label).filter(Boolean).join(' → ') || 'Jupiter' },
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromToken = searchParams.get('fromToken')?.toUpperCase();
  const toToken = searchParams.get('toToken')?.toUpperCase();
  const amount = parseFloat(searchParams.get('amount') || '0');
  const userPublicKey = searchParams.get('userPublicKey');

  if (!fromToken || !toToken || !amount || !userPublicKey) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const inputToken = TOKEN_MINTS[fromToken];
  const outputToken = TOKEN_MINTS[toToken];
  if (!inputToken) return NextResponse.json({ error: `Unknown token: ${fromToken}` }, { status: 400 });
  if (!outputToken) return NextResponse.json({ error: `Unknown token: ${toToken}` }, { status: 400 });

  const amountIn = Math.floor(amount * Math.pow(10, inputToken.decimals));

  try {
    const result = await getQuoteAndSwapTx(inputToken, outputToken, amountIn, userPublicKey, fromToken, toToken);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Swap error:', err);
    return NextResponse.json({ error: err.message || 'Swap unavailable' }, { status: 503 });
  }
}