import { APIEmbed, Client, Colors, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";
import CREDENTIAL from "../data/credential.json";
import { isFullPage, isFullUser, Client as NotionClient, PageObjectResponse, RichTextItemResponse, UserObjectResponse } from "@notionhq/client";
import assert from "assert";
import { schedule } from "../utils/System";
import { Logger } from "../utils/Logger";

type NotionObject = PageObjectResponse['properties'][string];
const notion = new NotionClient({
  auth: CREDENTIAL.notionAPIKey
});

export async function processNotionAgent(client:Client, guild:Guild):Promise<void>{
  const notionChannel = await guild.channels.fetch(SETTINGS.notion.channel);
  if(!notionChannel?.isTextBased()) throw Error(`Invalid notionChannel: ${SETTINGS.notion.channel}`);
  let list = await fetchDataSource();

  Logger.info("NotionAgent Activation")
    .next("Length").put(list.length)
    .out()
  ;
  schedule(async () => {
    const nextList = await fetchDataSource();
    const embeds:APIEmbed[] = [];

    // 1. 새로 생김
    for(const v of nextList){
      if(list.some(w => w.id === v.id)) break;
      embeds.push({
        title: "🆕 새 페이지",
        color: Colors.Green,
        fields: [
          { name: "이름", value: v.title, inline: true },
          { name: "종류", value: v.category, inline: true },
          { name: "상태", value: formatStatus(v.status), inline: true }
        ],
        author: {
          name: v.creator.name,
          icon_url: v.creator.thumbnail || undefined
        },
        url: v.url
      });
    }
    // 2. 변경됨
    for(const v of nextList){
      const prev = list.find(w => w.id === v.id);
      if(!prev) continue;
      if(v.title === prev.title && v.category === prev.category && v.status === prev.status) continue;
      embeds.push({
        title: "✏️ 페이지 업데이트",
        color: Colors.Purple,
        fields: [
          { name: "이름", value: v.title === prev.title ? v.title : `~~${prev.title}~~ → **${v.title}**`, inline: true },
          { name: "종류", value: v.category === prev.category ? v.category : `~~${prev.category}~~ → **${v.category}**`, inline: true },
          { name: "상태", value: v.status === prev.status ? formatStatus(v.status) : `~~${prev.status}~~ → **${formatStatus(v.status)}**`, inline: true }
        ],
        author: {
          name: v.creator.name,
          icon_url: v.creator.thumbnail || undefined
        },
        url: v.url
      });
    }
    for(let i = 0; i < embeds.length; i += 10){
      await notionChannel.send({
        embeds: embeds.slice(i, i + 10)
      });
    }

    list = nextList;
  }, SETTINGS.notion.interval);
}
async function fetchDataSource():Promise<Array<{
  'id': string,
  'title': string,
  'category': string,
  'creator': {
    'name': string,
    'thumbnail': string|null
  },
  'status': string,
  'url': string,
  'updatedAt': number
}>>{
  const R = await notion.dataSources.query({
    data_source_id: SETTINGS.notion.dataSource,
    sorts: [
      {
        timestamp: "last_edited_time",
        direction: "descending"
      }
    ],
    page_size: 50
  });
  const users:Record<string, UserObjectResponse> = {};
  const unknownUsers = R.results.reduce((pv, v) => {
    assert(isFullPage(v));
    const creatorProperty = v.properties['창작자'];
    assert(creatorProperty.type === "people");
    const creator = creatorProperty.people[0];
    assert(creator.object === "user");
    if(isFullUser(creator)){
      users[creator.id] = creator;
      return pv;
    }
    pv.add(creator.id);
    return pv;
  }, new Set<string>());

  for(const v of unknownUsers){
    const user = await notion.users.retrieve({ user_id: v });
    users[v] = user;
  }
  return R.results.map(v => {
    assert(isFullPage(v));
    const creatorProperty = v.properties['창작자'];
    assert(creatorProperty.type === "people");
    const creator = users[creatorProperty.people[0].id];
    assert(creator?.name);

    return {
      id: v.id,
      title: sanitizeToString(v.properties['이름']),
      category: sanitizeToString(v.properties['종류']),
      creator: {
        name: creator.name,
        thumbnail: creator.avatar_url
      },
      status: sanitizeToString(v.properties['상태']),
      url: v.url,
      updatedAt: Date.parse(v.last_edited_time)
    };
  });
}
function sanitizeToString(notionObject:NotionObject):string{
  const richTextItemsToString = (list:RichTextItemResponse[]) => list.map(v => v.plain_text).join('');

  switch(notionObject.type){
    case "title": return richTextItemsToString(notionObject.title);
    case "status": return notionObject.status?.name || "-";
    case "select": return notionObject.select?.name || "-";
  }
  return `[object NotionObject:${notionObject.type}]`;
}
function formatStatus(value:string):string{
  switch(value){
    case "요청": return "❗ 요청";
    case "발안": return "🤚 발안";
    case "재가": return "🆗 재가";
    case "작업 중": return "⌛ 작업 중";
    case "작업 완료": return "☑️ 작업 완료";
    case "정산 완료": return "✅ 정산 완료";
  }
  return value;
}