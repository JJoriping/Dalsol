import { Captcha } from "captcha-canvas";
import { Client, Guild, MessageAttachment, TextChannel } from "discord.js";
import randomColor from "randomcolor";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { SpamKicker } from "../utils/SpamKicker";
import { schedule } from "../utils/System";
import { randInt, sleep } from "../utils/Utility";

const captchaTable = new Map<string, [data:Captcha, channel:string, expired:number]>();
const spamKicker = new SpamKicker();
const REGULARIZATION_TERM = 10 * DateUnit.MINUTE;

export async function processGuestInterviewer(client:Client, guild:Guild):Promise<void>{
  const guestWelcomeChannel = await client.channels.fetch(SETTINGS.guestWelcomeChannel) as TextChannel;
  if(guestWelcomeChannel?.type !== "GUILD_TEXT") throw Error(`Invalid guestWelcomeChannel: ${SETTINGS.guestWelcomeChannel}`);

  for(const v of (await guestWelcomeChannel.threads.fetch({
    archived: {
      type: "private",
      fetchAll: true
    }
  })).threads.values()){
    await v.delete("부팅 시 존재하는 스레드 삭제");
    await sleep(1);
  }
  client.on('guildMemberAdd', async member => {
    Logger.info("Member Add").put(member.id)
      .next("Tag").put(member.user.tag)
      .next("Birth").put(member.user.createdAt.toLocaleString())
      .out()
    ;
    if(member.user.bot){
      return;
    }
    if(!spamKicker.in(member)){
      return;
    }
    const thread = await guestWelcomeChannel.threads.create({
      name: `${member.user.username} 님의 스레드`,
      type: 'GUILD_PRIVATE_THREAD', // 부스트 2단계 이상이어야 한다.
      autoArchiveDuration: 60,
      reason: `${member.user.tag} 님에 대한 멤버십 심사`,
      invitable: false
    });
    let message = await thread.send({
      content: [
        `<@${member.id}> 님, ${guild.name}에 오신 걸 환영합니다 :wave:`,
        `대화에 참여하시기 전 꼭 <#${SETTINGS.guestWelcomeChannel}> 채널의 모든 규칙을 읽고 지켜 주세요!`,
        "준비가 되셨다면 제가 보내 드린 그림에서 선이 이어진 6글자(대문자와 숫자 조합)를 입력해 주세요."
      ].join('\n'),
      files: [
        new MessageAttachment(await registerCaptcha(member.id, thread.id), "captcha.png")
      ]
    });
    const collector = thread.createMessageCollector({ time: DateUnit.HOUR });
    const isYoung = Date.now() - member.user.createdTimestamp < SETTINGS.userAgeThreshold;
    const timeBecomingAdult = isYoung && Math.ceil((member.user.createdTimestamp + SETTINGS.userAgeThreshold) / DateUnit.SECOND);
    let life = 5;

    collector.on('collect', async v => {
      if(v.author.id !== member.id) return;
      const chunk = captchaTable.get(member.id);
      if(!chunk) return;
      Logger.log("Captcha").put(member.id)
        .next("Input").put(v.content)
        .next("Answer").put(chunk[0].text)
        .out()
      ;
      if(chunk[0].text !== v.content){
        await message.delete();
        if(--life <= 0){
          await member.kick("그림을 5회 연속으로 잘못 입력했습니다.");
          return;
        }
        await registerCaptcha(member.id, thread.id);
        message = await thread.send({
          content: "다시 시도해 주세요!",
          files: [
            new MessageAttachment(await registerCaptcha(member.id, thread.id), "captcha.png")
          ]
        });
        return;
      }
      captchaTable.delete(member.id);
      await v.reply({
        embeds: [{
          title: "✨ 입장 완료!",
          color: 'GREEN',
          description: isYoung
            ? `협조해 주셔서 감사합니다! 다만 사용하시는 디스코드 계정이 아직 새 것이라, 정식 <@&${SETTINGS.regularRole}> 역할을 받으려면 <t:${timeBecomingAdult}:F>까지 기다려야 해요.`
            : `협조해 주셔서 감사합니다! 즐거운 ${guild.name} 여행 되세요 😉`
          ,
          footer: {
            text: "이 스레드는 1분 뒤 삭제됩니다."
          }
        }]
      });
      global.setTimeout(() => {
        thread.delete("인증 성공");
      }, DateUnit.MINUTE);
      await member.roles.add(isYoung ? SETTINGS.associateRole : SETTINGS.regularRole);
      collector.stop("인증 성공");
    });
    collector.once('end', async () => {
      if(member.roles.cache.hasAny(SETTINGS.regularRole, SETTINGS.associateRole)){
        return;
      }
      try{
        const channel = await member.createDM();

        await channel.send({
          embeds: [{
            title: "시간 초과",
            color: 'ORANGE',
            description: [
              `인증을 기한 내에 받지 않아 ${member.guild.name} 서버에서 추방되었어요.`,
              "다시 인증을 시도해 주세요."
            ].join('\n')
          }]
        });
      }catch(e){}
      await member.kick("인증 시간 초과");
      captchaTable.delete(member.id);
    });
  });
  client.on('guildMemberRemove', async member => {
    Logger.warning("Member Remove").put(member.id).next("Tag").put(member.user.tag).out();
    const chunk = captchaTable.get(member.id);
    if(!chunk) return;
    const channel = await guestWelcomeChannel.threads.fetch(chunk[1]);
    if(!channel) return;
    channel.delete("유저 퇴장");
  });
  schedule(async () => {
    const associateRole = await guild.roles.fetch(SETTINGS.associateRole);
    if(!associateRole){
      throw Error(`Invalid associateRole: ${SETTINGS.associateRole}`);
    }
    const now = Date.now();

    for(const v of associateRole.members.values()){
      if(now - v.user.createdTimestamp < SETTINGS.userAgeThreshold){
        continue;
      }
      await v.roles.remove(SETTINGS.associateRole, "정회원 시간 경과");
      await v.roles.add(SETTINGS.regularRole, "정회원 시간 경과");
      Logger.info("Regularization").put(v.id).next("Tag").put(v.user.tag).out();
    }
  }, REGULARIZATION_TERM, {
    punctual: true
  });
}
async function registerCaptcha(userId:string, threadId:string):Promise<Buffer>{
  if(captchaTable.get(userId)){
    captchaTable.delete(userId);
  }
  const captcha = new Captcha(SETTINGS.captcha.width, SETTINGS.captcha.height);
  const colors = [
    randomColor(),
    randomColor(),
    randomColor()
  ];
  captcha
    .addDecoy({ total: randInt(60, 80), color: colors[1], opacity: 0.8 })
    .drawTrace({ size: randInt(4, 8), color: colors[0] })
    .drawCaptcha({ size: 48, colors, characters: 6 })
  ;
  captchaTable.set(userId, [ captcha, threadId, Date.now() + DateUnit.HOUR ]);
  return await captcha.png;
}