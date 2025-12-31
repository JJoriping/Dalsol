import { Client, Guild, Snowflake, TextBasedChannel } from "discord.js";
import { bing, gpt } from "gpti";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { sleep } from "../utils/Utility";

export async function processGPTAgent(client:Client, guild:Guild):Promise<void>{
  const gptChannel = await guild.channels.fetch(SETTINGS.gptChannel);
  if(!gptChannel?.isTextBased()) throw Error(`Invalid gptChannel: ${SETTINGS.gptChannel}`);
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
  client.on('interactionCreate', async interaction => {
    if(!interaction.isButton()) return;
    switch(interaction.customId){
      case "GPTAgent#remove":{
        const remove = () => interaction.update({
          content: "*(삭제된 메시지입니다.)*",
          components: [],
          files: []
        });
        try{
          const origin = await interaction.message.fetchReference();
          if(origin.author.id === interaction.user.id){
            await remove();
          }else{
            await interaction.reply({
              ephemeral: true,
              content: `<@${origin.author.id}> 님만 메시지를 삭제할 수 있어요.`
            });
          }
        }catch(error){
          console.warn(error);
          await remove();
        }
      } break;
    }
  });
  client.on('messageCreate', async message => {
    if(message.channelId !== SETTINGS.gptChannel) return;
    if(message.author.bot) return;
    let chunk:RegExpMatchArray|null;

    if(chunk = message.content.match(new RegExp(SETTINGS.gptImagePattern))){
      // if(await checkRunning()) return;
      // const wrappers:Array<(query:string) => string> = [
      //   query => query,
      //   query => `((sfw)), (detailed), ${query}, professional majestic painting by Ed Binkley, Atey Ghailan, Studio Ghibli, by Jeremy Mann`,
      //   query => `(digital painting), ${query}, fantasy art, beautiful artwork illustration`
      // ];
      // let query = chunk[1];
      // let results:string[];
      // let translated = false;
  
      // if((query.match(/[\w가-힣]/g) || []).length < 5){
      //   await message.reply("내용이 충분하지 않아요.");
      //   return;
      // }
      // try{
      //   running = true;
      //   Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
      //   startSendTyping(message.channel);
      //   if(/[가-힣]{2,}/.test(query)){
      //     const { translation } = await g4f.translation({
      //       text: query,
      //       source: "ko",
      //       target: "en"
      //     });
      //     query = translation.result;
      //     translated = true;
      //     Logger.log("GPTAgent Translation").put(query).out();
      //   }
      //   results = await Promise.all(wrappers.map((v, i) => g4f.imageGeneration(
      //     `(best quality), ${v(query)}, (score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, high res, 4k)`,
      //     {
      //       provider: g4f.providers.Prodia,
      //       providerOptions: {
      //         model: "revAnimated_v122.safetensors [3f4fefd9]",
      //         negativePrompt: `nsfw, naked, nude, nipples, deformed iris, deformed pupils, mutated hands and fingers, deformed, distorted, disfigured, poorly drawn, bad anatomy, wrong anatomy, ugly, disgusting, amputation, bad quality, (rating_safe)${chunk?.[2] ? `, ${chunk[2]}` : ""}`,
      //         samplingSteps: 20,
      //         cfgScale: 30
      //       }
      //     }
      //   ).catch(error => {
      //     console.warn(`#${i}`, error);
      //     return "";
      //   })));
      //   running = false;
      // }catch(error){
      //   running = false;
      //   Logger.warning("GPTAgent").put(error).out();
      //   await message.react("😵");
      //   return;
      // }
      // if(!results.filter(v => v).length){
      //   await message.react("😵");
      //   return;
      // }
      // await message.reply({
      //   content: translated ? `→ ${query}` : undefined,
      //   files: results.filter(v => v).map(v => ({ attachment: Buffer.from(v, "base64") })),
      //   components: [
      //     {
      //       type: ComponentType.ActionRow,
      //       components: [
      //         new ButtonBuilder({
      //           customId: "GPTAgent#remove",
      //           style: ButtonStyle.Secondary,
      //           label: "삭제"
      //         })
      //       ]
      //     }
      //   ]
      // });
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
      const model = chunk?.[1] === "4" ? "gpt-4-32k" : "gpt-3.5-turbo";
      const query = chunk?.[2] || message.content;
      let result:string;
  
      try{
        running = true;
        Logger.log("GPTAgent").put(message.content).next("Author").put(message.author.tag).out();
        startSendTyping(message.channel);
        result = await Promise.race([
          bing({
            messages: [
              {
                role: "system" as any,
                content: [
                  "I am a secretary of Daldalso(달달소 in Korean) - a Discord community server.",
                  "The owner of Daldalso is JJoriping(쪼리핑 in Korean), who made a online word chain game KKuTu(끄투 in Korean).",
                  "The official website of Daldalso is https://daldal.so.",
                  "\"JAVA!\"(\"자바!\" in Korean) is a rhythm game made by JJoriping, and it's available on https://sorry.daldal.so/java."
                ].join("\n")
              },
              ...context.messages.map(v => ({ role: v[0], content: v[1] })),
              { role: "user", content: query }
            ],
            conversation_style: "Balanced"
          }).then(res => (res as { 'message': string })?.message || "(unknown)"),
          sleep(5 * DateUnit.MINUTE).then(() => {
            throw Error("GPT Timeout");
          })
        ]);
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
        : sanitize(result)
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
function sanitize(text:string):string{
  return text.replace(/@(here|everyone|&?\d+)/g, "＠$1");
}