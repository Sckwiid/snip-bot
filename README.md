# snip-bot

Bot Discord (Node.js) qui surveille les nouveaux tokens listés sur Dexscreener, exécute un scan honeypot/scam via honeypot.is, et publie dans un channel dédié uniquement les paires qui passent les contrôles.

## Fonctionnalités
- ⏱️ Poll Dexscreener toutes les `POLL_INTERVAL_MS` pour les dernières créations de tokens.
- 🛡️ Scan honeypot/scam temps réel (honeypot.is v2) avec filtrage par score de risque.
- 🧠 Sélection automatique de la paire la plus liquide pour chaque token.
- 🟢 Pastille couleur + check ✅/❌ pour afficher l’état des scans.
- 🖼️ Image du token, lien Dexscreener, volume/liquidité/FDV, taxes buy/sell, mention d’un rôle.

## Prérequis
- Node.js 18.18+.
- Un bot Discord avec le scope `bot` et l’autorisation d’écrire dans le channel cible.
- IDs : channel cible (`DISCORD_CHANNEL_ID`) et rôle à mentionner (`MENTION_ROLE_ID`).

## Démarrage rapide
1) Clone le repo et installe les dépendances :
   ```bash
   npm install
   ```
2) Copie le modèle d’environnement :
   ```bash
   cp .env.example .env
   ```
3) Renseigne au minimum `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, `MENTION_ROLE_ID`.
4) Lance le bot :
   ```bash
   npm start
   ```

## Variables d’environnement clés
- `DISCORD_TOKEN` : token du bot.
- `DISCORD_CHANNEL_ID` : channel où publier (par défaut `1466419634633969696`).
- `MENTION_ROLE_ID` : rôle mentionné à chaque alerte (par défaut `1466422195088654470`).
- `POLL_INTERVAL_MS` : périodicité de poll Dexscreener (45s par défaut).
- `RISK_SCORE_THRESHOLD` : score max accepté (0–100), 60 par défaut.
- `CHAINS` : listes des chaînes surveillées, séparées par des virgules.

## Architecture rapide
- `src/index.js` : bootstrap + boucle de poll.
- `src/dexscreener.js` : appels API Dexscreener et sélection de la meilleure paire.
- `src/honeypot.js` : requête honeypot.is + normalisation du score de risque.
- `src/messageFormatter.js` : construction de l’embed Discord (image, pastille, champs).
- `src/discordClient.js` : client Discord et envoi dans le channel cible.
- `src/format.js` : helpers de formatage (USD, pourcentages, couleurs).

## Limites & notes
- Les scans honeypot.is ne couvrent que les chaînes EVM. Les autres chaînes sont ignorées.
- L’état “liquidity locked” dépend des labels Dexscreener : si absent, l’info reste “?”.
- Le bot conserve un cache mémoire (~500 tokens) pour éviter les doublons entre polls.

## Licence
MIT.
# snip-bot
