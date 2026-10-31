/* global __dirname */
/** Fresh production TS with simulated hooks/native controls and synthetic Canvas clients.
 * No React reconciliation/Compiler, device, browser, real account, or native focus/layout claims. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const cache = new Map(), calls = [], timers = [];
let scope;
const state = { queries: {}, changes: [], prefs: [], alerts: [], params: { courseId: '42', groupId: 'g' } };
const react = {
  useState(initial) { const s = scope, i = s.cursor++; if (!(i in s.slots)) s.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [s.slots[i], v => { s.slots[i] = typeof v === 'function' ? v(s.slots[i]) : v; }]; },
  useRef(v) { return react.useState(() => ({ current: v }))[0]; },
  useMemo(fn, deps) { const r = react.useRef(); if (!r.current || deps.some((d,i) => !Object.is(d,r.current.deps[i]))) r.current = { deps, value: fn() }; return r.current.value; },
  useEffect(fn, deps) { react.useMemo(() => { scope.effects.push(fn); }, deps); },
  useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
};
react.useLayoutEffect = react.useEffect;
react.useCallback = (fn,deps) => react.useMemo(() => fn,deps);
const jsx = (type,props) => type === 'SectionList' ? ({ type, props: { ...props, children: [
  props.ListHeaderComponent, ...props.sections.flatMap(section => [props.renderSectionHeader({section}), ...section.data.map(item => props.renderItem({item}))]),
  props.sections.length ? null : props.ListEmptyComponent, props.ListFooterComponent,
] } }) : ({ type,props });
const success = data => ({ data, isSuccess: true, isPending: false, isError: false, refetch() { calls.push('refetch'); } });
const qc = { invalidateQueries: x => calls.push(x), refetchQueries: x => calls.push(x), setQueryData() {}, cancelQueries() {} };
const native = new Proxy({ Platform: { OS: 'android' }, Alert: { alert: (...args) => state.alerts.push(args) }, useWindowDimensions: () => ({height: 800}), AccessibilityInfo: { announceForAccessibility() {} } }, { get: (o,k) => o[k] ?? k });
const controls = new Proxy({ useTheme: () => ({ scheme: 'light', colors: {} }), haptics: { selection() {}, error() {}, success() {} },
  deriveAccent: () => ({ accent: '#000' }), useToast: () => ({ show: x => calls.push(x) }) }, { get(o,k) { if (k === 'courseColors') return load('@/design/tokens/colors').courseColors; return o[k] ?? k; } });
const conferenceNavigation = { isFocused: () => true, addListener: () => () => {} };
const conferenceClient = { baseUrl: 'https://school.invalid' };
const mock = {
  '@/lib/cn': { cn: (...x) => x.filter(Boolean).join(' ') },
  react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
  'lucide-react-native': new Proxy({}, { get: (_,k) => k }),
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
  'expo-router': { useIsFocused: () => true, useNavigation: () => conferenceNavigation, router: { push: x => calls.push(x), canGoBack: () => false, replace: x => calls.push(x) }, Stack: { Screen: 'Stack.Screen' }, useLocalSearchParams: () => state.params },
  '@tanstack/react-query': { useQueryClient: () => qc, useInfiniteQuery: ({queryKey}) => {
    const search = queryKey.at(-1).toLowerCase();
    const all = state.queries['courses/42/people']?.data ?? [];
    return success({pages: [{people: search ? all.filter(p => p.name.toLowerCase().includes(search)) : all}]});
  } },
  '@/features/offline/connectivity': { noteRequestError() {}, reportReachable() {} },
  '@/design': controls, '@/design/interop': { AnimatedView: 'AnimatedView' },
  '@/i18n/LocalizedText': { LocalizedText: 'Text' },
  'react-native-reanimated': { SlideInDown: { duration: () => ({}) } },
  '@/canvas/session': { useCanvas: () => ({ client: conferenceClient, account: { id: 'a', baseUrl: 'https://school.invalid', user: { id: 'u' } } }) },
  '@/canvas/query': { useAccountKey: () => 'a', useCanvasQuery: (key, _fn, options) => options?.enabled === false ? {data:undefined,isPending:true} : state.queries[key.join('/')] ?? success([]),
    useCanvasMutation: (fn, options) => ({ mutate: (v,callbacks) => state.changes.push({ v, fn, options, callbacks }), reset() {}, error: state.joinError }) },
  '@/features/offline/useOnline': { useOnline: () => true },
  '@/features/content/browser': { openSignedIn: async (_client, url, mayOpen) => { if (!mayOpen || mayOpen()) calls.push({ browser: url }); }, useOpenSignedIn: () => async url => calls.push({ browser: url }) },
  '@/features/content/links': { openCanvasLink: (...x) => calls.push(x) },
  '@/features/web/open': { openWebView: x => calls.push(x) },
  '@/features/lti/launch': { predictOpenMode: () => 'browser', useLaunchTool: () => x => calls.push(x) },
  '@/features/lti/preferences': { useToolOpenMode: (account,tool,fallback) => ({ mode: fallback, setMode: mode => state.prefs.push({ account,tool,mode }) }) },
  '@/canvas/api/lti': { bareToolId: id => id.replace('context_external_tool_', '') },
  '@/canvas/api/pages': { FRONT_PAGE: '__front_page__', fetchPages: async () => state.pages ?? [] },
  '@/canvas/api/assignments': { fetchAssignmentGroups: async () => ({ assignments: state.assignments ?? [] }) },
  '@/canvas/api/modules': { fetchModules: async () => state.modules ?? [] },
  '@/canvas/api/discussions': { fetchDiscussions: async () => state.discussions ?? [], groupContext: id => ({type:'group',id}) },
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
    'features/groups/CourseGroups.tsx': ['SignupSet'],
    'features/conferences/ConferenceList.tsx': ['RecordingRow','ConferenceCard'],
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
(async () => {
  const people = load('@/canvas/api/people'), groups = load('@/canvas/api/groups'), conferences = load('@/canvas/api/conferences');
  const pp = load('@/features/people/presentation'), gp = load('@/features/groups/presentation'), cp = load('@/features/conferences/presentation');
  const profileUI = load('@/features/people/ProfileSheet'), groupUI = load('@/features/groups/CourseGroups');
  const confUI = load('@/features/conferences/ConferenceList');
  const rosterUI = load('@/app/(app)/course/[courseId]/people');
  const groupHome = load('@/app/(app)/group/[groupId]/index');
  const groupPeople = load('@/app/(app)/group/[groupId]/people');
  const { CanvasError } = load('@/canvas/client');
  const unknownNames = ['constructor', 'toString', '__proto__', 'FutureEnrollment'];
  const unknownProfiles = await Promise.all(unknownNames.map(type => people.fetchPersonProfile({
    get: async () => ({ id: 'p', name: 'Raw', enrollments: [{ type }] }), getAll: async () => [],
  }, '42', 'p')));
  const unknownProviders = await conferences.fetchConferences({ get: async () => ({ conferences:
    unknownNames.map(name => ({ id: name, title: 'Raw', conference_type: name })),
  }) }, { type: 'course', id: '42' });
  assert.deepEqual({
    roles: unknownProfiles.map(p => ({ role: p.role, roles: p.roles, builtinRoles: p.builtinRoles })),
    providers: unknownProviders.map(c => c.provider),
  }, {
    roles: unknownNames.map(() => ({ role: 'student', roles: ['Student'], builtinRoles: ['student'] })),
    providers: unknownNames,
  });
  const rawUser = freeze({id:'person', name:'Teacher', short_name:'Raw short', pronouns:'Teacher', bio:'Teacher', title:'Teacher', pronunciation:'Teacher',
    enrollments:[{type:'StudentEnrollment'},{type:'TeacherEnrollment'}, {type:'TaEnrollment',role:'Teacher'}, {type:'DesignerEnrollment',role:'DesignerEnrollment',course_section_id:'s'}]});
  const reads=[];
  const client = { get: async (...args) => {reads.push(args);return rawUser;}, getAll: async (...args) => {reads.push(args);return [{id:'s',name:'Section'}];} };
  const profile=freeze(await people.fetchPersonProfile(client,'42','person'));
  assert.deepEqual(profile.roles,['Teacher','Course designer','Student']);
  assert.deepEqual(profile.builtinRoles,[null,'designer','student']);
  assert.equal(profile.customRole,null);
  assert.deepEqual(profile.sections,['Section']);
  for(const type of ['TeacherEnrollment','TaEnrollment','DesignerEnrollment','StudentEnrollment','StudentViewEnrollment','ObserverEnrollment']) {
    const p=await people.fetchPersonProfile({...client,get:async()=>({id:'p',name:'Raw',enrollments:[{type,role:type}]})},'42','p');
    assert.equal(p.builtinRoles[0],p.role);
  }
  const noEnrollment=await people.fetchPersonProfile({...client,get:async()=>({id:'p',name:'Raw'})},'42','p');
  assert.deepEqual(noEnrollment.builtinRoles,['student']);
  const custom=await people.fetchPersonProfile({...client,get:async()=>({id:'p',name:'Raw',enrollments:[{type:'StudentEnrollment',role:'Student'}]})},'42','p');
  assert.deepEqual(custom.builtinRoles,[null]);
  assert.equal(custom.customRole,'Student');
  const legacy={...profile,builtinRoles:undefined};
  const person=freeze(people.toPerson(rawUser));
  state.queries['courses/42/people/person']=success(profile);
  state.queries['courses/42/people']=success([person, {...person,id:'u',name:'Raw student',role:'student'}, {...person,id:'ta',name:'Raw TA',role:'ta'}]);
  state.queries['courses/42/tabs']=success([{id:'people',hidden:false}]);
  const roster=harness(rosterUI.default), sheet=harness(profileUI.ProfileSheet);
  const rosterProps={}, sheetProps={person,courseId:'42',userId:'u',onClose(){}};
  let t=setLocale('en');
  let tree=roster(rosterProps);
  find(tree,'ListItem',p=>p.title===person.name).onPress();
  const selected = find(roster(rosterProps),profileUI.ProfileSheet).person;
  find(roster(rosterProps),'SearchField').onChangeText('Teacher');
  roster(rosterProps); for (const timer of timers.splice(0)) timer();
  const initialCalls=calls.length, initialWrites=state.changes.length, initialReads=reads.length;
  for(const locale of ['en','fr','ar','en']) {
    t=setLocale(locale);
    assert.deepEqual(pp.profileRoles(person,legacy,t),legacy.roles);
    assert.equal(pp.profileRoles(custom,custom,t)[0],'Student');
    assert.deepEqual(pp.profileRoles(person,profile,t),['Teacher',t('people.role.designer'),t('people.role.student')]);
    assert.equal(pp.profileRoles({...person,customRole:null},null,t)[0],t('people.role.teacher'));
    tree=roster(rosterProps);
    assert.strictEqual(find(tree,profileUI.ProfileSheet).person,selected);
    assert.equal(find(tree,'SearchField').value,'Teacher');
    assert.equal(nodes(tree).filter(n=>n.type==='ListItem').length,1);
    assert.equal(find(tree,'SectionList').sections[0].title,t('people.heading.teacher'));
    let view=sheet(sheetProps);
    assert.equal(find(view,'Modal').visible,true);
    assert.equal(find(view,'Modal').animationType,'fade');
    assert.ok(texts(view).includes(t('people.role.designer')));
    assert.ok(texts(view).includes('Teacher'));
    assert.ok(texts(view).includes('Section'));
    assert.ok(texts(view).includes(t('people.pronounced',{name:'Teacher'})));
    assert.equal(find(view,'Button').accessibilityHint,t('people.messageHint'));
  }
  assert.equal(calls.length,initialCalls);assert.equal(state.changes.length,initialWrites);assert.equal(reads.length,initialReads);
  find(roster(rosterProps),'SearchField').onChangeText('');
  roster(rosterProps); for (const timer of timers.splice(0)) timer();
  assert.deepEqual(find(roster(rosterProps),'SectionList').sections.map(s=>s.title),['teacher','ta','student'].map(x=>t(`people.heading.${x}`)));
  find(roster(rosterProps),'SegmentedControl').onChange('groups');
  setLocale('ar');assert.equal(find(roster(rosterProps),'SegmentedControl').value,'groups');
  assert.strictEqual(find(roster(rosterProps),profileUI.ProfileSheet).person,selected);
  profileUI.messagePerson('42',{id:'p',name:'Raw, اسم'});
  assert.deepEqual(calls.pop(),{pathname:'/compose',params:{courseId:'42',recipientIds:'p',recipientNames:'Raw  اسم'}});
  native.Platform.OS='ios';
  let closed=0;const ios=harness(profileUI.ProfileSheet);tree=ios({...sheetProps,onClose(){closed++;}});
  let callCount=calls.length;find(tree,'Button').onPress();assert.equal(closed,1);assert.equal(calls.length,callCount);
  find(tree,'Modal').onDismiss();assert.equal(calls.pop().pathname,'/compose');native.Platform.OS='android';
  assert.equal(find(sheet({...sheetProps,userId:'person'}),'Button'),undefined);
  assert.equal(find(sheet({...sheetProps,canMessage:false}),'Button'),undefined);
  assert.equal(find(sheet({...sheetProps,courseId:null}),'Button'),undefined);

  // Group limits, restricted sections, multiple memberships, native alerts, and mutation payloads.
  const g=freeze({id:'g',name:'Group',membersCount:1234,maxMembers:2000,canJoin:true,canLeave:true,concluded:false,courseId:'42'});
  const target=freeze({...g,id:'target',membersCount:2,maxMembers:4});
  const category=freeze({id:'set',name:'Groups',selfSignup:'restricted',groupLimit:8,multipleMemberships:false,groups:[g,target],joinedGroupId:'g'});
  const signup=harness(groupUI.SignupSet), courseGroups=harness(groupUI.CourseGroups), home=harness(groupHome.default), members=harness(groupPeople.default);
  state.queries['groups/course/42/mine']=success([g]);state.queries['groups/course/42/signup']=success([category]);
  state.queries['groups/g']=success({...g,leaderId:'person'});
  state.queries['groups/g/people']=success([person]);
  const tabs=['announcements','discussions','pages','people','files','conferences','unknown','constructor','toString','__proto__'].map(id=>({id,label:'People',htmlUrl:'/raw/'+id,fullUrl:null}));
  state.queries['groups/g/tabs']=success(tabs);
  const memberFirst=members({});find(memberFirst,'ListItem').onPress();
  const memberSelected=find(members({}),profileUI.ProfileSheet).person;
  for(const locale of ['en','fr','ar']) {
    t=setLocale(locale);const n=new Intl.NumberFormat(locale);
    assert.equal(gp.memberLine(g,null,t,locale),t('groups.capacity',{count:1234,max:n.format(2000)}));
    for(const count of [0,1,2,3,11,100,1.5]) {
      assert.equal(gp.memberLine({...g,membersCount:count,maxMembers:null},null,t,locale),t('groups.members',{count}));
      assert.equal(gp.memberLine({...g,membersCount:count,maxMembers:0},10,t,locale),t('groups.members',{count}));
    }
    tree=signup({category,joiningId:null,onJoin(){}});
    assert.equal(find(tree,'Section').title,'Groups');assert.equal(find(tree,'ListGroup').footer,t('groups.restricted'));
    const rows=nodes(tree).filter(n=>n.type==='ListItem').map(n=>n.props);
    assert.equal(rows[0].trailing.props.children,t('groups.joined'));
    assert.equal(rows[1].trailing.props.children,t('groups.join'));
    assert.equal(rows[1].trailing.props.accessibilityLabel,t('groups.joinName',{name:'Group'}));
    const full=signup({category:{...category,groups:[{...target,membersCount:4}]},joiningId:null,onJoin(){}});
    assert.equal(find(full,'ListItem').trailing.props.children,t('groups.full'));
    const denied=signup({category:{...category,groups:[{...target,canJoin:false}]},joiningId:null,onJoin(){}});
    assert.equal(find(denied,'ListItem').trailing,undefined);
    const limit=signup({category:{...category,groups:[{...target,maxMembers:null,membersCount:8}]},joiningId:null,onJoin(){}});
    assert.equal(find(limit,'ListItem').trailing.props.children,t('groups.full'));
    const multi=signup({category:{...category,multipleMemberships:true},joiningId:null,onJoin(){}});
    assert.equal(find(multi,'ListGroup').footer,t('groups.multiple'));
    tree=members({});assert.strictEqual(find(tree,profileUI.ProfileSheet).person,memberSelected);
    assert.ok(find(tree,'ListItem').subtitle.startsWith(t('groups.leader')));
    tree=home({});
    const menu=nodes(tree).filter(n=>n.type==='ListItem').map(n=>n.props);
    for(let i=0;i<tabs.length;i++) {
      assert.equal(menu[i].title,'People');menu[i].onPress();const action=calls.pop();
      if(i<6) {assert.deepEqual(action.params,{groupId:'g'});assert.equal(action.pathname,i===4?'/files/group/[groupId]':`/group/[groupId]/${tabs[i].id}`);}
      else { assert.deepEqual(action,{url:tabs[i].htmlUrl,title:'People'});assert.equal(menu[i].leading.props.icon,'LayoutList');assert.equal(menu[i].subtitle,t('groups.opensCanvas')); }
    }
  }
  t=setLocale('fr');tree=courseGroups({courseId:'42',notify:()=>{}});
  find(tree,groupUI.SignupSet).onJoin(target,category);let alert=state.alerts.pop();
  assert.equal(alert[0],t('groups.moveTitle',{name:'Group'}));assert.equal(alert[2][0].style,'cancel');
  alert[2][1].onPress();let mutation=state.changes.pop();assert.equal(mutation.v,'target');
  setLocale('ar');assert.equal(find(courseGroups({courseId:'42',notify(){}}),groupUI.SignupSet).joiningId,'target');
  const payloads=[];await mutation.fn({post:async(...x)=>payloads.push(x)},mutation.v);
  assert.deepEqual(payloads.pop(),['/api/v1/groups/target/memberships',{user_id:'self'}]);
  mutation.options.onSettled();assert.deepEqual(calls.pop(),{queryKey:['a','groups']});mutation.callbacks.onSettled();
  tree=courseGroups({courseId:'42',notify(){}});let alerts=state.alerts.length;
  find(tree,groupUI.SignupSet).onJoin(target,{...category,multipleMemberships:true});assert.equal(state.alerts.length,alerts);state.changes.pop();
  find(home({}),'Button').onPress();alert=state.alerts.pop();assert.equal(alert[2][1].style,'destructive');alert[2][1].onPress();
  const leaveMutation=state.changes.pop();await leaveMutation.fn({delete:async(...x)=>payloads.push(x)},leaveMutation.v);
  assert.deepEqual(payloads.pop(),['/api/v1/groups/g/memberships/self']);
  for(const [status,message,reason] of [[400,'Group FULL','full'],[400,'must share a section','section'],[401,'denied','permission'],[403,'denied','permission']]) {
    const server=new CanvasError(message,status,'/group');let error;
    try {await mutation.fn({post:async()=>{throw server;}},'target');} catch(e){error=e;}
    assert.equal(error.reason,reason);assert.strictEqual(error.serverError,server);
    for(const locale of ['en','fr','ar']) assert.equal(gp.membershipErrorMessage(error,setLocale(locale)),i18n.createTranslator(locale)(`groups.error.${reason}`));
  }
  for(const server of [new Error('This group is full. Choose another group.'),new CanvasError('Raw school error',500,'/group')]) {
    await assert.rejects(()=>mutation.fn({post:async()=>{throw server;}},'target'),e=>e===server);
    assert.equal(gp.membershipErrorMessage(server,setLocale('ar')),server.message);
  }
  state.queries['groups/g']=success({...g,canLeave:false});assert.equal(find(home({}),'Button'),undefined);
  state.queries['groups/g']=success({...g,concluded:true});assert.equal(find(home({}),'Button'),undefined);

  // Group producers keep raw names, ordering, permission and membership decisions.
  const rawGroup={id:'g',name:'Group',members_count:2,max_membership:3,course_id:'42',group_category_id:'set',permissions:{join:true},group_category:{id:'set',name:'Groups',self_signup:'restricted',group_limit:4,allows_multiple_memberships:true}};
  const groupReads=[];
  const fetched=await groups.fetchGroup({get:async(...args)=>{groupReads.push(args);return rawGroup;}},'g');
  assert.equal(fetched.name,'Group');assert.equal(fetched.canJoin,true);assert.equal(fetched.canLeave,true);assert.equal(fetched.maxMembers,3);
  assert.deepEqual(groupReads[0].slice(0,2),['/api/v1/groups/g',{include:['permissions','group_category']}]);
  const sets=await groups.fetchSignupCategories({getAll:async(_url,query)=>query.only_own_groups?[rawGroup]:[rawGroup,{...rawGroup,id:'g2',name:'Group 2'}]},'42');
  assert.equal(sets[0].name,'Groups');assert.equal(sets[0].joinedGroupId,'g');assert.equal(sets[0].selfSignup,'restricted');assert.equal(sets[0].multipleMemberships,true);
  const rawMembers=await groups.fetchGroupMembers({getAll:async()=>[{id:'z',name:'You',sortable_name:'Z'},{id:'a',name:'Group leader',sortable_name:'A'}]},'g');
  assert.deepEqual(rawMembers.map(m=>m.name),['Group leader','You']);
  const rawTabs=await groups.fetchGroupTabs({getAll:async()=>[{id:'people',label:'People',html_url:'/raw',full_url:'/full',position:2,type:'internal'},{id:'pages',label:'Pages',html_url:'/p',position:1,unused:true}]},'g');
  assert.deepEqual(rawTabs.map(tab=>tab.label),['Pages','People']);assert.equal(rawTabs[0].hidden,true);assert.equal(rawTabs[1].fullUrl,'/full');

  // Fresh adapters identify missing data before presentation; identical English raw titles stay raw.
  const formatTypes=['presentation','video','statistics','notes','screenshare','podcast','constructor','__proto__','future'];
  const rawConferences=[{id:'ended',title:'Untitled conference',started_at:'2025-12-31T23:30:00Z',ended_at:'2026-01-01T00:30:00Z',conference_type:'Raw provider',recordings:[
    {recording_id:'r1',title:'Recording 1',created_at:1767227400000,duration_minutes:61.5,playback_formats:formatTypes.map(type=>({type,url:'/format/'+type}))},
    {recording_id:'r2',title:' ',playback_url:'/play',playback_formats:[{type:'video',translated_type:'Video',url:'/video'},{type:'video',url:'/hidden',show_to_students:false}]},
    {recording_id:'r3',title:'Raw',playback_formats:[]},
  ]},{id:'live',title:'',started_at:'2026-01-01T00:30:00Z',join_url:'/custom-join',duration:90},
  {id:'scheduled',title:'Raw conference',duration:120,url:'/page'}, {id:'long',title:'No time limit',long_running:true,duration:999}];
  const request=[];const list=freeze(await conferences.fetchConferences({get:async(...x)=>{request.push(x);return {conferences:rawConferences};}},{type:'group',id:'g'}));
  assert.deepEqual(request[0].slice(0,2),['/api/v1/groups/g/conferences',{per_page:100}]);
  assert.deepEqual(list.map(c=>c.id),['live','scheduled','long','ended']);
  const live=list[0], scheduled=list[1], long=list[2], ended=list[3];
  assert.equal(long.durationMinutes,null);assert.equal(long.longRunning,true);
  assert.equal(live.joinPath,'/custom-join');assert.equal(ended.joinPath,'/groups/g/conferences/ended/join');
  assert.equal(ended.title,'Untitled conference');assert.equal(ended.fallbackTitle,undefined);assert.equal(live.fallbackTitle,true);
  assert.equal(ended.recordings[0].title,'Recording 1');assert.equal(ended.recordings[0].fallbackTitleNumber,undefined);
  assert.equal(ended.recordings[1].fallbackTitleNumber,2);assert.equal(ended.recordings[1].formats.length,1);
  assert.equal(ended.recordings[0].url,'/format/presentation');assert.equal(ended.recordings[1].url,'/play');assert.equal(ended.recordings[2].url,null);
  const card=harness(confUI.ConferenceCard), recording=harness(confUI.RecordingRow);
  const now=new Date('2026-01-01T08:00:00Z'),context={type:'group',id:'g'},cardProps={conference:ended,context,now},recordingProps={recording:ended.recordings[0],conference:ended,context,now};
  let e=card(cardProps);find(e,'Pressable').onPress();assert.equal(find(card(cardProps),'Pressable').accessibilityState.expanded,false);
  const stableReads=reads.length,stableChanges=state.changes.length,stableCalls=calls.length;
  for(const locale of ['en','fr','ar','en']) for(const zone of ['America/Los_Angeles','Asia/Tokyo','UTC']) {
    t=setLocale(locale);dates.setDisplayTimeZone(zone);const p=cp.createConferencePresentation(locale,zone),d=dates.createDateContext(locale,zone);
    assert.equal(p.statusLine(live,now),t('conferences.started',{when:d.formatDueDate(live.startedAt,now)}));
    assert.equal(p.statusLine(ended,now),t('conferences.endedAt',{when:d.formatDueDate(ended.endedAt,now)}));
    assert.equal(p.dayLabel(ended.endedAt,now),t(zone==='America/Los_Angeles'?'date.yesterday':'date.today'));
    assert.equal(p.conferenceTitle(ended),'Untitled conference');assert.equal(p.conferenceTitle(live),t('conferences.untitled'));
    assert.equal(p.recordingTitle(ended.recordings[0]),'Recording 1');assert.equal(p.recordingTitle(ended.recordings[1]),t('conferences.recording',{count:2}));
    assert.equal(p.recordingTitle({title:'Recording 2'}),'Recording 2');assert.equal(p.conferenceTitle({title:'Untitled conference'}),'Untitled conference');
    ended.recordings[0].formats.forEach((f,i)=>assert.equal(p.formatLabel(f),i<6?t(`conferences.format.${formatTypes[i]}`):formatTypes[i]));
    assert.equal(p.formatLabel(ended.recordings[1].formats[0]),'Video');assert.equal(p.formatLabel({label:'Video',url:'/legacy'}),'Video');
    for(const count of [0,1,2,3,11,59,60,61.5,120,180,660,6000]) {
      const h=Math.floor(count/60),m=count%60;
      const expected=count<60?t('conferences.minutes',{count}):m?t('conferences.hoursMinutes',{hours:t('conferences.hours',{count:h}),minutes:t('conferences.minutes',{count:m})}):t('conferences.hours',{count:h});
      assert.equal(p.minutes(count),expected);
    }
    assert.equal(p.statusLine(long,now),t('conferences.unlimited'));
    assert.equal(p.statusLine({...scheduled,durationMinutes:0},now),t('conferences.notStarted'));
    e=card(cardProps);assert.equal(find(e,'Pressable').accessibilityState.expanded,false);
    assert.ok(find(e,'Pressable').accessibilityLabel.includes(p.statusLine(ended,now)));
    const row=recording(recordingProps);assert.equal(row.props.title,'Recording 1');assert.equal(row.props.subtitle,`${p.dayLabel(recordingProps.recording.createdAt,now)} · ${p.minutes(61.5)}`);
  }
  assert.equal(reads.length,stableReads);assert.equal(state.changes.length,stableChanges);assert.equal(calls.length,stableCalls);
  find(card(cardProps),'Pressable').onPress();setLocale('fr');assert.equal(find(card(cardProps),'Pressable').accessibilityState.expanded,true);
  for(const [c,url] of [[live,'/custom-join'],[scheduled,'/page'],[{...scheduled,url:null},scheduled.joinPath]]) {
    const render=harness(confUI.ConferenceCard);const ctree=render({conference:c,context,now});find(ctree,'Button').onPress();assert.deepEqual(calls.pop(),{browser:url});
  }
  assert.equal(find(card(cardProps),'Button'),undefined);
  recording(recordingProps).props.onPress();assert.deepEqual(calls.pop(),{browser:'/format/presentation'});
  assert.equal(recording({recording:ended.recordings[2],conference:ended,context,now}).props.onPress,undefined);
  let wrapper;const syntax=new SyntaxError('raw parsing detail');try {await conferences.fetchConferences({get:async()=>{throw syntax;}},{type:'course',id:'42'});}catch(e){wrapper=e;}
  assert.strictEqual(wrapper.serverError,syntax);assert.equal(wrapper.reason,'notSetup');
  for(const locale of ['en','fr','ar']) {
    const p=cp.createConferencePresentation(locale,'UTC');assert.equal(p.errorMessage(wrapper),i18n.createTranslator(locale)('conferences.notSetup'));
    assert.equal(p.errorMessage(new Error(wrapper.message)),wrapper.message);
  }
  const rawError=new Error('School raw');await assert.rejects(()=>conferences.fetchConferences({get:async()=>{throw rawError;}},{type:'course',id:'42'}),e=>e===rawError);
  const listView=harness(confUI.ConferenceList), listProps={context:{type:'group',id:'g'}};
  const errorQuery=error=>({data:undefined,isError:true,isPending:false,error,refetch(){calls.push('refetch');}});
  const {LoadError}=load('@/features/course/states');
  for(const locale of ['en','fr','ar']) {
    t=setLocale(locale);
    state.queries['conferences/group/g']=success(list);
    tree=listView(listProps);assert.deepEqual(nodes(tree).filter(n=>n.type==='Section').map(n=>n.props.title),[t('conferences.current'),t('conferences.past')]);
    state.queries['conferences/group/g']=errorQuery(wrapper);
    tree=listView(listProps);assert.equal(find(tree,LoadError).error.message,t('conferences.notSetup'));
    state.queries['conferences/group/g']=errorQuery(rawError);
    assert.equal(find(listView(listProps),LoadError).error.message,'School raw');
    state.queries['conferences/group/g']=success([]);assert.equal(find(listView(listProps),'EmptyState').title,t('conferences.empty'));
    state.queries['courses/42/people/person']=errorQuery(rawError);
    assert.equal(find(sheet(sheetProps),'Callout').children,'School raw');
    assert.equal(find(sheet(sheetProps),'Callout').title,t('people.profileError'));
  }
  // Independent numeric/grammar expectations, including every Arabic cardinal category.
  const catalogs=['en','fr','ar'].map(l=>load(`@/i18n/${l}`)[l]);
  // Preserve the original 994 values, while allowing independently reviewed additions.
  const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'people-groups-conferences.baseline.json'),'utf8')).catalogs;
  assert.deepEqual(['en','fr','ar'].map(locale=>Object.keys(historical[locale]).length),[994,994,994]);
  for(const [i,locale] of ['en','fr','ar'].entries()) for(const [key,hash] of Object.entries(historical[locale])) {
    assert.ok(Object.hasOwn(catalogs[i],key),`${locale}: historical key ${key}`);
    assert.equal(createHash('sha256').update(JSON.stringify(catalogs[i][key])).digest('hex'),hash,`${locale}: historical value ${key}`);
  }
  for(const [i,locale] of ['en','fr','ar'].entries()) for(const count of [0,1,2,3,11,100,1.5]) {
    const translate=i18n.createTranslator(locale),plural=new Intl.PluralRules(locale).select(count),num=new Intl.NumberFormat(locale).format(count);
    for(const key of ['groups.members','conferences.recordings','conferences.hours','conferences.minutes','people.sections']) {
      const entry=catalogs[i][key],template=entry[plural]??entry.other;
      assert.equal(translate(key,{count}),template.replaceAll('{count}',num));
    }
  }
  for(const file of ['features/conferences/ConferenceList.tsx']) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const component of ['RecordingRow','ConferenceCard']) {
      const start=source.indexOf(`function ${component}`);
      const end=source.indexOf('\nfunction ',start+1);
      const body=source.slice(start,end<0?undefined:end);
      assert.match(body,/const \{ t, locale \} = useTranslation\(\);/);
      assert.match(body,/const zone = useDisplayTimeZone\(\);/);
      assert.match(body,/createConferencePresentation\(locale, zone\)/);
    }
  }
  console.log('People/groups/conferences checks passed: fresh production adapters and simulated hooks/native props; no native/Compiler/browser verification.');
})().catch(error=>{console.error(error);process.exitCode=1;});
