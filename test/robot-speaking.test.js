import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {syncRobotSpeaking} from '../src/robot-speaking.js';

function node({hidden=false,image=true}={}) {
 return {hidden,firstElementChild:image?{}:null,attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
}
test('audible playback animates only the current companion and returns every avatar to rest',()=>{
 const core=node(),previous=node(),latest=node();const nodes=[core,previous,latest];
 const root={querySelector:()=>core,querySelectorAll(selector){return selector==='[data-robot-speaking]'?nodes.filter(n=>n.attrs['data-robot-speaking']):[previous,latest];}};
 syncRobotSpeaking(root,true);assert.equal(core.attrs['data-robot-speaking'],'true');assert.equal(latest.attrs['data-robot-speaking'],'true');assert.equal(previous.attrs['data-robot-speaking'],undefined);
 syncRobotSpeaking(root,false);assert.ok(nodes.every(n=>!n.attrs['data-robot-speaking']));
 latest.hidden=true;core.firstElementChild=null;syncRobotSpeaking(root,true);assert.ok(nodes.every(n=>!n.attrs['data-robot-speaking']));
});
test('every built-in companion retains its face and has a distinct speaking mouth',async()=>{
 const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function robotSvgMarkup('),source.indexOf('function saveRobotAppearance('));
 const ids=['elo','lumi','pip','nova','miso'];
 const render=new Function('ROBOT_OPTIONS',fn+'; return robotSvgMarkup;')(ids.map(id=>({id,name:id,accent:'#58a6ff'})));
 for(const id of ids){const svg=render(id);assert.match(svg,/class="robot-mouth-rest"/);assert.match(svg,/class="robot-mouth-speaking"/);assert.match(svg,/class="robot-eyes"/);assert.match(svg,new RegExp('robot-svg-'+id));}
 assert.match(source,/syncRobotSpeaking\(document, mode === "speaking"\)/);
});
