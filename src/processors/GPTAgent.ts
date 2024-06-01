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
      const models = [
        "revAnimated_v122.safetensors [3f4fefd9]",
        "Realistic_Vision_V5.0.safetensors [614d1063]",
        "lyriel_v16.safetensors [68fceea2]"
      ];
      let query = chunk[1];
      let results:string[];
      let translated = false;
  
      try{
        running = true;
        Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
        startSendTyping(message.channel);
        if(/[가-힣]{2,}/.test(query)){
          const { translation } = await g4f.translation({
            text: query,
            source: "ko",
            target: "en"
          });
          query = translation.result;
          translated = true;
          Logger.log("GPTAgent Translation").put(query).out();
        }
        results = await Promise.all(models.map(v => g4f.imageGeneration(query, {
          provider: g4f.providers.Prodia,
          providerOptions: {
            model: v,
            negativePrompt: `nsfw, naked, nude, deformed iris, deformed pupils, mutated hands and fingers, deformed, distorted, disfigured, poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, mutated, ugly, disgusting, amputation${chunk?.[2] ? `, ${chunk[2]}` : ""}`
          }
        }).catch(error => {
          console.warn(v, error);
          return "";
        })));
        running = false;
      }catch(error){
        running = false;
        Logger.warning("GPTAgent").put(error).out();
        await message.react("😵");
        return;
      }
      if(!results.filter(v => v).length){
        await message.react("😵");
        return;
      }
      await message.reply({
        content: translated ? `→ ${query}` : undefined,
        files: results.filter(v => v).map(v => ({ attachment: Buffer.from(v, "base64") }))
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
      const model = chunk?.[1] === "4" ? "gpt-4" : "gpt-3.5-turbo";
      const query = chunk?.[2] || message.content;
      let result:string;
  
      try{
        running = true;
        Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
        startSendTyping(message.channel);
        result = await g4f.chatCompletion([
          {
            role: "user",
            content: [
              "You are a secretary of Daldalso(달달소 in Korean) - a Discord community server.",
              "The owner of Daldalso is JJoriping(쪼리핑 in Korean), who made a online word chain game KKuTu(끄투 in Korean).",
              "The official website of Daldalso is https://daldal.so.",
              "\"JAVA!\"(\"자바!\" in Korean) is a rhythm game made by JJoriping, and it's available on https://sorry.daldal.so/java."
            ].join("\n")
          },
          ...context.messages.map(v => ({ role: v[0], content: v[1] })),
          { role: "user", content: query },
        ], { model });
        running = false;
      }catch(error){
        running = false;
        Logger.warning("GPTAgent").put(error).out();
        await message.react("😵");
        return;
      }
      context.messages.push([ "user", query ], [ "assistant", result ]);
      context.updatedAt = Date.now();
      await message.reply(result.length > 2000
        ? { files: [{ attachment: Buffer.from(result), name: `${message.id}.md` }] }
        : result
      ).then(res => {
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