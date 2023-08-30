import { Client, Colors, Guild } from "discord.js";
import { Browser, Builder, Key, until } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "../utils/Logger";
import { sleep } from "../utils/Utility";

const questionValidityChecker = /[a-z가-힣\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Cyrillic}]{2}/iu;

export async function processPerplexityAgent(client:Client, guild:Guild):Promise<void>{
  const koPattern = new RegExp(SETTINGS.perplexityPattern.ko);
  const enPattern = new RegExp(SETTINGS.perplexityPattern.en, "i")
  const driver = await new Builder().forBrowser(Browser.CHROME)
    .setChromeOptions(new Options().addArguments("--headless", "--no-sandbox").windowSize({ width: 800, height: 600 }))
    .build()
  ;
  let pending = false;

  client.on('messageCreate', async message => {
    if(message.author.bot){
      return;
    }
    const [ chunk, locale ] = parseMessage(message.content);
    if(!chunk?.[1].trim()){
      return;
    }
    if(chunk[1].length < 5 || chunk[1].length > 200 || !questionValidityChecker.test(chunk[1])){
      await message.react("❌");
      return;
    }
    if(pending){
      await message.react("⌛");
      return;
    }
    const query = locale === "ko"
      ? `${chunk[1]} 한국어로 대답해 주세요.`
      : chunk[1]
    ;
    await message.channel.sendTyping();
    const timer = global.setInterval(() => message.channel.sendTyping(), 10 * DateUnit.SECOND);

    pending = true;
    Logger.info("Perplexity").put(chunk[1])
      .next("Author").put(message.author.id)
      .out()
    ;
    try{
      await driver.get("https://www.perplexity.ai/");
      await driver.findElement({ css: "textarea[autofocus]" }).sendKeys(query, Key.ENTER);
      const $answer = await driver
        .wait(until.elementLocated({ xpath: "//div[text()='Answer  ']" }), DateUnit.MINUTE)
        .findElement({ xpath: "../../../../following-sibling::div[1]" })
      ;
      const $images = await $answer.findElements({ css: 'img[alt="related"]' });

      driver.executeScript(`[ ...document.querySelectorAll(".citation") ].map($v => $v.remove());`);
      driver.executeScript(`[ ...document.querySelectorAll("strong") ].map($v => {
        $v.innerHTML = "**" + $v.innerHTML + "**";
      });`);
      driver.executeScript(`[ ...document.querySelectorAll("ol>li") ].map(($v, i) => {
        $v.innerHTML = (i + 1) + ". " + $v.innerHTML;
      })`);

      global.clearInterval(timer);
      await message.reply({
        embeds: [{
          color: Colors.Blue,
          description: await $answer.getText(),
          image: { url: await $images[0]?.getAttribute("src") },
          footer: { text: "Powered by perplexity.ai" }
        }],
      });
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