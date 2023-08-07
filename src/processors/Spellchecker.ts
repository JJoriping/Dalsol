import { Client, Guild } from "discord.js";

export async function processSpellchecker(client:Client, guild:Guild):Promise<void>{
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    console.log(message.content);
  });
}