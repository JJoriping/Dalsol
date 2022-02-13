import { Client, Guild, Message, PartialMessage } from "discord.js";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const SCAM_WHITELISTS = [
  /https?:\/\/(\w+\.)?discord\.(com|gift)/,
  /https?:\/\/(\w+\.)?youtube\.com/,
  /https?:\/\/youtu\.be/,
  /https?:\/\/(\w+\.)?epicgames\.com/
];
const SCAM_TABLE = {
  '$korean': -4,
  '$image': 1,
  'gift': 3,
  'nitro': 6,
  'free': 2,
  'discord': 2,
  'month': 1
};
const SCAM_THRESHOLD = 10;

export async function processScamChecker(client:Client, guild:Guild):Promise<void>{
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    if(!message.embeds.length){
      return;
    }
    await checkEmbeds(message);
  });
}
export async function checkEmbeds(message:Message|PartialMessage):Promise<void>{
  const contents = [
    message.content,
    ...message.embeds.map(v => `${v.title}\n${v.description}`)
  ].join('\n\n').toLowerCase();
  for(const v of SCAM_WHITELISTS){
    if(v.test(contents)){
      return;
    }
  }
  let score = 0;

  for(const [ k, v ] of Object.entries(SCAM_TABLE)){
    let matched = false;

    if(k[0] === "$"){
      switch(k){
        case "$image": matched = Boolean(message.embeds.find(w => w.image)); break;
        case "$korean": matched = /[가-힣]/.test(contents); break;
      }
    }else matched = contents.includes(k);
    if(!matched){
      continue;
    }
    score += v;
  }
  if(score < SCAM_THRESHOLD) return;
  Logger.warning("Scam").put(message.author?.id)
    .next("Contents").put(contents)
    .next("Score").put(score)
    .out()
  ;
  await message.member?.timeout(SETTINGS.scamTimeout, `금지된 내용: ${contents}`);
  await message.reply({
    embeds: [{
      title: "⚠ 경고",
      color: 'ORANGE',
      description: "금지된 내용 입력이 감지되어 자동 타임아웃 처리되었습니다.",
      footer: {
        text: "혹시나 잘못 처리되었다고 생각하시면 관리자에게 문의해 주세요."
      }
    }]
  });
  await message.delete();
}