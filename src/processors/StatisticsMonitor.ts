import { ChannelType, Client, Guild, MessageEditOptions, BaseMessageOptions, Snowflake } from "discord.js";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { RANKING_EMOJI } from "../utils/Text";
import { orderBy } from "../utils/Utility";
import { resolve } from "path";
import { existsSync, mkdirSync, appendFileSync } from "fs";

const MONITOR_TERM = 10 * DateUnit.MINUTE;
const STATISTICS_DIRECTORY = resolve("dist", "statistics");

if(!existsSync(STATISTICS_DIRECTORY)){
  mkdirSync(STATISTICS_DIRECTORY);
}
export async function processStatisticsMonitor(client:Client, guild:Guild):Promise<void>{
  const usersChannel = await guild.channels.fetch(SETTINGS.statistics.usersChannel);
  const messagesChannel = await guild.channels.fetch(SETTINGS.statistics.messagesChannel);
  const userMessageList:Array<{
    'userId': Snowflake,
    'channelId': Snowflake,
    'timestamp': number
  }> = [];
  if(usersChannel?.type !== ChannelType.GuildVoice){
    throw Error("Invalid usersChannel");
  }
  if(messagesChannel?.type !== ChannelType.GuildVoice){
    throw Error("Invalid messagesChannel");
  }
  const messagesChannelMessages = await messagesChannel.messages.fetch();
  const textChannelRankingMessage = messagesChannelMessages.find(v => v.embeds[0].footer?.text === "채널별 메시지 랭킹")
    || await messagesChannel.send(getTextChannelRankingMessagePayload())
  ;
  const textAuthorRankingMessage = messagesChannelMessages.find(v => v.embeds[0].footer?.text === "유저별 메시지 랭킹")
    || await messagesChannel.send(getTextAuthorRankingMessagePayload())
  ;
  
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    userMessageList.push({
      userId: message.author.id,
      channelId: message.channelId,
      timestamp: message.createdTimestamp
    });
  });
  schedule(async () => {
    pruneTimestampList(userMessageList);
    const logger = Logger.info("Statistics");
    const isYoung = process.uptime() < DateUnit.DAY / DateUnit.SECOND;
    const now = Date.now();

    const regularRole = await guild.roles.fetch(SETTINGS.regularRole);
    const associateRole = await guild.roles.fetch(SETTINGS.associateRole);
    const members = await guild.members.fetch({ withPresences: true });

    const regularUserCount = regularRole?.members.size;
    const associateUserCount = associateRole?.members.size;
    const userMessageCount = userMessageList.length;
    const onlineUserCount = members.reduce((pv, v) => {
      if(v.user.bot) return pv;
      if(!v.presence || v.presence.status === 'offline') return pv;
      return pv + 1;
    }, 0);

    if(regularUserCount){
      let text = `👪・${regularRole.name}・${onlineUserCount.toLocaleString()}⟋${regularUserCount.toLocaleString()}`;

      if(associateUserCount){
        text += `+${associateUserCount.toLocaleString()}`;
      }
      await usersChannel.setName(text);
      logger.next("Users").put(text);
      appendFileSync(resolve(STATISTICS_DIRECTORY, "regular-user-count.log"), `${now}\t${regularUserCount}\n`);
      appendFileSync(resolve(STATISTICS_DIRECTORY, "online-user-count.log"), `${now}\t${onlineUserCount}\n`);
    }
    {
      let text = `💬・메시지・${userMessageCount?.toLocaleString()}⟋일`;

      if(isYoung) text += " ⚠";
      await messagesChannel.setName(text).catch(e => console.error(e));
      logger.next("Messages").put(text);
      appendFileSync(resolve(STATISTICS_DIRECTORY, "user-message-count.log"), `${now}\t${userMessageCount}\n`);
    }
    await textChannelRankingMessage.edit(getTextChannelRankingMessagePayload());
    await textAuthorRankingMessage.edit(getTextAuthorRankingMessagePayload());

    logger.out();
  }, MONITOR_TERM, {
    punctual: true,
    punctualOffset: 30 * DateUnit.SECOND,
    callAtStart: CLOTHES.development
  });

  function pruneTimestampList(list:typeof userMessageList):void{
    const threshold = Date.now() - DateUnit.DAY;
    
    for(let i = 0; i < list.length; i++){
      if(list[i].timestamp < threshold){
        continue;
      }
      list.splice(0, i);
      break;
    }
  }
  function getTextChannelRankingMessagePayload():BaseMessageOptions&MessageEditOptions{
    return {
      embeds: [{
        title: " 채널별 최근 24시간 메시지 수",
        description: Object.entries(userMessageList.reduce<Record<Snowflake, number>>((pv, { channelId }) => {
          pv[channelId] = (pv[channelId] || 0) + 1;
          return pv;
        }, {})).sort(orderBy(e => e[1], true)).slice(0, 20).map(([ k, v ], i) => (
          `${RANKING_EMOJI[i] || (i + 1)} <#${k}>\n> ${v.toLocaleString()}개`
        )).join('\n') || "-",
        footer: { text: "채널별 메시지 랭킹" }
      }]
    };
  }
  function getTextAuthorRankingMessagePayload():BaseMessageOptions&MessageEditOptions{
    return {
      embeds: [{
        title: "🤗 유저별 최근 24시간 메시지 수",
        description: Object.entries(userMessageList.reduce<Record<Snowflake, number>>((pv, { userId }) => {
          pv[userId] = (pv[userId] || 0) + 1;
          return pv;
        }, {})).sort(orderBy(e => e[1], true)).slice(0, 20).map(([ k, v ], i) => (
          `${RANKING_EMOJI[i] || (i + 1)} <@${k}>\n> ${v.toLocaleString()}개`
        )).join('\n') || "-",
        footer: { text: "유저별 메시지 랭킹" }
      }]
    };
  }
}