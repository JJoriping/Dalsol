declare module "node_perplexityai"{
  function send(query:string):Promise<string>;
  function forget():Promise<void>;
}