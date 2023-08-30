import { Client, Colors, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";
import { sleep } from "../utils/Utility";

export async function processPerplexityAgent(client:Client, guild:Guild):Promise<void>{
  const pattern = new RegExp(SETTINGS.perplexityPattern);
  let pending = false;

  await import("puppeteer").then(Puppeteer => {
    const _launch = Puppeteer.launch;

    Object.assign(Puppeteer, { launch: function(this:typeof Puppeteer, options:Parameters<typeof _launch>[0] = {}){
      options.args ??= [];
      options.args.push("--no-sandbox");
      return _launch.call(this, options);
    }});
  });
  const Perplexity = await import("node_perplexityai");

  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    const chunk = message.content.match(pattern);
    if(!chunk?.[1].trim()){
      return;
    }
    if(chunk[1].length > 100){
      await message.react("❌");
      return;
    }
    if(pending){
      await message.react("⌛");
      return;
    }
    pending = true;
    Logger.info("Perplexity").put(chunk[1]).out();
    await message.channel.sendTyping();
    try{
      const response = await Perplexity.send(chunk[1]);
      await message.reply({
        embeds: [{
          color: Colors.Blue,
          description: response,
          footer: { text: "Powered by perplexity.ai" }
        }]
      });
      await Perplexity.forget();
      await sleep(5);
    }catch(err){
      console.warn(err);
      await message.react("�");
    }
    pending = false;
  });
}