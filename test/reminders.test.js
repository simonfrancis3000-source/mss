import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReminderCommand, matchReminder, validReminderTitle } from '../src/reminders.js';

test('explicit to-do commands cover chat and spoken phrasing',()=>{
  assert.deepEqual(parseReminderCommand('Add finding the dishwasher model number to my to-do list'),{action:'add',title:'finding the dishwasher model number'});
  assert.deepEqual(parseReminderCommand('Add a reminder to give details of the new dishwasher when it gets installed'),{action:'add',title:'give details of the new dishwasher when it gets installed'});
  for(const phrase of ["What's on my to-do list?",'What are my reminders?','List my reminders']) assert.equal(parseReminderCommand(phrase)?.action,'list',phrase);
  assert.deepEqual(parseReminderCommand('Mark the dishwasher reminder as done'),{action:'complete',query:'the dishwasher'});
  assert.equal(parseReminderCommand('Remove the dishwasher reminder')?.action,'delete');
  assert.deepEqual(parseReminderCommand('Change the dishwasher reminder to Find the label'),{action:'edit',query:'dishwasher',title:'Find the label'});
  assert.equal(parseReminderCommand('I will find the dishwasher model later'),null);
  assert.equal(parseReminderCommand('Change my preferred room temperature to 20 degrees'),null);
  assert.equal(parseReminderCommand('The dishwasher reminds me of my old one'),null);
});
test('destructive commands require one unambiguous matching item',()=>{
  const items=[{id:'a',title:'Find the dishwasher model'},{id:'b',title:'Replace dishwasher filter'}];
  assert.equal(matchReminder(items,'dishwasher').status,'ambiguous');
  assert.equal(matchReminder(items,'model').item.id,'a');
  assert.equal(matchReminder(items,'all').status,'ambiguous');
  assert.equal(matchReminder(items,'oven').status,'missing');
});
test('vague or oversized reminder content is not saved',()=>{
  assert.equal(validReminderTitle('it'),''); assert.equal(validReminderTitle('x'.repeat(501)),'');
  assert.equal(validReminderTitle('Find the model.'),'Find the model');
});

test('conversation confirms only persisted changes and refuses ambiguous deletion', async()=>{
  const {readFile}=await import('node:fs/promises'); const vm=await import('node:vm');
  const source=await readFile(new URL('../src/synqme.js',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('async function handleTodoCommand('),source.indexOf("document.querySelector('#todoReminders')"));
  const items=[{id:'a',title:'Find dishwasher model',completed:false},{id:'b',title:'Order dishwasher filter',completed:false}];
  const writes=[];
  const ctx=vm.createContext({cloudUserId:'owner-a',supabase:{},todoItems:items,todoAwaitingTitle:false,loadTodoReminders:async()=>true,matchReminder,validReminderTitle,writeTodoReminder:async(...args)=>{writes.push(args);}});
  vm.runInContext(block,ctx);
  assert.match(await ctx.handleTodoCommand({action:'delete',query:'dishwasher'}),/more detail/i);
  assert.equal(writes.length,0);
  assert.match(await ctx.handleTodoCommand({action:'complete',query:'model'}),/Marked as complete/);
  assert.equal(writes[0][1].id,'a');
  ctx.writeTodoReminder=async()=>{throw Error('offline');};
  assert.match(await ctx.handleTodoCommand({action:'add',title:'Find the model'}),/could not save/i);
  assert.doesNotMatch(await ctx.handleTodoCommand({action:'add',title:'Find the model'}),/^Added/);
});
