import { APIEmbed, Message, PartialMessage } from "discord.js";

export async function getEmbedMessage(data:Message|PartialMessage):Promise<APIEmbed>{
  const message = data.partial ? await data.fetch() : data;
  const descriptions = [
    message.content || "*(비어 있음)*"
  ];
  for(const v of message.embeds){
    descriptions.push(v.title ? `*(임베드: ${v.title})*` : "*(제목 없는 임베드)*");
  }
  return {
    description: descriptions.join('\n')
  };
}