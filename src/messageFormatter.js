import { formatNumber, formatPercent, formatUsd, pickRiskColor, shortAddress } from "./format.js";

function formatLiquidity(pair, lockInfo) {
  const baseSymbol = pair?.baseToken?.symbol || "BASE";
  const quoteSymbol = pair?.quoteToken?.symbol || "QUOTE";
  const usd = formatUsd(pair?.liquidity?.usd);
  const base = formatNumber(pair?.liquidity?.base);
  const quote = formatNumber(pair?.liquidity?.quote);
  const lockStatus =
    lockInfo.locked === null
      ? "🔒 ?"
      : lockInfo.locked
      ? "🔒 Locked"
      : "🔓 Unlocked";

  return `${usd} (${base} ${baseSymbol} / ${quote} ${quoteSymbol}) • ${lockStatus}`;
}

function formatTaxes(hp) {
  const buy = formatPercent(hp?.taxes?.buy ?? 0);
  const sell = formatPercent(hp?.taxes?.sell ?? 0);
  const buyFail = hp?.buyFailed ? "❌" : "✅";
  const sellFail = hp?.sellFailed ? "❌" : "✅";
  return `Buy ${buy} ${buyFail} • Sell ${sell} ${sellFail}`;
}

export function buildEmbed({ profile, pair, honeypot, lockInfo, mentionRoleId }) {
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
      value: formatLiquidity(pair, lockInfo)
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
