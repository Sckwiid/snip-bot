# Guide de mise en route

Un pas-à-pas concis pour démarrer le bot, pensé pour un débutant.

## 🧰 Ce qu’il te faut
- Node.js 18.18+ (`node -v` pour vérifier).
- Un bot Discord déjà créé (token récupérable dans le portail Discord Developer).
- Les IDs du channel cible et du rôle à mentionner.

## 🚀 Étapes
1) 📦 Installer les dépendances  
   ```bash
   npm install
   ```
2) 🗝️ Préparer l’environnement  
   ```bash
   cp .env.example .env
   ```
   Ouvre `.env` et remplis :
   - `DISCORD_TOKEN` : le token de ton bot.
   - `DISCORD_CHANNEL_ID` : le salon où poster les alertes (par défaut celui fourni).
   - `MENTION_ROLE_ID` : le rôle à ping (par défaut celui fourni).
   Optionnel : ajuste `POLL_INTERVAL_MS` (ms) ou `CHAINS`.

3) ✅ Donner les permissions au bot  
   - Dans Discord Developer Portal > OAuth2 > URL Generator : coche `bot`, puis les permissions “Send Messages” (+ éventuellement “Embed Links” si ta config Discord le requiert).  
   - Invite le bot avec l’URL générée.

4) ▶️ Lancer  
   ```bash
   npm start
   ```
   Tu peux aussi utiliser le mode auto-reload pendant le dev :  
   ```bash
   npm run dev
   ```

5) 👀 Vérifier que ça tourne  
   - La console doit afficher “Bot connecté à Discord”.  
   - Un message apparaîtra dans le channel cible dès qu’un token passe les checks.

## 🧪 Comment ça marche (résumé)
- Le bot interroge régulièrement Dexscreener pour récupérer les nouveaux tokens.
- Pour chaque token : choix de la paire la plus liquide, scan honeypot.is (EVM only), filtrage par score de risque.
- Si le scan passe : envoi d’un embed avec image, lien Dexscreener, liquidité, taxes, pastille de couleur, et mention du rôle.

## ⚠️ Dépannage rapide
- Rien ne s’affiche ? Vérifie `DISCORD_TOKEN` et que le bot est bien présent sur le serveur + permissions d’écriture dans le channel.
- Trop de messages ou pas assez ? Ajuste `POLL_INTERVAL_MS` et `RISK_SCORE_THRESHOLD`.
- Chaîne manquante dans honeypot.is ? Ajoute-la dans `CHAINS` seulement si elle est EVM; sinon elle sera ignorée.
