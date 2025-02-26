import { Chart, Plugin } from "chart.js";
import { ChannelType, Client, Guild, MessageCreateOptions, MessageEditOptions, Snowflake } from "discord.js";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { RANKING_EMOJI } from "../utils/Text";
import { orderBy, reduceToTable } from "../utils/Utility";
const { Context } = require("pureimage");
Context.prototype.resetTransform = function(){};
Context.prototype.setLineDash = function(){};
Object.defineProperty(Context.prototype, "font", {
  // NOTE I don't know why.
  set() {},
});

const MONITOR_TERM = 10 * DateUnit.MINUTE;
const STATISTICS_DIRECTORY = resolve("dist", "statistics");
const whiteBackground:Plugin = {
  id: 'whiteBackground',
  beforeDraw: (chart, args, options) => {
    const {ctx} = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = (options.color || '#ffffff') as string;
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  }
};

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
  if(usersChannel?.type !== ChannelType.GuildAnnouncement){
    throw Error("Invalid usersChannel");
  }
  if(messagesChannel?.type !== ChannelType.GuildVoice){
    throw Error("Invalid messagesChannel");
  }
  const usersChannelMessages = await usersChannel.messages.fetch();
  const userCountChart7Message = usersChannelMessages.find(v => v.embeds[0].footer?.text === "여행자 수 추이 (7일)")
    || await usersChannel.send(await getUserCountChartMessagePayload("7d"))
  ;
  const userCountChart90Message = usersChannelMessages.find(v => v.embeds[0].footer?.text === "여행자 수 추이 (90일)")
    || await usersChannel.send(await getUserCountChartMessagePayload("90d"))
  ;
  const userCountChart365Message = usersChannelMessages.find(v => v.embeds[0].footer?.text === "여행자 수 추이 (1년)")
    || await usersChannel.send(await getUserCountChartMessagePayload("1y"))
  ;

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

    const members = await guild.members.fetch({ withPresences: true });

    const userMessageCount = userMessageList.length;
    const userCount = members.filter(v => !v.user.bot).size;
    const onlineUserCount = members.reduce((pv, v) => {
      if(v.user.bot) return pv;
      if(!v.presence || v.presence.status === 'offline') return pv;
      return pv + 1;
    }, 0);

    {
      let text = `👪・여행자・${onlineUserCount.toLocaleString()}⟋${userCount.toLocaleString()}`;

      if(!CLOTHES.development) await usersChannel.setName(text);
      logger.next("Users").put(text);
      appendFileSync(resolve(STATISTICS_DIRECTORY, "user-count.log"), `${now}\t${userCount}\n`);
      appendFileSync(resolve(STATISTICS_DIRECTORY, "online-user-count.log"), `${now}\t${onlineUserCount}\n`);
      
      await userCountChart7Message.edit(await getUserCountChartMessagePayload("7d"));
      await userCountChart90Message.edit(await getUserCountChartMessagePayload("90d"));
      await userCountChart365Message.edit(await getUserCountChartMessagePayload("1y"));
    }
    if(!CLOTHES.development){
      {
        let text = `💬・메시지・${userMessageCount?.toLocaleString()}⟋일`;
  
        if(isYoung) text += " ⚠";
        await messagesChannel.setName(text).catch(e => console.error(e));
        logger.next("Messages").put(text);
        appendFileSync(resolve(STATISTICS_DIRECTORY, "user-message-count.log"), `${now}\t${userMessageCount}\n`);
      }
      await textChannelRankingMessage.edit(getTextChannelRankingMessagePayload());
      await textAuthorRankingMessage.edit(getTextAuthorRankingMessagePayload());
    }

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
  async function getUserCountChartMessagePayload(type:"7d"|"90d"|"1y"):Promise<MessageCreateOptions&MessageEditOptions>{
    const { make, encodePNGToStream, registerFont } = await import("pureimage");
    const fileName = `${Date.now()}.png`;
    const canvas = make(800, 600);
    const step = type === "7d" ? DateUnit.HOUR : DateUnit.DAY;
    const timeSlices = type === "7d"
      ? getTimeSlices(DateUnit.WEEK, step)
      : type === "90d"
      ? getTimeSlices(90 * DateUnit.DAY, step)
      : getTimeSlices(DateUnit.YEAR, step)
    ;
    const font = registerFont(resolve("res", "ChartFont.ttf"), "ChartFont");

    await font.load();
    Chart.defaults.font.family = `'${font.family}'`;
    new Chart(canvas as any, {
      type: "line",
      data: {
        labels: timeSlices.map(v => new Date(v).toLocaleString("ko-KR")),
        datasets: [
          {
            label: "활성 여행자",
            data: resolveData("online-user-count.log", timeSlices, step),
            borderColor: "#0cab46",
            borderWidth: 3,
            backgroundColor: "#6cf59e",
            fill: true
          },
          {
            label: "여행자",
            data: resolveData("user-count.log", timeSlices, step),
            borderColor: "#1b33bf",
            borderWidth: 3,
            backgroundColor: "#4060e377",
            fill: true
          }
        ]
      },
      options: {
        scales: {
          x: {
            ticks: {
              autoSkipPadding: 8
            }
          }
        }
      },
      plugins: [ whiteBackground ]
    });
    await encodePNGToStream(canvas, createWriteStream(fileName));
    const buffer = readFileSync(fileName);
    unlinkSync(fileName);

    return {
      embeds: [{
        footer: { text: `여행자 수 추이 (${type === "7d" ? "7일" : type === "90d" ? "90일" : "1년"})` }
      }],
      files: [
        { attachment: buffer }
      ]
    };
  }
  function getTextChannelRankingMessagePayload():MessageCreateOptions&MessageEditOptions{
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
  function getTextAuthorRankingMessagePayload():MessageCreateOptions&MessageEditOptions{
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
function resolveData(path:string, timeSlices:number[], step:number):Array<number|undefined>{
  const R:Array<number|undefined> = [];
  const timeSliceTable = reduceToTable(timeSlices, (_, i) => i, v => v / step);
  const chunk = readFileSync(resolve(STATISTICS_DIRECTORY, path)).toString().split('\n');

  for(const v of chunk){
    const [ key, value ] = v.split('\t');
    const actualKey = Math.floor(parseInt(key) / step);

    if(actualKey in timeSliceTable){
      R[timeSliceTable[actualKey]] = parseInt(value);
    }
  }
  return R;
}
function getTimeSlices(length:number, step:number):number[]{
  const to = Math.floor(Date.now() / step) * step;
  const from = to - Math.floor(length / step) * step;
  const R:number[] = [];

  for(let i = from; i <= to; i += step){
    R.push(i);
  }
  return R;
}