import { Client, Guild } from "discord.js";
import { getBasePreset } from "../components/BasePreset";
import { getEmbedMessage } from "../components/EmbedMessage";
import SETTINGS from "../data/settings.json";

export async function processMessageLogger(client:Client, guild:Guild):Promise<void>{
  const logChannel = await client.channels.fetch(SETTINGS.logChannel);
  if(!logChannel?.isText()) throw Error(`Invalid logChannel: ${SETTINGS.logChannel}`);

  client.on('messageUpdate', async (before, after) => {
    if(before.author?.bot){
      return;
    }
    const data = getBasePreset("✏️ 메시지 수정", 'YELLOW', before);

    data.embeds![0].description = `메시지 번호: ${before.id} [이동](https://discord.com/channels/${before.guildId}/${before.channelId}/${before.id})`;
    data.embeds!.push(
      await getEmbedMessage(before),
      await getEmbedMessage(after)
    );
    logChannel.send(data);
  });
  client.on('messageDelete', async message => {
    if(message.author?.bot){
      return;
    }
    const data = getBasePreset("🗑 메시지 삭제", 'RED', message);

    data.embeds![0].description = `메시지 번호: ${message.id}`;
    data.embeds!.push(
      await getEmbedMessage(message)
    );
    logChannel.send(data);
  });
}