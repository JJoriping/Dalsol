import { Client, Intents } from "discord.js";
import CREDENTIAL from "./data/credential.json";
import SETTINGS from "./data/settings.json";
import { processChannelActivityLogger } from "./processors/ChannelActivityLogger";
import { processGameEventMaker } from "./processors/GameEventMaker";
import { processGuestInterviewer } from "./processors/GuestInterviewer";
import { processMessageLogger } from "./processors/MessageLogger";
import { processTextRoleMaker } from "./processors/RoleMaker";
import { processScamChecker } from "./processors/ScamChecker";
import { CLOTHES } from "./utils/Clothes";
import { Logger } from "./utils/Logger";

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES
  ],
  retryLimit: 3
});

async function main():Promise<void>{
  if(!CLOTHES.development){
    await Logger.initialize("main");
  }
  client.once('ready', async () => {
    const guild = await client.guilds.fetch(SETTINGS.guild);

    await processGuestInterviewer(client, guild);
    await processScamChecker(client, guild);
    await processTextRoleMaker(client, guild);
    await processMessageLogger(client, guild);
    await processGameEventMaker(client, guild);
    await processChannelActivityLogger(client, guild);

    Logger.success("Discord").put(client.user?.tag).out();
  });
  await client.login(CREDENTIAL.token);
}
main();
process.on('uncaughtException', e => {
  Logger.error("Unhandled Exception").put(e.stack).out();
});
process.on('unhandledRejection', e => {
  Logger.error("Unhandled Rejection").put(e instanceof Error ? e.stack : e).out();
});