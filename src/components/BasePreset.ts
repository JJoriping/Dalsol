import { APIEmbed, Message, BaseMessageOptions, PartialMessage } from "discord.js";
import { DateUnit } from "../enums/DateUnit";

export function getBasePreset(title:string, color:number, message:Message|PartialMessage):BaseMessageOptions&{
  'embeds': APIEmbed[]
}{
  const thumbnail = message.author?.avatarURL();

  return {
    content: `\`▼ 이벤트 ───────────────────\` <t:${Math.floor(Date.now() / DateUnit.SECOND)}:R>`,
    embeds: [
      {
        title,
        fields: [
          { name: "채널", value: `<#${message.channelId}>`, inline: true },
          { name: "주체", value: `<@${message.author?.id}>`, inline: true }
        ],
        thumbnail: thumbnail ? { url: thumbnail } : undefined,
        color
      }
    ],
    files: message.attachments.toJSON()
  };
}