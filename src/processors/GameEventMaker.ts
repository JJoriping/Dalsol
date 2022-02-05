import SETTINGS from "../data/settings.json";
import { Client, Guild, GuildScheduledEvent } from "discord.js";
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
    if(await getScheduledEvent(guild, message.author.username, 'SCHEDULED')){
      await message.reply("이미 등록한 이벤트가 있어요.");
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
    let useRoleMention = true;
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
            "> - 아무 내용으로 답장하면 이벤트에 설명을 추가할 수 있어요.",
            "> - 음성 채널을 멘션해 답장하면 이벤트에 음성 채널을 연결할 수 있어요.",
            "> - `확인`으로 답장: 이벤트가 만들어져요.",
            `> - \`멘션\`으로 답장: 이벤트를 생성할 때 <@&${roleEntity.roleId}> 역할을 멘션할지를 결정해요.`,
            "> - 5분이 지나거나 `취소`를 입력하면 이벤트 만들기를 그만둬요.",
            "",
            "🗓️ __이벤트 정보__",
            `> 게임: **${roleEntity.title}**`,
            `> 일시: **${startDate.toLocaleString()}**`,
            `> 장소: ${voiceChannelId ? `<#${voiceChannelId}>` : "*(없음)*"}`,
            `> 멘션: ${useRoleMention ? `<@&${roleEntity.roleId}> 역할을 멘션하면서 이벤트 생성` : "멘션하지 않고 이벤트 생성"}`,
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
      if(answer.content === "멘션"){
        useRoleMention = !useRoleMention;
      }else{
        const voiceChannel = answer.mentions.channels.last();
        if(voiceChannel && voiceChannel.isVoice() && voiceChannel.guildId === message.guildId){
          voiceChannelId = voiceChannel.id;
        }else{
          description = answer.content;
        }
      }
      await answer.delete();
    }
    if(startDate.getTime() - Date.now() < DateUnit.MINUTE){
      startDate = new Date(Date.now() + 3 * DateUnit.MINUTE);
    }
    const event = await guild.scheduledEvents.create({
      name: `${message.author.username} 님의 ${roleEntity.title}`,
      scheduledStartTime: startDate,
      scheduledEndTime: new Date(startDate.getTime() + DateUnit.HOUR),
      privacyLevel: "GUILD_ONLY",
      entityType: voiceChannelId ? "VOICE" : "EXTERNAL",
      description,
      channel: voiceChannelId,
      entityMetadata: voiceChannelId ? undefined : { location: message.url },
      reason: "게임 이벤트 만들기 기능 이용"
    });
    const inviteURL = await event.createInviteURL({
      maxAge: DateUnit.WEEK / DateUnit.SECOND,
      unique: true,
      channel: voiceChannelId ? undefined : SETTINGS.guestWelcomeChannel
    });
    await question.reply({
      content: useRoleMention ? `<@&${roleEntity.roleId}>\n${inviteURL}` : inviteURL,
      embeds: [{
        title: "🎮 게임 이벤트 만들기",
        color: 'YELLOW',
        description: [
          `<@${message.author.id}> 님이 이벤트를 만들었어요!`,
          "> 이벤트는 시작한지 1시간 뒤 자동으로 완료돼요. 그 전에 이 메시지에 `연장`으로 답장하면 1일 연장할 수 있어요.",
          "> 이벤트가 끝났다면 `완료`로 답장해서 다른 분들이 실망하지 않도록 해 주세요!"
        ].join('\n'),
        footer: { text: "취소하려면 이 메시지에 `취소`로 답장해 주세요." }
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
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    if(!message.reference){
      return;
    }
    const roleEntity = channelRoleTable.get(message.channelId);
    if(!roleEntity){
      return;
    }
    const reference = await message.fetchReference().catch(() => undefined);
    if(reference?.embeds[0]?.title !== "🎮 게임 이벤트 만들기"){
      return;
    }
    const chunk = reference.embeds[0].description?.match(/^<@(\d+)> 님이 이벤트를 만들었어요/);
    if(chunk?.[1] !== message.author.id){
      return;
    }
    switch(message.content){
      case "완료":{
        const event = await getScheduledEvent(guild, message.author.username, 'ACTIVE', roleEntity.title);
        if(event){
          await event.setStatus("COMPLETED");
          await message.react("✅");
        }else{
          await message.react("⚠️");
        }
      } break;
      case "연장":{
        const event = await getScheduledEvent(guild, message.author.username, 'ACTIVE', roleEntity.title);
        if(event){
          await event.edit({ scheduledEndTime: new Date(Date.now() + DateUnit.DAY) });
          await message.react("✅");
        }else{
          await message.react("⚠️");
        }
      } break;
      case "취소":{
        const event = await getScheduledEvent(guild, message.author.username, 'SCHEDULED', roleEntity.title);
        if(event){
          await event.delete();
          await reference.edit({
            content: `*(<@${message.author.id}> 님에 의해 취소된 이벤트입니다.)*`,
            embeds: []
          });
          await message.react("✅");
        }else{
          await message.react("⚠️");
        }
      } break;
    }
  });
  global.setInterval(async () => {
    const now = Date.now();

    for(const [ , v ] of await guild.scheduledEvents.fetch()){
      switch(v.status){
        case "SCHEDULED":
          if(!v.scheduledStartTimestamp) continue;
          if(now >= v.scheduledStartTimestamp){
            await v.setStatus("ACTIVE");
          }
          break;
        case "ACTIVE":
          if(!v.scheduledEndTimestamp) continue;
          if(now >= v.scheduledEndTimestamp){
            await v.setStatus("COMPLETED");
          }
          break;
        case "CANCELED":
        case "COMPLETED":
          if(!v.scheduledEndTimestamp) continue;
          if(now >= v.scheduledEndTimestamp + DateUnit.WEEK){
            await v.delete();
          }
          break;
      }
    }
  }, DateUnit.MINUTE);
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
function getScheduledEvent(guild:Guild, username:string, status:GuildScheduledEvent['status'], title?:string):Promise<GuildScheduledEvent|undefined>{
  return guild.scheduledEvents.fetch().then(title
    ? list => list.find(v => v.status === status && v.name === `${username} 님의 ${title}`)
    : list => list.find(v => v.status === status && v.name.startsWith(`${username} 님의`))
  );
}