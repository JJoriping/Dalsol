import { Client, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const enum FooterStigma{
  GAME_ROLE = "게임 역할 받기"
}

export async function processTextRoleMaker(client:Client, guild:Guild):Promise<void>{
  const roleChannel = await client.channels.fetch(SETTINGS.roleChannel);
  if(!roleChannel?.isText()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);
  await roleChannel.messages.fetch();

  client.on('messageCreate', async message => {
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
}
export async function processVoiceRoleMaker(client:Client, guild:Guild):Promise<void>{
  client.on('voiceStateUpdate', async (before, after) => {
    if(before.channelId === after.channelId){
      return;
    }
    Logger.info("Voice State").put(after.member?.id)
      .next("Before").put(before.channelId)
      .next("After").put(after.channelId)
      .out()
    ;
    if(before.channelId && !after.channelId){
      await after.member?.roles.remove(SETTINGS.voiceChannelParticipantRole, "음성 채널 퇴장");
    }else if(!before.channelId && after.channelId){
      await after.member?.roles.add(SETTINGS.voiceChannelParticipantRole, "음성 채널 입장");
    }
  });
}