import { assertConfig, config } from "./config.js";
import { createDiscordClient, sendToChannel } from "./discordClient.js";
import {
  deriveLiquidityLock,
  fetchLatestTokenProfiles,
  fetchLatestBoosts,
  fetchPairsForToken,
  selectBestPairs
} from "./dexscreener.js";
import { formatUsd } from "./format.js";
import { runHoneypotCheck } from "./honeypot.js";
import { logger } from "./logger.js";
import { buildEmbed } from "./messageFormatter.js";
import { buildMockPayloads } from "./mock.js";

assertConfig();

const client = createDiscordClient();
const seenIds = new Set();
const seenOrder = [];
const MAX_SEEN = 500;
let isPolling = false;
let emptyProfilesStreak = 0;

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
});
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled rejection");
});

function remember(id) {
  if (seenIds.has(id)) return;
  seenIds.add(id);
  seenOrder.push(id);
  if (seenOrder.length > MAX_SEEN) {
    const old = seenOrder.shift();
    seenIds.delete(old);
  }
}

function buildTokenId(profile) {
  const chain = profile.chainId || profile.chain || "unknown";
  const address = profile.tokenAddress || profile.address || profile.id || "noaddress";
  return `${chain.toLowerCase()}:${address.toLowerCase()}`;
}

async function processProfile(profile) {
  const tokenId = buildTokenId(profile);
  const tokenAddress = profile.tokenAddress || profile.address || profile.id;
  if (!tokenAddress) {
    logger.info({ tokenId, reason: "no_token_address" }, "Profil ignoré");
    return;
  }

  try {
    const pairs = await fetchPairsForToken(profile.chainId, tokenAddress);
    logger.info({ tokenId, chain: profile.chainId, pairs: pairs.length }, "Profil reçu");

    if (!pairs.length) {
      logger.info({ tokenId, reason: "no_pairs" }, "Token filtré");
      return;
    }

    const bestPairs = selectBestPairs(pairs, config.maxPairsPerToken);
    const primary = bestPairs[0];
    if (!primary) {
      logger.info({ tokenId, reason: "no_primary_pair" }, "Token filtré");
      return;
    }

    const hp = await runHoneypotCheck(profile.chainId, tokenAddress, primary.pairAddress);
    if (!hp.supported) {
      logger.info({ tokenId, reason: "honeypot_not_supported", chain: profile.chainId }, "Token filtré");
      return;
    }

    if (!hp.ok || hp.riskScore >= config.riskScoreThreshold) {
      logger.info(
        {
          tokenId,
          risk: hp.riskScore,
          isHoneypot: hp.isHoneypot,
          reason: hp.reason
        },
        "Token filtré (risque/honeypot)"
      );
      return;
    }

    const lockInfo = deriveLiquidityLock(primary);
    const payload = buildEmbed({
      profile,
      pair: primary,
      honeypot: hp,
      lockInfo,
      mentionRoleId: config.mentionRoleId
    });

    await sendToChannel(client, config.targetChannelId, payload);
    logger.info(
      {
        tokenId,
        priceUsd: primary.priceUsd,
        liquidity: formatUsd(primary?.liquidity?.usd),
        risk: hp.riskScore
      },
      "Token envoyé au channel cible"
    );
  } catch (error) {
    logger.error({ err: error, tokenId }, "Erreur pendant le traitement du token");
  }
}

async function poll() {
  if (isPolling) return;
  isPolling = true;
  try {
    logger.info("Polling Dexscreener...");
    let profiles = [];

    if (config.sourceMode === "profiles_only" || config.sourceMode === "profiles_then_boosts") {
      profiles = await fetchLatestTokenProfiles(40);
      logger.info({ count: profiles.length }, "Profils récupérés");
      if (profiles.length === 0) emptyProfilesStreak += 1;
      else emptyProfilesStreak = 0;
    }

    // Fallback sur les boosts si le flux profils est vide
    if (
      profiles.length === 0 &&
      (config.sourceMode === "profiles_then_boosts" || config.sourceMode === "boosts_only")
    ) {
      const boosts = await fetchLatestBoosts(40);
      logger.info({ count: boosts.length }, "Boosts récupérés (fallback)");
      profiles = boosts;
    }

    if (profiles.length === 0) {
      if (emptyProfilesStreak % 10 === 0) {
        logger.warn(
          { streak: emptyProfilesStreak, sourceMode: config.sourceMode },
          "Aucune donnée renvoyée par Dexscreener (profiles/boosts)."
        );
      }
    }

    // Traiter du plus ancien au plus récent pour éviter les doublons si la page est triée desc
    for (const profile of profiles.reverse()) {
      const chain = (profile?.chainId || profile?.chain || "").toLowerCase();
      if (!config.watchedChains.includes(chain)) {
        remember(buildTokenId(profile)); // pour éviter re-check constant
        logger.info({ tokenId: buildTokenId(profile), chain, reason: "chain_not_watched" }, "Token filtré");
        continue;
      }

      const tokenId = buildTokenId(profile);
      if (seenIds.has(tokenId)) continue;
      remember(tokenId);
      await processProfile(profile);
    }
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du polling Dexscreener");
  } finally {
    isPolling = false;
  }
}

async function start() {
  await client.login(config.discordToken);
  logger.info(
    {
      pollIntervalMs: config.pollIntervalMs,
      chains: config.watchedChains
    },
    "Bot démarré"
  );

  // Message de présence au démarrage pour confirmer l'accès au channel.
  try {
    const startChannelId = config.startChannelId || config.targetChannelId;
    const startRoleId = config.startMentionRoleId || config.mentionRoleId;

    await sendToChannel(client, startChannelId, {
      content: `✅ Bot démarré et à l'écoute sur les chaînes : ${config.watchedChains.join(
        ", "
      )}${startRoleId ? ` <@&${startRoleId}>` : ""}`
    });

    if (config.sendMockOnStart) {
      const mocks = buildMockPayloads({ mentionRoleId: config.mentionRoleId });
      if (mocks[0]) {
        await sendToChannel(client, startChannelId, {
          content: "🧪 Test API Dexscreener (mock) — message de démarrage",
          ...mocks[0]
        });
      }
      logger.info({ count: 1 }, "Payload mock de démarrage envoyé");
    }
  } catch (error) {
    logger.warn({ err: error }, "Impossible d'envoyer le message de démarrage (permissions ou channel ?)");
  }

  await poll();
  setInterval(poll, config.pollIntervalMs);
}

start().catch((error) => {
  logger.error({ err: error }, "Impossible de démarrer le bot");
  process.exit(1);
});
