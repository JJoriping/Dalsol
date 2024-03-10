import { AudioPlayer, AudioPlayerStatus, AudioResource, DiscordGatewayAdapterCreator, VoiceConnection, VoiceConnectionStatus, createAudioPlayer, createAudioResource, joinVoiceChannel } from "@discordjs/voice";
import { Client, Guild } from "discord.js";
import { MsEdgeTTS } from "msedge-tts";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";
import { Sorrygle } from "sorrygle";
import { exec } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { resolve } from "path";

const leaveThreshold = 600000;
const voices:Array<[RegExp|null, string]> = [
  [ /^(;[sㄴ])/, "sorrygle" ],
  [ /^(;[iㅑ])/, "id-ID-GadisNeural" ],
  [ /^(;[zㅋ])/, "zh-CN-XiaoyiNeural" ],
  [ /^(;[jㅓ])|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u, "ja-JP-NanamiNeural" ],
  [ /^[\x00-\xFF]+$/, "en-US-MichelleNeural" ],
  [ null, "ko-KR-HyunsuNeural" ]
];

export async function processTTSAgent(client:Client, guild:Guild):Promise<void>{
  const tts = new MsEdgeTTS();
  let ttsQueue:Array<[AudioResource, (() => void)?]> = [];

  let timer:NodeJS.Timeout;
  let connection:VoiceConnection|null;
  let audioPlayer:AudioPlayer;

  client.on('messageCreate', async message => {
    if(!message.channel.isVoiceBased() && !SETTINGS.additionalTTSChannels.includes(message.channelId)){
      return;
    }
    if(!message.content.startsWith(SETTINGS.ttsPrefix)){
      return;
    }
    const doublePrefix = SETTINGS.ttsPrefix.repeat(2);
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
    actualContent = actualContent.slice(offset);
    if(voiceName === "sorrygle"){
      const midiFilePath = `res/fluidsynth/${BigInt(message.id)}.mid`;
      const wavFilePath = `res/fluidsynth/${BigInt(message.id)}.wav`;

      actualContent = actualContent.replaceAll("`", "");
      try{
        await writeFile(midiFilePath, Sorrygle.compile(actualContent));
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
    }else{
      await tts.setMetadata(voiceName, MsEdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  
      const stream = tts.toStream(actualContent);
      enqueue(createAudioResource(stream));
    }
    if(timer) global.clearTimeout(timer);
    timer = global.setTimeout(leave, leaveThreshold);
    Logger.log("TTSAgent").put(actualContent).next("Author").put(message.author.tag).out();
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
}