import { Client, GatewayIntentBits, Partials } from "discord.js";
import { logger } from "./logger.js";

export function createDiscordClient() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
  });

  // Discord.js v15 : l'event s'appelle "clientReady" pour éviter la confusion avec READY gateway.
  client.once("clientReady", () => {
    logger.info({ user: client.user?.tag }, "Bot connecté à Discord");
  });

  client.on("error", (err) => logger.error({ err }, "Erreur Discord client"));

  return client;
}

export async function sendToChannel(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} introuvable`);
  }
  return channel.send(payload);
}
