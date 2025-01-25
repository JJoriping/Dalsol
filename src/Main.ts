import { Client, IntentsBitField } from "discord.js";
import CREDENTIAL from "./data/credential.json";
import SETTINGS from "./data/settings.json";
import { processChannelActivityLogger } from "./processors/ChannelActivityLogger";
import { processGameEventMaker } from "./processors/GameEventMaker";
import { processMessageLogger } from "./processors/MessageLogger";
import { processTextRoleMaker } from "./processors/RoleMaker";
import { processRSSReader } from "./processors/RSSReader";
import { processScamChecker } from "./processors/ScamChecker";
import { processStatisticsMonitor } from "./processors/StatisticsMonitor";
import { CLOTHES } from "./utils/Clothes";
import { Logger } from "./utils/Logger";
import { processSpellchecker } from "./processors/Spellchecker";
import { processTTSAgent } from "./processors/TTSAgent";
import { processGPTAgent } from "./processors/GPTAgent";

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.MessageContent
  ],
  rest: {
    retries: 3
  }
});

async function main():Promise<void>{
  if(!CLOTHES.development){
    await Logger.initialize("main");
  }
  client.once('ready', async () => {
    const guild = await client.guilds.fetch(SETTINGS.guild);

    if(CLOTHES.development){
      await processGPTAgent(client, guild);
    }else{
      await processRSSReader(client, guild);
      await processScamChecker(client, guild);
      await processTextRoleMaker(client, guild);
      await processMessageLogger(client, guild);
      await processGameEventMaker(client, guild);
      await processChannelActivityLogger(client, guild);
      await processStatisticsMonitor(client, guild);
      await processSpellchecker(client, guild);
      await processTTSAgent(client, guild);
      await processGPTAgent(client, guild);
    }
    Logger.success("Discord").put(client.user?.tag).out();
  });
  client.on('debug', e => {
    if(e.startsWith("Hit a 429")){
      Logger.warning("Rate Limit").put(e).out();
    }
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