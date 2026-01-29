import { buildEmbed } from "./messageFormatter.js";
import { deriveLiquidityLock } from "./dexscreener.js";

// Génère un payload semblable à un vrai token pour tester l'embed et les permissions.
export function buildMockPayloads({ mentionRoleId }) {
  const mockProfile = {
    name: "MockToken",
    chainId: "bsc",
    tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
    info: {
      imageUrl: "https://cryptologos.cc/logos/binance-coin-bnb-logo.png?v=029"
    }
  };

  const mockPair = {
    url: "https://dexscreener.com/bsc/mocktoken",
    dexId: "pancakeswap",
    chainId: "bsc",
    baseToken: { symbol: "MOCK", name: "MockToken", address: mockProfile.tokenAddress },
    quoteToken: { symbol: "BUSD", name: "BUSD", address: "0x..." },
    priceUsd: 0.0123,
    priceNative: 0.00004,
    liquidity: { usd: 120000, base: 9_500_000, quote: 150000 },
    volume: { h24: 340000 },
    fdv: 1_200_000,
    txns: { m5: { buys: 12, sells: 8 } },
    pairAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdef",
    labels: ["lock"]
  };

  const mockHpOk = {
    supported: true,
    ok: true,
    isHoneypot: false,
    riskScore: 25,
    taxes: { buy: 5, sell: 7 },
    buyFailed: false,
    sellFailed: false
  };

  const lockInfo = deriveLiquidityLock(mockPair);
  const embedOk = buildEmbed({
    profile: mockProfile,
    pair: mockPair,
    honeypot: mockHpOk,
    lockInfo,
    mentionRoleId
  });

  const mockHpWarn = { ...mockHpOk, riskScore: 75, taxes: { buy: 12, sell: 18 } };
  const embedWarn = buildEmbed({
    profile: { ...mockProfile, name: "MockToken HighTax" },
    pair: { ...mockPair, priceUsd: 0.00042, liquidity: { usd: 4200, base: 1_100_000, quote: 4200 } },
    honeypot: mockHpWarn,
    lockInfo,
    mentionRoleId
  });

  return [embedOk, embedWarn];
}
