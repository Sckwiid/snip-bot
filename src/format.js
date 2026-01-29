const USD_INTL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const NUM_INTL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return USD_INTL.format(value);
}

export function formatNumber(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits });
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return fmt.format(value);
  if (value >= 1) return fmt.format(value);
  return value.toPrecision(3);
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function shortAddress(address, visible = 4) {
  if (!address) return "—";
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
}

export function pickRiskColor(riskScore) {
  if (riskScore >= 80) return { color: 0xe74c3c, emoji: "🔴", label: "High" };
  if (riskScore >= 60) return { color: 0xf1c40f, emoji: "🟠", label: "Medium" };
  return { color: 0x2ecc71, emoji: "🟢", label: "Low" };
}
