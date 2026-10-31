/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
 file=path.resolve(file);
 if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file,'utf8'));
 if (!path.extname(file)) file += '.ts';
 if(cache.has(file)) return cache.get(file).exports;
 const m={exports:{}}; cache.set(file,m);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(id=>load(path.resolve(path.dirname(file),id)),m,m.exports);
 return m.exports;
}
(async()=>{
 const {DemoClient,reanchor}=load(path.join(__dirname,'client.ts'));
 const old=global.fetch;global.fetch=()=>{throw Error('Demo attempted network');};
 try {
 const c=new DemoClient(new Date(2030,5,15,12));
 const courses=await c.getAll('/api/v1/courses');assert.ok(courses.length>=4);
 for(const courseId of ['201','241','110','150']) {
  for(const route of ['','/tabs','/assignments','/assignment_groups','/modules','/pages','/front_page','/users','/quizzes','/discussion_topics','/files','/folders']) {
   await c.get(`/api/v1/courses/${courseId}${route}`);
  }
 }
 for(const p of ['/api/v1/planner/items','/api/v1/conversations','/api/v1/users/self/profile','/api/v1/users/self/activity_stream','/api/v1/calendar_events','/api/v1/users/self/groups']) await c.get(p);
 assert.ok(!(await c.get('/api/v1/planner/items')).some(item=>/QA|931[0-9]/.test(JSON.stringify(item))));
 const first=await c.getPage('/api/v1/courses',{per_page:2});assert.equal(first.items.length,2);assert.ok(first.next);
 const note=await c.post('/api/v1/planner_notes',{title:'My demo note',todo_date:'2030-06-15T12:00:00Z'});
 assert.equal((await c.get(`/api/v1/planner_notes/${note.id}`)).title,'My demo note');
 await assert.rejects(new DemoClient().get(`/api/v1/planner_notes/${note.id}`));
 const assignment = '/api/v1/courses/201/assignments/9001/submissions';
 await c.post(assignment,{submission:{submission_type:'online_text_entry',body:'My draft'}});
 assert.equal((await c.get(assignment+'/self')).body,'My draft');
 const quizPath='/api/v1/courses/201/quizzes/9008/submissions';
 const started=await c.post(quizPath,{});const attempt=started.quiz_submissions[0];
 await c.post(`/api/v1/quiz_submissions/${attempt.id}/questions`,{quiz_questions:[{id:'1',answer:'11'}]});
 assert.equal((await c.get(`/api/v1/quiz_submissions/${attempt.id}/questions`)).quiz_submission_questions[0].answer,'11');
 assert.equal((await c.post(`${quizPath}/${attempt.id}/complete`,{})).quiz_submissions[0].workflow_state,'complete');
 await c.put(`/api/v1/planner_notes/${note.id}`,{title:'Finished note'});
 assert.equal((await c.get(`/api/v1/planner_notes/${note.id}`)).title,'Finished note');
 await c.delete(`/api/v1/planner_notes/${note.id}`);
 await assert.rejects(c.get(`/api/v1/planner_notes/${note.id}`));
 const original=require('./data.json').anchor;const moved=reanchor(original,new Date(2030,5,15,12));assert.equal(new Date(moved).getDate(),15);
 await assert.rejects(c.get('/api/v1/login/session_token'),/Not available/);
 const session=fs.readFileSync(path.join(__dirname,'../../canvas/session.tsx'),'utf8');
 assert.match(session,/authMethod !== 'demo'/);assert.match(session,/await runAccountCleanups\(DEMO_ID\)/);assert.match(session,/accounts.some\(a => a.id === previousDemoAccount\)/);
 assert.match(fs.readFileSync(path.join(__dirname,'../../app/(app)/settings.tsx'),'utf8'),/developer.enabled \?/);
 console.log('PASS demo transport, main screen collections, pagination, dates, session writes/reset, lifecycle guards');
 }finally{global.fetch=old;}
})().catch(e=>{console.error(e);process.exitCode=1;});
