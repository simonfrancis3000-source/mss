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
  const context=vm.createContext({elements,document,renderScenarioJourney:()=>{rendered++;},updateChatScrollbar(){},prepareWelcomeAudioOffer(){},renderMessages(){},closeVoiceExperience(){elements.voiceExperience.hidden=true;},window:{requestAnimationFrame(){},scrollTo(){}}});
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


test('returning from Talk reveals saved chat and scrolls to the latest message without the start gate', async () => {
  const source = await readFile(new URL('../src/synqme.js', import.meta.url), 'utf8');
  const functions = ['syncAppNavigation', 'selectAppView', 'prepareWelcomeAudioOffer', 'renderMessages']
    .map(name => source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'))?.[0]).join('\n');
  const shown = [];
  const elements = { voiceExperience: { hidden: false }, welcomeAudioOffer: { hidden: false },
    chatStage: { hidden: true }, introAudioReplay: { hidden: true },
    chatMessages: { scrollTop: 0, scrollHeight: 900, replaceChildren() { shown.length = 0; } } };
  const state = { messages: [{ role: 'user', content: 'Leave the remote on the side table.' }, { role: 'assistant', content: 'I will leave it there.' }] };
  const document = { body: { dataset: { appView: 'chat' } }, querySelectorAll: () => [], querySelector: () => ({ open: false }) };
  const context = vm.createContext({ elements, state, document, cloudUserId: 'account-a',
    localStorage: { getItem: () => null }, introAudioStorageKey: () => 'intro-account-a',
    syncRobotSpeaking() {}, updateChatScrollbar() {}, renderScenarioJourney() {}, appendMessage: (role, content) => shown.push(content),
    closeVoiceExperience() { elements.voiceExperience.hidden = true; },
    window: { requestAnimationFrame(callback) { callback(); }, scrollTo() {} } });
  vm.runInContext(functions + '\nselectAppView("chat");', context);
  assert.equal(elements.welcomeAudioOffer.hidden, true);
  assert.equal(elements.chatStage.hidden, false);
  assert.deepEqual(shown, state.messages.map(message => message.content));
  assert.equal(elements.chatMessages.scrollTop, 900);
  state.messages = [{ role: 'assistant', content: 'Welcome to your SecondSelf.' }];
  vm.runInContext('prepareWelcomeAudioOffer();', context);
  assert.equal(elements.welcomeAudioOffer.hidden, false);
  assert.equal(elements.chatStage.hidden, true);
});
