import { ChannelType, Client, ForumChannel, Guild } from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import ogs from "open-graph-scraper";
import Parser from "rss-parser";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { PACKAGE, schedule } from "../utils/System";
import { sleep } from "../utils/Utility";

type RSSTopic = keyof typeof SETTINGS.rssForum.topics;
type RSSConsumeOptions = {
  'linkPreprocessor'?: (link:string) => string
};

const MAX_HISTORY_LENGTH = 100;

export async function processRSSReader(client:Client, guild:Guild):Promise<void>{
  const forumChannel = await guild.channels.fetch(SETTINGS.rssForum.channel);
  if(forumChannel?.type !== ChannelType.GuildForum) throw Error(`Invalid rssForum: ${SETTINGS.rssForum.channel}`);
  
  // 스톤 엔터테인먼트
  addRSSConsumer(forumChannel, 'stoneEntertainment', post => [
    `> 📅 ${post.pubDate ? `<t:${Date.parse(post.pubDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
    `> 🔗 유튜브 링크: ${post.link}`
  ], 30 * DateUnit.MINUTE);
  // 애니멀플래닛
  addNaverRSSConsumer(forumChannel, 'animalPlanet', 25 * DateUnit.MINUTE);
  // Inven
  addRSSConsumer(forumChannel, 'inven', post => [
    `${post.contentSnippet || "(내용 없음)"}`,
    "",
    `> 📅 ${post.isoDate ? `<t:${Date.parse(post.isoDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
    `> 🔗 기사 원문: ${post.link}`
  ], 20 * DateUnit.MINUTE);
  // 외교부
  addNaverRSSConsumer(forumChannel, 'mofa', 15 * DateUnit.MINUTE);
  // JTBC
  addRSSConsumer(forumChannel, 'jtbc', post => [
    `${post.contentSnippet || "(내용 없음)"}`,
    "",
    `> 📅 ${post.pubDate || "-"} 작성됨`,
    `> 🔗 기사 원문: ${post.link}`
  ], 10 * DateUnit.MINUTE);
  // GeekNews
  addRSSConsumer(forumChannel, 'geekNews', post => [
    `${post.contentSnippet || "(내용 없음)"}`,
    "",
    `> ✍️ 작성자: **${post.author}**`,
    `> 📅 ${post.pubDate ? `<t:${Date.parse(post.pubDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
    `> 🔗 기사 원문: ${post.link}`
  ], 5 * DateUnit.MINUTE);
}
function addNaverRSSConsumer(forumChannel:ForumChannel, topic:RSSTopic, punctualOffset?:number):void{
  addRSSConsumer(forumChannel, topic, post => [
    `${post.contentSnippet || "(내용 없음)"}`,
    "",
    `> 📅 ${post.isoDate ? `<t:${Date.parse(post.isoDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
    `> 🔗 기사 원문: ${post.link}`
  ], punctualOffset, {
    linkPreprocessor: link => {
      const chunk = link.split('/');
      const postId = chunk.pop();
      const blogId = chunk.pop();
  
      return `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${postId}`;
    }
  });
}
function addRSSConsumer<T extends Record<string, unknown>>(
  forumChannel:ForumChannel,
  topic:RSSTopic,
  renderer:(post:Parser.Item&T) => string[],
  punctualOffset?:number,
  options:RSSConsumeOptions = {}
):void{
  schedule(async () => {
    const { url, name } = SETTINGS.rssForum.topics[topic];
    const tag = forumChannel.availableTags.find(v => v.name === name)?.id;
    if(!tag) throw Error(`No such tag: ${name}`);
    const lastPostURLs = getLastPostURLs(topic);
    const rssParser = new Parser({
      headers: {
        'User-Agent': `Dalsol/${PACKAGE['version']}`,
        'Accept': "*/*"
      }
    });
    const feed = await rssParser.parseURL(url).catch(err => {
      Logger.error("RSS").put(name).next("Error").put(err).out();
      return { items: [] };
    });
    feed.items.forEach(v => {
      if(options.linkPreprocessor) v.link = options.linkPreprocessor(v.link!);
    });
    const newItems = feed.items.filter(v => v.link && !lastPostURLs.includes(v.link));
    const logger = Logger.info("RSS").put(topic);

    if(newItems.length > 3){
      const bundle = newItems.slice(0, 10);
      const now = new Date();
      const ogTags = await Promise.all(bundle.map(w => (
        w.link ? ogs({ url: w.link }).then(res => res.error ? null : res.result).catch(() => null) : null
      )));

      await forumChannel.threads.create({
        name: `${name}의 기사 모음 (${now.toLocaleDateString('ko')} ${now.getHours()}시)`,
        message: {
          content: `*Powered by **${name}***`,
          embeds: bundle.map((w, j) => {
            let image = ogTags[j]?.ogImage as string|ogs.OpenGraphImage|ogs.OpenGraphImage[]|undefined;

            if(image instanceof Array) image = image[0];
            return {
              title: w.title || "-",
              description: renderer(w as any).join('\n'),
              thumbnail: image ? { url: typeof image === "string" ? image : image.url } : undefined
            };
          })
        },
        appliedTags: [ tag ]
      });
      await sleep(5);
      logger.next("New").put(`${bundle[0].title} (+${bundle.length - 1})`);
    }else for(const v of newItems){
      await forumChannel.threads.create({
        name: v.title || name,
        message: {
          content: [
            ...renderer(v as any),
            `*Powered by **${name}***`
          ].join('\n')
        },
        appliedTags: [ tag ]
      });
      await sleep(5);
      logger.next("New").put(v.title);
    }
    setLastPostURLs(topic, [
      ...feed.items.filter(v => v.link).map(v => v.link!),
      ...lastPostURLs
    ].slice(0, MAX_HISTORY_LENGTH));
    logger.out();
  }, SETTINGS.rssForum.interval, {
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
  writeFileSync(`./res/rss/${topic}.log`, [ ...new Set(value) ].join('\n'));
}