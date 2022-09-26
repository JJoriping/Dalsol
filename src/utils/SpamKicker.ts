import { Colors, GuildMember } from "discord.js";
import CREDENTIAL from "../data/credential.json";
import { DateUnit } from "../enums/DateUnit";
import { Logger } from "./Logger";

const INTERVAL = DateUnit.SECOND;
const RECENT_LENGTH = DateUnit.MINUTE;
const SPAM_THRESHOLD = 50;
const PROTECTION_INTERVAL = DateUnit.MINUTE;
const BAN_BATCH = 3;
const BAN_THRESHOLD = 2;
const REGEXP_SPAM_USERNAME = /^[a-z\s]+$/i;

export class SpamKicker{
  private recentKicks:Map<string, number>;
  private recentEntrances:Array<[member:GuildMember, enteredAt:number]> = [];
  private timer:NodeJS.Timer;
  private protectionTimer?:NodeJS.Timeout;

  constructor(){
    this.recentKicks = new Map();
    this.timer = global.setInterval(this.onTick, INTERVAL);
  }
  private onTick = () => {
    const now = Date.now();
    let spamScore = 0;

    for(let i = 0; i < this.recentEntrances.length; i++){
      const [ member, enteredAt ] = this.recentEntrances[i];

      if(now - enteredAt > RECENT_LENGTH){
        this.recentEntrances.splice(i, 1);
        i--;
      }else{
        spamScore += this.getSpamScore(member);
        if(spamScore > SPAM_THRESHOLD){
          this.protect();
          return;
        }
      }
    }
    if(spamScore > 0) Logger.info("Spam Score").put(spamScore).out();
  };
  private onProtectTick = () => {
    this.protectionTimer = undefined;
    this.recentKicks.clear();
    Logger.log("Protect Clear").out();
  };

  private getSpamScore(member:GuildMember):number{
    const age = Date.now() - member.user.createdTimestamp;
    let R = 1;

    if(member.displayName.match(REGEXP_SPAM_USERNAME)){
      R *= 3;
    }
    if(age < DateUnit.HOUR){
      R *= 3;
    }else if(age < DateUnit.DAY){
      R *= 2;
    }
    if(member.user.flags?.bitfield){
      R *= 0.1;
    }
    if(!member.user.avatarURL()){
      R *= 2;
    }
    return R;
  }
  private async protect():Promise<void>{
    const victims = [ ...this.recentEntrances ];

    this.recentEntrances = [];
    this.protectionTimer = global.setTimeout(this.onProtectTick, PROTECTION_INTERVAL);

    for(let i = 0; i < victims.length; i += BAN_BATCH){
      const batch:Promise<void>[] = [];
      const endJ = Math.min(BAN_BATCH, victims.length - i);

      for(let j = 0; j < endJ; j++){
        batch.push(this.ban(victims[i + j][0]));
      }
      await Promise.all(batch);
    }
  }
  private async ban(member:GuildMember):Promise<void>{
    const banCount = this.recentKicks.get(member.id) || 0;
    const banned = banCount >= BAN_THRESHOLD;

    try{
      const channel = await member.createDM();
  
      await channel.send({
        embeds: [{
          title: "입장 제한 모드",
          color: Colors.Orange,
          description: (banned ? [
            "지속적으로 입장을 시도해 차단되었습니다.",
            `문의: ${CREDENTIAL.protectModeContact}`
          ] : [
            "죄송합니다. 현재 본 서버로 비정상적인 접근이 감지되어 모든 유저들의 입장이 제한된 상태입니다.",
            "잠시 후 다시 시도해 주시기 바랍니다."
          ]).join('\n')
        }]
      });
    }catch(e){}

    Logger.warning("Kick").put(member.id)
      .next("Banned").put(banned)
      .out()
    ;
    if(banned){
      await member.ban({
        deleteMessageDays: 3,
        reason: "입장 제한 모드에서 지속적인 접근 시도"
      });
    }else{
      await member.kick("입장 제한 모드");
    }
    this.recentKicks.set(member.id, banCount + 1);
  }

  public in(member:GuildMember):boolean{
    if(this.protectionTimer){
      this.ban(member);
      return false;
    }
    this.recentEntrances.push([ member, Date.now() ]);
    return true;
  }
}