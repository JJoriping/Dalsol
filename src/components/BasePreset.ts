import { ColorResolvable, Message, PartialMessage, MessageOptions } from "discord.js";
import { DateUnit } from "../enums/DateUnit";

export function getBasePreset(title:string, color:ColorResolvable, message:Message|PartialMessage):MessageOptions{
  return {
    content: `\`▼ 이벤트 ───────────────────\` <t:${Math.floor(Date.now() / DateUnit.SECOND)}:R>`,
    embeds: [
      {
        title,
        fields: [
          { name: "채널", value: `<#${message.channelId}>`, inline: true },
          { name: "주체", value: `<@${message.author?.id}>`, inline: true }
        ],
        thumbnail: {
          url: message.author?.avatarURL() || undefined
        },
        color
      }
    ],
    files: message.attachments.toJSON()
  };
}