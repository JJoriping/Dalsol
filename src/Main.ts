import { Client, Intents, TextChannel } from "discord.js";
import { getBasePreset } from "./components/BasePreset";
import { getEmbedMessage } from "./components/EmbedMessage";
import CREDENTIAL from "./data/credential.json";
import SETTINGS from "./data/settings.json";
import { Logger } from "./utils/Logger";

const enum FooterStigma{
  GAME_ROLE = "게임 역할 받기"
}

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ],
  retryLimit: 3
});
async function main():Promise<void>{
  client.once('ready', async () => {
    const guild = await client.guilds.fetch(SETTINGS.guild);
    // for(const v of guild.channels.cache.toJSON()){
    //   if(v.parentId !== "904930256299888680"){
    //     continue;
    //   }
    //   if(!/^[가-힣\w-]+$/.test(v.name)){
    //     continue;
    //   }
    //   if(v.isThread()){
    //     continue;
    //   }
    //   await v.permissionOverwrites.create(guild.roles.everyone, {
    //     'VIEW_CHANNEL': false,
    //     'CREATE_PUBLIC_THREADS': false,
    //     'CREATE_PRIVATE_THREADS': false
    //   });
    // }
    // process.exit(0);
    const logChannel = await client.channels.fetch(SETTINGS.logChannel);
    const roleChannel = await client.channels.fetch(SETTINGS.roleChannel);
    if(!logChannel?.isText()) throw Error(`Invalid logChannel: ${SETTINGS.logChannel}`);
    if(!roleChannel?.isText()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);

    await roleChannel.messages.fetch();
    client.on('messageCreate', async message => {
      if(message.channelId !== SETTINGS.roleChannel){
        if(message.channel.type === "GUILD_TEXT" && message.channel.parentId === SETTINGS.roleCategory && message.author.bot){
          // 봇에게 VIEW_CHANNEL가 없다면 그 채널에선 그 봇을 사용할 수 없다.
          if(!message.channel.permissionsFor(message.author)?.has('VIEW_CHANNEL')){
            message.channel.send({
              content: message.interaction ? `<@${message.interaction.user.id}>` : undefined,
              embeds: [{
                title: "⚠ 경고",
                color: 'ORANGE',
                description: [
                  "채널 주제와 관련이 없는 봇의 사용은 지양해 주시기 바랍니다.",
                  `혹시 <@${message.author.id}> 봇이 이 채널과 관련이 있다고 생각하신다면 위성지기에게 알려 주세요.`,
                  "",
                  `> 봇의 출력: ${message.content || "*(비어 있음)*"}`
                ].join('\n')
              }]
            });
            await message.delete();
          }
        }
        return;
      }
      const chunk = message.content.match(/^생성 (.+) <@&(\d+)> ([0-9A-F]+)( [^\x00-\xFF]+| <.+>)?$/i);
      if(!chunk) return;
      const name = chunk[1];
      const color = parseInt(chunk[3], 16);
      const emoji = chunk[4]?.trim() || "✅";
      const role = await guild.roles.fetch(chunk[2]);
      if(!role) throw Error(`Invalid role: ${chunk[2]}`);
      const channel = await guild.channels.create(name, {
        type: 'GUILD_TEXT',
        parent: SETTINGS.roleCategory,
        permissionOverwrites: [
          {
            id: role.id,
            allow: [ 'VIEW_CHANNEL' ]
          }
        ]
      });
      const newMessage = await message.channel.send({
        embeds: [{
          title: name,
          color,
          description: `<@&${role.id}> 역할을 받고 싶다면 ${emoji} 하세요!`,
          footer: {
            text: FooterStigma.GAME_ROLE
          }
        }]
      });
      await newMessage.react(emoji);
      await message.delete();
      Logger.info("New Role").put(role.name)
        .next("Emoji").put(emoji)
        .next("Channel").put(channel.id)
        .out()
      ;
    });
    client.on('messageReactionAdd', async (reaction, user) => {
      if(reaction.message.channelId !== SETTINGS.roleChannel) return;
      if(user.bot) return;
      const footerText = reaction.message.embeds[0].footer?.text;
      const member = await guild.members.fetch(user.id);

      switch(footerText){
        case FooterStigma.GAME_ROLE:{
          const [ , role, emoji ] = reaction.message.embeds[0].description!.match(/^<@&(\d+)> 역할을 받고 싶다면 (.+) 하세요!$/)!;
          const id = reaction.emoji.id ? `<:${reaction.emoji.identifier}>` : reaction.emoji.name;

          if(id === emoji) await member.roles.add(role);
        } break;
      }
    });
    client.on('messageReactionRemove', async (reaction, user) => {
      if(reaction.message.channelId !== SETTINGS.roleChannel) return;
      if(user.bot) return;
      const footerText = reaction.message.embeds[0].footer?.text;
      const member = await guild.members.fetch(user.id);

      switch(footerText){
        case FooterStigma.GAME_ROLE:{
          const [ , role, emoji ] = reaction.message.embeds[0].description!.match(/^<@&(\d+)> 역할을 받고 싶다면 (.+) 하세요!$/)!;
          const id = reaction.emoji.id ? `<:${reaction.emoji.identifier}>` : reaction.emoji.name;

          if(id === emoji) await member.roles.remove(role);
        } break;
      }
    });
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