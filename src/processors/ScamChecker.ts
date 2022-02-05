import { Client, Guild } from "discord.js";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const SCAM_TABLE = {
  '허위 니트로 링크': /https?:\/\/dis[cords0]{3,5}e?\.gift\//
};

export async function processScamChecker(client:Client, guild:Guild):Promise<void>{
  client.on('messageCreate', async message => {
    // 기능: 금지된 내용 검열
    for(const [ k, v ] of Object.entries(SCAM_TABLE)){
      if(!message.content.match(v)){
        continue;
      }
      Logger.warning("Scam").put(message.author.id)
        .next("Content").put(message.content)
        .next("Reason").put(k)
        .out()
      ;
      await message.member?.timeout(SETTINGS.scamTimeout, k);
      await message.reply({
        embeds: [{
          title: "⚠ 경고",
          color: 'ORANGE',
          description: [
            "금지된 내용 입력이 감지되어 자동 타임아웃 처리되었습니다.",
            `> 사유: ${k}`
          ].join('\n')
        }]
      });
      await message.delete();
    }
  });
}
