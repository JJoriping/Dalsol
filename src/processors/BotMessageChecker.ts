import { Client, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";

export async function processBotMessageChecker(client:Client, guild:Guild):Promise<void>{
  const webhooks = await guild.fetchWebhooks();

  client.on('messageCreate', async message => {
    if(message.channelId === SETTINGS.roleChannel){
      return;
    }
    if(message.channel.type === "GUILD_TEXT"
      && message.channel.parentId === SETTINGS.roleCategory
      && message.author.bot
      && !webhooks.has(message.webhookId || "")
    ){
      // NOTE 봇에게 VIEW_CHANNEL가 없다면 그 채널에선 그 봇을 사용할 수 없다.
      if(!message.channel.permissionsFor(message.author)?.has('VIEW_CHANNEL')){
        message.channel.send({
          content: message.interaction ? `<@${message.interaction.user.id}>` : undefined,
          embeds: [{
            title: "⚠ 경고",
            color: 'ORANGE',
            description: [
              "채널 주제와 관련이 없는 봇의 사용은 지양해 주시기 바랍니다.",
              `혹시 <@${message.author.id}> 봇이 이 채널과 관련이 있다고 생각하신다면 관리자에게 알려 주세요.`,
              "",
              `> 봇의 출력: ${message.content || "*(비어 있음)*"}`
            ].join('\n')
          }]
        });
        await message.delete();
      }
    }
  });
}