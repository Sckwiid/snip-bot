import { config } from "./config.js";
import { logger } from "./logger.js";

async function getJsonWithDebug(res, label) {
  const contentType = res.headers.get("content-type");
  const text = await res.text();
  try {
    return { data: JSON.parse(text), raw: text, contentType };
  } catch (error) {
    logger.warn(
      { err: error, status: res.status, contentType, rawSample: text.slice(0, 200) },
      `Parsing JSON échoué pour ${label}`
    );
    return { data: {}, raw: text, contentType };
  }
}

export async function fetchLatestTokenProfiles(limit = 25) {
  const url = `${config.dexscreenerBase}/token-profiles/latest/v1`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "snip-bot/1.0 (+github.com/)"
    }
  });

  if (!res.ok) {
    throw new Error(`Dexscreener latest profiles HTTP ${res.status}`);
  }

  const { data, contentType, raw } = await getJsonWithDebug(res, "token-profiles");
  // L'API renvoie parfois un tableau brut, parfois un objet { profiles: [] }
  const profiles = Array.isArray(data)
    ? data
    : Array.isArray(data.profiles)
    ? data.profiles
    : [];

  if (!profiles.length) {
    logger.warn(
      {
        status: res.status,
        info: data?.info || data?.message || "no_info",
        hint: "profiles array vide",
        contentType,
        rawSample: raw?.slice ? raw.slice(0, 200) : "n/a"
      },
      "Dexscreener renvoie 0 profil"
    );
  }

  return profiles.slice(0, limit);
}

export async function fetchLatestBoosts(limit = 25) {
  const url = `${config.dexscreenerBase}/token-boosts/latest/v1`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "snip-bot/1.0 (+github.com/)"
    }
  });

  if (!res.ok) {
    throw new Error(`Dexscreener latest boosts HTTP ${res.status}`);
  }

  const { data, contentType, raw } = await getJsonWithDebug(res, "token-boosts");
  // Même logique : parfois tableau brut, parfois { boosts: [] }
  const boosts = Array.isArray(data)
    ? data
    : Array.isArray(data.boosts)
    ? data.boosts
    : [];

  if (!boosts.length) {
    logger.warn(
      {
        status: res.status,
        info: data?.info || data?.message || "no_info",
        hint: "boosts array vide",
        contentType,
        rawSample: raw?.slice ? raw.slice(0, 200) : "n/a"
      },
      "Dexscreener renvoie 0 boost"
    );
  }

  // Convertir au format profil minimal attendu par processProfile
  return boosts
    .slice(0, limit)
    .map((b) => ({
      chainId: b.chainId || b.chain || b.network,
      tokenAddress: b.tokenAddress || b.address || b.token
    }))
    .filter((b) => b.tokenAddress);
}

export async function fetchPairsForToken(chainId, tokenAddress) {
  const query = chainId ? `?chainId=${chainId}` : "";
  const url = `${config.dexscreenerBase}/latest/dex/tokens/${tokenAddress}${query}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });

  if (!res.ok) {
    throw new Error(`Dexscreener pairs HTTP ${res.status}`);
  }

  const data = await safeJson(res);
  const pairs = Array.isArray(data.pairs) ? data.pairs : [];

  return pairs.filter((p) => p && (!chainId || p.chainId?.toLowerCase() === chainId.toLowerCase()));
}

export function selectBestPairs(pairs, take = 1) {
  if (!Array.isArray(pairs)) return [];

  const sorted = [...pairs].sort((a, b) => {
    const liqA = Number(a?.liquidity?.usd || 0);
    const liqB = Number(b?.liquidity?.usd || 0);
    if (liqA !== liqB) return liqB - liqA;

    const volA = Number(a?.volume?.h24 || 0);
    const volB = Number(b?.volume?.h24 || 0);
    if (volA !== volB) return volB - volA;

    const txA = Number(a?.txns?.m5?.buys || 0) + Number(a?.txns?.m5?.sells || 0);
    const txB = Number(b?.txns?.m5?.buys || 0) + Number(b?.txns?.m5?.sells || 0);
    return txB - txA;
  });

  return sorted.slice(0, take);
}

export function deriveLiquidityLock(pair) {
  const labels = (pair?.labels || []).map((l) => l.toLowerCase());
  if (labels.some((l) => l.includes("burn"))) {
    return { locked: true, reason: "Liquidity burned (labels)" };
  }
  if (labels.some((l) => l.includes("lock"))) {
    return { locked: true, reason: "Tag lock détecté (labels)" };
  }
  if (labels.some((l) => l.includes("unlock"))) {
    return { locked: false, reason: "Tag unlock détecté (labels)" };
  }
  if (pair?.liquidity?.isLocked !== undefined) {
    return {
      locked: Boolean(pair.liquidity.isLocked),
      reason: "Flag isLocked depuis Dexscreener"
    };
  }
  return { locked: null, reason: "Non communiqué" };
}
