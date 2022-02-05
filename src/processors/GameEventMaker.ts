import SETTINGS from "../data/settings.json";
import { Client, Guild } from "discord.js";
import { DateUnit } from "../enums/DateUnit";
import { channelRoleTable } from "./RoleMaker";
import { Logger } from "../utils/Logger";

const REGEXP_DATE_RELATIVE = /^(\d+)\s*(초|분|시간)\s*(?:후|뒤)에?$/;
const REGEXP_DATE_ABSOLUTE = /^(오전|오후)?\s*(\d+)시\s*(반|\d+분)?$/;
const REGEXP_DATE_FIXED = /^(\d?\d):(\d\d)$/;

export async function processGameEventMaker(client:Client, guild:Guild):Promise<void>{
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    if(message.channel.type !== 'GUILD_TEXT'){
      return;
    }
    if(message.channel.parentId !== SETTINGS.roleCategory){
      return;
    }
    if(!message.stickers.has(SETTINGS.gameEventSticker)){ // 부스트 1단계 이상이어야 한다.
      return;
    }
    const roleEntity = channelRoleTable.get(message.channelId);
    if(!roleEntity){
      return;
    }
    const question = await message.reply({
      embeds: [{
        title: "🎮 게임 이벤트 만들기 (1/2)",
        color: 'YELLOW',
        description: [
          "게임을 언제 하실 예정이신가요?",
          "아래 양식을 참고해서 이 메시지에 **답장**해 주세요!",
          "(5분이 지나거나 `취소`를 입력하면 취소됩니다.)",
          "> `지금`, `바로`",
          "> `30분 뒤`, `1시간 후`",
          "> `1시 반`, `09:45`, `오후 12시 34분`"
        ].join('\n'),
        footer: { text: roleEntity.title }
      }]
    });
    let startDate:Date;
    let voiceChannelId:string|undefined;
    let description = "";

    // 시작 일시 정하기
    while(true){
      const answer = await message.channel.awaitMessages({
        filter: v => {
          if(v.author.id !== message.author.id) return false;
          if(v.content === "취소") return true;
          return v.reference?.messageId === question.id;
        },
        time: 5 * DateUnit.MINUTE,
        max: 1
      }).then(list => list.last());
      if(!answer || answer.content === "취소"){
        await question.delete();
        await answer?.delete();
        return;
      }
      const R = parseDate(answer.content.trim());
      if(R === null){
        await answer.reply("다시 시도해 주세요!");
        await answer.delete();
        continue;
      }
      startDate = R;
      await answer.delete();
      break;
    }
    // 이벤트 검토하고 설명하기
    while(true){
      await question.edit({
        embeds: [{
          title: "🎮 게임 이벤트 만들기 (2/2)",
          color: 'YELLOW',
          description: [
            "아래 내용으로 이벤트를 만들 예정이에요.",
            "> - 아무 내용으로 답장해서 이벤트에 설명을 추가할 수 있어요.",
            "> - 음성 채널을 멘션해서 이벤트에 음성 채널을 연결할 수 있어요.",
            "> - `확인`으로 답장하면 이벤트가 만들어져요.",
            "> - 5분이 지나거나 `취소`를 입력하면 이벤트 만들기를 그만둬요.",
            "",
            "🗓️ __이벤트 정보__",
            `> 게임: **${roleEntity.title}**`,
            `> 일시: **${startDate.toLocaleString()}**`,
            `> 장소: ${voiceChannelId ? `<#${voiceChannelId}>` : "*(없음)*"}`,
            "📝 __이벤트 설명__",
            description ? `\`\`\`plain\n${description.replace(/`/g, "｀")}\`\`\`` : "*(없음)*"
          ].join('\n'),
          footer: { text: roleEntity.title }
        }]
      });
      const answer = await message.channel.awaitMessages({
        filter: v => {
          if(v.author.id !== message.author.id) return false;
          if(v.content === "취소") return true;
          return v.reference?.messageId === question.id;
        },
        time: 5 * DateUnit.MINUTE,
        max: 1
      }).then(list => list.last());
      if(!answer || answer.content === "취소"){
        await question.delete();
        await answer?.delete();
        return;
      }
      if(answer.content === "확인"){
        await answer.delete();
        break;
      }
      const voiceChannel = answer.mentions.channels.last();
      if(voiceChannel && voiceChannel.isVoice()){
        voiceChannelId = voiceChannel.id;
      }else{
        description = answer.content;
      }
      await answer.delete();
    }
    const event = await guild.scheduledEvents.create({
      name: `${message.author.username} 님의 ${roleEntity.title}`,
      scheduledStartTime: startDate,
      scheduledEndTime: voiceChannelId ? undefined : new Date(startDate.getTime() + DateUnit.HOUR),
      privacyLevel: "GUILD_ONLY",
      entityType: voiceChannelId ? "VOICE" : "EXTERNAL",
      description,
      channel: voiceChannelId,
      entityMetadata: voiceChannelId ? undefined : { location: message.url },
      reason: "게임 이벤트 만들기 기능 이용"
    });
    await question.reply({
      content: `<@&${roleEntity.roleId}>\n${event.url}`,
      embeds: [{
        title: "🎮 게임 이벤트 만들기",
        color: 'YELLOW',
        description: `<@${message.author.id}> 님이 이벤트를 만들었어요!`
      }]
    });
    await question.delete();
    Logger.info("Game Event").put(message.author.id)
      .next("Channel").put(message.channelId)
      .next("Start Date").put(startDate.getTime())
      .next("Description").put(description)
      .out()
    ;
  });
}
function parseDate(text:string):Date|null{
  if(text === "지금" || text === "바로"){
    return new Date();
  }
  const now = Date.now();
  let chunk:RegExpMatchArray|null;

  if(chunk = text.match(REGEXP_DATE_RELATIVE)){
    const value = parseInt(chunk[1]);
    const unit = chunk[2] === "초"
      ? DateUnit.SECOND
      : chunk[2] === "분"
      ? DateUnit.MINUTE
      : DateUnit.HOUR
    ;
    return new Date(now + value * unit);
  }
  if(chunk = text.match(REGEXP_DATE_ABSOLUTE)){
    const noon = chunk[1] === "오후" ? 12 : 0;
    const hour = parseInt(chunk[2]);
    const minute = chunk[3] === "반"
      ? 30
      : chunk[3]
      ? parseInt(chunk[3].slice(0, chunk[3].length - 1))
      : 0
    ;
    const R = new Date();

    R.setHours(noon + hour, minute, 0, 0);
    while(R.getTime() < now){
      R.setTime(R.getTime() + 12 * DateUnit.HOUR);
    }
    return R;
  }
  if(chunk = text.match(REGEXP_DATE_FIXED)){
    const hour = parseInt(chunk[1]);
    const minute = parseInt(chunk[2]);
    const R = new Date();

    R.setHours(hour, minute, 0, 0);
    while(R.getTime() < now){
      R.setTime(R.getTime() + 12 * DateUnit.HOUR);
    }
  }
  return null;
}