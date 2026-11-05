import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onboardingPages,FAQ_CATEGORIES,searchFaq} from '../src/getting-started-content.js';
import {computeNativeChatHeight,createAndroidChatKeyboard} from '../src/android-chat-keyboard.js';

const file = path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const titles = onboardingPages('Vikki').map(page=>page.title);

test('Android How It Works contains five panels in the correct order',()=>{
  assert.deepEqual(titles,[
    'Meet Vikki','How training works','Your journey, your pace','Robot Rewards','What happens next?'
  ]);
  assert.equal(onboardingPages('Andy').length,5);
  assert.equal(onboardingPages('Andy')[0].title,'Meet Andy');
});
test('Android on-boarding includes selected name, Premium voice and language editing',()=>{
  const copy=onboardingPages('Vikki')[2].paragraphs.join(' ');
  assert.match(copy,/Premium/);
  assert.match(copy,/two-way voice conversation/);
  assert.match(copy,/Profile - Edit Profile/);
  assert.match(copy,/custom name/);
  assert.match(copy,/conversation language/);
});
test('Free and Premium FAQ describes allowances without exposing any monetary values',()=>{
  const copy=FAQ_CATEGORIES.flatMap(category=>category.questions.map(q=>q.answer+' '+q.question)).join(' ');
  assert.doesNotMatch(copy,/[$€£]|\bUSD\b/i);
  assert.match(copy,/free Chat allowance|introductory Chat allowance/i);
  assert.match(copy,/fair-use Chat allowance/);
  assert.match(copy,/when.*allowance.*runs out/i);
  assert.ok(searchFaq('free').some(section=>section.questions.some(q=>q.id==='free-chat')));
  assert.ok(searchFaq('fair-use').some(section=>section.questions.some(q=>q.id==='premium-chat')));
  assert.ok(searchFaq('allowance').some(section=>section.questions.some(q=>q.id==='chat-allowance')));
});
test('How It Works auto completion enters free Chat and all five panels share a fixed outer size',()=>{
  const help=file('src/help-interface.js');
  const css=file('src/mss-interface.css');
  assert.match(help,/automatic \? 'Start free in Chat'/);
  assert.match(help,/finishGuide\('completed', automatic \? 'chat' : null\)/);
  assert.match(help,/item\.title === 'Robot Rewards'/);
  assert.match(css,/height:min\(590px,calc\(100dvh - 28px\)\)/);
  assert.match(css,/\.mss-onboarding\.mss-guide-rewards\[open\]/);
  assert.match(css,/\.mss-onboarding\.mss-guide-final\[open\]/);
  assert.match(css,/\.mss-onboarding \.mss-guide-actions/);
});
test('Android explicitly uses adjustResize, release 1.15 and build 18',()=>{
  assert.match(file('android/app/src/main/AndroidManifest.xml'),/android:windowSoftInputMode="adjustResize"/);
  assert.match(file('android/app/build.gradle'),/versionCode 18/);
  assert.match(file('android/app/build.gradle'),/versionName "1\.15"/);
});
test('Visible viewport height takes precedence over 100dvh after keyboard opens',()=>{
  assert.equal(computeNativeChatHeight({
    visibleHeight:440,mainTop:86,bottomNavigationHeight:73,keyboardOpen:true
  }),346);
  assert.equal(computeNativeChatHeight({
    visibleHeight:800,mainTop:86,bottomNavigationHeight:73,keyboardOpen:false
  }),633);
  assert.equal(computeNativeChatHeight({
    visibleHeight:420,visibleTop:15,mainTop:85,bottomNavigationHeight:73,keyboardOpen:true
  }),342);
});

function emitter(){
 const events=new Map();
 return {
   addEventListener(name,callback){const list=events.get(name)||[];list.push(callback);events.set(name,list);},
   removeEventListener(name,callback){events.set(name,(events.get(name)||[]).filter(fn=>fn!==callback));},
   emit(name){for(const fn of events.get(name)||[])fn();}
 };
}

test('Gboard resize moves newest robot reply above composer, then restores navigation',()=>{
 const input=emitter();
 const viewport=Object.assign(emitter(),{height:800,offsetTop:0});
 const styles=new Map();
 const main={
   style:{setProperty(name,value){styles.set(name,value)},removeProperty(name){styles.delete(name)}},
   getBoundingClientRect(){return {top:86}}
 };
 const messages={scrollTop:0,scrollHeight:1664};
 const body={dataset:{appView:'chat'},classList:{contains(){return false}}};
 const nav={getBoundingClientRect(){return {height:73}}};
 const composer={};
 const documentObject={
   body,activeElement:null,
   querySelector(selector){return selector==='.app-bottom-nav'?nav:selector==='.chat-composer'?composer:null}
 };
 let nextId=0;
 const pending=new Map();
 const windowObject=Object.assign(emitter(),{
   innerHeight:800,visualViewport:viewport,
   requestAnimationFrame(callback){callback();return ++nextId;},
   cancelAnimationFrame(){},
   setTimeout(callback){const id=++nextId;pending.set(id,callback);return id;},
   clearTimeout(id){pending.delete(id);}
 });
 const handle=createAndroidChatKeyboard({windowObject,documentObject,input,messages,main});
 documentObject.activeElement=input;
 input.emit('focus');
 assert.equal(handle.isKeyboardOpen(),false);
 viewport.height=440;
 viewport.emit('resize');
 assert.equal(handle.isKeyboardOpen(),true);
 assert.equal(body.dataset.mssNativeKeyboard,'open');
 assert.equal(styles.get('--mss-native-chat-height'),'346px');
 assert.equal(messages.scrollTop,1664);
 messages.scrollTop=0;
 handle.scrollLatest();
 assert.equal(messages.scrollTop,1664,'new robot turn returns into visible transcript');
 documentObject.activeElement=null;
 viewport.height=800;
 input.emit('blur');
 viewport.emit('resize');
 assert.equal(handle.isKeyboardOpen(),false);
 assert.equal(body.dataset.mssNativeKeyboard,undefined);
 assert.equal(styles.has('--mss-native-chat-height'),false);
 handle.dispose();
 assert.equal(pending.size,0);
});
test('Android-only Chat keyboard rules hide fixed navigation while typing',()=>{
  const css=file('src/mss-interface.css');
  const app=file('src/synqme.js');
  assert.match(css,/data-mss-native-keyboard='open'\] \.app-bottom-nav/);
  assert.match(css,/--mss-native-chat-height/);
  assert.match(css,/scroll-padding-block-end:12px/);
  assert.match(app,/createAndroidChatKeyboard/);
  assert.match(app,/androidChatKeyboard\?\.scrollLatest\(\)/);
  assert.match(app,/Capacitor\.getPlatform\(\) === 'android'/);
});
