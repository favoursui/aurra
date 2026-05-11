import { NextResponse } from 'next/server';

let cache: any[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60;

export async function GET() {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return NextResponse.json(cache);
  }
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json'
    );
    const data = await res.json();
    const tokens = data.tokens || [];
    cache = tokens;
    cacheTime = now;
    return NextResponse.json(tokens);
  } catch (error) {
    return NextResponse.json([], { status: 200 });
  }
}