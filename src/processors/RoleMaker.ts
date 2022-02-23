import { Client, Guild, NewsChannel, Permissions, Snowflake, TextChannel } from "discord.js";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const enum FooterStigma{
  GAME_ROLE = "게임 역할 받기"
}

const REGEXP_ROLE_MESSAGE = /^<@&(\d+)> 역할을 받고 싶다면/;

export const channelRoleTable = new Map<Snowflake, {
  'roleId': Snowflake,
  'messageId': Snowflake,
  'title': string
}>();
export async function processTextRoleMaker(client:Client, guild:Guild):Promise<void>{
  const roleChannel = await guild.channels.fetch(SETTINGS.roleChannel);
  if(!roleChannel?.isText()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);

  await updateChannelRoleTable(guild, roleChannel);
  client.on('messageCreate', async message => {
    if(message.channelId !== SETTINGS.roleChannel) return;
    if(message.author.bot) return;
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
    await updateChannelRoleTable(guild, roleChannel);
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
async function updateChannelRoleTable(guild:Guild, roleChannel:NewsChannel|TextChannel):Promise<void>{
  const channels = await guild.channels.fetch().then(list => (
    list.filter(v => v.parentId === SETTINGS.roleCategory && v.id !== roleChannel.id)
  ));
  const messages = await roleChannel.messages.fetch();

  channelRoleTable.clear();
  for(const v of messages.values()){
    if(!v.embeds[0]?.title) continue;
    const chunk = v.embeds[0].description?.match(REGEXP_ROLE_MESSAGE);
    if(!chunk) continue;
    const channel = channels.find(w => (
      w.permissionOverwrites.resolve(chunk[1])?.allow.has(Permissions.FLAGS.VIEW_CHANNEL) || false
    ));
    if(!channel) continue;

    channelRoleTable.set(channel.id, {
      roleId: chunk[1],
      messageId: v.id,
      title: v.embeds[0].title
    });
  }
}