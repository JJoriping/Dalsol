import { APIEmbed, Message, PartialMessage } from "discord.js";

export async function getEmbedMessage(data:Message|PartialMessage):Promise<APIEmbed>{
  const message = data.partial ? await data.fetch() : data;
  const thumbnail = message.attachments.toJSON()[0];
  const descriptions = [
    message.content || "*(비어 있음)*"
  ];
  for(const v of message.embeds){
    descriptions.push(v.title ? `*(임베드: ${v.title})*` : "*(제목 없는 임베드)*");
  }
  return {
    description: descriptions.join('\n'),
    image: thumbnail?.contentType?.startsWith("image/") ? {
      url: thumbnail.url,
      proxy_url: thumbnail.proxyURL
    } : undefined
  };
}