import { NextRequest, NextResponse } from 'next/server';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

let tokenSymbolCache: Record<string, string> | null = null;
let tokenCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60;

async function getTokenSymbols(): Promise<Record<string, string>> {
  const now = Date.now();
  if (tokenSymbolCache && now - tokenCacheTime < CACHE_TTL) return tokenSymbolCache;
  try {
    // 'all' covers every token on Solana, not just verified ones
    const res = await fetch('https://token.jup.ag/all', { headers: { 'Accept': 'application/json' } });
    const tokens: Array<{ address: string; symbol: string }> = await res.json();
    const map: Record<string, string> = {};
    for (const t of tokens) map[t.address] = t.symbol;
    tokenSymbolCache = map;
    tokenCacheTime = now;
    return map;
  } catch { return {}; }
}

async function fetchSymbolsFromHelius(mints: string[]): Promise<Record<string, string>> {
  if (mints.length === 0) return {};
  const apiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (!apiKey) return {};
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAssetBatch', params: { ids: mints } }),
    });
    const data = await res.json();
    const symbols: Record<string, string> = {};
    for (const asset of data.result || []) {
      const symbol = asset?.content?.metadata?.symbol || asset?.token_info?.symbol;
      if (asset?.id && symbol) symbols[asset.id] = symbol;
    }
    return symbols;
  } catch { return {}; }
}

async function fetchPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < mints.length; i += 100) chunks.push(mints.slice(i, i + 100));
    const results = await Promise.all(chunks.map(chunk =>
      fetch(`https://api.jup.ag/price/v2?ids=${chunk.join(',')}`, { headers: { 'Accept': 'application/json' } }).then(r => r.json())
    ));
    const prices: Record<string, number> = {};
    for (const data of results) {
      for (const [mint, info] of Object.entries(data.data || {})) {
        prices[mint] = parseFloat((info as any).price || '0');
      }
    }
    return prices;
  } catch { return {}; }
}

export async function POST(req: NextRequest) {
  try {
    const { solBalance, rawTokens } = await req.json();

    const tokenMints = (rawTokens || []).map((t: any) => t.mint);
    const allMints = [SOL_MINT, ...tokenMints];

    const [prices, symbolMap] = await Promise.all([
      fetchPrices(allMints),
      getTokenSymbols(),
    ]);

    // Fallback to Helius for any mints still missing after Jupiter all-list
    const unknownMints = tokenMints.filter((m: string) => !symbolMap[m]);
    const heliusSymbols = await fetchSymbolsFromHelius(unknownMints);

    const solPrice = prices[SOL_MINT] || 0;
    const solUsdValue = solBalance * solPrice;

    const tokens = (rawTokens || []).map((t: any) => {
      const symbol = symbolMap[t.mint] || heliusSymbols[t.mint] || t.mint.slice(0, 6) + '...';
      const price = prices[t.mint] || 0;
      const usdValue = t.amount * price;
      return { ...t, symbol, price, usdValue };
    });

    const totalUsdValue = solUsdValue + tokens.reduce((sum: number, t: any) => sum + t.usdValue, 0);

    return NextResponse.json({ solBalance, solPrice, solUsdValue, tokens, totalUsdValue });
  } catch (error) {
    console.error('Portfolio enrich error:', error);
    return NextResponse.json({ error: 'Failed to enrich portfolio' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST with solBalance and rawTokens from client' }, { status: 400 });
}