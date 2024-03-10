import { AudioPlayer, AudioPlayerStatus, AudioResource, DiscordGatewayAdapterCreator, VoiceConnection, VoiceConnectionStatus, createAudioPlayer, createAudioResource, joinVoiceChannel } from "@discordjs/voice";
import { Client, Guild } from "discord.js";
import { MsEdgeTTS } from "msedge-tts";
import SETTINGS from "../data/settings.json";
import { Logger } from "../utils/Logger";

const maxLength = 200;
const leaveThreshold = 600000;
const voices:Array<[RegExp|null, string]> = [
  [ /^(;[iㅑ])/, "id-ID-GadisNeural" ],
  [ /^(;[zㅋ])/, "zh-CN-XiaoyiNeural" ],
  [ /^(;[jㅓ])|[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u, "ja-JP-NanamiNeural" ],
  [ /^[\x00-\xFF]+$/, "en-US-MichelleNeural" ],
  [ null, "ko-KR-HyunsuNeural" ]
];

export async function processTTSAgent(client:Client, guild:Guild):Promise<void>{
  const tts = new MsEdgeTTS();
  const ttsQueue:AudioResource[] = [];

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
    const targetChannel = message.member?.voice.channel;
    if(!targetChannel){
      await message.react("🤷");
      return;
    }
    if(connection && connection.joinConfig.channelId !== targetChannel.id){
      await message.react("🙅");
      return;
    }
    if(message.content === ";;stop"){
      audioPlayer.stop();
      await message.react("✅");
      return;
    }
    if(message.content === ";;leave"){
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
          ttsQueue.shift();
          if(ttsQueue.length) audioPlayer.play(ttsQueue[0]);
        }
      });
      connection.subscribe(audioPlayer);
    }
    let actualContent = message.content.slice(1, maxLength + 1);
    let offset = 0;
    const [ , voiceName ] = voices.find(([ pattern ]) => {
      if(pattern === null) return true;
      const chunk = actualContent.match(pattern);
      if(!chunk) return false;
      if(chunk[1]) offset = chunk[1].length;
      return true;
    })!;
    await tts.setMetadata(voiceName, MsEdgeTTS.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const stream = tts.toStream(actualContent.slice(offset));
    enqueue(createAudioResource(stream));

    if(timer) global.clearTimeout(timer);
    timer = global.setTimeout(leave, leaveThreshold);
    Logger.log("TTSAgent").put(actualContent).next("Author").put(message.author.tag).out();
  });
  function enqueue(resource:AudioResource):void{
    if(ttsQueue.push(resource) === 1){
      audioPlayer.play(ttsQueue[0]);
    }
  }
  function leave():void{
    if(!connection) return;
    connection.disconnect();
    connection = null;
  }
}