import { DateUnit } from "../enums/DateUnit";
import { Logger } from "./Logger";

/**
 * 무시 함수.
 */
export const IGNORE = async (e:any) => {
  Logger.log("Ignore").put(e instanceof Error ? e.stack : e).out();
};
/**
 * 유효한 단일 샤프 인자의 집합.
 */
export const REGEXP_LANGUAGE_ARGS = /\{#(\d+?)\}/g;
/**
 * 시간대 오프셋 값(㎳).
 */
export const TIMEZONE_OFFSET = new Date().getTimezoneOffset() * DateUnit.MINUTE;
/**
 * 제한 길이를 초과하는 내용이 생략된 문자열을 반환한다.
 *
 * @param text 대상 문자열.
 * @param limit 제한 길이.
 */
export function cut(text:string, limit:number):string{
  return text.length > limit
    ? text.slice(0, limit - 1) + "…"
    : text
  ;
}
/**
 * 배열을 생성해 반환한다.
 *
 * @param length 배열의 길이.
 * @param fill 배열의 내용.
 */
export function Iterator<T = undefined>(length:number, fill?:T):T[]{
  return Array(length).fill(fill);
}
/**
 * 객체 배열을 정렬할 때 쓸 비교 함수를 만들어 반환한다.
 *
 * @param retriever 객체로부터 비굣값을 추출하는 함수.
 * @param desc 내림차순 정렬 여부.
 */
export function orderBy<T>(retriever:(v:T) => number, desc?:boolean):(a:T, b:T) => number{
  return desc
    ? (b, a) => retriever(a) - retriever(b)
    : (a, b) => retriever(a) - retriever(b)
  ;
}
/**
 * 객체 배열을 문자열 기준으로 정렬할 때 쓸 비교 함수를 만들어 반환한다.
 *
 * @param retriever 객체로부터 비굣값을 추출하는 함수.
 * @param desc 내림차순 정렬 여부.
 */
export function orderByString<T>(retriever:(v:T) => string, desc?:boolean):(a:T, b:T) => number{
  return desc
    ? (b, a) => retriever(a).localeCompare(retriever(b))
    : (a, b) => retriever(a).localeCompare(retriever(b))
  ;
}
/**
 * 대상 객체의 엔트리 일부만 갖는 객체를 반환한다.
 *
 * @param object 대상 객체.
 * @param keys 선택할 키.
 */
export function pick<T, U extends keyof T>(object:T, ...keys:U[]):Pick<T, U>{
  return keys.reduce<Pick<T, U>>((pv, v) => {
    if(v in object){
      pv[v] = object[v];
    }
    return pv;
  }, {} as any);
}
/**
 * 대상 배열의 원소 하나를 무작위로 반환한다.
 * 
 * @param array 대상 배열.
 */
export function pickArray<T>(array:T[]):T{
  return array[Math.floor(Math.random() * array.length)];
}
/**
 * 대상 객체에서 값이 `undefined`인 것을 뺀 객체를 반환한다.
 * 
 * @param object 대상 객체.
 * @param nanAndNull `true`인 경우 `NaN`과 `null`의 경우에도 모두 제외시킨다.
 */
export function prune<T>(object:T, nanAndNull:boolean = false):Partial<T>{
  const R:Partial<T> = {};

  for(const k in object){
    if(object[k] === undefined || (nanAndNull && (object[k] === null || (typeof object[k] === "number" && isNaN(object[k] as any))))){
      continue;
    }
    R[k] = object[k];
  }
  return R;
}
/**
 * 주어진 범위 안에서 정수를 무작위로 반환한다.
 * 
 * @param min 최솟값 (포함).
 * @param max 최댓값 (포함).
 */
export function randInt(min:number, max:number):number{
  return min + Math.floor((max - min + 1) * Math.random());
}
/**
 * 주어진 확률로 `true`를 반환한다.
 * 
 * @param value 확률.
 */
export function rate(value:number):boolean{
  return Math.random() < value;
}
/**
 * 배열을 주어진 함수에 따라 딕셔너리로 바꾸어 반환한다.
 *
 * @param target 대상 배열.
 * @param placer 값을 반환하는 함수.
 * @param keyPlacer 키를 반환하는 함수.
 */
export function reduceToTable<T, U, V extends number|string>(
  target:T[],
  placer:(v:T, i:number, my:T[]) => U,
  keyPlacer?:(v:T, i:number, my:T[]) => V
):{ [key in V]: U }{
  return target.reduce(keyPlacer
    ? (pv, v, i, my) => {
      pv[keyPlacer(v, i, my)] = placer(v, i, my);
      return pv;
    }
    : (pv, v, i, my) => {
      pv[String(v) as V] = placer(v, i, my);
      return pv;
    }
  , {} as { [key in V]: U });
}
/**
 * 주어진 보상 정보를 정해진 숫자로 반환한다.
 * 
 * @param data 보상 정보.
 */
export function resolveRewardCount(data:number|[number, number]):number{
  if(typeof data === "number"){
    return data;
  }
  return randInt(...data);
}
/**
 * 주어진 시간동안 대기한다.
 * 
 * @param seconds 시간.
 */
export function sleep(seconds:number):Promise<void>{
  return new Promise(res => {
    setTimeout(res, seconds * DateUnit.SECOND);
  });
}
/**
 * 주어진 수가 0보다 크면 + 기호를 붙여 반환한다.
 * 
 * @param value 대상.
 */
export function toSignedString(value:number):string{
  return (value > 0 ? "+" : "") + value;
}