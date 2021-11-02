function getBoolean(name:string):boolean{
  return process.argv.includes(name);
}
export const CLOTHES:{
  /**
   * `--dev`
   *
   * 개발 플래그 설정 여부.
   */
  'development'?: boolean
} = {
  development: getBoolean("--dev")
};