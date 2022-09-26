import { Client, Colors, Guild } from "discord.js";
import { getBasePreset } from "../components/BasePreset";
import { getEmbedMessage } from "../components/EmbedMessage";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";
import { checkEmbeds } from "./ScamChecker";

export async function processMessageLogger(client:Client, guild:Guild):Promise<void>{
  const logChannel = await client.channels.fetch(SETTINGS.logChannel);
  if(!logChannel?.isTextBased()) throw Error(`Invalid logChannel: ${SETTINGS.logChannel}`);

  client.on('messageUpdate', async (before, after) => {
    if(before.author?.bot){
      return;
    }
    const data = getBasePreset("✏️ 메시지 수정", Colors.Yellow, before);

    data.embeds![0].description = `메시지 번호: ${before.id} [이동](https://discord.com/channels/${before.guildId}/${before.channelId}/${before.id})`;
    data.embeds!.push(
      await getEmbedMessage(before),
      await getEmbedMessage(after)
    );
    await logChannel.send(data);
    if(!before.embeds.length && after.embeds.length){
      await checkEmbeds(after);
    }
  });
  client.on('messageDelete', async message => {
    if(message.author?.bot){
      return;
    }
    const data = getBasePreset("🗑 메시지 삭제", Colors.Red, message);

    data.embeds![0].description = `메시지 번호: ${message.id}`;
    data.embeds!.push(
      await getEmbedMessage(message)
    );
    logChannel.send(data);
  });
  client.on('messageReactionAdd', (reaction, user) => {
    if(user.bot){
      return;
    }
    Logger.log("Reaction Add").put(user.id)
      .next("Message").put(reaction.message.url)
      .next("Emoji").put(decodeURI(reaction.emoji.identifier))
      .out()
    ;
  });
  client.on('messageReactionRemove', (reaction, user) => {
    if(user.bot){
      return;
    }
    Logger.log("Reaction Remove").put(user.id)
      .next("Message").put(reaction.message.url)
      .next("Emoji").put(decodeURI(reaction.emoji.identifier))
      .out()
    ;
  });
}