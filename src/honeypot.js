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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractRiskScore(payload) {
  if (!payload) return 100;
  if (typeof payload.riskLevel === "number") return payload.riskLevel;
  if (typeof payload.riskScore === "number") return payload.riskScore;
  if (payload.summary?.riskLevel !== undefined) return Number(payload.summary.riskLevel);
  if (payload.simulationResult?.riskLevel !== undefined) return Number(payload.simulationResult.riskLevel);
  return payload.summary?.isHoneypot ? 100 : 50;
}

function extractBooleanFlag(payload, path) {
  return path.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), payload);
}

function normalizeTaxes(payload) {
  const sim = payload.simulationResult || payload.honeypotResult || {};
  const taxes = sim.taxes || sim;
  return {
    buy: Number(taxes.buyTax ?? taxes.buy ?? sim.buyFee ?? payload.summary?.buyTax ?? 0),
    sell: Number(taxes.sellTax ?? taxes.sell ?? sim.sellFee ?? payload.summary?.sellTax ?? 0)
  };
}

function normalizeHoneypot(payload) {
  const riskScore = extractRiskScore(payload);
  const isHoneypot =
    payload.summary?.isHoneypot ??
    payload.isHoneypot ??
    payload.result?.isHoneypot ??
    extractBooleanFlag(payload, "simulationResult.isHoneypot") ??
    false;

  const sim = payload.simulationResult || payload.result || {};
  const buyFailed = Boolean(sim.buyFailed || sim.buyError);
  const sellFailed = Boolean(sim.sellFailed || sim.sellError);

  const taxes = normalizeTaxes(payload);

  return {
    supported: true,
    ok: !isHoneypot && !buyFailed && !sellFailed,
    isHoneypot,
    riskScore,
    taxes,
    buyFailed,
    sellFailed,
    flags: payload.flags || [],
    raw: payload
  };
}

export async function runHoneypotCheck(chainId, tokenAddress, pairAddress) {
  const numericChain = normalizeChainId(chainId);
  if (!numericChain) {
    return { supported: false, reason: "Chain non supportée par honeypot.is" };
  }

  const url = new URL(`${config.honeypotBase}/v2/IsHoneypot`);
  url.searchParams.set("address", tokenAddress);
  url.searchParams.set("chainID", numericChain);
  if (pairAddress) url.searchParams.set("pair", pairAddress);

  const retries = Math.max(0, Number(config.fetchRetries || 2));
  const baseDelayMs = Math.max(100, Number(config.fetchRetryBaseMs || 700));

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        logger.warn({ status: res.status }, "Honeypot.is HTTP non OK");
        return { supported: true, ok: false, isHoneypot: true, riskScore: 100, reason: `HTTP ${res.status}` };
      }
      const payload = await res.json();
      return normalizeHoneypot(payload);
    } catch (error) {
      if (attempt > retries) {
        logger.error({ err: error, errorSummary: describeFetchError(error) }, "Erreur appel Honeypot.is");
        return {
          supported: true,
          ok: false,
          isHoneypot: true,
          riskScore: 100,
          reason: `Exception réseau: ${describeFetchError(error)}`
        };
      }

      const delayMs = baseDelayMs * attempt;
      logger.warn(
        { attempt, retries, delayMs, err: error, errorSummary: describeFetchError(error) },
        "Honeypot.is temporairement indisponible, retry"
      );
      await wait(delayMs);
    }
  }

  return { supported: true, ok: false, isHoneypot: true, riskScore: 100, reason: "Exception réseau" };
}
