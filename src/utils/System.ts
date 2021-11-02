import { readFileSync } from "fs";
import { Logger } from "./Logger";
import { TIMEZONE_OFFSET } from "./Utility";

type ScheduleOptions = {
  /**
   * `true`인 경우 시작할 때 한 번 즉시 호출한다.
   */
  'callAtStart': boolean,
  /**
   * `true`인 경우 정시에 호출된다. 가령 1시간마다 호출하려는 경우
   * 시작 시점과는 관계 없이 0시 정각, 1시 정각, …에 맞추어 호출된다.
   */
  'punctual': boolean,
  /**
   * 호출 시점을 늦추는 정도(㎳).
   * 
   * `punctual`이 `true`인 경우에만 유효하다.
   */
  'punctualOffset'?: number
};

export const PACKAGE = JSON.parse(readFileSync("package.json").toString());

/**
 * 주어진 함수가 주기적으로 호출되도록 한다.
 *
 * @param callback 매번 호출할 함수.
 * @param interval 호출 주기(㎳).
 * @param options 설정 객체.
 */
export async function schedule(
  callback:(...args:any[]) => Promise<void>,
  interval:number,
  options?:Partial<ScheduleOptions>
):Promise<void>{
  if(options?.callAtStart){
    await callback();
  }
  if(options?.punctual){
    onTick(true);
  }else{
    global.setTimeout(onTick, interval);
  }
  async function onTick(manual?:boolean):Promise<void>{
    try{
      if(!manual) await callback();
    }catch(e){
      Logger.warning("Callee Error").put(e instanceof Error ? e.stack : e).out();
    }
    const now = Date.now() + TIMEZONE_OFFSET;
    let gap = options?.punctual
      ? (1 + Math.floor(now / interval)) * interval - now + (options?.punctualOffset || 0)
      : interval
    ;
    if(gap > interval){
      gap -= interval;
    }
    global.setTimeout(onTick, gap);
  }
}
/**
 * 주어진 모듈을 동적으로 불러온다.
 * 
 * @param module 불러올 모듈 이름.
 */
export function dynamicImport<T>(module:string):Promise<{ 'default': T }>{
  return eval(`import("${module}")`);
}