import dotenv from "dotenv";

dotenv.config();

const DEFAULT_CHAINS = [
  "ethereum",
  "bsc",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "avalanche",
  "fantom"
];

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  targetChannelId: process.env.DISCORD_CHANNEL_ID || "1466419634633969696",
  mentionRoleId: process.env.MENTION_ROLE_ID || "1466422195088654470",
  opsChannelId: process.env.OPS_CHANNEL_ID || "1466475243647271185",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 45000),
  hourlyRecapIntervalMs: Number(process.env.HOURLY_RECAP_INTERVAL_MS || 60 * 60 * 1000),
  maxPairsPerToken: Number(process.env.MAX_PAIRS_PER_TOKEN || 3),
  riskScoreThreshold: Number(process.env.RISK_SCORE_THRESHOLD || 60),
  dexscreenerBase: process.env.DEXSCREENER_BASE || "https://api.dexscreener.com",
  honeypotBase: process.env.HONEYPOT_BASE || "https://api.honeypot.is",
  goplusBase: process.env.GOPLUS_BASE || "https://api.gopluslabs.io",
  sourceMode: process.env.SOURCE_MODE || "profiles_then_boosts", // profiles_only, boosts_only, profiles_then_boosts
  startChannelId: process.env.START_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID,
  startMentionRoleId: process.env.START_MENTION_ROLE_ID || process.env.MENTION_ROLE_ID,
  watchedChains: process.env.CHAINS
    ? process.env.CHAINS.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_CHAINS,
  logLevel: process.env.LOG_LEVEL || "info",
  sendMockOnStart: process.env.SEND_MOCK_ON_START !== "false",
  fetchRetries: Number(process.env.FETCH_RETRIES || 2),
  fetchRetryBaseMs: Number(process.env.FETCH_RETRY_BASE_MS || 700),
  enforceMintOwnerFilter: process.env.ENFORCE_MINT_OWNER_FILTER !== "false"
};

export function assertConfig() {
  if (!config.discordToken) {
    throw new Error("DISCORD_TOKEN est manquant dans l'environnement (.env).");
  }
}
