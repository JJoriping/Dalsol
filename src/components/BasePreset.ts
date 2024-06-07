import { APIEmbed, Message, BaseMessageOptions, PartialMessage, Colors } from "discord.js";
import { DateUnit } from "../enums/DateUnit";

export function getBasePreset(title:string, color:number, message:Message|PartialMessage):BaseMessageOptions&{
  'embeds': APIEmbed[]
}{
  const thumbnail = message.author?.avatarURL();
  const embeds:APIEmbed[] = [
    {
      title,
      fields: [
        { name: "채널", value: `<#${message.channelId}>`, inline: true },
        { name: "주체", value: `<@${message.author?.id}>`, inline: true }
      ],
      thumbnail: thumbnail ? { url: thumbnail } : undefined,
      color
    }
  ];
  if(message.attachments.size){
    const preview = message.attachments.toJSON().find(v => v.contentType?.startsWith("image/"));

    embeds.push({
      title: "첨부 파일",
      color: Colors.Blue,
      description: message.attachments.toJSON().map((v, i) => (
        `${i + 1}. [${v.name}](${v.proxyURL})`
      )).join('\n'),
      image: preview ? { url: preview.proxyURL } : undefined
    });
  }
  return {
    content: `\`▼ 이벤트 ───────────────────\` <t:${Math.floor(Date.now() / DateUnit.SECOND)}:R>`,
    embeds
  };
}