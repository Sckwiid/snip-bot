import { formatNumber, formatPercent, formatUsd, pickRiskColor, shortAddress } from "./format.js";

function formatLiquidity(pair) {
  const baseSymbol = pair?.baseToken?.symbol || "BASE";
  const quoteSymbol = pair?.quoteToken?.symbol || "QUOTE";
  const usd = formatUsd(pair?.liquidity?.usd);
  const base = formatNumber(pair?.liquidity?.base);
  const quote = formatNumber(pair?.liquidity?.quote);

  return `${usd} (${base} ${baseSymbol} / ${quote} ${quoteSymbol})`;
}

function formatLockInfo(lockInfo) {
  if (!lockInfo || lockInfo.locked === null) {
    return "❔ LP lock inconnu (Dexscreener ne fournit pas cette info).\nCe statut concerne la liquidité LP, pas le lock de supply.";
  }

  if (lockInfo.locked) {
    return `🔒 LP locked\nRaison: ${lockInfo.reason || "détecté par Dexscreener"}`;
  }

  return `🔓 LP unlocked\nRaison: ${lockInfo.reason || "détecté par Dexscreener"}`;
}

function formatTaxes(hp) {
  const buy = formatPercent(hp?.taxes?.buy ?? 0);
  const sell = formatPercent(hp?.taxes?.sell ?? 0);
  const buyFail = hp?.buyFailed ? "❌" : "✅";
  const sellFail = hp?.sellFailed ? "❌" : "✅";
  return `Buy ${buy} ${buyFail} • Sell ${sell} ${sellFail}`;
}

function formatFractionAsPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "0.00%";
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatTokenSecurity(tokenSecurity) {
  if (!tokenSecurity?.supported) {
    return "Source: GoPlus non supporte sur cette chaine";
  }

  if (!tokenSecurity?.available) {
    return `Source: GoPlus indisponible (${tokenSecurity.reason || "raison inconnue"})`;
  }

  let lpLabel = "LP inconnu";
  if (tokenSecurity.lp?.status === "locked") {
    lpLabel = `LP locked (${formatFractionAsPercent(tokenSecurity.lp.lockedFraction)})`;
  } else if (tokenSecurity.lp?.status === "unlocked") {
    lpLabel = "LP unlocked";
  }

  let teamLabel = "Team lock inconnu";
  const knownTeamPercent = formatFractionAsPercent(tokenSecurity.team?.knownTeamFraction || 0);
  if (tokenSecurity.team?.status === "locked") {
    teamLabel = `Team locked (${formatFractionAsPercent(tokenSecurity.team.lockedFraction)} / exp. ${knownTeamPercent})`;
  } else if (tokenSecurity.team?.status === "partial") {
    teamLabel = `Team lock partiel (${formatFractionAsPercent(tokenSecurity.team.lockedFraction)} / exp. ${knownTeamPercent})`;
  } else if (tokenSecurity.team?.status === "unlocked") {
    teamLabel = `Team unlocked (exp. ${knownTeamPercent})`;
  }

  const supplyLabel = tokenSecurity.supply?.fixedSupply ? "Supply fixe (mint off)" : "Supply non fixe (mint on)";
  const ownerLabel = tokenSecurity.supply?.ownerRenounced
    ? "Owner renonce"
    : tokenSecurity.supply?.ownerUnknown
    ? "Owner inconnu"
    : "Owner actif";

  return `${lpLabel}\n${teamLabel}\n${supplyLabel} • ${ownerLabel}`;
}

export function buildEmbed({ profile, pair, honeypot, lockInfo, tokenSecurity, mentionRoleId }) {
  const risk = pickRiskColor(honeypot.riskScore);
  const baseSymbol = pair?.baseToken?.symbol || "BASE";
  const quoteSymbol = pair?.quoteToken?.symbol || "QUOTE";

  const descriptionParts = [
    `${risk.emoji} Risk: ${risk.label} (score ${honeypot.riskScore ?? "?"})`,
    honeypot.isHoneypot ? "⚠️ Honeypot détecté" : "✅ Honeypot.is OK",
    honeypot.reason ? `Note: ${honeypot.reason}` : null
  ].filter(Boolean);

  const fields = [
    {
      name: "Pair",
      value: `[${baseSymbol}/${quoteSymbol}](${pair?.url}) • ${pair?.dexId || "?"} • ${pair?.chainId || "?"}`
    },
    {
      name: "Prix",
      value: `${formatUsd(pair?.priceUsd)} (${pair?.priceNative || "—"} native)`
    },
    {
      name: "Liquidité",
      value: formatLiquidity(pair)
    },
    {
      name: "Lock LP",
      value: formatLockInfo(lockInfo)
    },
    {
      name: "Security (on-chain)",
      value: formatTokenSecurity(tokenSecurity)
    },
    {
      name: "Volume 24h",
      value: formatUsd(pair?.volume?.h24)
    },
    {
      name: "FDV",
      value: formatUsd(pair?.fdv)
    },
    {
      name: "Txns (5m)",
      value: `🟢 ${pair?.txns?.m5?.buys ?? 0} / 🔴 ${pair?.txns?.m5?.sells ?? 0}`
    },
    {
      name: "Taxes (honeypot.is)",
      value: formatTaxes(honeypot)
    }
  ];

  const tokenName = profile?.name || pair?.baseToken?.name || baseSymbol;
  const tokenAddress = profile?.tokenAddress || profile?.address || pair?.baseToken?.address;

  return {
    content: mentionRoleId ? `<@&${mentionRoleId}> Nouveau token détecté` : undefined,
    embeds: [
      {
        title: `${tokenName} | ${baseSymbol}/${quoteSymbol}`,
        url: pair?.url,
        color: risk.color,
        description: descriptionParts.join(" • "),
        thumbnail: {
          url:
            profile?.info?.imageUrl ||
            profile?.info?.image ||
            pair?.info?.imageUrl ||
            pair?.baseToken?.logoURI ||
            undefined
        },
        fields: [
          ...fields,
          {
            name: "Token",
            value: `${tokenName} (${baseSymbol})\n${shortAddress(tokenAddress)}`
          }
        ],
        footer: {
          text: "Filtré via honeypot.is + Dexscreener"
        }
      }
    ]
  };
}
