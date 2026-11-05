// Analyze an authorized PCM16 WAV capture locally. No audio leaves this process.
import {readFile} from 'node:fs/promises';
import {measurePcmQuality} from '../src/audio-quality.js';
const path=process.argv[2];
if(!path){console.error('Usage: node scripts/analyze-phonic-pcm.mjs capture.wav');process.exit(2);}
const bytes=await readFile(path);
if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Expected a WAV capture.');
let offset=12,format,data;
while(offset+8<=bytes.length){const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(offset+8+size>bytes.length)throw Error('Truncated WAV chunk.');if(tag==='fmt ')format={encoding:bytes.readUInt16LE(offset+8),channels:bytes.readUInt16LE(offset+10),sampleRate:bytes.readUInt32LE(offset+12),bits:bytes.readUInt16LE(offset+22)};if(tag==='data')data=bytes.subarray(offset+8,offset+8+size);offset+=8+size+(size%2);}
if(format?.encoding!==1||format.bits!==16||!data)throw Error('Expected PCM16 WAV audio.');
const pcm=new Int16Array(Math.floor(data.length/2));for(let i=0;i<pcm.length;i++)pcm[i]=data.readInt16LE(i*2);
console.log(JSON.stringify({format,...measurePcmQuality(pcm),durationSeconds:pcm.length/format.sampleRate/format.channels,
 interpretation:'Clipping here indicates clipping in the captured signal. Playback gain cannot reconstruct already-clipped samples. Listening and packet/buffer timing remain separate checks.'},null,2));
