import { Client, Colors, Guild, Snowflake, SnowflakeUtil } from "discord.js";
import { Browser, Builder, Key, WebDriver, until } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { sleep } from "../utils/Utility";
import { schedule } from "../utils/System";
import { CLOTHES } from "../utils/Clothes";

const questionValidityChecker = /[a-z가-힣\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Cyrillic}]{2}/iu;

type Context = {
  'author': Snowflake,
  'driver': WebDriver,
  'length': number
};
export async function processPerplexityAgent(client:Client, guild:Guild):Promise<void>{
  const koPattern = new RegExp(CLOTHES.development ? "^달솔아~ (.+)$" : SETTINGS.perplexityPattern.ko);
  const enPattern = new RegExp(CLOTHES.development ? "^hey dalsol~ (.+)$" : SETTINGS.perplexityPattern.en, "i");
  const contextMap = new Map<Snowflake, Context>();

  let pending = false;

  schedule(async () => {
    const now = Date.now();

    for(const [ k, v ] of contextMap.entries()){
      const gap = now - SnowflakeUtil.timestampFrom(k);

      if(gap > DateUnit.HOUR){
        Logger.log("Perplexity Session Expiry").put(k).out();
        await v.driver.quit();
        contextMap.delete(k);
      }
    }
  }, 10 * DateUnit.MINUTE);
  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    const context = message.reference?.messageId && contextMap.get(message.reference.messageId) || null;
    let query:string;

    if(context){
      if(context.author !== message.author.id){
        return;
      }
      query = message.content;
    }else{
      const [ chunk, locale ] = parseMessage(message.content);
      if(!chunk?.[1].trim()){
        return;
      }
      query = locale === "ko"
        ? `${chunk[1]} 한국어로 대답해 주세요.`
        : chunk[1]
      ;
    }
    if(query.length < 5 || query.length > 200 || !questionValidityChecker.test(query)){
      await message.react("❌");
      return;
    }
    if(pending){
      await message.react("⌛");
      return;
    }
    await message.channel.sendTyping();
    const timer = global.setInterval(() => message.channel.sendTyping(), 10 * DateUnit.SECOND);
    const logger = Logger.info("Perplexity").put(query)
      .next("Author").put(message.author.id)
    ;

    pending = true;
    if(context) logger.next("Origin").put(message.reference?.messageId);
    logger.out();
    try{
      const driver = context?.driver || await new Builder().forBrowser(Browser.CHROME)
        .setChromeOptions(new Options().addArguments("--headless", "--no-sandbox").windowSize({ width: 800, height: 600 }))
        .build()
      ;
      if(context){
        await driver.findElement({ css: "textarea[placeholder]" }).sendKeys(query, Key.ENTER);
      }else{
        await driver.get("https://www.perplexity.ai/");
        await driver.findElement({ css: "textarea[autofocus]" }).sendKeys(query, Key.ENTER);
      }
      const $answer = await driver
        .wait(until.elementLocated({ xpath: `(//div[text()='Answer  '])[${(context?.length || 0) + 1}]` }), DateUnit.MINUTE)
        .findElement({ xpath: "../../../../following-sibling::div[1]" })
      ;
      const $images = await $answer.findElements({ css: 'img[alt="related"]' });

      driver.executeScript(`[ ...document.querySelectorAll(".citation") ].map($v => $v.remove());`);
      driver.executeScript(`[ ...document.querySelectorAll("strong:not(.dalsol)") ].map($v => {
        $v.innerHTML = "**" + $v.innerHTML + "**";
        $v.classList.add("dalsol");
      });`);
      driver.executeScript(`[ ...document.querySelectorAll("ol>li:not(.dalsol)") ].map(($v, i) => {
        $v.innerHTML = (i + 1) + ". " + $v.innerHTML;
        $v.classList.add("dalsol");
      })`);
      driver.executeScript(`[ ...document.querySelectorAll("ul>li:not(.dalsol)") ].map(($v, i) => {
        $v.innerHTML = "- " + $v.innerHTML;
        $v.classList.add("dalsol");
      })`);
      driver.executeScript(`[ ...document.querySelectorAll("pre code:not(.dalsol)") ].map(($v, i) => {
        if(!$v.textContent.trim()) return;
        const $pre = $v.closest("pre");
        const $div = $pre && $pre.querySelector(".absolute");
        const language = ($div && $div.textContent) || "";

        if($div) $div.remove();
        $v.innerHTML = "\`\`\`" + language + "\\n" + $v.textContent + "\\n\`\`\`";
        $v.classList.add("dalsol");
      })`);
      driver.executeScript(`[ ...document.querySelectorAll("span[class] code:not(.dalsol)") ].map(($v, i) => {
        $v.innerHTML = "\`" + $v.innerHTML + "\`";
        $v.classList.add("dalsol");
      })`);

      global.clearInterval(timer);
      const answer = await message.reply({
        embeds: [{
          color: Colors.Blue,
          description: await $answer.getText(),
          image: { url: await $images[0]?.getAttribute("src") },
          footer: { text: "Powered by perplexity.ai" }
        }],
      });
      if(context){
        context.length++;
        contextMap.set(answer.id, context);
      }else{
        contextMap.set(answer.id, { author: message.author.id, driver, length: 1 });
      }
      await sleep(5);
    }catch(err){
      global.clearInterval(timer);
      console.warn(err);
      await message.react("😵");
    }
    pending = false;
  });
  function parseMessage(value:string):[RegExpMatchArray|null, "ko"|"en"|null]{
    let chunk = value.match(koPattern);
    if(chunk){
      return [ chunk, "ko" ];
    }
    chunk = value.match(enPattern);
    if(chunk){
      return [ chunk, "en" ];
    }
    return [ null, null ];
  }
}