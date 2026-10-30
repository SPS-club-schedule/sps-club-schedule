import test from 'node:test';
import assert from 'node:assert/strict';
import {tutorialKey,tutorialPreferences,canOfferTutorial,spotlightLayout} from '../shared/onboarding.js';

test('skipping or completing is remembered per account and club across reloads',()=>{
  const values=new Map(), storage=()=>({getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)});
  const key=tutorialKey('alice','club'),prefs=tutorialPreferences(storage);
  assert.equal(prefs.seen(key),false);
  prefs.dismiss(key);
  assert.equal(values.get(key),'skipped');
  assert.equal(tutorialPreferences(storage).seen(key),true);
  assert.equal(prefs.seen(tutorialKey('bob','club')),false);
  assert.equal(prefs.seen(tutorialKey('alice','another-club')),false);
  prefs.dismiss(key,true);
  assert.equal(values.get(key),'completed');
  assert.notEqual(tutorialKey('a:b','c'),tutorialKey('a','b:c'));
});

test('blocked storage does not break the app or repeat the guide during the session',()=>{
  const prefs=tutorialPreferences(()=>{throw new Error('Storage disabled');});
  const key=tutorialKey('alice','club');
  assert.equal(prefs.seen(key),false);
  prefs.dismiss(key);
  assert.equal(prefs.seen(key),true);
  assert.equal(prefs.seen(''),true);
});

test('automatic guide waits for a loaded membership and avoids forms and recovery',()=>{
  const state={page:'board',sync:{phase:'ready',board:{club:{id:'club'},me:{id:'member'}}}};
  assert.equal(canOfferTutorial(state,'alice'),true);
  for(const page of ['edit','auth','entry','experience','account','reset','template-edit'])assert.equal(canOfferTutorial({...state,page},'alice'),false);
  for(const flag of ['busy','recovery','error'])assert.equal(canOfferTutorial({...state,[flag]:true},'alice'),false);
  assert.equal(canOfferTutorial(state,null),false);
  assert.equal(canOfferTutorial({...state,sync:{...state.sync,phase:'loading'}},'alice'),false);
  assert.equal(canOfferTutorial({...state,sync:{phase:'ready',board:{}}},'alice'),false);
});

test('spotlight keeps desktop controls clickable with the coach beside them',()=>{
  const {hole,card,shades}=spotlightLayout({left:700,right:1440,top:230,bottom:440},{width:1512,height:714},{width:340,height:230});
  assert.ok(card.left+340<hole.left);
  assert.ok(hole.left<=700&&hole.left+hole.width>=1440);
  assert.ok(hole.top<=230&&hole.top+hole.height>=440);
  assert.equal(shades.reduce((sum,r)=>sum+r.width*r.height,0)+hole.width*hole.height,1512*714);
});

test('phone and keyboard-sized viewports keep the coach inside the screen and outside the spotlight',()=>{
  for(const viewport of [{width:390,height:844},{width:390,height:390,top:100},{width:320,height:568}]) {
    const dimensions={width:Math.min(340,viewport.width-24),height:220};
    const {hole,card,shades}=spotlightLayout({left:24,right:366,top:260,bottom:535},viewport,dimensions);
    assert.ok(card.left>=0&&card.left+dimensions.width<=viewport.width);
    assert.ok(card.top>=(viewport.top||0)&&card.top+220<=(viewport.top||0)+viewport.height);
    assert.ok(card.top>=hole.top+hole.height||card.top+220<=hole.top);
    for(const rect of [hole,...shades])assert.ok(rect.width>=0&&rect.height>=0);
    assert.equal(shades.reduce((sum,r)=>sum+r.width*r.height,0)+hole.width*hole.height,viewport.width*viewport.height);
  }
});
