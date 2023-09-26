import { Client, Colors, Guild, Message, Snowflake, SnowflakeUtil } from "discord.js";
import { writeFileSync } from "fs";
import { Browser, Builder, Key, WebDriver, until } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import CREDENTIAL from "../data/credential.json";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { IGNORE, sleep } from "../utils/Utility";

const questionValidityChecker = /[a-z가-힣\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Cyrillic}]{2}/iu;

type Context = {
  'author': Snowflake,
  'driver': WebDriver,
  'length': number
};
export async function processPerplexityAgent(client:Client, guild:Guild):Promise<void>{
  // const proxyServer = createProxyServer({ target: "ec2-52-90-162-236.compute-1.amazonaws.com" });
  const koPattern = new RegExp(SETTINGS.perplexityPattern.ko);
  const enPattern = new RegExp(SETTINGS.perplexityPattern.en, "i");
  const contextMap = new Map<Snowflake, Context>();
  const queue:Message[] = [];

  let pending:string|undefined;

  // proxyServer.listen(CREDENTIAL.perplexityProxyPort, "127.0.0.1");
  schedule(async () => {
    const now = Date.now();

    for(const [ k, v ] of contextMap.entries()){
      const gap = now - SnowflakeUtil.timestampFrom(k);

      if(gap > DateUnit.HOUR){
        Logger.log("Perplexity Session Expiry").put(k).out();
        await v.driver.quit().catch(IGNORE);
        contextMap.delete(k);
      }
    }
  }, 10 * DateUnit.MINUTE);
  schedule(async () => {
    if(!queue.length) return;
    if(pending) return;
    const message = queue.shift()!;
    
    await message.react("⌛");
    await handleMessage(message);
  }, 5 * DateUnit.SECOND);

  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    const channelId = message.channel.isThread() ? message.channel.parentId : message.channel.id;
    if(SETTINGS.perplexityChannel !== channelId){
      return;
    }
    await handleMessage(message);
  });
  async function handleMessage(message:Message):Promise<void>{
    const context = message.reference?.messageId && contextMap.get(message.reference.messageId) || null;
    let originalQuery:string;
    let query:string;

    if(context){
      if(context.author !== message.author.id){
        return;
      }
      query = originalQuery = message.content;
    }else{
      const [ chunk, locale ] = parseMessage(message.content);
      if(!chunk?.[1].trim()){
        return;
      }
      originalQuery = chunk[1];
      query = locale === "ko"
        ? `(한국어로 대답해 주세요)\n${chunk[1]}`
        : chunk[1]
      ;
    }
    if(originalQuery.length < 5 || originalQuery.length > SETTINGS.perplexityQuestionLengthLimit || !questionValidityChecker.test(originalQuery)){
      await message.react("❌");
      return;
    }
    if(pending){
      if(pending === message.content
        || queue.length >= 5
        || queue.some(v => v.author.id === message.author.id || v.content === message.content)
      ){
        await message.react("✋");
        return;
      }
      queue.push(message);
      await message.react("⏳");
      return;
    }
    await message.channel.sendTyping();
    const timer = global.setInterval(() => message.channel.sendTyping(), 9 * DateUnit.SECOND);
    const logger = Logger.info("Perplexity").put(message.content)
      .next("Author").put(message.author.id)
    ;
    let driver:WebDriver|undefined;

    pending = query;
    if(context) logger.next("Origin").put(message.reference?.messageId);
    logger.out();
    try{
      driver = context?.driver || await new Builder().forBrowser(Browser.CHROME)
        .setChromeOptions(new Options()
          .addArguments(
            "--headless",
            "--no-sandbox",
            "--disable-web-security",
            "--ignore-certificate-errors",
            // `--proxy-server=127.0.0.1:${CREDENTIAL.perplexityProxyPort}`
          )
          .windowSize({ width: 800, height: 600 })
        )
        .build()
      ;
      if(context){
        await driver.findElement({ css: "textarea[placeholder]" }).sendKeys(toKey(query), Key.ENTER);
      }else{
        await driver.get(CREDENTIAL.perplexityHomepageURL);
        const $textarea = await driver.findElement({ css: "textarea[autofocus]" });
        await driver.wait(until.elementIsVisible($textarea));
        await $textarea.sendKeys(toKey(query), Key.ENTER);
      }
      const $answer = await driver
        .wait(until.elementLocated({ xpath: `(//*[text()='Answer  '])[${(context?.length || 0) + 1}]` }), 2 * DateUnit.MINUTE)
        .findElement({ xpath: "../../../../following-sibling::div[1]" })
      ;
      const $links = await $answer.findElements({ xpath: "//p[text()='Quick Search']/../../following-sibling::div[1]//a[not(contains(@class, 'dalsol'))]" });
      const $citations = await $answer.findElements({ css: ".citation" });
      const $images = await $answer.findElements({ css: 'img[alt="related"]:not(.dalsol)' });
      const citations:string[] = [];
      for(const $v of $citations) citations.push(await $v.getAttribute("href"));

      if(CLOTHES.development){
        console.log("─BEFORE─────────────\n" + await $answer.getText() + "\n────────────────────");
      }
      await driver.executeScript(`[ ...document.querySelectorAll(".citation") ].map($v => $v.remove());`);
      await driver.executeScript(`[ ...document.querySelectorAll('img[alt="related"]:not(.dalsol)') ].map($v => $v.classList.add("dalsol"));`);
      await driver.executeScript(`[ ...document.querySelectorAll("a:not(.dalsol)") ].map($v => $v.classList.add("dalsol"));`);

      await driver.executeScript(`[ ...document.querySelectorAll("strong:not(.dalsol)") ].map($v => {
        $v.innerHTML = "**" + $v.innerHTML + "**";
        $v.classList.add("dalsol");
      });`);
      await driver.executeScript(`[ ...document.querySelectorAll("ol>li:not(.dalsol)") ].map(($v, i) => {
        $v.innerHTML = (i + 1) + ". " + $v.innerHTML;
        $v.classList.add("dalsol");
      })`);
      await driver.executeScript(`[ ...document.querySelectorAll("ul>li:not(.dalsol)") ].map(($v, i) => {
        $v.innerHTML = "- " + $v.innerHTML;
        $v.classList.add("dalsol");
      })`);
      await driver.executeScript(`[ ...document.querySelectorAll("pre code:not(.dalsol)") ].map(($v, i) => {
        if(!$v.textContent.trim()) return;
        const $pre = $v.closest("pre");
        const $div = $pre && $pre.querySelector(".absolute");
        const language = ($div && $div.textContent) || "";

        if($div) $div.remove();
        $v.textContent = "\`\`\`" + language + "\\n" + $v.textContent + "\\n\`\`\`";
        $v.classList.add("dalsol");
      })`);
      await driver.executeScript(`[ ...document.querySelectorAll("span[class] code:not(.dalsol)") ].map(($v, i) => {
        $v.textContent = "\`" + $v.textContent + "\`";
        $v.classList.add("dalsol");
      })`);
      if(CLOTHES.development){
        console.log("─AFTER──────────────\n" + await $answer.getText() + "\n────────────────────");
      }

      global.clearInterval(timer);
      const citatedLinks:string[] = [];
      
      for(const $v of $links){
        const href = await $v.getAttribute("href");
        if(!citations.includes(href)){
          continue;
        }
        citatedLinks.push(`[${await $v.findElement({ css: ".default" }).getText()}](${href})`);
      }
      const answer = await message.reply({
        embeds: [
          {
            color: Colors.Blue,
            description: await $answer.getText(),
            image: { url: await $images[0]?.getAttribute("src") }
          },
          {
            description: citatedLinks.map((v, i) => `${i + 1}. ${v}`).join("\n"),
            footer: { text: "Powered by perplexity.ai" }
          }
        ],
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
      if(driver){
        const chunk = await driver.takeScreenshot();

        writeFileSync(`./res/selenium-logs/${Date.now()}.png`, Buffer.from(chunk, "base64"));
      }
    }
    pending = undefined;
  }
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
function toKey(value:string):string{
  return value.replaceAll("\n", Key.SHIFT + Key.ENTER + Key.SHIFT);
}