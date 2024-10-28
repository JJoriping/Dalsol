import { AudioPlayer, AudioPlayerStatus, AudioResource, DiscordGatewayAdapterCreator, VoiceConnection, VoiceConnectionStatus, createAudioPlayer, createAudioResource, joinVoiceChannel } from "@discordjs/voice";
import { exec } from "child_process";
import { Client, Colors, Guild, Message } from "discord.js";
import { unlink, writeFile } from "fs/promises";
import JSZip from "jszip";
import { MsEdgeTTS } from "msedge-tts";
import fetch from "node-fetch";
import { resolve } from "path";
import { Sorrygle } from "sorrygle";
import { Readable } from "stream";
import CREDENTIAL from "../data/credential.json";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const voices:Array<[RegExp|null, string]> = [
  [ /^(;[sㄴ]\s*)/, "sorrygle" ],
  [ /^(;[pㅔ]\s*)/, "sorryfield" ],
  [ /^(;[iㅑ])/, "id-ID-GadisNeural" ],
  [ /^(;[zㅋ])/, "zh-CN-XiaoyiNeural" ],
  [ /^(;[fㄹ])/, "fr-FR-DeniseNeural" ],
  [ /^(;[tㅅ])/, "es-ES-AlvaroNeural" ],
  [ /^(;[dㅇ])/, "ar-SA-HamedNeural" ],
  [ /^(;[jㅓ])|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u, "ja-JP-NanamiNeural" ],
  [ /^[\x00-\xFF]+$/, "en-US-MichelleNeural" ],
  [ null, "ko-KR-InJoonNeural" ]
];

export async function processTTSAgent(client:Client, guild:Guild):Promise<void>{
  const tts = new MsEdgeTTS();
  const doublePrefix = SETTINGS.ttsPrefix.repeat(2);
  let ttsQueue:Array<[AudioResource, (() => void)?]> = [];

  let connection:VoiceConnection|null;
  let audioPlayer:AudioPlayer;
  
  client.on('messageCreate', async message => {
    if(!message.channel.isVoiceBased() && !SETTINGS.ttsChannels.includes(message.channelId)){
      return;
    }
    if(!message.content.startsWith(SETTINGS.ttsPrefix)){
      return;
    }
    const targetChannel = message.member?.voice.channel;
    if(!targetChannel){
      await message.react("🤷");
      return;
    }
    if(connection && connection.joinConfig.channelId !== targetChannel.id){
      await message.react("🙅");
      return;
    }
    if(message.content === `${doublePrefix}stop`){
      audioPlayer.stop();
      await message.react("✅");
      return;
    }
    if(message.content === `${doublePrefix}leave`){
      leave();
      await message.react("✅");
      return;
    }
    if(!connection){
      connection = joinVoiceChannel({
        channelId: targetChannel.id,
        guildId: targetChannel.guildId,
        adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator
      });
      connection.on('stateChange', (prev, next) => {
        if(next.status === VoiceConnectionStatus.Disconnected){
          connection = null;
        }
      });
      audioPlayer = createAudioPlayer();
      audioPlayer.on('error', e => {
        Logger.warning("TTSAgent Error").put(e.message).next("Author").put(message.author.tag).out();
      });
      audioPlayer.on('stateChange', (prev, next) => {
        if(prev.status === AudioPlayerStatus.Playing && next.status === AudioPlayerStatus.Idle){
          ttsQueue[0][1]?.();
          ttsQueue.shift();
          if(ttsQueue.length) audioPlayer.play(ttsQueue[0][0]);
        }
      });
      connection.subscribe(audioPlayer);
    }
    let actualContent = message.content.slice(1);
    let offset = 0;
    const [ , voiceName ] = voices.find(([ pattern ]) => {
      if(pattern === null) return true;
      const chunk = actualContent.match(pattern);
      if(!chunk) return false;
      if(chunk[1]) offset = chunk[1].length;
      return true;
    })!;
    actualContent = actualContent.slice(offset).replace(/[ㄱ-ㅎ](?=[ㄱ-ㅎ])/g, "$& ");

    switch(voiceName){
      case "sorrygle":
        await handleSorrygle(message, actualContent);
        break;
      case "sorryfield":
        await handleSorryfield(message, actualContent);
        break;
      default: {
        await tts.setMetadata(voiceName, MsEdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
        const stream = tts.toStream(actualContent);
        enqueue(createAudioResource(stream));
      }
    }
    Logger.log("TTSAgent").put(actualContent).next("Author").put(message.author.tag).out();
  });
  client.on('voiceStateUpdate', async (prev, next) => {
    if(connection?.state.status !== VoiceConnectionStatus.Ready) return;
    if(!prev.channelId || next.channelId) return;
    const channel = await client.channels.fetch(prev.channelId);
    if(!channel?.isVoiceBased()) throw Error(`Unexpected channel type: ${prev.channelId}`);
    if(!channel.members.has(client.user?.id!)) return;
    if(channel.members.size <= 1){
      leave();
    }
  });
  function enqueue(resource:AudioResource, callback?:() => void):void{
    if(ttsQueue.push([ resource, callback ]) === 1){
      audioPlayer.play(ttsQueue[0][0]);
    }
  }
  function leave():void{
    if(!connection) return;
    connection.disconnect();
    connection = null;
    ttsQueue = [];
  }

  async function handleSorrygle(message:Message, content:string):Promise<void>{
    const midiFilePath = `res/fluidsynth/${BigInt(message.id)}.mid`;
    const wavFilePath = `res/fluidsynth/${BigInt(message.id)}.wav`;
  
    content = content.replaceAll("`", "");
    try{
      await writeFile(midiFilePath, Sorrygle.compile(content));
    }catch(error){
      Logger.warning("TTSAgent Sorrygle").put(error).out();
      message.react("😵");
      return;
    }
    const p = exec(`${resolve("res/fluidsynth/fluidsynth")} ./res/fluidsynth/default.sf2 -F ${wavFilePath} ${midiFilePath}`);
    p.stderr?.pipe(process.stderr);
    p.once('exit', code => {
      unlink(midiFilePath);
      if(code){
        Logger.warning("TTSAgent Fluidsynth").put(code).out();
        message.react("😵");
        return;
      }
      enqueue(createAudioResource(wavFilePath), () => unlink(wavFilePath));
    });
  }
  async function handleSorryfield(message:Message, content:string):Promise<void>{
    if(ttsQueue.length){
      message.react("⌛");
      return;
    }
    let songData:{
      'id': number,
      'title': string,
      'artistTitle': string,
      'duration': number,
      'karaokeData': Record<string, number>,
      'youtubeFront': string
    };
    Logger.log("TTSAgent Sorryfield").put(content).out();
    if(content.startsWith("#")){
      const htmlFetch = await fetch(`https://sorry.daldal.so/song/${parseInt(content.slice(1))}`);
      if(htmlFetch.status !== 200){
        message.react("🤷");
        return;
      }
      const html = await htmlFetch.text();
      const propsChunk = html.match(/window\.__PROPS=(\{.+\})/)?.[1];
      if(!propsChunk){
        message.react("😵");
        return;
      }
      const { data } = JSON.parse(propsChunk);
      songData = data['song'];
      if(!('tj' in songData.karaokeData)){
        message.react("🤷");
        return;
      }
    }else{
      const search:{
        'list': Array<typeof songData>
      } = await fetch(`https://sorry.daldal.so/search`, {
        method: "POST",
        headers: { 'Content-Type': "application/json", 'User-Agent': "Dalsol" },
        body: JSON.stringify({
          title: content,
          page: 0
        })
      }).then(res => res.json());
      const searchQuery = content.replaceAll(" ", "").toLowerCase();
      const target = search.list.find(v => v.title.replaceAll(" ", "").toLowerCase().includes(searchQuery) && 'tj' in v.karaokeData);
      if(!target){
        message.react("🤷");
        return;
      }
      songData = target;
    }
    const chunk = await fetch(`https://sorry.daldal.so/song/dynamic/tj/${songData.karaokeData['tj']}/pack`, {
      headers: {
        'Authorization': `Basic ${CREDENTIAL.sorryfieldBasicAuthKey}`
      }
    });
    if(chunk.status !== 200){
      Logger.warning("TTSAgent Sorryfield").put(content).next("Status").put(chunk.status).out();
      message.react("😵");
      return;
    }
    const zip = await JSZip.loadAsync(await chunk.arrayBuffer());
    const audio = zip.file("audio.mp3")?.nodeStream();
    if(!audio){
      throw Error(`No audio found: ${content}`);
    }
    const reply = await message.reply({
      embeds: [{
        color: Colors.Blue,
        title: "🎵 쏘리들 음악 재생",
        description: `[${songData.artistTitle} - ${songData.title}](https://sorry.daldal.so/song/${songData.id})`,
        thumbnail: { url: `https://img.youtube.com/vi/${songData.youtubeFront}/hqdefault.jpg` },
        footer: { text: `${doublePrefix}stop으로 종료` }
      }]
    });
    const resource = createAudioResource(new Readable().wrap(audio), { inlineVolume: true });
    resource.volume?.setVolume(0.1);
    enqueue(resource, () => reply.delete());
  }
}