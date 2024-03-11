import { Client, Guild, Snowflake, TextBasedChannel } from "discord.js";
import { G4F } from "g4f";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";

export async function processGPTAgent(client:Client, guild:Guild):Promise<void>{
  const gptChannel = await guild.channels.fetch(SETTINGS.gptChannel);
  if(!gptChannel?.isTextBased()) throw Error(`Invalid gptChannel: ${SETTINGS.gptChannel}`);
  const g4f = new G4F();
  const contexts:Record<Snowflake, {
    messages: Array<[role:"user"|"assistant", message:string]>,
    updatedAt: number
  }> = {};
  let running = false;

  schedule(async () => {
    const now = Date.now();

    for(const [ k, v ] of Object.entries(contexts)){
      if(now - v.updatedAt > DateUnit.HOUR){
        delete contexts[k];
      }
    }
  }, DateUnit.HOUR);
  client.on('messageCreate', async message => {
    if(message.channelId !== SETTINGS.gptChannel) return;
    if(message.author.bot) return;
    let chunk:RegExpMatchArray|null;

    if(chunk = message.content.match(new RegExp(SETTINGS.gptImagePattern))){
      if(await checkRunning()) return;
      const query = chunk[1];
      let result:string;
  
      try{
        running = true;
        Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
        startSendTyping(message.channel);
        result = await g4f.imageGeneration(query, {
          provider: g4f.providers.Emi
        });
        running = false;
      }catch(error){
        running = false;
        Logger.warning("GPTAgent").put(error).out();
        await message.react("😵");
        return;
      }
      await message.reply({
        files: [{ attachment: Buffer.from(result, "base64") }]
      });
    }else if(
      (chunk = message.content.match(new RegExp(SETTINGS.gptPattern)))
      || (message.reference?.messageId && message.reference.messageId in contexts)
    ){
      if(await checkRunning()) return;
      const referenceId = message.reference?.messageId;
      const context = referenceId && referenceId in contexts
        ? contexts[referenceId]
        : { messages: [], updatedAt: Date.now() }
      ;
      const query = chunk?.[1] || message.content;
      let result:string;
  
      try{
        running = true;
        Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
        startSendTyping(message.channel);
        result = await g4f.chatCompletion([
          ...context.messages.map(v => ({ role: v[0], content: v[1] })),
          { role: "user", content: query },
        ], {
          model: "gpt-4"
        });
        running = false;
      }catch(error){
        running = false;
        Logger.warning("GPTAgent").put(error).out();
        await message.react("😵");
        return;
      }
      context.messages.push([ "user", query ], [ "assistant", result ]);
      context.updatedAt = Date.now();
      await message.reply(result).then(res => {
        contexts[res.id] = context;
      });
    }
    async function checkRunning():Promise<boolean>{
      if(running){
        await message.react("⌛");
        return true;
      }
      return false;
    }
  });
  function startSendTyping(channel:TextBasedChannel):void{
    channel.sendTyping();
    const timer = global.setInterval(() => {
      if(running){
        channel.sendTyping();
      }else{
        global.clearInterval(timer);
      }
    }, 9 * DateUnit.SECOND);
  }
}