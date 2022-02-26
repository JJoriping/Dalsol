import { Client, Guild, Permissions, Snowflake } from "discord.js";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { channelRoleTable } from "./RoleMaker";

type ChannelActivityData = {
  'scores': number[],
  'users': {
    [key:Snowflake]: number
  }
};
const INACTIVATION_TERM = DateUnit.MONTH;
const INCUBATOR_TERM = CLOTHES.development ? DateUnit.MINUTE : 6 * DateUnit.HOUR;
const SCORES_WINDOW = 28; // 최근 7일

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

    if(!existsSync(path)){
      await writeFile(path, JSON.stringify({
        scores: [],
        users: {}
      } as ChannelActivityData));
    }
    channelMessageIncubator.set(v.id, {});
  }
  client.on('messageCreate', message => {
    if(message.author.bot) return;
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
    const histogram:{ [key:string]: number } = {};
    const logger = Logger.info("Activity Incubation");

    // 활성도 계산
    for(const [ k, v ] of channelMessageIncubator.entries()){
      const incubatedMessages:Snowflake[] = [];

      for(const l in v){
        if(v[l] < threshold){
          incubatedMessages.push(l);
          delete v[l];
        }
      }
      if(incubatedMessages.length < 1) continue;
      for(const v of incubatedMessages){
        const author = messageAuthorTable[v];
  
        histogram[author] ??= 0;
        histogram[author]++;
        delete messageAuthorTable[v];
      }
      await update(k, async w => {
        const score = getActivityScore(histogram);

        if(w.scores.push(score) > SCORES_WINDOW){
          w.scores.shift();
        }
        for(const l in histogram){
          w.users[l] = threshold;
        }
        logger.next(k).put(score);
      });
    }
    // 비활성 유저 정리
    await guild.members.fetch();
    for(const k of channelMessageIncubator.keys()){
      const entity = channelRoleTable.get(k);
      if(!entity) continue;
      const role = await guild.roles.fetch(entity.roleId);
      if(!role) continue;
      const message = await roleChannel.messages.fetch(entity.messageId);
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
    logger.out();
  }, INCUBATOR_TERM, {
    punctual: true
  });
}
function getActivityScore(histogram:{ [key:string]: number }):number{
  let R = 0;

  for(const v of Object.values(histogram)){
    R += Math.log(1 + v);
  }
  return Math.log(Object.keys(histogram).length) * R;
}
async function update(channelId:string, modifier:(v:ChannelActivityData) => Promise<void>):Promise<void>{
  const path = `res/channels/${channelId}.json`;
  const data = JSON.parse((await readFile(path, 'utf8'))) as ChannelActivityData;

  await modifier(data);
  await writeFile(path, JSON.stringify(data));
}