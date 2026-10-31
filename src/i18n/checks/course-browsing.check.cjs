/* global __dirname */
/** Fresh production TS with simulated hooks/native controls and synthetic Canvas clients.
 * No React reconciliation/Compiler, device, browser, real account, or native focus/layout claims. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map(), calls = [], timers = [];
let scope;
const state = { queries: {}, changes: [], prefs: [], params: { courseId: '42' } };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(v) { return react.useState(() => ({ current: v }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d,i) => !Object.is(d,r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useEffect(fn, deps) { react.useMemo(() => { scope.effects.push(fn); }, deps); },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
react.useCallback = (fn,deps) => react.useMemo(() => fn,deps);
react.useLayoutEffect = (fn, deps) => {
  const s = scope, i = s.cursor++, old = s.slots[i];
  if (!old || !deps || deps.some((v,j) => !Object.is(v, old.deps[j]))) {
    const slot = { deps }; s.slots[i] = slot;
    s.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
  }
};
const jsx = (type,props) => ({ type,props });
const success = data => ({ data, isSuccess: true, isPending: false, isError: false, refetch() { calls.push('refetch'); } });
const qc = { invalidateQueries: x => calls.push(x), refetchQueries: x => calls.push(x), setQueryData() {}, cancelQueries() {} };
const native = new Proxy({ Platform: { OS: 'android' }, Alert: { alert() {} }, AccessibilityInfo: { announceForAccessibility() {} } }, { get: (o,k) => o[k] ?? k });
const controls = new Proxy({ useTheme: () => ({ scheme: 'light', colors: {} }), haptics: { selection() {}, error() {}, success() {} },
  deriveAccent: () => ({ accent: '#000' }), useToast: () => ({ show: x => calls.push(x) }) }, { get(o,k) { if (k === 'courseColors') return load('@/design/tokens/colors').courseColors; return o[k] ?? k; } });
const mock = {
  '@/lib/cn': { cn: (...x) => x.filter(Boolean).join(' ') },
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
  'lucide-react-native': new Proxy({}, { get: (_,k) => k }),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'expo-router': { router: { push: x => calls.push(x), canGoBack: () => false, replace: x => calls.push(x) }, Stack: { Screen: 'Stack.Screen' }, useLocalSearchParams: () => state.params },
  '@tanstack/react-query': { useQueryClient: () => qc },
  '@/design': controls, '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/i18n/LocalizedText': { LocalizedText: 'Text' },
  'react-native-reanimated': { FadeIn: {}, FadeOut: {}, LinearTransition: {} },
  '@/canvas/session': { useCanvas: () => ({ account: { id: 'a', baseUrl: 'https://school.invalid', user: { id: 'u' } } }) },
  '@/canvas/query': { useAccountKey: () => 'a', useCanvasQuery: key => state.queries[key.join('/')] ?? success([]),
    useCanvasMutation: (fn, options) => ({ mutate: (v,callbacks) => state.changes.push({ v, fn, options, callbacks }), reset() {}, error: state.joinError }) },
  '@/features/offline/useOnline': { useOnline: () => true },
  '@/features/content/links': { openCanvasLink: (...x) => calls.push(x) },
  '@/features/web/open': { openWebView: x => calls.push(x) },
  '@/features/lti/launch': { predictOpenMode: () => 'browser', useLaunchTool: () => x => calls.push(x) },
  '@/features/lti/preferences': { useToolOpenMode: (account,tool,fallback) => ({ mode: fallback, setMode: mode => state.prefs.push({ account,tool,mode }) }) },
  '@/canvas/api/lti': { bareToolId: id => id.replace('context_external_tool_', '') },
  '@/canvas/api/pages': { FRONT_PAGE: '__front_page__', fetchPages: async () => state.pages ?? [] },
  '@/canvas/api/assignments': { fetchAssignmentGroups: async () => ({ assignments: state.assignments ?? [] }) },
  '@/canvas/api/modules': { fetchModules: async () => state.modules ?? [] },
  '@/canvas/api/discussions': { fetchDiscussions: async () => state.discussions ?? [] },
};
function load(name, parent = path.join(root, 'entry.ts')) {
  const key = name.startsWith('.') ? '@/' + path.relative(root,path.resolve(path.dirname(parent),name)) : name;
  if (mock[key]) return mock[key];
  assert.ok(key.startsWith('@/'), `Unmocked ${key}`);
  const file = ['.ts','.tsx','/index.ts'].map(ext => path.join(root,key.slice(2))+ext).find(fs.existsSync);
  assert.ok(file,key); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file,module);
  let source = fs.readFileSync(file,'utf8');
  // Test-only access to private production components, without widening their production exports.
  const expose = {
    'app/(app)/courses.tsx': ['CourseRow','JoinCourseSheet'],
    'app/(app)/customize-courses.tsx': ['CourseRow','EditCourse'],
    'app/(app)/course/[courseId]/index.tsx': ['TabRow'],
    'features/search/CourseSearch.tsx': ['openResult','ResultGroups'],
    'features/home/CourseInvitations.tsx': ['InvitationCard'],
  }[path.relative(root,file)];
  if (expose) source += '\nexport { '+expose.join(',')+' };';
  const js = ts.transpileModule(source,{ fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require','module','exports','setTimeout','clearTimeout',js)(n => load(n,file),module,module.exports,fn => { timers.push(fn); return fn; },fn => { const i=timers.indexOf(fn); if(i>=0) timers.splice(i,1); });
  return module.exports;
}
function harness(fn) { const s={ slots: [],effects: [],cursor: 0 }; return props => { scope=s;s.cursor=0;const tree=fn(props);for(const effect of s.effects.splice(0)) effect();scope=null;return tree; }; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree,...nodes(tree.props?.children)];
const find = (tree,type,predicate=()=>true) => nodes(tree).find(n=>n.type===type && predicate(n.props))?.props;
const texts = tree => JSON.stringify(tree,(_k,v)=>typeof v==='function'? undefined:v);
const freeze = x => { if(x && typeof x==='object') { Object.freeze(x);Object.values(x).forEach(freeze); } return x; };
const i18n=load('@/i18n/runtime'), dates=load('@/lib/dates');
const setLocale = locale => { i18n.setAccountLocale('a',locale);return i18n.createTranslator(locale); };
const course = freeze({ id:'42',name:'Other past courses',originalName:'Course',nickname:'My اسم',code:'RAW-1',color:'#123456',isFavorite:true,onHome:true,timing:'future',term:{ id:'t',name:'Other past courses',startAt:new Date('2027-01-01T01:00:00Z'),endAt:new Date('2027-03-01') } });
(async () => {
  const p=load('@/features/course/presentation'), nav=load('@/features/course/navigation');
  const all=load('@/app/(app)/courses'), custom=load('@/app/(app)/customize-courses');
  const search=load('@/features/search/CourseSearch'), home=load('@/app/(app)/course/[courseId]/index');
  const enrollment=load('@/canvas/api/enrollments'), api=load('@/canvas/api/courses'), searchApi=load('@/canvas/api/search');
  const joinPresentation=load('@/features/course/joinPresentation');
  const row=harness(all.CourseRow), edit=harness(custom.EditCourse), join=harness(all.JoinCourseSheet), searchView=harness(search.CourseSearch), customRow=harness(custom.CourseRow);
  const now=new Date('2026-12-01');
  const rowProps={course,color:course.color,now}, changes=[];
  const editProps={course,disabled:false,onChange:x=>changes.push(x)};
  const joinProps={visible:true,onClose(){},onJoined:x=>calls.push(x)};
  let t=setLocale('en');
  let e=edit(editProps);find(e,'TextField',x=>x.label===t('customize.nickname')).onChangeText(' Unsent اسم ');
  find(e,'TextField',x=>x.label===t('customize.customColor')).onChangeText('#abcdef');
  let j=join(joinProps);find(j,'TextField').onChangeText('https://school.invalid/enroll/abc123');
  state.queries['courses/42/search/mode']=success('titles');
  const results=freeze([{key:'assignment:9',id:'9',kind:'assignment',title:'Raw élève اسم',snippet:'Canvas source',htmlUrl:'/a',relevance:null}]);
  state.queries['courses/42/search/index']=success(results);
  let sv=searchView({courseId:'42'});find(sv,'SearchField').onChangeText('élève');searchView({courseId:'42'});timers.splice(0).forEach(fn=>fn());
  const grouped=harness(search.ResultGroups);
  const choice=harness(() => load('@/features/lti/ToolOpenChoice').useToolOpenChoice('88','Raw tool اسم','browser'));
  choice().choose();
  for(const locale of ['en','fr','ar','en']) {
    t=setLocale(locale);
    for(const zone of ['America/Los_Angeles','Asia/Tokyo']) {
      dates.setDisplayTimeZone(zone);
      const r=row(rowProps);
      const date=new Intl.DateTimeFormat(locale,{calendar:'gregory',timeZone:zone,month:'short',day:'numeric',year:'numeric'}).format(course.term.startAt);
      assert.equal(r.props.subtitle,`RAW-1 · ${t('courses.starts',{date})}`);
      assert.equal(r.props.title,course.name);
    }
    e=edit(editProps);
    assert.equal(find(e,'TextField',x=>x.label===t('customize.nickname')).value,' Unsent اسم ');
    assert.equal(find(e,'TextField',x=>x.label===t('customize.customColor')).value,'#abcdef');
    find(e,'Button',x=>x.children===t('customize.saveNickname')).onPress();
    assert.deepEqual(changes.at(-1),{kind:'nickname',courseId:'42',nickname:' Unsent اسم '});
    find(e,'Button',x=>x.children===t('customize.useCustomColor')).onPress();
    assert.deepEqual(changes.at(-1),{kind:'color',courseId:'42',color:'#ABCDEF'});
    const palette=nodes(e).filter(n=>n.props?.accessibilityRole==='radio');
    assert.equal(palette.length,12);palette[0].props.onPress();assert.equal(changes.at(-1).color,load('@/design/tokens/colors').courseColors[0].light);
    assert.ok(p.colorName('#ABCDEF',t).includes('#ABCDEF'));
    const cr=customRow({course,index:0,count:3,disabled:false,onChange:x=>changes.push(x),onMove:(...x)=>calls.push(x),onEdit(){}});
    cr.props.onAccessibilityAction({nativeEvent:{actionName:'favorite'}});assert.deepEqual(changes.at(-1),{kind:'favorite',courseId:'42',favorite:false});
    cr.props.onAccessibilityAction({nativeEvent:{actionName:'moveDown'}});assert.deepEqual(calls.at(-1),[0,1]);
    j=join(joinProps);assert.equal(find(j,'TextField').value,'https://school.invalid/enroll/abc123');find(j,'Button').onPress();assert.equal(state.changes.at(-1).v,'https://school.invalid/enroll/abc123');
    sv=searchView({courseId:'42'});assert.equal(find(sv,'SearchField').value,'élève');assert.ok(texts(sv).includes(t('search.results',{count:1})));
    const g=grouped({courseId:'42',results,smart:false});assert.equal(find(g,'ListItem').title,results[0].title);assert.equal(find(g,'ListItem').subtitle,results[0].snippet);
    assert.equal(find(g,'ListGroup').header,t('search.kind.assignment'));
    const c=choice();assert.equal(c.sheet.props.visible,true);assert.equal(c.sheet.props.title,t('tool.where',{name:'Raw tool اسم'}));assert.equal(c.mode,'browser');
    for(const count of [0,1,2,3,11,100]) {
      assert.ok(!t('search.results',{count}).includes('{'));assert.ok(!t('courses.restricted',{count}).includes('{'));
      assert.ok(t('search.results',{count}).includes(new Intl.NumberFormat(locale).format(count)));
    }
    for(const view of ['modules','assignments','syllabus','wiki','feed']) {
      const tab={id:'home',label:'Canvas home اسم',htmlUrl:'/home',fullUrl:'https://school.invalid/home',external:false};
      const action=nav.tabAction(tab,'42',view,t);
      if(view==='feed') {assert.equal(action.title,t('course.default.feed'));assert.equal(action.url,tab.fullUrl);}
      else {assert.equal(action.kind,'route');assert.equal(action.target.params.courseId,'42');assert.equal(action.target.params[view==='wiki'?'pageUrl':'fromHome'],view==='wiki'?'__front_page__':'1');}
      const tr=harness(home.TabRow)({tab,courseId:'42',defaultView:view});assert.equal(find(tr,'ListItem').title,tab.label);assert.equal(find(tr,'ListItem').subtitle,nav.defaultViewLabel(view,t));
    }
  }
  find(choice().sheet,'ListItem',x=>x.title===t('tool.openApp')).onPress();assert.deepEqual(state.prefs.at(-1),{account:'a',tool:'88',mode:'app'});assert.equal(choice().sheet.props.visible,false);
  const mode=harness(load('@/features/lti/ToolOpenChoice').ToolOpenModeControl)({toolId:'88',fallback:'browser'});find(mode,'SegmentedControl').onChange('browser');assert.deepEqual(state.prefs.at(-1),{account:'a',tool:'88',mode:'browser'});
  for(const bad of [undefined,null,'','unknown','constructor','toString','__proto__','hasOwnProperty']) {
    assert.equal(nav.asDefaultView(bad),'modules');assert.equal(nav.tabAction({id:'home',label:'Raw',htmlUrl:'/home'},'42',bad).target.pathname,'/course/[courseId]/modules');
  }
  for(const id of ['assignments','modules','pages','syllabus','quizzes','people','files','grades','announcements','discussions','conferences','search','outcomes']) {
    const tab={id,label:'RAW label',htmlUrl:'/raw',fullUrl:null};const a=nav.tabAction(tab,'42','modules');assert.equal(a.target.pathname,`/course/[courseId]/${id}`);assert.deepEqual(a.target.params,{courseId:'42',canvasUrl:'/raw'});
  }
  for(const id of ['collaborations','unknown','constructor','toString','__proto__']) assert.deepEqual(nav.tabAction({id,label:'RAW label',htmlUrl:'/raw'},'42','modules'),{kind:'web',url:'/raw',title:'RAW label'});
  const tool=nav.tabAction({id:'context_external_tool_88',label:'RAW tool',htmlUrl:'/fallback',launchUrl:'/launch',external:true},'42','feed',t);
  assert.deepEqual(tool,{kind:'tool',launch:{courseId:'42',toolId:'context_external_tool_88',title:'RAW tool',launchType:'course_navigation',url:'/launch',fallbackUrl:'/fallback'}});
  assert.equal(nav.tabAction({id:'home',label:'Home',htmlUrl:'/'},'42','feed').title,'Recent activity');
  // Full owned screen state and teachers/menu presentation with unchanged query objects.
  const teachers=freeze(['Alice','Bob','اسم']);
  const tabData=freeze([{id:'home',label:'RAW Home',hidden:false,htmlUrl:'/home'},{id:'assignments',label:'RAW Assignments',hidden:true,htmlUrl:'/assignments'}]);
  state.queries['courses/42']=success({name:'RAW Course',code:'RAW',term:'RAW Term',teachers,defaultView:'feed'});
  state.queries['courses/42/tabs']=success(tabData);
  const homeView=harness(home.default), customizeView=harness(custom.default), allView=harness(all.default);
  state.queries['courses/customize']=success([course,{...course,id:'5',name:'Other',onHome:true}]);
  state.queries['courses/enrolled']=success({courses:[course],restrictedCount:3});
  let ct=customizeView();let items=nodes(ct).filter(n=>n.type===custom.CourseRow);items[0].props.onEdit();
  let at=allView();find(at,'SearchField').onChangeText('Other');
  for(const locale of ['en','fr','ar']) {
    t=setLocale(locale);const changesBefore=state.changes.length, callsBefore=calls.length;
    const ht=homeView();assert.ok(texts(ht).includes(new Intl.ListFormat(locale,{style:'long',type:'conjunction'}).format(teachers)));assert.equal(ht.props.title,'RAW Course');assert.ok(texts(ht).includes('RAW Assignments'));
    ct=customizeView();assert.equal(find(ct,'Sheet').visible,true);assert.equal(find(ct,'Sheet').title,course.name);
    items=nodes(ct).filter(n=>n.type===custom.CourseRow);assert.deepEqual(items.map(n=>n.props.course.id),['42','5']);
    at=allView();assert.equal(find(at,'SearchField').value,'Other');
    assert.equal(state.changes.length,changesBefore);assert.equal(calls.length,callsBefore); // relabeling performs no writes/refetches
    items[0].props.onMove(0,1);assert.deepEqual(state.changes.at(-1).v,{kind:'order',courseIds:['5','42']});
    const gate=load('@/features/course/TabGate');assert.equal(gate.useTabGate('42','assignments'),'hidden');assert.equal(gate.useTabGate('42','assignments',true),'open');assert.equal(gate.useTabGate('42','home'),'open');
    const disabled=harness(gate.TabDisabled)({courseId:'42',label:'RAW tab'});assert.equal(find(disabled,'EmptyState').description,t('course.tabDisabledHelp',{label:'RAW tab'}));
    const smartGroups=grouped({courseId:'42',smart:true,results:[{...results[0],kind:'page',key:'page:1'},{...results[0],kind:'assignment'},{...results[0],kind:'page',key:'page:2'}]});
    assert.deepEqual(nodes(smartGroups).filter(n=>n.type==='ListGroup').map(n=>n.props.header),[t('search.kind.page'),t('search.kind.assignment')]);
  }
  // UI validation errors translate while invalid unsaved input remains intact.
  t=setLocale('en');e=edit(editProps);find(e,'TextField',x=>x.label===t('customize.customColor')).onChangeText('invalid');
  for(const locale of ['en','fr','ar']){t=setLocale(locale);e=edit(editProps);const field=find(e,'TextField',x=>x.label===t('customize.customColor'));assert.equal(field.value,'invalid');assert.equal(field.error,t('customize.hexError'));}
  // Past grouping uses raw names and fixed IDs, never translated strings.
  const past=[{...course,id:'2',name:'Z',term:null},{...course,id:'1',name:'A',term:null},{...course,id:'3',term:course.term}];
  const groups=p.pastByTerm(past);assert.deepEqual(groups.map(g=>g.key),['t','none']);assert.equal(groups[0].title,'Other past courses');assert.equal(groups[1].title,null);assert.deepEqual(groups[1].courses.map(c=>c.id),['1','2']);
  assert.ok(p.matches({...course,name:'Psychologie'},'psych'));assert.ok(p.matches({...course,name:'élève'},'eleve'));
  // All search destinations, quiz fallback, graded discussions and raw page URLs.
  for(const [r,pathname,param] of [
    [{kind:'quiz',id:'9',quizId:'7'},'/course/[courseId]/quiz/[quizId]',{quizId:'7'}],
    [{kind:'quiz',id:'9'},'/course/[courseId]/assignment/[assignmentId]',{assignmentId:'9'}],
    [{kind:'assignment',id:'9',discussionTopicId:'8'},'/course/[courseId]/discussion/[topicId]',{topicId:'8'}],
    [{kind:'assignment',id:'9'},'/course/[courseId]/assignment/[assignmentId]',{assignmentId:'9'}],
    [{kind:'discussion',id:'9'},'/course/[courseId]/discussion/[topicId]',{topicId:'9'}],
    [{kind:'announcement',id:'9'},'/course/[courseId]/discussion/[topicId]',{topicId:'9'}],
    [{kind:'page',id:'9',pageUrl:'raw-اسم'},'/course/[courseId]/page/[pageUrl]',{pageUrl:'raw-اسم'}],
    [{kind:'module',id:'9'},'/course/[courseId]/modules',{}],
  ]) {search.openResult('42',r,'https://school.invalid');assert.deepEqual(calls.at(-1),{pathname,params:{courseId:'42',...param}});}
  search.openResult('42',{kind:'page',htmlUrl:'/raw-url'},'https://school.invalid');assert.deepEqual(calls.at(-1),['/raw-url','https://school.invalid']);
  assert.deepEqual(searchApi.searchTitles(results,'eleve'),results);
  state.assignments=[{id:'1',kind:'quiz',quizId:'q',name:'Quiz',htmlUrl:'/q'},{id:'2',kind:'discussion',discussionTopicId:'d',name:'Graded',htmlUrl:'/d'}];
  state.discussions=[{id:'d',title:'Duplicate'},{id:'e',title:'Other',preview:'Raw preview'}];
  const index=await searchApi.fetchSearchIndex({},'42');assert.deepEqual(index.map(r=>r.key),['quiz:1','discussion:d','discussion:e']);assert.equal(index[0].quizId,'q');
  const smart=await searchApi.fetchSmartSearch({get:async()=>({results:[{content_id:'3',content_type:'WikiPage',title:'Raw page',body:'Raw body',html_url:'/courses/42/pages/raw',relevance:99}]})},'42','raw query');assert.equal(smart[0].title,'Raw page');assert.equal(smart[0].pageUrl,'raw');
  // Course list ordering/restrictions/invitations remain production adapter decisions.
  const client={get:async()=>({custom_colors:{}}),getAll:async(_url,q)=>q.enrollment_state==='active'?[{id:'1',name:'B'},{id:'9',access_restricted_by_date:true}]:q.enrollment_state==='invited_or_pending'?[{id:'2',name:'A',enrollments:[{enrollment_state:'invited'}]},{id:'3',name:'C'}]:[{id:'1',name:'duplicate'},{id:'4',name:'D'}]};
  assert.deepEqual(await enrollment.fetchEnrolledCourses(client),{courses:[{id:'1',name:'B',code:'',color:load('@/design/tokens/colors').courseColors[0].light,term:null,timing:'current',isFavorite:false},{id:'3',name:'C',code:'',color:load('@/design/tokens/colors').courseColors[1].light,term:null,timing:'future',isFavorite:false},{id:'4',name:'D',code:'',color:load('@/design/tokens/colors').courseColors[2].light,term:null,timing:'past',isFavorite:false}],restrictedCount:1});
  const writes=[];const writeClient={post:async(...x)=>writes.push(['post',...x]),put:async(...x)=>writes.push(['put',...x]),delete:async(...x)=>writes.push(['delete',...x])};
  await api.setFavorite(writeClient,'42',true);await api.setFavorite(writeClient,'42',false);await api.setNickname(writeClient,'42',' Raw اسم ');await api.setNickname(writeClient,'42',' ');await api.setCourseColor(writeClient,'42','#ABCDEF');await api.setDashboardOrder(writeClient,'u',['42','5']);
  assert.deepEqual(writes,[['post','/api/v1/users/self/favorites/courses/42'],['delete','/api/v1/users/self/favorites/courses/42'],['put','/api/v1/users/self/course_nicknames/42',{nickname:'Raw اسم'}],['delete','/api/v1/users/self/course_nicknames/42'],['put','/api/v1/users/self/colors/course_42',{hexcode:'ABCDEF'}],['put','/api/v1/users/u/dashboard_positions',{dashboard_positions:{course_42:0,course_5:1}}]]);
  assert.deepEqual(enrollment.parseJoinInput('https://school.invalid/enroll/abc123'),{code:'ABC123',courseId:null});assert.deepEqual(enrollment.parseJoinInput('https://school.invalid/courses/42?self_enrollment_code=abc123'),{code:'ABC123',courseId:'42'});assert.equal(enrollment.parseJoinInput('bad input'),null);
  const savedFetch=global.fetch;
  try {
    global.fetch=async(url,opts)=>{writes.push([url,JSON.parse(opts.body)]);return {ok:true};};
    assert.equal(await enrollment.joinCourse({url:p=>'https://school.invalid'+p,freshAuthHeaders:async()=>({})},{courseId:'42',code:'ABC123'}),'42');assert.deepEqual(writes.at(-1),['https://school.invalid/api/v1/courses/42/enrollments',{enrollment:{self_enrollment_code:'ABC123',user_id:'self'}}]);
    global.fetch=async()=>({ok:false,status:400,text:async()=>JSON.stringify({user:{errors:{self_enrollment_code:[{type:'full',message:'Raw school detail اسم'}]}}})});
    let error;try{await enrollment.joinCourse({url:p=>p,freshAuthHeaders:async()=>({})},{courseId:'42',code:'ABC123'});}catch(e){error=e;}
    assert.equal(error.presentation.reason,'full');
    for(const locale of ['en','fr','ar']) {t=setLocale(locale);assert.equal(joinPresentation.joinErrorMessage(error,t),t('courses.joinError.full')+' Raw school detail اسم');assert.equal(joinPresentation.joinErrorMessage(new enrollment.JoinError('This course is full. Ask your instructor about a spot.'),t),'This course is full. Ask your instructor about a spot.');}
    for (const type of ['constructor', 'toString', '__proto__', 'future_error']) {
      const detail = 'Unrecognized school error اسم';
      global.fetch = async () => ({ok:false,status:400,text:async()=>JSON.stringify({user:{errors:{self_enrollment_code:[{type,message:detail}]}}})});
      await assert.rejects(enrollment.joinCourse({url:p=>p,freshAuthHeaders:async()=>({})},{courseId:'42',code:'ABC123'}), error => {
        assert.equal(error.presentation?.reason, 'status');
        assert.equal(error.presentation.detail, detail);
        return true;
      });
    }
  } finally {global.fetch=savedFetch;}
  // Existing built-in role metadata and custom role behavior are reused unchanged.
  const invitations=await enrollment.fetchCourseInvitations({getAll:async(url)=>url.includes('enrollments')?[{id:'i',course_id:'42',enrollment_state:'invited',type:'StudentEnrollment',role:'StudentEnrollment'},{id:'j',course_id:'42',enrollment_state:'invited',type:'TeacherEnrollment',role:'Student'}]:[{id:'42',name:'Raw course',course_code:'RAW'}]});
  assert.equal(invitations[0].builtInRole,'StudentEnrollment');assert.equal(invitations[1].builtInRole,undefined);assert.equal(invitations[1].role,'Student');
  const invitation=load('@/features/home/CourseInvitations');
  for(const locale of ['en','fr','ar']) {t=setLocale(locale);for(const i of invitations){const tree=harness(invitation.InvitationCard)({invitation:i});assert.ok(texts(tree).includes(t('invitation.role',{role:i.builtInRole?t(`invitation.role.${i.builtInRole}`):i.role})));}}
  const errors=load('@/features/course/states');t=setLocale('fr');const errorTree=harness(errors.LoadError)({title:'Raw wrapper',error:new Error('Raw detail'),onRetry:()=>calls.push('retry')});assert.equal(errorTree.props.action.label,t('common.retry'));assert.equal(errorTree.props.children,'Raw detail');errorTree.props.action.onPress();assert.equal(calls.at(-1),'retry');
  const en=load('@/i18n/en').en,fr=load('@/i18n/fr').fr,ar=load('@/i18n/ar').ar;assert.deepEqual(Object.keys(en).sort(),Object.keys(fr).sort());assert.deepEqual(Object.keys(en).sort(),Object.keys(ar).sort());
  console.log(`course-browsing checks passed; ${Object.keys(en).length} keys per catalog; synthetic hooks/native controls/clients`);
})().catch(error=>{console.error(error);process.exitCode=1;});
