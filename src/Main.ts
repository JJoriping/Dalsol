import { Captcha } from "captcha-canvas";
import { Client, Intents, MessageAttachment, TextChannel } from "discord.js";
import randomColor from "randomcolor";
import { getBasePreset } from "./components/BasePreset";
import { getEmbedMessage } from "./components/EmbedMessage";
import CREDENTIAL from "./data/credential.json";
import SETTINGS from "./data/settings.json";
import { DateUnit } from "./enums/DateUnit";
import { Logger } from "./utils/Logger";
import { SpamKicker } from "./utils/SpamKicker";
import { randInt, sleep } from "./utils/Utility";

const enum FooterStigma{
  GAME_ROLE = "게임 역할 받기"
}

const SCAM_TABLE = {
  '허위 니트로 링크': "https://discode.gift"
};
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES
  ],
  retryLimit: 3
});
const captchaTable = new Map<string, [data:Captcha, channel:string, expired:number]>();
const spamKicker = new SpamKicker();

async function main():Promise<void>{
  client.once('ready', async () => {
    const guild = await client.guilds.fetch(SETTINGS.guild);
    const webhooks = await guild.fetchWebhooks();
    // for(const v of guild.channels.cache.toJSON()){
    //   if(v.parentId !== "904930256299888680"){
    //     continue;
    //   }
    //   if(!/^[가-힣\w-]+$/.test(v.name)){
    //     continue;
    //   }
    //   if(v.isThread()){
    //     continue;
    //   }
    //   await v.permissionOverwrites.create(guild.roles.everyone, {
    //     'VIEW_CHANNEL': false,
    //     'CREATE_PUBLIC_THREADS': false,
    //     'CREATE_PRIVATE_THREADS': false
    //   });
    // }
    // for(const [ k, v ] of await guild.members.fetch()){
    //   const hasRole = v.roles.cache.has("923200636177219645");

    //   if(v.user.bot || hasRole) continue;
    //   console.log(v.user.tag);
    //   try{
    //     const channel = await v.createDM();

    //     await channel.send({
    //       embeds: [{
    //         title: "시간 초과",
    //         color: 'ORANGE',
    //         description: [
    //           `인증을 기한 내에 받지 않아 ${v.guild.name} 서버에서 추방되었어요.`,
    //           "다시 인증을 시도해 주세요."
    //         ].join('\n')
    //       }]
    //     });
    //   }catch(e){}
    //   await v.kick("인증 시간 초과");
    // }
    // process.exit(0);
    const logChannel = await client.channels.fetch(SETTINGS.logChannel);
    const roleChannel = await client.channels.fetch(SETTINGS.roleChannel);
    const guestWelcomeChannel = await client.channels.fetch(SETTINGS.guestWelcomeChannel) as TextChannel;
    if(!logChannel?.isText()) throw Error(`Invalid logChannel: ${SETTINGS.logChannel}`);
    if(!roleChannel?.isText()) throw Error(`Invalid roleChannel: ${SETTINGS.roleChannel}`);
    if(guestWelcomeChannel?.type !== "GUILD_TEXT") throw Error(`Invalid guestWelcomeChannel: ${SETTINGS.guestWelcomeChannel}`);

    await roleChannel.messages.fetch();
    for(const v of (await guestWelcomeChannel.threads.fetch()).threads.values()){
      await v.delete("부팅 시 존재하는 스레드 삭제");
      await sleep(1);
    }

    // 기능: 새 회원 captcha 심사
    client.on('guildMemberAdd', async member => {
      Logger.info("Member Add").put(member.id)
        .next("Tag").put(member.user.tag)
        .next("Birth").put(member.user.createdAt.toLocaleString())
        .out()
      ;
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
        collector.stop("인증 성공");
        await v.reply({
          embeds: [{
            title: "✨ 입장 완료!",
            color: 'GREEN',
            description: `협조해 주셔서 감사합니다! 즐거운 ${guild.name} 여행 되세요 😉`,
            footer: {
              text: "이 스레드는 1분 뒤 삭제됩니다."
            }
          }]
        });
        global.setTimeout(() => {
          thread.delete("인증 성공");
        }, DateUnit.MINUTE);
        await member.roles.add(SETTINGS.regularRole);
      });
      collector.once('end', async () => {
        if(!captchaTable.delete(member.id)) return;
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
    client.on('messageCreate', async message => {
      // 기능: 금지된 내용 검열
      for(const [ k, v ] of Object.entries(SCAM_TABLE)){
        if(!message.content.includes(v)){
          continue;
        }
        Logger.warning("Scam").put(message.author.id)
          .next("Content").put(message.content)
          .next("Reason").put(k)
          .out()
        ;
        await message.member?.timeout(SETTINGS.scamTimeout, k);
        await message.reply({
          embeds: [{
            title: "⚠ 경고",
            color: 'ORANGE',
            description: [
              "금지된 내용 입력이 감지되어 자동 타임아웃 처리되었습니다.",
              `> 사유: ${k}`
            ].join('\n')
          }]
        });
        await message.delete();
      }
      // 기능: 로봇 사용 가능 채널 검사
      if(message.channelId !== SETTINGS.roleChannel){
        if(message.channel.type === "GUILD_TEXT"
          && message.channel.parentId === SETTINGS.roleCategory
          && message.author.bot
          && !webhooks.has(message.webhookId || "")
        ){
          // NOTE 봇에게 VIEW_CHANNEL가 없다면 그 채널에선 그 봇을 사용할 수 없다.
          if(!message.channel.permissionsFor(message.author)?.has('VIEW_CHANNEL')){
            message.channel.send({
              content: message.interaction ? `<@${message.interaction.user.id}>` : undefined,
              embeds: [{
                title: "⚠ 경고",
                color: 'ORANGE',
                description: [
                  "채널 주제와 관련이 없는 봇의 사용은 지양해 주시기 바랍니다.",
                  `혹시 <@${message.author.id}> 봇이 이 채널과 관련이 있다고 생각하신다면 관리자에게 알려 주세요.`,
                  "",
                  `> 봇의 출력: ${message.content || "*(비어 있음)*"}`
                ].join('\n')
              }]
            });
            await message.delete();
          }
        }
        return;
      }
      // 기능: 역할 부여기 생성
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
    // 기능: 메시지 수정·삭제 이력
    client.on('messageUpdate', async (before, after) => {
      if(before.author?.bot){
        return;
      }
      const data = getBasePreset("✏️ 메시지 수정", 'YELLOW', before);

      data.embeds![0].description = `메시지 번호: ${before.id} [이동](https://discord.com/channels/${before.guildId}/${before.channelId}/${before.id})`;
      data.embeds!.push(
        await getEmbedMessage(before),
        await getEmbedMessage(after)
      );
      logChannel.send(data);
    });
    client.on('messageDelete', async message => {
      if(message.author?.bot){
        return;
      }
      const data = getBasePreset("🗑 메시지 삭제", 'RED', message);

      data.embeds![0].description = `메시지 번호: ${message.id}`;
      data.embeds!.push(
        await getEmbedMessage(message)
      );
      logChannel.send(data);
    });
    // 기능: 음성 채널 전용 역할 부여
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
    Logger.success("Discord").put(client.user?.tag).out();
  });
  await client.login(CREDENTIAL.token);
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
main();
process.on('uncaughtException', e => {
  Logger.error("Unhandled Exception").put(e.stack).out();
});
process.on('unhandledRejection', e => {
  Logger.error("Unhandled Rejection").put(e instanceof Error ? e.stack : e).out();
});