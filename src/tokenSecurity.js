import { config } from "./config.js";
import { logger } from "./logger.js";

const CHAIN_ID_MAP = {
  ethereum: 1,
  eth: 1,
  bsc: 56,
  binance: 56,
  bnb: 56,
  polygon: 137,
  matic: 137,
  arbitrum: 42161,
  arb: 42161,
  base: 8453,
  optimism: 10,
  op: 10,
  avalanche: 43114,
  avax: 43114,
  fantom: 250,
  ftm: 250
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const LOCKER_KEYWORDS = ["pinklock", "unicrypt", "team finance", "mudra", "locker", "locked"];
const TEAM_KEYWORDS = ["team", "dev", "developer", "owner", "creator", "treasury", "foundation"];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAddress(value) {
  return (value || "").toString().toLowerCase();
}

function toBoolFlag(value) {
  return value === true || value === 1 || value === "1";
}

function toFraction(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

function clampFraction(value) {
  return Math.max(0, Math.min(1, value));
}

function describeFetchError(error) {
  const message = error?.message || String(error);
  const cause = error?.cause;
  if (!cause || typeof cause !== "object") return message;
  const details = [cause.code, cause.errno, cause.syscall, cause.hostname].filter(Boolean);
  return details.length ? `${message} (${details.join(" | ")})` : message;
}

function normalizeChainId(chainId) {
  if (!chainId) return undefined;
  const key = chainId.toString().toLowerCase();
  return CHAIN_ID_MAP[key];
}

function isBurnAddress(address) {
  const normalized = normalizeAddress(address);
  return normalized === ZERO_ADDRESS || normalized === DEAD_ADDRESS;
}

function hasKeyword(value, keywords) {
  const text = (value || "").toString().toLowerCase();
  if (!text) return false;
  return keywords.some((keyword) => text.includes(keyword));
}

function parseResponseItem(payload, tokenAddress) {
  const result = payload?.result;
  if (!result || typeof result !== "object") return null;

  const lowerAddress = normalizeAddress(tokenAddress);
  return result[lowerAddress] || result[tokenAddress] || null;
}

function analyzeLp(data) {
  const lpHolders = Array.isArray(data?.lp_holders) ? data.lp_holders : [];
  if (!lpHolders.length) {
    return {
      status: "unknown",
      lockedFraction: 0,
      burnedFraction: 0,
      reason: "Aucune info LP holder renvoyee"
    };
  }

  let lockedFraction = 0;
  let burnedFraction = 0;

  for (const holder of lpHolders) {
    const percent = toFraction(holder?.percent);
    const address = normalizeAddress(holder?.address);
    const tag = holder?.tag || "";
    const locked =
      toBoolFlag(holder?.is_locked) || isBurnAddress(address) || hasKeyword(tag, LOCKER_KEYWORDS);

    if (locked) lockedFraction += percent;
    if (isBurnAddress(address)) burnedFraction += percent;
  }

  const safeLockedFraction = clampFraction(lockedFraction);
  const safeBurnedFraction = clampFraction(burnedFraction);
  const status = safeLockedFraction > 0 ? "locked" : "unlocked";
  const reason =
    status === "locked"
      ? `LP verrouille/brule detecte via GoPlus (${(safeLockedFraction * 100).toFixed(2)}%)`
      : "Aucun LP lock detecte via GoPlus";

  return {
    status,
    lockedFraction: safeLockedFraction,
    burnedFraction: safeBurnedFraction,
    reason
  };
}

function analyzeTeam(data) {
  const holders = Array.isArray(data?.holders) ? data.holders : [];
  const ownerAddress = normalizeAddress(data?.owner_address);
  const creatorAddress = normalizeAddress(data?.creator_address);

  const ownerFraction = toFraction(data?.owner_percent);
  const creatorFraction = ownerAddress && creatorAddress === ownerAddress ? 0 : toFraction(data?.creator_percent);
  const knownTeamFraction = clampFraction(ownerFraction + creatorFraction);

  let teamLockedFraction = 0;
  let observedTeamEntry = false;

  for (const holder of holders) {
    const address = normalizeAddress(holder?.address);
    const percent = toFraction(holder?.percent);
    const taggedAsTeam = hasKeyword(holder?.tag, TEAM_KEYWORDS);
    const isKnownTeamAddress = address && (address === ownerAddress || address === creatorAddress);
    if (!taggedAsTeam && !isKnownTeamAddress) continue;
    observedTeamEntry = true;
    if (toBoolFlag(holder?.is_locked)) {
      teamLockedFraction += percent;
    }
  }

  const safeTeamLockedFraction = clampFraction(teamLockedFraction);

  if (knownTeamFraction <= 0) {
    return {
      status: "unknown",
      knownTeamFraction,
      lockedFraction: safeTeamLockedFraction,
      reason: "Part team non detectee (owner/creator faibles ou nuls)"
    };
  }

  if (!observedTeamEntry) {
    return {
      status: "unknown",
      knownTeamFraction,
      lockedFraction: safeTeamLockedFraction,
      reason: "Part team detectee mais pas visible dans les holders retournes"
    };
  }

  if (safeTeamLockedFraction <= 0) {
    return {
      status: "unlocked",
      knownTeamFraction,
      lockedFraction: safeTeamLockedFraction,
      reason: "Owner/creator detectes sans lock visible"
    };
  }

  if (safeTeamLockedFraction >= knownTeamFraction * 0.9) {
    return {
      status: "locked",
      knownTeamFraction,
      lockedFraction: safeTeamLockedFraction,
      reason: "Part team majoritairement lockee"
    };
  }

  return {
    status: "partial",
    knownTeamFraction,
    lockedFraction: safeTeamLockedFraction,
    reason: "Part team partiellement lockee"
  };
}

function analyzeSupply(data) {
  const ownerAddress = normalizeAddress(data?.owner_address);
  const mintable = toBoolFlag(data?.is_mintable);
  const ownerUnknown = !ownerAddress;
  const ownerRenounced = ownerAddress === ZERO_ADDRESS || ownerAddress === DEAD_ADDRESS;
  const canTakeBackOwnership = toBoolFlag(data?.can_take_back_ownership);
  const hiddenOwner = toBoolFlag(data?.hidden_owner);

  return {
    mintable,
    ownerAddress,
    ownerUnknown,
    ownerRenounced,
    canTakeBackOwnership,
    hiddenOwner,
    fixedSupply: !mintable
  };
}

function normalizeTokenSecurityData(data) {
  const lp = analyzeLp(data);
  const team = analyzeTeam(data);
  const supply = analyzeSupply(data);

  return {
    supported: true,
    available: true,
    lp,
    team,
    supply,
    raw: data
  };
}

export async function runTokenSecurityCheck(chainId, tokenAddress) {
  const numericChain = normalizeChainId(chainId);
  if (!numericChain) {
    return {
      supported: false,
      available: false,
      reason: "Chain non supportee par GoPlus"
    };
  }

  const retries = Math.max(0, Number(config.fetchRetries || 2));
  const baseDelayMs = Math.max(100, Number(config.fetchRetryBaseMs || 700));
  const url = new URL(`${config.goplusBase}/api/v1/token_security/${numericChain}`);
  url.searchParams.set("contract_addresses", tokenAddress);

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        if (res.status >= 500 && attempt <= retries) {
          await wait(baseDelayMs * attempt);
          continue;
        }
        return {
          supported: true,
          available: false,
          reason: `GoPlus HTTP ${res.status}`
        };
      }

      const payload = await res.json();
      if (Number(payload?.code) !== 1) {
        return {
          supported: true,
          available: false,
          reason: payload?.message || "Reponse GoPlus invalide"
        };
      }

      const item = parseResponseItem(payload, tokenAddress);
      if (!item) {
        return {
          supported: true,
          available: false,
          reason: "Token absent de la reponse GoPlus"
        };
      }

      return normalizeTokenSecurityData(item);
    } catch (error) {
      if (attempt <= retries) {
        logger.warn(
          { attempt, retries, delayMs: baseDelayMs * attempt, errorSummary: describeFetchError(error) },
          "GoPlus indisponible temporairement, retry"
        );
        await wait(baseDelayMs * attempt);
        continue;
      }

      logger.warn({ err: error, errorSummary: describeFetchError(error) }, "Erreur appel GoPlus token security");
      return {
        supported: true,
        available: false,
        reason: `Exception reseau: ${describeFetchError(error)}`
      };
    }
  }

  return {
    supported: true,
    available: false,
    reason: "GoPlus indisponible"
  };
}
