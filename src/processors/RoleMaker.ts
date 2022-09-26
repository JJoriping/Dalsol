import { ChannelType, Client, Guild, NewsChannel, PermissionFlagsBits, Snowflake, TextBasedChannel, TextChannel, VoiceChannel } from "discord.js";
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
  if(!roleChannel?.isTextBased()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);

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
    const channel = await guild.channels.create({
      type: ChannelType.GuildText,
      name,
      parent: SETTINGS.roleCategory,
      permissionOverwrites: [
        {
          id: role.id,
          allow: [ 'ViewChannel' ]
        },
        {
          id: guild.roles.everyone,
          deny: [ 'ViewChannel' ]
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
  client.on('messageCreate', async message => {
    if(message.channelId !== SETTINGS.roleChannel) return;
    if(message.author.bot) return;
    const chunk = message.content.match(/^보관 <#(\d+)>$/i);
    if(!chunk) return;
    const roleEntity = channelRoleTable.get(chunk[1]);
    if(!roleEntity) throw Error(`Invalid channel: ${chunk[1]}`);
    const channel = await guild.channels.fetch(chunk[1]);
    if(channel?.type !== ChannelType.GuildText) throw Error(`Invalid channel: ${chunk[1]}`);
    const role = await guild.roles.fetch(roleEntity.roleId);
    const roleMessage = await roleChannel.messages.fetch(roleEntity.messageId);
    
    const reason = `${message.author.tag}의 보관 명령어 사용`;
    
    await channel.setParent(SETTINGS.archivedRoleCategory, { reason });
    await role?.delete(reason);
    await roleMessage.delete();
    await message.delete();

    Logger.warning("Archived Role").put(roleEntity.title).out();
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
async function updateChannelRoleTable(guild:Guild, roleChannel:TextBasedChannel):Promise<void>{
  const channels = await guild.channels.fetch().then(list => (
    list.filter(v => v !== null && v.parentId === SETTINGS.roleCategory && v.id !== roleChannel.id)
  ));
  const messages = await roleChannel.messages.fetch();

  channelRoleTable.clear();
  for(const v of messages.values()){
    if(!v.embeds[0]?.title) continue;
    const chunk = v.embeds[0].description?.match(REGEXP_ROLE_MESSAGE);
    if(!chunk) continue;
    const channel = channels.find(w => (
      w?.permissionOverwrites.resolve(chunk[1])?.allow.has(PermissionFlagsBits.ViewChannel) || false
    ));
    if(!channel) continue;

    channelRoleTable.set(channel.id, {
      roleId: chunk[1],
      messageId: v.id,
      title: v.embeds[0].title
    });
  }
}