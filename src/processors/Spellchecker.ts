import { Client, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";
import { reduceToTable } from "../utils/Utility";
import { Logger } from "../utils/Logger";
import { readFileSync, writeFileSync } from "fs";

export async function processSpellchecker(client:Client, guild:Guild):Promise<void>{
  const spellcheckerGuild = await client.guilds.fetch(SETTINGS.spellcheckerGuild);
  const emojis = reduceToTable(
    await spellcheckerGuild.emojis.fetch().then(res => res.toJSON()),
    v => v.toString(),
    v => v.name || `#${v.id}`
  );
  const patterns = Object.entries(SETTINGS.spellcheckerPatterns);
  const optout = readFileSync("./res/spellcheck-opt-out").toString().split("\n");
  if(optout[0] === "") optout.shift();

  for(const [ , v ] of patterns){
    if(!(v in emojis)){
      throw Error(`Unknown emoji: ${v}`);
    }
  }
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    switch(message.content){
      case "맞춤법 멈춰":
        if(optout.includes(message.author.id)) break;
        optout.push(message.author.id);
        updateOptout();
        await message.react("✅");
        break;
      case "맞춤법 멈춰 취소":{
        const index = optout.indexOf(message.author.id);
        if(index === -1) return;
        optout.splice(index, 1);
        updateOptout();
        await message.react("✅");
      } break;
    }
    if(optout.includes(message.author.id)){
      return;
    }
    for(const [ k, v ] of patterns){
      if(!new RegExp(k, "m").test(message.content)){
        continue;
      }
      Logger.log("Spellcheck").put(message.content)
        .next("Author").put(message.author.id)
        .next("By").put(k)
        .out()
      ;
      await message.react(emojis[v]);
    }
  });
  function updateOptout():void{
    writeFileSync("./res/spellcheck-opt-out", optout.join("\n"));
  }
}