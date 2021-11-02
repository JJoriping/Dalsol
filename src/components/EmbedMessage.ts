import { Message, MessageEmbedOptions, PartialMessage } from "discord.js";

export async function getEmbedMessage(data:Message|PartialMessage):Promise<MessageEmbedOptions>{
  const message = data.partial ? await data.fetch() : data;
  const thumbnail = message.attachments.toJSON()[0];

  return {
    description: message.content || "*(비어 있음)*",
    image: thumbnail?.contentType?.startsWith("image/") ? {
      url: thumbnail.url,
      proxyURL: thumbnail.proxyURL
    } : undefined
  };
}