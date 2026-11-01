import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('bottom navigation selects journey and chat, with voice taking the active state while open',async()=>{
  const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
  const functions=['syncAppNavigation','selectAppView'].map(name=>source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))?.[0]).join('\n');
  const buttons=['chat','talk','journey'].map(appTab=>({dataset:{appTab},current:null,setAttribute(name,value){this.current=value;},removeAttribute(){this.current=null;}}));
  const workspace={open:false};
  const elements={voiceExperience:{hidden:true}};
  const document={body:{dataset:{appView:'chat'}},querySelectorAll:()=>buttons,querySelector:()=>workspace};
  let rendered=0;
  const context=vm.createContext({elements,document,renderScenarioJourney:()=>{rendered++;},updateChatScrollbar(){},closeVoiceExperience(){elements.voiceExperience.hidden=true;},window:{requestAnimationFrame(){},scrollTo(){}}});
  vm.runInContext(functions+'\n;globalThis.navigation={syncAppNavigation,selectAppView};',context);
  context.navigation.selectAppView('journey');
  assert.equal(document.body.dataset.appView,'journey');
  assert.equal(workspace.open,true);
  assert.equal(buttons[2].current,'page');
  assert.equal(rendered,1);
  elements.voiceExperience.hidden=false;
  context.navigation.syncAppNavigation();
  assert.equal(buttons[1].current,'page');
  context.navigation.selectAppView('chat');
  assert.equal(elements.voiceExperience.hidden,true);
  assert.equal(workspace.open,false);
  assert.equal(buttons[0].current,'page');
});
