/* global __dirname */
/** Fresh production TS modules with synthetic clients, JSON storage, hooks/native props and timers.
 * No device, DOM, React reconciliation/Compiler, network, real account or background-task guarantee. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');
const root = path.resolve(__dirname, '../..');
const disk = new Map();
function runtime() {
  const cache = new Map(), timers = [], cleanup = [], announcements = [];
  const state = { online: false, network: false, reachable: false, host: null, account: 'a', retries: 0, clients: [], queryData: {} };
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let scope;
  const react = {
    useState(initial) { const i = scope.cursor++; if (!(i in scope.slots)) scope.slots[i] = typeof initial === 'function' ? initial() : initial;
      const s = scope; return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
    useRef(v) { return react.useState(() => ({ current: v }))[0]; },
    useMemo(fn, deps) { const ref = react.useRef(); if (!ref.current || deps.some((d,i) => !Object.is(d,ref.current.deps[i]))) ref.current = { deps, value: fn() }; return ref.current.value; },
    useEffect(fn, deps) { react.useMemo(() => { scope.effects.push(fn); }, deps); },
    // The grades hook publishes ownership in a layout effect. This harness
    // flushes both effect types before exposing event callbacks.
    useLayoutEffect(fn, deps) { react.useEffect(fn, deps); },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const jsx = (type, props) => ({ type, props });
  const connectivity = { isOnline: () => state.online, noteRequestError() {}, reportReachable() {},
    connectivity: { subscribe: () => () => {} }, retryConnectivity: () => { state.retries++; } };
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Pressable: 'Pressable', AppState: { addEventListener: () => ({ remove() {} }) },
      AccessibilityInfo: { announceForAccessibility: s => announcements.push(s) } },
    'react-native-reanimated': { FadeIn: { duration: n => n }, FadeOut: { duration: n => n } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 12 }) },
    'lucide-react-native': { CloudUpload: 'CloudUpload', CloudOff: 'CloudOff', WifiOff: 'WifiOff' },
    '@/design': { Icon: 'Icon', Text: 'Text', Callout: 'Callout', motion: { duration: { base: 100 } } },
    '@/design/interop': { AnimatedView: 'AnimatedView' },
    'expo-crypto': { randomUUID: require('node:crypto').randomUUID },
    '@tanstack/react-query': { useQueryClient: () => qc },
    '@/canvas/session': { registerAccountCleanup: fn => cleanup.push(fn), loadStoredClients: async () => state.clients,
      useCanvas: () => ({ account: { id: state.account, user: { id: 'user' } }, client: state.clients.find(c => c.account.id === state.account)?.client }) },
    '@/canvas/query': { useAccountKey: () => state.account, useCanvasMutation: () => ({}),
      useCanvasQuery: key => ({ data: state.queryData[key[2]], isPending: false, refetch: async () => {} }) },
    '@/features/offline/kv': { offlineKv: { getItemSync: k => disk.get(k), setItemSync: (k,v) => disk.set(k,v), removeItemSync: k => disk.delete(k) } },
    '@/features/offline/connectivity': connectivity,
    '@/features/offline/useOnline': { useOnline: () => state.online, useConnectivity: () => state },
  };
  // Minimal filesystem adapter for production draftState (separate from queue JSON storage).
  const files = new Map();
  class Directory { constructor(...parts) { this.uri = parts.map(p=>p.uri ?? p).join('/'); } get exists() { return true; } create() {} delete() {} }
  class File extends Directory { get exists() { return files.has(this.uri); } textSync() { return files.get(this.uri); } writeSync(v) { files.set(this.uri,v); } delete() { files.delete(this.uri); } }
  mocks['expo-file-system'] = { Directory, File, Paths: { document: 'synthetic-documents' } };
  function load(name, parent = path.join(root, 'entry.ts')) {
    let key = name.startsWith('.') ? '@/' + path.relative(root, path.resolve(path.dirname(parent), name)) : name;
    if (mocks[key]) return mocks[key];
    assert.ok(key.startsWith('@/'), `Unmocked module ${key}`);
    const base = path.join(root, key.slice(2));
    const filename = ['.ts','.tsx','/index.ts'].map(ext => base + ext).find(f => fs.existsSync(f));
    assert.ok(filename, `Missing ${key}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function('require','module','exports','setTimeout','clearTimeout',js)(
      n => load(n, filename), module, module.exports, (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, () => {});
    return module.exports;
  }
  function harness(component) { const s = { slots: [], effects: [], cursor: 0 }; return props => {
    scope = s; s.cursor = 0; const tree = component(props); for (const fn of s.effects.splice(0)) fn(); scope = undefined; return tree;
  }; }
  return { load, harness, qc, state, timers, cleanup, announcements };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
(async () => {
  let r = runtime();
  let q = r.load('@/features/offline/queue');
  const planner = r.load('@/features/offline/plannerWrites');
  const requests = r.load('@/features/offline/requests');
  let { CanvasError, CanvasNetworkError, CanvasAuthError } = r.load('@/canvas/client');
  const { createOfflinePresentation } = r.load('@/features/offline/presentation');
  const i18n = r.load('@/i18n/runtime');
  const { en } = r.load('@/i18n/en'), { fr } = r.load('@/i18n/fr'), { ar } = r.load('@/i18n/ar');
  assert.ok(Object.keys(en).length >= 762);
  assert.deepEqual(Object.keys(fr).sort(),Object.keys(en).sort()); assert.deepEqual(Object.keys(ar).sort(),Object.keys(en).sort());
  const title = 'Lab “عربي” <tag> {count} français';
  const input = { title, details: 'raw details', todoDate: new Date('2026-10-29T12:00:00Z'), courseId: 'c' };
  const { plannerKeys } = r.load('@/canvas/api/planner');
  const noteKey = id => ['a', ...plannerKeys.note(id)];
  planner.queueCreateNote(r.qc, 'a', input);
  let w = q.pendingWrites('a')[0]; const temp = w.payload.tempId;
  assert.deepEqual(w.labelDescriptor, { kind: 'planner-add', title });
  planner.queueUpdateNote(r.qc, 'a', temp, { ...input, title: title + ' edited' });
  assert.equal(q.pendingWrites('a').length, 1); w = q.pendingWrites('a')[0];
  assert.equal(w.payload.op, 'create'); assert.equal(w.labelDescriptor.kind, 'planner-edit');
  assert.equal(w.labelDescriptor.title, title + ' edited');
  // Exercise the handler's explicit create+update merge as well as local-ID create+create.
  q.enqueueWrite({...w,payload:{op:'update',id:temp,input:w.payload.input,base:null},label:'Edit retained',labelDescriptor:{kind:'planner-edit',title:'retained'}});
  assert.equal(q.pendingWrites('a')[0].payload.op,'create');
  assert.deepEqual(q.pendingWrites('a')[0].labelDescriptor,{kind:'planner-edit',title:'retained'});
  planner.queueDeleteNote(r.qc, 'a', temp); assert.equal(q.pendingWrites('a').length, 0);
  planner.queueDeleteNote(r.qc, 'a', 'missing');
  assert.equal(q.pendingWrites('a')[0].labelDescriptor.kind, 'planner-delete-untitled');
  q.queueStore.set([]);
  for (const [itemDismissed, dismissed, markedComplete, kind] of [
    [false,true,false,'planner-dismiss'],[true,false,false,'planner-restore'],
    [false,false,true,'planner-done'],[false,false,false,'planner-not-done'],
  ]) {
    const override = r.harness(planner.useQueuedPlannerOverride)();
    await override({ id: 'item', plannableId: '7', plannableType: 'Assignment', title, dismissed: itemDismissed, overrideId: null }, { dismissed, markedComplete });
    assert.equal(q.pendingWrites('a')[0].labelDescriptor.kind, kind);
    assert.deepEqual(q.pendingWrites('a')[0].payload, { itemId: 'item', plannableId: '7', plannableType: 'Assignment', title, overrideId: null, dismissed, markedComplete });
  }
  q.queueStore.set([]);
  // Producers + FIFO: scores separated by a reset cannot coalesce across it.
  const receipts = [];
  const client = { baseUrl: 'https://synthetic.invalid', request: async (p,b) => { receipts.push([p,b]); return {}; } };
  const req = (path, kind, score) => ({ method: 'PUT', path, key: path, body: { score }, label: 'legacy', labelDescriptor: { kind, ...(kind === 'what-if-score' ? { title } : {}) } });
  await requests.sendOrQueue('a', client, req('/score','what-if-score',1));
  await requests.sendOrQueue('a', client, req('/score','what-if-score',2));
  await requests.sendOrQueue('a', client, req('/reset','what-if-reset',null));
  await requests.sendOrQueue('a', client, req('/score','what-if-score',3));
  assert.deepEqual(q.pendingWrites('a').map(w => w.payload.body.score), [2,null,3]);
  await requests.sendOrQueue('b', client, req('/score','what-if-score',9));
  q.addNotice('a','legacy failure',{ kind: 'what-if-failed', title });
  q.addNotice('b','other account');
  const savedWrites = JSON.stringify(q.pendingWrites()), savedNotices = JSON.stringify(q.noticeStore.get());
  // Fresh module instances read the same serialized storage, including running -> pending recovery.
  r = runtime(); q = r.load('@/features/offline/queue'); r.load('@/features/offline/requests');
  ({ CanvasError, CanvasNetworkError, CanvasAuthError } = r.load('@/canvas/client'));
  assert.equal(JSON.stringify(q.pendingWrites()), savedWrites); assert.equal(JSON.stringify(q.noticeStore.get()), savedNotices);
  const stored = freeze(q.pendingWrites()), notices = freeze(q.noticeStore.get());
  let first;
  for (const locale of ['en','fr','ar','en']) {
    // Global foreground language must not affect explicitly scoped presentation.
    i18n.setAccountLocale('unrelated', locale === 'ar' ? 'fr' : 'ar');
    const p = createOfflinePresentation(locale), t = i18n.createTranslator(locale);
    const output = p.label(stored[0]); if (!first) first = output; if (locale === 'en') assert.equal(output, first);
    assert.ok(output.includes(title)); assert.equal(output, t('offline.label.whatIfScore', { title }));
    assert.equal(p.notice(notices[0]), t('offline.notice.whatIfFailed', { title }));
    for (const online of [true,false]) for (const n of [0,1,2,3,11,100]) {
      const list = Array.from({ length: n }, () => stored[0]);
      assert.equal(p.summary(list,online), n === 1 ? t(online ? 'offline.pendingOneOnline' : 'offline.pendingOneOffline', { label: output }) : t(online ? 'offline.pendingOnline' : 'offline.pendingOffline', { count: n }));
    }
    if (locale === 'ar') assert.ok(output.includes('\u2068' + title + '\u2069'));
    for (const bad of [undefined,null,[],0,'planner-add',{}, { kind:'future', title }, { kind:'planner-add',title:7 }]) {
      assert.equal(p.label({label:title,labelDescriptor:bad}),title);
      assert.equal(p.notice({message:title,noticeDescriptor:bad}),title);
    }
    for (const bad of [{kind:'dropped',label:7,detail:'x'}, {kind:'dropped',label:'x'}, {kind:'dropped',label:'x',detail:[]}]) assert.equal(p.notice({message:title,noticeDescriptor:bad}),title);
    for (const kind of ['planner-add','planner-edit','planner-delete','planner-dismiss','planner-restore','planner-done','planner-not-done','what-if-score']) assert.ok(p.label({label:'fallback',labelDescriptor:{kind,title}}).includes(title));
    for (const kind of ['draft-save','draft-discard','planner-delete-untitled','what-if-reset']) assert.notEqual(p.label({label:'fallback',labelDescriptor:{kind}}),'fallback');
    for (const kind of ['planner-deleted','planner-changed','what-if-failed']) assert.ok(p.notice({message:'fallback',noticeDescriptor:{kind,title}}).includes(title));
    assert.notEqual(p.notice({message:'fallback',noticeDescriptor:{kind:'what-if-reset-failed'}}),'fallback');
  }
  assert.equal(JSON.stringify(q.pendingWrites()),savedWrites); assert.equal(JSON.stringify(q.noticeStore.get()),savedNotices);
  r.state.clients = ['a','b'].map(id => ({ account: { id }, client })); r.state.online = true;
  assert.equal((await q.flushQueue()).sent,4);
  assert.deepEqual(receipts.map(x => x[1].body.score),[2,null,3,9]);
  assert.deepEqual(receipts.map(x => x[1].method),['PUT','PUT','PUT','PUT']);
  // Replacing a descriptor-bearing record via a legacy caller clears the old descriptor.
  r.state.online = false;
  q.enqueueWrite({accountId:'a',kind:'request',key:'legacy',payload:{method:'PUT',path:'/legacy'},label:'new',labelDescriptor:{kind:'draft-save'}});
  q.enqueueWrite({accountId:'a',kind:'request',key:'legacy',payload:{method:'PUT',path:'/legacy'},label:'old caller'});
  assert.equal(q.pendingWrites('a')[0].labelDescriptor,undefined);
  q.queueStore.set([]); q.noticeStore.set([]);
  const add = (accountId, mode, descriptor = {kind:'draft-save'}) => q.enqueueWrite({accountId,kind:'test',key:mode,payload:mode,label:'raw legacy label',labelDescriptor:descriptor});
  q.registerWriteHandler('test',{run: async mode => {
    if (mode === 'conflict') throw new q.WriteConflict('legacy conflict',{kind:'planner-deleted',title});
    if (mode === 'old-conflict') throw new q.WriteConflict('old conflict text');
    throw new CanvasError(mode === 'empty' ? '' : title,400,'/synthetic');
  }});
  for (const mode of ['conflict','old-conflict','drop','empty']) add('a',mode);
  r.state.online = true; assert.equal((await q.flushQueue()).dropped,4);
  const dropped = q.noticeStore.get(); assert.equal(dropped[0].noticeDescriptor.kind,'planner-deleted');
  assert.equal(dropped[1].noticeDescriptor,undefined);
  for (const locale of ['en','fr','ar','en']) {
    const p = createOfflinePresentation(locale), t = i18n.createTranslator(locale);
    assert.equal(p.notice(dropped[1]),'old conflict text'); assert.ok(p.notice(dropped[2]).includes(title));
    assert.equal(p.notice(dropped[3]),t('offline.notice.dropped',{label:t('offline.label.draftSave'),detail:t('offline.notice.refused')}));
    assert.equal(p.notice({message:'legacy',noticeDescriptor:{kind:'dropped',label:title,labelDescriptor:{kind:'future'},detail:'server {raw}'}}),t('offline.notice.dropped',{label:title,detail:'server {raw}'}));
  }
  q.noticeStore.reload(); assert.deepEqual(q.noticeStore.get(),JSON.parse(JSON.stringify(dropped)));
  // Retry counter/backoff, per-account FIFO blocking, successful other account, and limit drop.
  r.state.online = false;
  q.registerWriteHandler('test',{run:async mode => { if(mode==='retry') throw new CanvasError('server raw',503,'/synthetic'); }});
  add('a','retry'); add('a','behind'); add('b','success'); r.state.online = true;
  const before = Date.now(); let result = await q.flushQueue(); assert.equal(result.sent,1);
  let retry = q.pendingWrites('a')[0]; assert.equal(retry.attempts,1); assert.equal(retry.status,'retrying');
  assert.ok(retry.nextAttemptAt >= before + 5000); assert.equal(retry.labelDescriptor.kind,'draft-save');
  assert.equal(q.pendingWrites('a')[1].attempts,0); assert.equal((await q.flushQueue()).sent,0);
  q.queueStore.update(list => list.map(w => w.key==='retry' ? {...w,nextAttemptAt:0} : w));
  const secondStart=Date.now(); await q.flushQueue();
  assert.equal(q.pendingWrites('a')[0].attempts,2); assert.ok(q.pendingWrites('a')[0].nextAttemptAt >= secondStart+10000);
  q.queueStore.update(list => list.map(w => w.key==='retry' ? {...w,attempts:7,nextAttemptAt:0} : w));
  result = await q.flushQueue(); assert.equal(result.dropped,1); assert.equal(result.sent,1);
  for (const error of [new CanvasAuthError('/synthetic'), new CanvasNetworkError('network raw')]) {
    r.state.online = false; add('a','keep'); q.registerWriteHandler('test',{run:async () => { throw error; }});
    r.state.online = true; await q.flushQueue(); assert.equal(q.pendingWrites('a')[0].attempts,1); q.queueStore.set([]);
  }
  console.log('PASS descriptors, locale cycles/plurals/raw data, persistence, coalescing, FIFO, drops and retry behavior');
  // Real planner conflict handlers and temporary-ID rewrite during an in-flight create.
  const p2 = r.load('@/features/offline/plannerWrites');
  r.state.online = false; p2.queueCreateNote(r.qc,'a',input);
  const temporary = q.pendingWrites('a')[0].payload.tempId;
  let release, entered;
  const gate = new Promise(resolve => { entered = resolve; });
  const plannerReceipts = [];
  const remote = { id:'real-id', title, details:input.details, todo_date:input.todoDate.toISOString(), course_id:'c' };
  const pc = { baseUrl:'https://synthetic.invalid',
    post:async (path,body) => { plannerReceipts.push(['POST',path,body]); entered(); await new Promise(resolve => {release=resolve;}); return remote; },
    put:async (path,body) => { plannerReceipts.push(['PUT',path,body]); return {...remote,...body}; },
    get:async () => remote, delete:async () => { throw Error('must not delete changed note'); } };
  r.state.clients = [{account:{id:'a'},client:pc}]; r.state.online = true;
  const flushing = q.flushQueue(); await gate;
  r.state.online = false;
  p2.queueUpdateNote(r.qc,'a',temporary,{...input,title:'new title'});
  const laterId = q.pendingWrites('a')[1].id;
  // Same key for another account must not be rewritten.
  q.enqueueWrite({accountId:'b',kind:'planner-note',key:`note:${temporary}`,payload:{op:'create',tempId:temporary,input:{}},label:'b',labelDescriptor:{kind:'planner-add',title:'b'}});
  release(); await flushing;
  const later = q.pendingWrites('a').find(w=>w.id===laterId);
  assert.equal(later.key,'note:real-id'); assert.equal(later.payload.op,'update'); assert.equal(later.payload.id,'real-id');
  assert.deepEqual(later.labelDescriptor,{kind:'planner-edit',title:'new title'});
  assert.equal(q.pendingWrites('b')[0].key,`note:${temporary}`);
  r.state.online=true; await q.flushQueue();
  assert.deepEqual(plannerReceipts,[['POST','/api/v1/planner_notes',{title,details:input.details,todo_date:input.todoDate.toISOString(),course_id:'c'}],
    ['PUT','/api/v1/planner_notes/real-id',{title:'new title',details:input.details,todo_date:input.todoDate.toISOString(),course_id:'c'}]]);
  q.queueStore.set([]); q.noticeStore.set([]); r.state.online=false;
  p2.queueUpdateNote(r.qc,'a','deleted',input);
  // Error class must be from this freshly loaded runtime.
  const CError = r.load('@/canvas/client').CanvasError;
  pc.put=async()=>{throw new CError('raw 404',404,'/synthetic');};
  r.state.online=true; await q.flushQueue();
  assert.deepEqual(q.noticeStore.get()[0].noticeDescriptor,{kind:'planner-deleted',title});
  r.state.online=false;
  r.qc.setQueryData(noteKey('changed'),{...input,id:'changed',linkedUrl:null});
  p2.queueDeleteNote(r.qc,'a','changed'); pc.get=async()=>({...remote,title:'server changed title'});
  r.state.online=true; await q.flushQueue();
  assert.deepEqual(q.noticeStore.get()[1].noticeDescriptor,{kind:'planner-changed',title:'server changed title'});
  // Scoped removal is unchanged.
  r.cleanup.forEach(fn=>fn('a')); assert.equal(q.pendingWrites('a').length,0); assert.equal(q.noticeStore.get().length,0);
  console.log('PASS production planner conflicts, request payloads, temporary-ID rewrite and account isolation');

  // Production what-if callers, with simulated query/hook inputs; no grading behavior changes.
  q.queueStore.set([]); q.noticeStore.set([]); r.state.online=false;
  r.state.clients=[{account:{id:'a'},client}];
  r.state.queryData={course:{currentGradingPeriodId:null,totalsForAllPeriods:true,restrictQuantitativeData:false,hideFinalGrades:false},periods:[],groups:[],saved:{}};
  r.load('@/features/grades/whatIfSaving').setSaveWhatIf(true);
  const gradeHook=r.harness(r.load('@/features/grades/useCourseGrades').useCourseGrades);
  const assignment={id:'assn',name:title,counts:true,pointsPossible:10,submission:{id:'sub',hidden:false,excused:false}};
  r.state.queryData.groups=[{id:'g',weight:0,dropLowest:0,dropHighest:0,neverDrop:[],assignments:[assignment]}];
  gradeHook('course').setWhatIf(assignment,6);
  gradeHook('course').resetWhatIf();
  // A subsequent intentional edit is a new event, not a duplicate callback.
  await Promise.resolve();
  gradeHook('course').setWhatIf(assignment,8);
  assert.deepEqual(q.pendingWrites('a').map(w=>w.labelDescriptor),[{kind:'what-if-score',title},{kind:'what-if-reset'},{kind:'what-if-score',title}]);
  const gradeApi=r.load('@/canvas/api/grades');
  assert.deepEqual(q.pendingWrites('a').map(w=>({method:w.payload.method,path:w.payload.path,body:w.payload.body})),
    [gradeApi.whatIfScoreRequest('sub',6),{body:undefined,...gradeApi.resetWhatIfRequest('course')},gradeApi.whatIfScoreRequest('sub',8)]);
  q.queueStore.set([]); r.state.online=true;
  r.state.clients=[{account:{id:'a'},client:{request:async()=>{throw new Error('synthetic refusal');}}}];
  gradeHook('course').setWhatIf(assignment,9); gradeHook('course').resetWhatIf();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(q.noticeStore.get().map(n=>n.noticeDescriptor),[{kind:'what-if-failed',title},{kind:'what-if-reset-failed'}]);
  console.log('PASS production what-if score/reset caller metadata and failure notices');

  // Production draft producers preserve fixed descriptors through debounce, reload and discard.
  q.queueStore.set([]); r.state.online=false;
  const drafts=r.load('@/features/submissions/draftState'), draftQueue=r.load('@/features/offline/submissionDrafts');
  const target={accountId:'a',courseId:'c',assignmentId:'a',submissionId:'s',attempt:1};
  drafts.editDraft(target,'text','raw content',{activeSubmissionType:'online_text_entry',body:'raw content'});
  draftQueue.queueDraft(target,'text');
  drafts.editDraft(target,'text','raw latest',{activeSubmissionType:'online_text_entry',body:'raw latest'});
  draftQueue.queueDraft(target,'text');
  assert.equal(q.pendingWrites('a').length,1); assert.deepEqual(q.pendingWrites('a')[0].labelDescriptor,{kind:'draft-save'});
  assert.equal(q.pendingWrites('a')[0].payload.revision,2);
  q.queueStore.reload(); assert.deepEqual(q.pendingWrites('a')[0].labelDescriptor,{kind:'draft-save'});
  draftQueue.discardSubmissionDraft(target);
  assert.deepEqual(q.pendingWrites('a').map(w=>w.labelDescriptor),[{kind:'draft-save'},{kind:'draft-discard'}]);
  assert.deepEqual(q.pendingWrites('a')[1].payload,{target,generation:drafts.readDraftDocument(target).generation,action:'discard'});
  const draftRecords=freeze(q.pendingWrites('a'));
  for(const locale of ['en','fr','ar','en']) {
    const p=createOfflinePresentation(locale),t=i18n.createTranslator(locale);
    assert.equal(p.label(draftRecords[0]),t('offline.label.draftSave')); assert.equal(p.label(draftRecords[1]),t('offline.label.draftDiscard'));
  }
  console.log('PASS production draft save/discard metadata, coalescing and serialized reload');

  // Native props + simulated hook slots retain banner announcement state between renders.
  const rt=r.load('@/i18n/runtime');
  const banner=r.harness(r.load('@/features/offline/OfflineBanner').OfflineBanner);
  const queued=r.harness(r.load('@/features/offline/QueuedChanges').QueuedChanges);
  r.state.online=false; r.state.network=false; r.state.reachable=false;
  q.queueStore.set([]); q.noticeStore.set([]);
  q.enqueueWrite({accountId:'a',kind:'test',key:'ui',payload:{},label:'legacy',labelDescriptor:{kind:'planner-add',title}});
  q.addNotice('a','legacy notice',{kind:'what-if-failed',title}); q.addNotice('b','hidden notice');
  for (const locale of ['en','fr','ar','en']) {
    rt.setAccountLocale('a',locale); const t=rt.createTranslator(locale);
    let tree=banner(); assert.ok(nodes(tree).some(n=>n.props?.children===t('offline.disconnected')));
    assert.equal(r.announcements.at(-1),t('offline.disconnected'));
    assert.equal(nodes(tree).filter(n=>n.type==='Pressable').length,0);
    r.state.network=true; r.state.host='raw.host.example'; tree=banner();
    assert.equal(r.announcements.at(-1),t('offline.unreachable',{host:'raw.host.example'}));
    let button=nodes(tree).find(n=>n.type==='Pressable'); assert.equal(button.props.accessibilityLabel,t('offline.retryHint',{host:'raw.host.example'}));
    button.props.onPress();
    r.state.host=null; tree=banner(); assert.equal(r.announcements.at(-1),t('offline.unreachable',{host:t('offline.canvas')}));
    const ui=nodes(queued({})).filter(n=>n.type==='Callout'); assert.equal(ui.length,2);
    assert.equal(ui[0].props.title,t('offline.noticeTitle')); assert.equal(ui[0].props.action.label,t('offline.ok'));
    assert.equal(ui[0].props.action.accessibilityLabel,t('offline.dismissHint'));
    assert.equal(ui[0].props.children,createOfflinePresentation(locale).notice(q.noticeStore.get()[0]));
    assert.equal(ui[1].props.action,undefined); assert.equal(ui[1].props.children,createOfflinePresentation(locale).summary(q.pendingWrites('a'),false));
    r.state.online=true; r.state.reachable=true; assert.equal(banner(),null); assert.equal(r.announcements.at(-1),t('offline.online'));
    const count=r.announcements.length; banner(); assert.equal(r.announcements.length,count);
    assert.equal(nodes(queued({})).filter(n=>n.type==='Callout')[1].props.action.label,t('offline.syncNow'));
    r.state.online=false; r.state.network=false; r.state.reachable=false;
  }
  assert.equal(r.state.retries,4);
  nodes(queued({})).find(n=>n.type==='Callout').props.action.onPress();
  assert.equal(q.noticeStore.get().length,1); assert.equal(q.noticeStore.get()[0].accountId,'b');
  assert.equal(queued({kinds:['unrelated']}),null);
  q.queueStore.update(list=>list.map(w=>({...w,status:'running'}))); q.queueStore.reload();
  assert.equal(q.pendingWrites('a')[0].status,'pending'); assert.equal(q.pendingWrites('a')[0].labelDescriptor.kind,'planner-add');
  // Background queue module must keep presentation as type-only, never capture foreground strings.
  const queueSource=fs.readFileSync(path.join(root,'features/offline/queue.ts'),'utf8');
  assert.doesNotMatch(queueSource,/from ['"]@\/i18n/);
  console.log('PASS simulated banner announcements/retry and queued UI locale transitions, filtering and dismissal');
  console.log(`PASS ${Object.keys(en).length} keys per catalog. No native/DOM/Compiler guarantee; clients/storage/timers/hooks simulated.`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
