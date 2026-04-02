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
import { runTokenSecurityCheck } from "./tokenSecurity.js";

assertConfig();

const client = createDiscordClient();
const seenIds = new Set();
const seenOrder = [];
const MAX_SEEN = 500;
const MAX_ERROR_STACK_LENGTH = 900;
const MAX_DISCORD_MESSAGE_LENGTH = 1900;

const FILTER_REASON_LABELS = {
  chain_not_watched: "chaîne non surveillée",
  no_token_address: "adresse token absente",
  no_pairs: "aucune pair Dexscreener",
  no_primary_pair: "pair principale introuvable",
  honeypot_not_supported: "chaîne non supportée par honeypot.is",
  honeypot_risk_or_honeypot: "honeypot/risque trop élevé",
  mintable_owner_active: "mint activable (owner non renoncé)",
  processing_error: "erreur pendant processProfile"
};

let isPolling = false;
let emptyProfilesStreak = 0;
let hourlyStats = createFreshHourlyStats();

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  void notifyOpsError("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled rejection");
  void notifyOpsError("unhandledRejection", err);
});

function createFreshHourlyStats() {
  return {
    windowStart: new Date(),
    discovered: 0,
    watchedChain: 0,
    sent: 0,
    filteredReasons: {},
    scamReasons: {
      honeypotDetected: 0,
      scoreTooHigh: 0,
      tradeSimulationFailed: 0,
      honeypotApiIssue: 0,
      chainNotSupported: 0,
      mintableByOwner: 0
    },
    tokenSecurity: {
      checked: 0,
      unavailable: 0,
      unsupportedChain: 0,
      lpLocked: 0,
      lpUnlocked: 0,
      lpUnknown: 0,
      teamLocked: 0,
      teamPartial: 0,
      teamUnlocked: 0,
      teamUnknown: 0,
      fixedSupply: 0,
      mintable: 0
    },
    runtimeErrors: 0
  };
}

function incrementCounter(bucket, key, delta = 1) {
  bucket[key] = (bucket[key] || 0) + delta;
}

function recordFilterReason(reason) {
  incrementCounter(hourlyStats.filteredReasons, reason);
}

function recordRuntimeError() {
  hourlyStats.runtimeErrors += 1;
}

function recordHoneypotBlock(hp) {
  if (!hp?.supported) {
    hourlyStats.scamReasons.chainNotSupported += 1;
    return;
  }

  if (hp.isHoneypot) {
    hourlyStats.scamReasons.honeypotDetected += 1;
  }
  if (Number(hp.riskScore) >= config.riskScoreThreshold) {
    hourlyStats.scamReasons.scoreTooHigh += 1;
  }
  if (hp.buyFailed || hp.sellFailed) {
    hourlyStats.scamReasons.tradeSimulationFailed += 1;
  }

  const reason = (hp.reason || "").toString().toLowerCase();
  if (reason.startsWith("http") || reason.includes("exception")) {
    hourlyStats.scamReasons.honeypotApiIssue += 1;
  }
}

function recordTokenSecurityStats(tokenSecurity) {
  if (!tokenSecurity?.supported) {
    hourlyStats.tokenSecurity.unsupportedChain += 1;
    return;
  }

  if (!tokenSecurity?.available) {
    hourlyStats.tokenSecurity.unavailable += 1;
    return;
  }

  hourlyStats.tokenSecurity.checked += 1;

  if (tokenSecurity.lp?.status === "locked") hourlyStats.tokenSecurity.lpLocked += 1;
  else if (tokenSecurity.lp?.status === "unlocked") hourlyStats.tokenSecurity.lpUnlocked += 1;
  else hourlyStats.tokenSecurity.lpUnknown += 1;

  if (tokenSecurity.team?.status === "locked") hourlyStats.tokenSecurity.teamLocked += 1;
  else if (tokenSecurity.team?.status === "partial") hourlyStats.tokenSecurity.teamPartial += 1;
  else if (tokenSecurity.team?.status === "unlocked") hourlyStats.tokenSecurity.teamUnlocked += 1;
  else hourlyStats.tokenSecurity.teamUnknown += 1;

  if (tokenSecurity.supply?.fixedSupply) hourlyStats.tokenSecurity.fixedSupply += 1;
  if (tokenSecurity.supply?.mintable) hourlyStats.tokenSecurity.mintable += 1;
}

function truncate(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function normalizeError(error) {
  const cause = error?.cause && typeof error.cause === "object" ? error.cause : null;
  const causeDetails = cause
    ? {
        code: cause.code || null,
        errno: cause.errno || null,
        syscall: cause.syscall || null,
        hostname: cause.hostname || null
      }
    : null;

  if (error instanceof Error) {
    return { message: error.message, stack: error.stack || "", causeDetails };
  }
  if (typeof error === "string") {
    return { message: error, stack: "", causeDetails };
  }
  try {
    return { message: JSON.stringify(error), stack: "", causeDetails };
  } catch {
    return { message: String(error), stack: "", causeDetails };
  }
}

async function sendOpsChannelMessage(content) {
  if (!config.opsChannelId) return false;

  try {
    await sendToChannel(client, config.opsChannelId, {
      content: truncate(content, MAX_DISCORD_MESSAGE_LENGTH)
    });
    return true;
  } catch (error) {
    logger.error({ err: error, channelId: config.opsChannelId }, "Impossible d'envoyer un message ops");
    return false;
  }
}

async function notifyOpsError(context, error, extra = {}) {
  recordRuntimeError();

  const normalized = normalizeError(error);
  const stack = truncate(normalized.stack, MAX_ERROR_STACK_LENGTH);
  const causeText = normalized.causeDetails
    ? Object.entries(normalized.causeDetails)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")
    : "";
  const extraText = Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `- ${key}: \`${String(value)}\``)
    .join("\n");

  const lines = [
    "🚨 **Erreur bot détectée**",
    `Contexte: \`${context}\``,
    `Message: \`${truncate(normalized.message, 220)}\``
  ];

  if (extraText) {
    lines.push("Détails:");
    lines.push(extraText);
  }

  if (causeText) {
    lines.push(`Cause réseau: \`${causeText}\``);
  }

  if (stack) {
    lines.push("Stack:");
    lines.push(`\`\`\`\n${stack}\n\`\`\``);
  }

  await sendOpsChannelMessage(lines.join("\n"));
}

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

async function processProfile(profile, tokenId = buildTokenId(profile)) {
  const tokenAddress = profile.tokenAddress || profile.address || profile.id;
  if (!tokenAddress) {
    recordFilterReason("no_token_address");
    logger.info({ tokenId, reason: "no_token_address" }, "Profil ignoré");
    return;
  }

  try {
    const pairs = await fetchPairsForToken(profile.chainId, tokenAddress);
    logger.info({ tokenId, chain: profile.chainId, pairs: pairs.length }, "Profil reçu");

    if (!pairs.length) {
      recordFilterReason("no_pairs");
      logger.info({ tokenId, reason: "no_pairs" }, "Token filtré");
      return;
    }

    const bestPairs = selectBestPairs(pairs, config.maxPairsPerToken);
    const primary = bestPairs[0];
    if (!primary) {
      recordFilterReason("no_primary_pair");
      logger.info({ tokenId, reason: "no_primary_pair" }, "Token filtré");
      return;
    }

    const tokenSecurity = await runTokenSecurityCheck(profile.chainId, tokenAddress);
    recordTokenSecurityStats(tokenSecurity);

    if (
      tokenSecurity.supported &&
      tokenSecurity.available &&
      tokenSecurity.supply?.mintable &&
      !tokenSecurity.supply?.ownerRenounced &&
      config.enforceMintOwnerFilter
    ) {
      recordFilterReason("mintable_owner_active");
      hourlyStats.scamReasons.mintableByOwner += 1;
      logger.info(
        {
          tokenId,
          ownerAddress: tokenSecurity.supply.ownerAddress,
          canTakeBackOwnership: tokenSecurity.supply.canTakeBackOwnership
        },
        "Token filtré (mint activable par owner)"
      );
      return;
    }

    const hp = await runHoneypotCheck(profile.chainId, tokenAddress, primary.pairAddress);
    if (!hp.supported) {
      recordFilterReason("honeypot_not_supported");
      recordHoneypotBlock(hp);
      logger.info({ tokenId, reason: "honeypot_not_supported", chain: profile.chainId }, "Token filtré");
      return;
    }

    if (!hp.ok || hp.riskScore >= config.riskScoreThreshold) {
      recordFilterReason("honeypot_risk_or_honeypot");
      recordHoneypotBlock(hp);
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
      tokenSecurity,
      mentionRoleId: config.mentionRoleId
    });

    await sendToChannel(client, config.targetChannelId, payload);
    hourlyStats.sent += 1;
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
    recordFilterReason("processing_error");
    logger.error({ err: error, tokenId }, "Erreur pendant le traitement du token");
    await notifyOpsError("processProfile", error, {
      tokenId,
      chain: profile.chainId,
      tokenAddress
    });
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatReasonLines(bucket, fallback = "Aucune") {
  const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `- ${fallback}`;
  return entries.map(([reason, count]) => `- ${FILTER_REASON_LABELS[reason] || reason}: **${count}**`).join("\n");
}

async function sendHourlyRecap() {
  const snapshot = hourlyStats;
  const now = new Date();

  const filteredTotal = Object.values(snapshot.filteredReasons).reduce((sum, value) => sum + value, 0);
  const scamBlocked = snapshot.filteredReasons.honeypot_risk_or_honeypot || 0;
  const mintableOwnerBlocked = snapshot.filteredReasons.mintable_owner_active || 0;
  const tokenSecurity = snapshot.tokenSecurity || {};

  const content = [
    "📊 **Récap horaire snip-bot**",
    `Période: \`${formatDate(snapshot.windowStart)}\` → \`${formatDate(now)}\``,
    `Tokens découverts (nouveaux): **${snapshot.discovered}**`,
    `Tokens sur chaînes surveillées: **${snapshot.watchedChain}**`,
    `Tokens envoyés au channel cible: **${snapshot.sent}**`,
    `Tokens filtrés (tous motifs): **${filteredTotal}**`,
    "",
    "🛡️ **Détail scam (honeypot.is)**",
    `- Filtrés comme scam/risque: **${scamBlocked}**`,
    `- Suspectés honeypot.is (isHoneypot=true): **${snapshot.scamReasons.honeypotDetected}**`,
    `- Score >= seuil (${config.riskScoreThreshold}): **${snapshot.scamReasons.scoreTooHigh}**`,
    `- Simulation buy/sell en échec: **${snapshot.scamReasons.tradeSimulationFailed}**`,
    `- Erreur API honeypot (HTTP/exception): **${snapshot.scamReasons.honeypotApiIssue}**`,
    `- Chaîne non supportée honeypot.is: **${snapshot.scamReasons.chainNotSupported}**`,
    "",
    "🔐 **Checks on-chain (LP/team/supply)**",
    `- Tokens checkés via GoPlus: **${tokenSecurity.checked || 0}**`,
    `- LP locked / unlocked / inconnu: **${tokenSecurity.lpLocked || 0}** / **${tokenSecurity.lpUnlocked || 0}** / **${tokenSecurity.lpUnknown || 0}**`,
    `- Team locked / partiel / unlocked / inconnu: **${tokenSecurity.teamLocked || 0}** / **${tokenSecurity.teamPartial || 0}** / **${tokenSecurity.teamUnlocked || 0}** / **${tokenSecurity.teamUnknown || 0}**`,
    `- Supply fixe / mintable: **${tokenSecurity.fixedSupply || 0}** / **${tokenSecurity.mintable || 0}**`,
    `- Bloqués car mintable + owner actif: **${mintableOwnerBlocked}**`,
    `- Check GoPlus indisponible: **${tokenSecurity.unavailable || 0}**`,
    `- Chaîne non supportée GoPlus: **${tokenSecurity.unsupportedChain || 0}**`,
    "",
    "📉 **Raisons de filtrage**",
    formatReasonLines(snapshot.filteredReasons, "Aucun token filtré"),
    "",
    `⚠️ Erreurs runtime: **${snapshot.runtimeErrors}**`
  ].join("\n");

  const sent = await sendOpsChannelMessage(content);
  if (sent) {
    logger.info({ recap: snapshot }, "Récap horaire envoyé");
    hourlyStats = createFreshHourlyStats();
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
      const tokenId = buildTokenId(profile);
      if (seenIds.has(tokenId)) continue;

      remember(tokenId);
      hourlyStats.discovered += 1;

      const chain = (profile?.chainId || profile?.chain || "").toLowerCase();
      if (!config.watchedChains.includes(chain)) {
        recordFilterReason("chain_not_watched");
        logger.info({ tokenId, chain, reason: "chain_not_watched" }, "Token filtré");
        continue;
      }

      hourlyStats.watchedChain += 1;
      await processProfile(profile, tokenId);
    }
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du polling Dexscreener");
    await notifyOpsError("poll", error);
  } finally {
    isPolling = false;
  }
}

async function start() {
  await client.login(config.discordToken);
  logger.info(
    {
      pollIntervalMs: config.pollIntervalMs,
      recapIntervalMs: config.hourlyRecapIntervalMs,
      chains: config.watchedChains,
      opsChannelId: config.opsChannelId,
      enforceMintOwnerFilter: config.enforceMintOwnerFilter
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
  setInterval(() => {
    void poll();
  }, config.pollIntervalMs);

  setInterval(() => {
    void sendHourlyRecap();
  }, config.hourlyRecapIntervalMs);
}

start().catch(async (error) => {
  logger.error({ err: error }, "Impossible de démarrer le bot");
  await notifyOpsError("start", error);
  process.exit(1);
});
