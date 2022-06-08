import { Client, Guild, Permissions, Snowflake, SnowflakeUtil } from "discord.js";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { RANKING_EMOJI } from "../utils/Text";
import { orderBy } from "../utils/Utility";
import { channelRoleTable } from "./RoleMaker";

type ChannelActivityData = {
  'scores': number[],
  'users': {
    [key:Snowflake]: number
  }
};
const INACTIVATION_TERM = DateUnit.MONTH;
const INCUBATOR_TERM = 6 * DateUnit.HOUR;
const SCORES_WINDOW = 12; // 최근 3일
const MIN_CONTENT_LENGTH = 4;

export async function processChannelActivityLogger(client:Client, guild:Guild):Promise<void>{
  const roleChannel = await guild.channels.fetch(SETTINGS.roleChannel);
  if(!roleChannel?.isText()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);
  const channels = (await guild.channels.fetch()).filter(v => (
    !v.permissionsFor(SETTINGS.regularRole)?.has(Permissions.FLAGS.VIEW_CHANNEL) && v.parentId === SETTINGS.roleCategory
  )).toJSON();
  const channelMessageIncubator = new Map<Snowflake, { [key:Snowflake]: number }>();
  const messageAuthorTable:{ [key:Snowflake]: Snowflake } = {};

  for(const v of channels){
    if(!v.isText()){
      continue;
    }
    const path = `res/channels/${v.id}.json`;
    const baby:{ [key:Snowflake]: number } = {};

    if(!existsSync(path)){
      await writeFile(path, JSON.stringify({
        scores: [],
        users: {}
      } as ChannelActivityData));
    }
    for(const [ l, w ] of await v.messages.fetch({ after: SnowflakeUtil.generate(Date.now() - INCUBATOR_TERM) })){
      if(w.author.bot) continue;
      baby[l] = w.createdTimestamp;
      messageAuthorTable[l] = w.author.id;
    }
    channelMessageIncubator.set(v.id, baby);
  }
  client.on('messageCreate', message => {
    if(message.author.bot) return;
    if(message.content.length < MIN_CONTENT_LENGTH) return;
    const messages = channelMessageIncubator.get(message.channelId);
    if(!messages) return;
    messages[message.id] = message.createdTimestamp;
    messageAuthorTable[message.id] = message.author.id;
  });
  client.on('messageDelete', message => {
    if(message.author?.bot) return;
    const messages = channelMessageIncubator.get(message.channelId);
    if(!messages) return;
    delete messages[message.id];
    delete messageAuthorTable[message.id];
  });
  schedule(async () => {
    const threshold = Date.now() - INCUBATOR_TERM;
    const logger = Logger.info("Activity Incubation");
    const roleChannelMessages = await roleChannel.messages.fetch();
    const grossScores:{ [key:string]: number } = {};

    // 활성도 계산
    for(const [ k, v ] of channelMessageIncubator.entries()){
      const histogram:{ [key:string]: number } = {};
      const incubatedMessages:Snowflake[] = [];

      for(const l in v){
        if(v[l] < threshold){
          incubatedMessages.push(l);
          delete v[l];
        }
      }
      if(incubatedMessages.length > 0) for(const v of incubatedMessages){
        const author = messageAuthorTable[v];
  
        histogram[author] ??= 0;
        histogram[author]++;
        delete messageAuthorTable[v];
      }
      await update(k, async w => {
        const score = getActivityScore(histogram);

        w.scores.push(score);
        while(w.scores.length > SCORES_WINDOW){
          w.scores.shift();
        }
        for(const l in histogram){
          w.users[l] = threshold;
        }
        logger.next(k).put(score);
      });
    }
    logger.out();
    // 비활성 유저 정리
    await guild.members.fetch();
    for(const k of channelMessageIncubator.keys()){
      const entity = channelRoleTable.get(k);
      if(!entity) continue;
      const role = await guild.roles.fetch(entity.roleId);
      if(!role) continue;
      const message = roleChannelMessages.get(entity.messageId);
      if(!message) continue;
      const now = Date.now();

      await update(k, async v => {
        for(const w of role.members.values()){
          v.users[w.id] ??= now;
          if(now - v.users[w.id] < INACTIVATION_TERM){
            continue;
          }
          await w.roles.remove(entity.roleId);
          message.reactions.cache.forEach(v => v.users.remove(w));
          delete v.users[w.id];
          Logger.warning("Activity Inactivation").put(w.id)
            .next("Tag").put(w.user.tag)
            .next("Title").put(entity.title)
            .out()
          ;
        }
      });
    }
    // 활성도 현황 보고
    for(const k of channelMessageIncubator.keys()){
      await update(k, async ({ scores }) => {
        grossScores[k] = getGrossActivityScore(scores);
      });
    }
    await roleChannelMessages.find(v => v.embeds[0]?.footer?.text === "활성도 랭킹")?.delete();
    await roleChannel.send({
      embeds: [{
        title: "🔥 달달소에서 요즘 뜨는 게임",
        description: Object.entries(grossScores).sort(orderBy(e => e[1], true)).filter(e => e[1] > 0).slice(0, 5).map(([ k, v ], i) => (
          `${RANKING_EMOJI[i] || (i + 1)} <#${k}>\n> ${Math.round(v).toLocaleString()}점`
        )).join('\n') || "-",
        footer: { text: "활성도 랭킹" }
      }]
    });
  }, INCUBATOR_TERM, {
    punctual: true
  });
}
function getActivityScore(histogram:{ [key:string]: number }):number{
  let R = 0;

  for(const v of Object.values(histogram)){
    R += Math.log(1 + v);
  }
  return Math.log(Object.keys(histogram).length) * R || 0;
}
function getGrossActivityScore(scores:number[]):number{
  const list = [ ...scores ].sort(orderBy(v => v));

  list.shift();
  list.pop();

  if(list.length < 1){
    return 0;
  }
  return list.reduce((pv, v) => pv + v, 0);
}
async function update(channelId:string, modifier:(v:ChannelActivityData) => Promise<void>):Promise<void>{
  const path = `res/channels/${channelId}.json`;
  const data = JSON.parse((await readFile(path, 'utf8'))) as ChannelActivityData;

  await modifier(data);
  await writeFile(path, JSON.stringify(data));
}
