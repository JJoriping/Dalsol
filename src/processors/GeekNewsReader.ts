import { ButtonStyle, ChannelType, Client, Colors, ComponentType, Guild } from "discord.js";
import { readFileSync, writeFileSync } from "fs";
import Parser from "rss-parser";
import SETTINGS from "../data/settings.json";
import { DateUnit } from "../enums/DateUnit";
import { CLOTHES } from "../utils/Clothes";
import { Logger } from "../utils/Logger";
import { schedule } from "../utils/System";

const RSS_TERM = 10 * DateUnit.MINUTE;
const lastGeekNewsURLFile = "./res/last-geek-news-url";

export async function processGeekNewsReader(client:Client, guild:Guild):Promise<void>{
  const forumChannel = await guild.channels.fetch(SETTINGS.geekNewsForumChannel);
  if(forumChannel?.type !== ChannelType.GuildForum) throw Error(`Invalid geekNewsChannel: ${SETTINGS.geekNewsForumChannel}`);
  let lastGeekNewsURLs = getLastGeekNewsURLs();

  schedule(async () => {
    const rssParser = new Parser();
    const feed = await rssParser.parseURL(SETTINGS.geekNewsRSS);
    const newItems = feed.items.filter(v => v.link && !lastGeekNewsURLs.includes(v.link));
    const logger = Logger.info("GeekNews").put(newItems.length);

    for(const v of newItems){
      await forumChannel.threads.create({
        name: v.title || "GeekNews",
        appliedTags: [ SETTINGS.geekNewsForumTag ],
        message: {
          content: [
            `${v.contentSnippet || "(내용 없음)"}`,
            "",
            `> ✍️ 작성자: **${v.author}**`,
            `> 📅 ${v.pubDate ? `<t:${Date.parse(v.pubDate) / DateUnit.SECOND}:R>` : "-"} 작성됨`,
            "*Powered by GeekNews*"
          ].join('\n'),
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  style: ButtonStyle.Link,
                  label: "더 보기",
                  url: v.link || "https://news.hada.io/"
                }
              ]
            }
          ]
        }
      });
      logger.next("New").put(v.title);
    }
    setLastGeekNewsURLs(feed.items.filter(v => v.link).map(v => v.link!));
    logger.out();
  }, RSS_TERM, {
    punctual: true,
    callAtStart: CLOTHES.development
  });
}
function getLastGeekNewsURLs():string[]{
  return readFileSync(lastGeekNewsURLFile).toString().split('\n').map(v => v.trim());
}
function setLastGeekNewsURLs(value:string[]):void{
  writeFileSync(lastGeekNewsURLFile, value.join('\n'));
}