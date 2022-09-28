import { ButtonStyle, ChannelType, Client, ComponentType, ForumChannel, Guild, GuildForumThreadCreateOptions } from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import Parser from "rss-parser";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";
import { sleep } from "../utils/Utility";

type RSSTopic = keyof typeof SETTINGS.rssForum.topics;

const RSS_TERM = 10 * DateUnit.MINUTE;

export async function processGeekNewsReader(client:Client, guild:Guild):Promise<void>{
  const forumChannel = await guild.channels.fetch(SETTINGS.rssForum.channel);
  if(forumChannel?.type !== ChannelType.GuildForum) throw Error(`Invalid rssForum: ${SETTINGS.rssForum.channel}`);
  
  // Inven
  addRSSConsumer(forumChannel, 'inven', post => ({
    name: post.title || "인벤",
    message: {
      content: [
        `${post.contentSnippet || "(내용 없음)"}`,
        "",
        `> 📅 ${post.isoDate ? `<t:${Date.parse(post.isoDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
        `> 기사 원문: ${post.link}`,
        "*Powered by Inven*"
      ].join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "원문 보기",
              url: post.link || "https://www.inven.co.kr/"
            }
          ]
        }
      ]
    }
  }), 4 * DateUnit.MINUTE);
  // Steam
  addRSSConsumer(forumChannel, 'steam', post => ({
    name: post.title || "Steam",
    message: {
      content: [
        `${post['content:encodedSnippet'] || "(내용 없음)"}`,
        "",
        `> ✍️ 작성자: **${post.author}**`,
        `> 📅 ${post.isoDate ? `<t:${Date.parse(post.isoDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
        `> 기사 원문: ${post.link}`,
        "*Powered by Steam*"
      ].join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "원문 보기",
              url: post.link || "https://store.steampowered.com/"
            }
          ]
        }
      ]
    }
  }), 3 * DateUnit.MINUTE);
  // JTBC
  addRSSConsumer(forumChannel, 'jtbc', post => ({
    name: post.title || "JTBC",
    message: {
      content: [
        `${post.contentSnippet || "(내용 없음)"}`,
        "",
        `> 📅 ${post.pubDate || "-"} 작성됨`,
        `> 기사 원문: ${post.link}`,
        "*Powered by JTBC*"
      ].join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "원문 보기",
              url: post.link || "https://news.jtbc.co.kr/"
            }
          ]
        }
      ]
    }
  }), 2 * DateUnit.MINUTE);
  // GeekNews
  addRSSConsumer(forumChannel, 'geekNews', post => ({
    name: post.title || "GeekNews",
    message: {
      content: [
        `${post.contentSnippet || "(내용 없음)"}`,
        "",
        `> ✍️ 작성자: **${post.author}**`,
        `> 📅 ${post.pubDate ? `<t:${Date.parse(post.pubDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
        `> 기사 원문: ${post.link}`,
        "*Powered by GeekNews*"
      ].join('\n'),
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Link,
              label: "원문 보기",
              url: post.link || "https://news.hada.io/"
            }
          ]
        }
      ]
    }
  }), DateUnit.MINUTE);
}
function addRSSConsumer<T extends Record<string, unknown>>(
  forumChannel:ForumChannel,
  topic:RSSTopic,
  renderer:(post:Parser.Item&T) => GuildForumThreadCreateOptions,
  punctualOffset?:number
):void{
  schedule(async () => {
    const { url, tag } = SETTINGS.rssForum.topics[topic];
    const lastGeekNewsURLs = getLastPostURLs(topic);
    const rssParser = new Parser();
    const feed = await rssParser.parseURL(url);
    const newItems = feed.items.filter(v => v.link && !lastGeekNewsURLs.includes(v.link));
    const logger = Logger.info("RSS").put(topic);

    for(const v of newItems){
      await forumChannel.threads.create({
        ...renderer(v as any),
        appliedTags: [ tag ]
      });
      await sleep(5);
      logger.next("New").put(v.title);
    }
    setLastPostURLs(topic, feed.items.filter(v => v.link).map(v => v.link!));
    logger.out();
  }, RSS_TERM, {
    punctual: true,
    callAtStart: CLOTHES.development,
    punctualOffset
  });
}
function getLastPostURLs(topic:RSSTopic):string[]{
  if(!existsSync(`./res/rss/${topic}.log`)){
    return [];
  }
  return readFileSync(`./res/rss/${topic}.log`).toString().split('\n').map(v => v.trim());
}
function setLastPostURLs(topic:RSSTopic, value:string[]):void{
  writeFileSync(`./res/rss/${topic}.log`, value.join('\n'));
}