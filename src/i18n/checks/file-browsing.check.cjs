const { isIntlPolyfills, intlPolyfills } = require('./node-boundaries.cjs');
/* global __dirname */
/** Freshly transpiles production browser/card, presentation, five routes, ActionSheet,
 * catalogs, kinds/AttachmentList and date contexts. Stateful hook/memo/effect simulation;
 * native/design elements are prop records. Query hooks record exact arguments without
 * fetching. Upload/download/actions/session/router/openFile/native sheet/timers are
 * synthetic boundaries: no file/network mutations, native rendering or React Compiler.
 * Child functions are explicitly mounted via persistent harnesses where state matters. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..'), cache = new Map();
let scope;
const calls = [], queries = [], nativeSheets = [], timers = [];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const react = {
  useState(initial) { const s=scope, i=s.cursor++; if (!(i in s.slots)) s.slots[i]=typeof initial==='function'?initial():initial; return [s.slots[i], v => { s.slots[i]=typeof v==='function'?v(s.slots[i]):v; }]; },
  useRef(v) { return react.useState(() => ({current:v}))[0]; },
  useMemo(fn,deps) { const r=react.useRef(); if (!r.current || deps.some((v,i)=>!Object.is(v,r.current.deps[i]))) r.current={deps,value:fn()}; return r.current.value; },
  useCallback(fn,deps) { return react.useMemo(()=>fn,deps); },
  useEffect(fn,deps) { const r=react.useRef(); if (!r.current || deps.some((v,i)=>!Object.is(v,r.current.deps[i]))) { r.current?.cleanup?.(); r.current={deps,cleanup:fn()}; } },
  useSyncExternalStore(_s, snapshot) { return snapshot(); },
};
const jsx=(type,props,key)=>({type,props,key});
const native={Platform:{OS:'android'}, ActionSheetIOS:{showActionSheetWithOptions:(...args)=>nativeSheets.push(args)}};
const result = (data) => ({ data, isPending:false, isFetching:false, isError:false, error:null, refetch:()=>Promise.resolve() });
const state = { root:result({id:'root',name:'Root raw',canUpload:true}), sub:result({id:'sub',name:'Folder',context:{type:'groups',id:'g'}}), contents:result({folders:[],files:[]}), search:result({folders:[],files:[]}), upload:{state:{status:'idle'},pickAndUpload:()=>calls.push(['pick'])}, params:{}, courses:[{id:'c',code:'Files',name:'Course raw',color:'color'}] };
const client={synthetic:true};
const query=(name)=>(...args)=>{ queries.push([name,...args]); return state[name]; };
const mocks={
 react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
 'react-native':new Proxy(native,{get:(o,k)=>o[k]??k}),
 'lucide-react-native':new Proxy({},{get:(_o,k)=>k}),
 'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:12})},
 'expo-router':{Stack:{Screen:'Stack.Screen'},router:{push:(...a)=>calls.push(['push',...a]),replace:(...a)=>calls.push(['replace',...a])},useLocalSearchParams:()=>state.params},
 '@/canvas/api/files':{MIN_SEARCH_LENGTH:2,useRootFolder:query('root'),useFolder:query('sub'),useFolderContents:query('contents'),useFileSearch:query('search'),fetchFolderByPath:(...a)=>{calls.push(['path',...a]);return Promise.resolve(state.pathFolder);}},
 '@/canvas/api/courses':{useCourseLookup:()=>id=>state.courses.find(c=>c.id===id),useDashboardCourses:()=>({data:state.courses})},
 '@/canvas/session':{useCanvas:()=>({client})},
 '@/design':new Proxy({useTheme:()=>({colors:{fgMuted:'muted',fg:'fg'},scheme:'light'}),deriveAccent:()=>({accentFg:'tint'})},{get:(o,k)=>o[k]??k}),
 '@/features/files/FileThumbnail':{FileThumbnail:'FileThumbnail',kindTone:{document:'info'}},
 '@/features/files/open':{openFile:(...a)=>calls.push(['openFile',...a])},
 '@/features/files/upload':{useUploadToFolder:(id)=>{queries.push(['upload',id]);return state.upload;}},
};
function load(name,parent=path.join(root,'entry.ts')) {
  if (isIntlPolyfills(name)) return intlPolyfills;
 const key=name.startsWith('.')?'@/'+path.relative(root,path.resolve(path.dirname(parent),name)):name;
 if(mocks[key])return mocks[key]; if(!key.startsWith('@/'))return require(key);
 const file=['.ts','.tsx','/index.ts'].map(e=>path.join(root,key.slice(2))+e).find(fs.existsSync); assert.ok(file,key);
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports','setTimeout',js)(n=>load(n,file),module,module.exports,(fn,ms)=>timers.push({fn,ms}));return module.exports;
}
function harness(fn) {const s={slots:[],cursor:0};return props=>{const prev=scope;scope=s;s.cursor=0;try{return fn(props);}finally{scope=prev;}};}
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const all=(t,type)=>nodes(t).filter(n=>n.type===type);
const find=(t,type,test=()=>true)=>all(t,type).find(n=>test(n.props))?.props;
const text=t=>t==null||typeof t==='boolean'?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(text).join(' '):text(t.props?.children);
const child=(t,name)=>nodes(t).find(n=>typeof n.type==='function'&&n.type.name===name);
const renderChild=n=>harness(n.type)(n.props);
const i18n=load('@/i18n/runtime'), dates=load('@/lib/dates'), p=load('@/features/files/browserPresentation'), k=load('@/features/files/kinds');
const ui=load('@/features/files/FileCard'), browser=load('@/features/files/FolderBrowser'), sheet=load('@/features/files/ActionSheet');
const summary=load('@/features/files/AttachmentList').fileSummary;
const langs=['en','fr','ar'],zones=['UTC','America/Los_Angeles','Asia/Tokyo'];
const view=(locale,zone='UTC')=>{i18n.setAccountLocale('test',locale);dates.setDisplayTimeZone(zone);return i18n.createTranslator(locale);};
const file={id:'f',name:'Files',filename:'test.docx',contentType:'application/octet-stream',size:1250,modifiedAt:new Date('2026-01-01T00:30:00Z'),createdAt:new Date('2025-12-31T23:30:00Z'),updatedAt:new Date('2026-01-02T00:30:00Z'),uploader:'Uploaded',context:{type:'user',id:'self'},lockedForUser:false,hidden:false,unlockAt:null,lockAt:null};
const folder={id:'fo',name:'Folder',foldersCount:2,filesCount:11,hidden:false,lockedForUser:false,context:{type:'groups',id:'g'}};
const actionNames=['share','save','openIn','shareLink','print','copyLink'];
const actions={busy:null,canPrint:true,link:'raw',...Object.fromEntries(actionNames.map(n=>[n,()=>calls.push([n])])),download:{status:'downloading',progress:{fraction:0,bytes:0},cancel:()=>calls.push(['cancel'])}};
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
(async()=>{
 const baseline=require('./file-browsing.baseline.json'),catalogs=langs.map(l=>load('@/i18n/'+l)[l]);
 const slots=v=>[...new Set(JSON.stringify(v).match(/\{\w+\}/g)??[])].sort();
 assert.equal(baseline.catalogKeys.length,1491);assert.ok(Object.keys(catalogs[0]).length>=1558);
 for(const [i,lang] of langs.entries()){
  assert.equal(createHash('sha256').update(JSON.stringify(baseline.catalogKeys.map(key=>[key,catalogs[i][key]]))).digest('hex'),baseline.catalogHashes[lang]);
  assert.deepEqual(Object.keys(catalogs[i]).sort(),Object.keys(catalogs[0]).sort());
  for(const key of Object.keys(catalogs[0]))assert.deepEqual(slots(catalogs[i][key]),slots(catalogs[0][key]),key);
  for(const kind of ['folders','files','items','results'])for(const count of [0,1,2,3,7,11,99,100,102,1000]){
   const msg=catalogs[i]['files.count.'+kind], category=new Intl.PluralRules(lang).select(count);
   assert.equal(p.browserCount(kind,count,lang),(msg[category]??msg.other).replace('{number}',(lang==='ar'?'\u2068':'')+new Intl.NumberFormat(lang).format(count)+(lang==='ar'?'\u2069':'')));
  }
 }
 // Same file and Date objects across all locale/zone pairs, at civil New Year/midnight.
 const RealDate=Date, now=new RealDate('2026-01-01T01:00:00Z');
 global.Date=class extends RealDate {constructor(...a){super(...(a.length?a:[now.getTime()]));}static now(){return now.getTime();}};
 try {
 const hero=harness(ui.FileHero),details=harness(ui.FileDetails),card=harness(ui.FileCard),download=harness(ui.DownloadProgress),buttons=harness(ui.FileActionButtons);
 for(const locale of langs)for(const zone of zones){
  const t=view(locale,zone),ctx=dates.createDateContext(locale,zone),before=calls.length;
  const h=hero({file});assert.equal(find(h,'View',x=>x.accessible).accessibilityLabel,t('file.rowLabel',{name:file.name,summary:summary(file,locale)}));
  const d=details({file,courseId:'c',actions}),rows=all(d,'ListItem').filter(n=>n.key);
  const keys=['type','size','modified','uploaded','uploader','course','location','availability'];
  assert.deepEqual(rows.map(n=>n.key),keys);
  const values=[k.describeFile(file,locale).label,k.formatSize(file.size,locale),k.formatDateTime(file.modifiedAt,now,ctx),k.formatDateTime(file.createdAt,now,ctx),'Uploaded','Files',t('files.my'),t('files.available')];
  assert.deepEqual(rows.map(n=>text(n.props.trailing)),values);
  assert.deepEqual(rows.map(n=>n.props.title),keys.map(key=>t('files.detail.'+key)));
  rows.forEach((n,i)=>assert.equal(n.props.accessibilityLabel,t('files.detail.row',{title:n.props.title,value:values[i]})));
  assert.equal(find(d,'ListItem',x=>x.title===t('files.copyLink')).onPress,actions.copyLink);
  assert.equal(p.browserFileSummary(file,locale,zone),[summary(file,locale),k.formatDay(file.modifiedAt,now,ctx)].join(' · '));
  for(const name of ['Files','', 'العربية'])assert.equal(text(find(hero({file:{...file,name}}),'Text',x=>x.variant==='title3').children),name);
  for(const note of ['Locked','Your instructor hasn’t made this file available.','',undefined]){
   const c=card({file,actions,note});assert.equal(find(c,'Text')?.children,note||undefined);assert.equal(find(c,'Callout'),undefined);
  }
  for(const unlockAt of [null,new RealDate('2026-01-02T01:00:00Z')])for(const explanation of [null,'','   ','Locked until tomorrow',' LOCKED UNTIL tomorrow ','Locked','  Raw explanation  ']){
   const locked={...file,lockedForUser:true,unlockAt,lockExplanation:explanation},c=card({file:locked,actions,note:'raw note'}),callout=find(c,'Callout');
   const raw=explanation?.trim();const expected=raw&&!(unlockAt&&/locked until/i.test(raw))?raw:t(unlockAt?'files.lockAfter':'files.lockInstructor');
   assert.equal(text(callout.children),expected);assert.equal(callout.title,k.availabilityOf(locked,now,ctx)?.long??t('file.locked'));
  }
  for(const fraction of [0,null,.125,.999,1])for(const bytes of [0,null,undefined,12345]){
   actions.download.progress={fraction,bytes};const d=download({actions}),percent=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(Math.round(fraction*100)/100);
   assert.equal(find(d,'ProgressBar').value,fraction??0);
   assert.equal(find(d,'ProgressBar').accessibilityLabel,fraction===null?t('files.downloading'):t('files.downloadLabelPercent',{percent}));
   assert.equal(text(find(d,'Text').children),fraction===null?t('files.downloadBytes',{size:k.formatSize(bytes,locale)??''}):t('files.downloadPercent',{percent}));assert.equal(find(d,'Button').onPress,actions.download.cancel);
  }
  for(const busy of [null,'share','save','open','print'])for(const locked of [false,true])for(const canPrint of [false,true]){
   const a={...actions,busy,canPrint},bs=all(buttons({actions:a,locked}),'Button').map(n=>n.props);
   assert.deepEqual(bs.map(b=>text(b.children)),['share','save','openIn','shareLink',...(canPrint?['print']:[])].map(n=>t('files.'+n)));
   bs.forEach((b,i)=>{const name=['share','save','openIn','shareLink','print'][i],job=name==='openIn'?'open':name;assert.equal(b.onPress,a[name]);if(name!=='shareLink'){assert.equal(b.disabled,locked||!!busy&&busy!==job);assert.equal(b.loading,busy===job);}});
  }
  assert.equal(calls.length,before,'locale-only card renders have no effects');
 }
 const sparse={...file,size:null,modifiedAt:null,createdAt:null,uploader:'',context:null};
 assert.deepEqual(all(details({file:sparse}),'ListItem').map(n=>n.key),['type','availability']);
 assert.deepEqual(all(details({file:{...sparse,context:{type:'course',id:'c'}},courseId:'wrong'}),'ListItem').map(n=>n.key),['type','course','availability']);
 actions.download.status='idle';assert.equal(download({actions}),null);actions.download.status='downloading';
 find(details({file,actions}),'ListItem',x=>x.onPress).onPress();assert.deepEqual(calls.pop(),['copyLink']);
 find(download({actions}),'Button').onPress();assert.deepEqual(calls.pop(),['cancel']);
 for(const b of all(buttons({actions,locked:false}),'Button'))b.props.onPress();assert.deepEqual(calls.splice(-5),actionNames.slice(0,5).map(n=>[n]));
 } finally {global.Date=RealDate;}
 // Browser state/queries, row subscriptions, raw roots/headers and stable option IDs.
 state.contents=result({folders:[folder],files:[file]});state.search=result({folders:[],files:[file]});
 const props={context:{type:'users',id:'self'},rootTitle:'My Files',onOpenFolder:f=>calls.push(['folder',f]),header:jsx('RawHeader',{children:'Files'})};
 const b=harness(browser.FolderBrowser);let tree=b(props);
 const rowNode=child(tree,'FolderRow'),fileNode=child(tree,'FileRow'),row=harness(rowNode.type),fr=harness(fileNode.type);
 for(const locale of langs)for(const zone of zones){
  const t=view(locale,zone),before=calls.length;queries.length=0;tree=b(props);
  assert.deepEqual(queries,[['root',props.context],['sub',undefined],['contents','root',{by:'name',order:'asc'}],['search',props.context,'',{by:'name',order:'asc'}],['upload','root']]);
  assert.equal(find(tree,'Stack.Screen').options.title,'My Files');assert.equal(find(tree,'RawHeader').children,'Files');
  assert.equal(find(tree,'SearchField').value,'');assert.equal(find(tree,'SearchField').placeholder,t('files.searchMy'));
  const r=find(row(rowNode.props),'ListItem');assert.equal(r.title,'Folder');assert.equal(r.subtitle,p.folderSummary(folder,locale));assert.equal(r.accessibilityLabel,t('files.folderRow',{name:folder.name,summary:r.subtitle}));assert.equal(r.onPress,rowNode.props.onPress);
  const f=find(fr(fileNode.props),'ListItem');assert.equal(f.title,'Files');assert.equal(f.subtitle,p.browserFileSummary(file,locale,zone));assert.equal(f.onPress,fileNode.props.onPress);
  assert.deepEqual(nodes(tree).filter(n=>n.key).map(n=>n.key),['fo','f']);assert.equal(calls.length,before);
 }
 rowNode.props.onPress();assert.deepEqual(calls.pop(),['folder',folder]);fileNode.props.onPress();assert.deepEqual(calls.pop(),['openFile','f',{courseId:undefined,files:[file]}]);
 for(const locale of langs){const t=view(locale);
  for(const hidden of [false,true])for(const lockedForUser of [false,true]){
   const f={...folder,hidden,lockedForUser};const r=find(row({folder:f,onPress:props.onOpenFolder}),'ListItem');assert.equal(r.disabled,lockedForUser);assert.equal(r.subtitle,lockedForUser?t('files.folderLocked'):p.folderSummary(f,locale));assert.equal(r.accessibilityLabel,t(hidden?'files.folderRowHidden':'files.folderRow',{name:f.name,summary:r.subtitle}));assert.equal(text(r.trailing),hidden?t('files.hidden'):'');
   const item={...file,hidden,lockedForUser};const r2=find(fr({file:item,onPress:props.onOpenFolder}),'ListItem'),a=k.availabilityOf(item,new Date(),dates.createDateContext(locale,'UTC'));assert.equal(text(r2.trailing),a?(a.tone==='warning'?t('file.locked'):a.short):'');
  }
  assert.equal(p.folderSummary({...folder,filesCount:0,foldersCount:0},locale),t('files.empty'));
 }
 // Android open sort sheet relabels in place; same request/callback snapshot and 250ms delay.
 view('en');tree=b(props);find(tree,'PressableScale').onPress();
 for(const locale of langs){const t=view(locale),before=calls.length;tree=b(props);const modal=find(tree,'Modal');assert.equal(modal.visible,true);assert.equal(modal.animationType,'slide');const n=child(tree,'AndroidSheet'),s=renderChild(n);assert.deepEqual(all(s,'ListItem').map(n=>n.key),['name','updated_at','size','content_type']);assert.deepEqual(all(s,'ListItem').map(n=>n.props.title),p.sortPresentation({by:'name',order:'asc'},t).options);assert.equal(calls.length,before);assert.equal(timers.length,0);}
 let s=renderChild(child(tree,'AndroidSheet'));all(s,'ListItem')[0].props.onPress();tree=b(props);assert.equal(find(tree,'Modal').visible,false);assert.equal(queries.at(-3)[2].order,'asc');assert.equal(timers[0].ms,250);timers.shift().fn();tree=b(props);assert.equal(queries.at(-3)[2].order,'desc');
 // Each criterion retains its original default, then toggles; locale changes don't select.
 for(const [index,by,order] of [[1,'updated_at','desc'],[2,'size','desc'],[3,'content_type','asc'],[0,'name','asc']]){
  find(tree,'PressableScale').onPress();tree=b(props);all(renderChild(child(tree,'AndroidSheet')),'ListItem')[index].props.onPress();timers.shift().fn();tree=b(props);assert.deepEqual(queries.at(-3)[2],{by,order});
  find(tree,'PressableScale').onPress();tree=b(props);all(renderChild(child(tree,'AndroidSheet')),'ListItem')[index].props.onPress();timers.shift().fn();tree=b(props);assert.deepEqual(queries.at(-3)[2],{by,order:order==='asc'?'desc':'asc'});
 }
 view('ar');find(tree,'SearchField').onChangeText(' x ');tree=b(props);assert.equal(queries.at(-2)[2],'');assert.ok(text(tree).includes(i18n.createTranslator('ar')('files.searchHint',{minimum:new Intl.NumberFormat('ar').format(2)})));
 find(tree,'SearchField').onChangeText('  Files  ');
 let sortState;
 for(const locale of langs){view(locale);queries.length=0;const before=calls.length;tree=b(props);assert.equal(find(tree,'SearchField').value,'  Files  ');assert.equal(queries.at(-2)[2],'Files');sortState??=queries.at(-2)[3];assert.equal(queries.at(-2)[3],sortState);assert.equal(find(tree,'Button',x=>x.leadingIcon==='Upload'),undefined);assert.equal(calls.length,before);}
 // Context/open payload bounds, root/subfolder title and route order remain unchanged.
 for(const type of ['users','groups','courses'])for(const length of [1,100,101]){
  const files=Array.from({length},(_,i)=>({...file,id:String(i)}));state.contents=result({folders:[folder],files});const props2={...props,context:{type,id:'c'}};const tree=harness(browser.FolderBrowser)(props2);child(tree,'FileRow').props.onPress();assert.deepEqual(calls.pop(),['openFile','0',{courseId:type==='courses'?'c':undefined,files:length<=100?files:[files[0]]}]);
 }
 for(const name of ['Folder','',undefined]){state.sub.data={id:'sub',name,canUpload:true};const t=view('fr'),tree=harness(browser.FolderBrowser)({...props,folderId:'sub'});assert.equal(find(tree,'Stack.Screen').options.title,name??t('files.folder'));assert.equal(queries.at(-3)[1],'sub');}
 for(const rootTitle of ['Files',''])assert.equal(find(harness(browser.FolderBrowser)({...props,rootTitle}),'Stack.Screen').options.title,rootTitle);
 assert.deepEqual(browser.folderRoute(folder),{pathname:'/files/folder/[folderId]',params:{folderId:'fo'}});
 assert.deepEqual(browser.folderRoute({...folder,context:{type:'courses',id:'c'}}),{pathname:'/course/[courseId]/files/folder/[folderId]',params:{courseId:'c',folderId:'fo'}});browser.openFolder(folder);assert.deepEqual(calls.pop(),['push',browser.folderRoute(folder)]);
 // Empty/pending/error/search wrappers; upload permission matches hook target policy.
 for(const locale of langs)for(const type of ['users','groups','courses'])for(const canUpload of [true,false,undefined])for(const id of ['root',undefined]){
  const t=view(locale);state.root=result({id,canUpload});state.contents=result({folders:[],files:[]});state.search=result({folders:[],files:[]});
  const render=harness(browser.FolderBrowser),props2={...props,context:{type,id:'c'}};let tree=render(props2);
  const allowed=type==='users'&&canUpload!==false&&!!id;
  assert.equal(!!find(tree,'Button',x=>x.leadingIcon==='Upload'),allowed);assert.equal(queries.at(-1)[1],type==='users'&&canUpload!==false?id:undefined);
  assert.equal(find(tree,'EmptyState').description,t(allowed?'files.emptyUpload':'files.emptyInstructor'));
  find(tree,'SearchField').onChangeText('Files');tree=render(props2);assert.equal(find(tree,'Button',x=>x.leadingIcon==='Upload'),undefined);assert.equal(find(tree,'EmptyState').title,t('files.noMatches'));assert.equal(find(tree,'EmptyState').description,t('files.noMatchesDetail',{term:'Files'}));
 }
 state.root=result({id:'root',canUpload:true});state.contents=result({folders:[],files:[]});state.search=result({folders:[],files:[]});
 for(const locale of langs){const t=view(locale);const render=harness(browser.FolderBrowser);let tree=render(props);
  state.root.isPending=true;tree=render(props);assert.equal(find(renderChild(child(tree,'LoadingRows')),'View',x=>x.accessible).accessibilityLabel,t('files.loading'));state.root.isPending=false;
  state.contents={...result(undefined),isPending:true};tree=render(props);assert.ok(child(tree,'LoadingRows'));
  for(const searching of [false,true]){
   find(tree,'SearchField').onChangeText(searching?'Files':'');
   const q=searching?'search':'contents';state[q]={...result(undefined),error:new Error('Upload failed'),isError:true,refetch:()=>calls.push([q+'Retry'])};tree=render(props);
   const c=find(tree,'Callout');assert.equal(c.title,t(searching?'files.searchError':'files.folderError'));assert.equal(text(c.children),'Upload failed');c.action.onPress();assert.deepEqual(calls.pop(),[q+'Retry']);
   state.root={...state.root,error:new Error('Folder'),isError:true,refetch:()=>calls.push(['folderRetry'])};tree=render(props);assert.equal(text(find(tree,'Callout').children),'Folder');find(tree,'Callout').action.onPress();assert.deepEqual(calls.pop(),['folderRetry']);state.root=result({id:'root',canUpload:true});
   state[q]=result({folders:[],files:[]});tree=render(props);
  }
  find(tree,'SearchField').onChangeText('');
  for(const status of ['uploading','error','done','idle'])for(const fraction of [0,null,.5]){
   state.upload.state={status,fraction,name:'Files',message:'Upload failed',file};const before=calls.length;tree=render(props);
   if(status==='uploading'){assert.equal(find(tree,'ProgressBar').value,fraction??0);assert.equal(find(tree,'ProgressBar').accessibilityLabel,t('files.uploadingLabel',{name:'Files'}));assert.ok(text(tree).includes(t('files.uploading',{name:'Files'})));}
   if(status==='error'){const c=find(tree,'Callout');assert.equal(c.title,t('files.uploadFailed'));assert.equal(text(c.children),'Upload failed');assert.equal(c.action.onPress,state.upload.pickAndUpload);}
   if(status==='done'){const c=find(tree,'Callout');assert.equal(c.title,t('files.uploaded'));assert.equal(text(c.children),t('files.uploadedDetail',{name:file.name}));}
   assert.equal(calls.length,before);
  }
 }
 // Persist the exact upload state and target through a locale change with no pick/retry.
 for(const status of ['uploading','error','done']){state.upload.state={status,fraction:.4,name:'',message:'',file};const same=state.upload.state,render=harness(browser.FolderBrowser);for(const locale of langs){view(locale);const before=calls.length;render(props);assert.equal(state.upload.state,same);assert.equal(queries.at(-1)[1],'root');assert.equal(calls.length,before);}}
 state.upload.state={status:'idle'};
 // Refresh: either request may reject first with its sibling pending; wait for BOTH,
 // absorb rejections and always clear the spinner. Search selects search, not contents.
 for(const searching of [false,true])for(const first of [0,1])for(const outcome of ['reject','resolve']){
  const jobs=[deferred(),deferred()];state.root={...result({id:'root',canUpload:true}),refetch:()=>{calls.push(['refreshRoot']);return jobs[0].promise;}};
  state.contents={...result({folders:[],files:[]}),refetch:()=>{calls.push(['refreshContents']);return jobs[1].promise;}};
  state.search={...result({folders:[],files:[]}),refetch:()=>{calls.push(['refreshSearch']);return jobs[1].promise;}};
  const render=harness(browser.FolderBrowser);let tree=render(props);if(searching){find(tree,'SearchField').onChangeText('Files');tree=render(props);}
  const refresh=()=>find(render(props),'Screen').refreshControl.props;const task=refresh().onRefresh();let settled=false;task.then(()=>settled=true);assert.equal(refresh().refreshing,true);
  assert.deepEqual(calls.splice(-2),[['refreshRoot'],[searching?'refreshSearch':'refreshContents']]);jobs[first][outcome](outcome==='reject'?new Error('raw'):undefined);await flush();assert.equal(settled,false);assert.equal(refresh().refreshing,true);
  view('fr');assert.equal(refresh().refreshing,true);jobs[1-first].reject(new Error('second'));await task;assert.equal(refresh().refreshing,false);
 }
 // Successful refresh also remains busy until the second response settles.
 { const jobs=[deferred(),deferred()];state.root={...result({id:'root'}),refetch:()=>jobs[0].promise};state.contents={...result({folders:[],files:[]}),refetch:()=>jobs[1].promise};const render=harness(browser.FolderBrowser);const refresh=()=>find(render(props),'Screen').refreshControl.props;const task=refresh().onRefresh();jobs[0].resolve();await flush();assert.equal(refresh().refreshing,true);jobs[1].resolve();await task;assert.equal(refresh().refreshing,false); }
 // Subfolder refresh never calls the root refetch.
 state.root=result({id:'root'});state.sub={...result({id:'sub'}),refetch:()=>{calls.push(['subRefresh']);return Promise.resolve();}};state.contents={...result({folders:[],files:[]}),refetch:()=>{calls.push(['contentRefresh']);return Promise.resolve();}};
 await find(harness(browser.FolderBrowser)({...props,folderId:'sub'}),'Screen').refreshControl.props.onRefresh();assert.deepEqual(calls.splice(-2),[['subRefresh'],['contentRefresh']]);
 // ActionSheet old requests retain literal strings/label key fallback, new factory is
 // stored as data and cannot run as a setter. Factory changes labels only, not count.
 native.Platform.OS='android';const sh=harness(sheet.useActionSheet);let value=sh();let factoryCalls=0;const chosen=()=>calls.push(['original']);
 const request={title:'Raw title',message:'Raw message',options:[{key:'one',label:'Raw label',icon:'Check',onPress:chosen},{label:'Legacy',onPress:chosen}],presentation:t=>{factoryCalls++;return {title:t('files.sort.title'),options:[t('files.sort.name')]};}};
 value.show(request);assert.equal(factoryCalls,0,'factory not invoked as state updater');
 for(const locale of langs){const t=view(locale),before=calls.length;value=sh();assert.equal(value.sheet.props.visible,true);const n=child(value.sheet,'AndroidSheet');assert.equal(n.props.request.options[0].onPress,chosen);assert.equal(n.props.request.options[0].icon,'Check');assert.equal(n.props.request.options.length,2);const tree=renderChild(n);assert.deepEqual(all(tree,'ListItem').map(n=>n.key),['one','Legacy']);assert.deepEqual(all(tree,'ListItem').map(n=>n.props.title),[t('files.sort.name'),'Legacy']);assert.ok(text(tree).includes('Raw message'));assert.equal(calls.length,before);}
 all(renderChild(child(value.sheet,'AndroidSheet')),'ListItem')[0].props.onPress();assert.equal(sh().sheet.props.visible,false);assert.equal(timers.length,1);assert.equal(timers[0].ms,250);timers.shift().fn();assert.deepEqual(calls.pop(),['original']);
 for(const close of ['back','overlay','cancel']){sh().show(request);value=sh();const tree=renderChild(child(value.sheet,'AndroidSheet'));if(close==='back')value.sheet.props.onRequestClose();else find(tree,close==='overlay'?'Pressable':'Button').onPress();assert.equal(sh().sheet.props.visible,false);assert.equal(timers.length,0);}
 const old={title:'Files',options:[{label:'Name',onPress:chosen}]};sh().show(old);for(const locale of langs){view(locale);value=sh();const tree=renderChild(child(value.sheet,'AndroidSheet'));assert.equal(all(tree,'ListItem')[0].key,'Name');assert.equal(find(tree,'ListItem').title,'Name');}
 native.Platform.OS='ios';
 for(const locale of langs){const t=view(locale),nativeHook=harness(sheet.useActionSheet);nativeHook().show(request);const [options,select]=nativeSheets.at(-1),count=nativeSheets.length;assert.deepEqual(options,{title:t('files.sort.title'),message:'Raw message',options:[t('files.sort.name'),'Legacy',t('common.cancel')],cancelButtonIndex:2,userInterfaceStyle:'light'});view(locale==='en'?'ar':'en');assert.equal(nativeHook().sheet,null);assert.equal(nativeSheets.length,count);assert.equal(options.options[0],t('files.sort.name'));const before=calls.length;select(2);assert.equal(calls.length,before);select(0);assert.deepEqual(calls.pop(),['original']);}
 // Browser iOS sort order/cancel snapshot (no Android replacement, no auto-reopen).
 state.contents=result({folders:[],files:[file]});state.root=result({id:'root'});view('fr');const ib=harness(browser.FolderBrowser);let it=ib(props);find(it,'PressableScale').onPress();const [opts,select]=nativeSheets.at(-1);assert.deepEqual(opts.options,[...p.sortPresentation({by:'name',order:'asc'},i18n.createTranslator('fr')).options,i18n.createTranslator('fr')('common.cancel')]);assert.equal(opts.cancelButtonIndex,4);view('ar');it=ib(props);select(1);it=ib(props);assert.deepEqual(queries.at(-3)[2],{by:'updated_at',order:'desc'});
 // Search pending/fetching and stale-data rules; payload limit applies to search too.
 native.Platform.OS='android';state.root=result({id:'root'});state.contents=result({folders:[],files:[]});state.upload.state={status:'idle'};
 for(const isFetching of [false,true]){state.search={...result(undefined),isPending:true,isFetching};const render=harness(browser.FolderBrowser);let tree=render(props);find(tree,'SearchField').onChangeText('Files');tree=render(props);assert.equal(!!child(tree,'LoadingRows'),isFetching);assert.equal(!!find(tree,'EmptyState'),!isFetching);}
 for(const length of [100,101]){const files=Array.from({length},(_,i)=>({...file,id:String(i)}));state.search={...result({folders:[],files}),isPending:true,isFetching:true,error:new Error('stale error')};const render=harness(browser.FolderBrowser);let tree=render({...props,context:{type:'courses',id:'c'}});find(tree,'SearchField').onChangeText('Files');tree=render({...props,context:{type:'courses',id:'c'}});assert.equal(child(tree,'LoadingRows'),undefined);assert.equal(find(tree,'Callout'),undefined);child(tree,'FileRow').props.onPress();assert.deepEqual(calls.pop(),['openFile','0',{courseId:'c',files:length<=100?files:[files[0]]}]);}
 for(const name of ['','Folder']){assert.equal(find(row({folder:{...folder,name},onPress:props.onOpenFolder}),'ListItem').title,name);assert.equal(find(fr({file:{...file,name},onPress:props.onOpenFolder}),'ListItem').title,name);}
 // Status details keep the exact same row keys while dates/availability relabel.
 const detail=harness(ui.FileDetails),available={...file,lockAt:new Date('2099-01-01T00:30:00Z')};
 for(const locale of langs)for(const zone of zones){const t=view(locale,zone),ctx=dates.createDateContext(locale,zone);const tree=detail({file:available,actions});const row=all(tree,'ListItem').find(n=>n.key==='availability');assert.equal(row.props.title,t('files.detail.availability'));assert.equal(text(row.props.trailing),k.availabilityOf(available,new Date(),ctx).long);}
 // Five route wrappers: owned labels only, routes/params/effects remain exact.
 const routes=['files/index','files/folder/[folderId]','files/group/[groupId]','course/[courseId]/files/index','course/[courseId]/files/folder/[folderId]'].map(n=>harness(load('@/app/(app)/'+n).default));
 state.params={courseId:'c',folderId:'sub',groupId:'g'};state.sub=result({id:'sub',name:'Folder',context:{type:'groups',id:'g'}});
 for(const locale of langs){const t=view(locale),before=calls.length;
  const outputs=routes.map(r=>r());const bs=outputs.map(o=>find(o,browser.FolderBrowser));assert.deepEqual(bs.map(x=>x.rootTitle),['my','title','group','title','title'].map(k=>t('files.'+k)));
  assert.deepEqual(bs.map(x=>x.context),[{type:'users',id:'self'},{type:'groups',id:'g'},{type:'groups',id:'g'},{type:'courses',id:'c'},{type:'courses',id:'c'}]);assert.deepEqual(bs.map(x=>x.folderId),[undefined,'sub',undefined,undefined,'sub']);assert.ok(bs.every(x=>x.onOpenFolder===browser.openFolder));assert.equal(bs[3].headerTint,'tint');assert.equal(bs[4].headerTint,'tint');
  const row=find(bs[0].header,'ListItem');assert.equal(row.title,t('files.downloaded'));assert.equal(row.subtitle,t('files.offline'));assert.equal(calls.length,before);row.onPress();assert.deepEqual(calls.pop(),['push','/files/downloads']);
 }
 state.sub.isPending=true;assert.ok(find(routes[1](),'Skeleton'));state.sub=result(undefined);assert.deepEqual(find(routes[1](),browser.FolderBrowser).context,{type:'users',id:'self'});
 state.params={courseId:'c',canvasUrl:'https://synthetic.invalid/courses/c/files?preview=42'};const courseRoute=routes[3];courseRoute();assert.deepEqual(calls.pop(),['replace',{pathname:'/file/[fileId]',params:{fileId:'42',courseId:'c',canvasUrl:state.params.canvasUrl}}]);for(const locale of langs){view(locale);const before=calls.length;courseRoute();assert.equal(calls.length,before,'locale must not rerun routing effect');}
 state.params={courseId:'c',path:'Raw Labs'};state.pathFolder={...folder,parentId:'root',context:{type:'courses',id:'c'}};courseRoute();await flush();assert.deepEqual(calls.splice(-2),[['path',client,{type:'courses',id:'c'},'Raw Labs'],['replace',browser.folderRoute(state.pathFolder)]]);for(const locale of langs){view(locale);const before=calls.length;courseRoute();await flush();assert.equal(calls.length,before);}
 // Fresh production query hooks/fetchers with a separate synthetic read-only client.
 // Assert exact query keys/options and list traversal order, never real account reads.
 delete mocks['@/canvas/api/files'];const querySpecs=[];
 mocks['@/canvas/query']={useCanvasQuery:(...args)=>{querySpecs.push(args);return {};}};
 mocks['@/canvas/client']={CanvasError:class extends Error{},CanvasAuthError:class extends Error{}};
 const api=load('@/canvas/api/files');assert.equal(api.MIN_SEARCH_LENGTH,2);
 const sort={by:'updated_at',order:'desc'},ctx={type:'courses',id:'c'};
 for(const locale of langs){view(locale);api.useRootFolder(ctx);api.useFolder(undefined);api.useFolder('fo');api.useFolderContents('fo',sort);api.useFileSearch(ctx,'  Files  ',sort);api.useFileSearch(ctx,'x',sort);
  const specs=querySpecs.splice(0);assert.deepEqual(specs.map(x=>x[0]),[['files','root','courses','c'],['files','folder',''],['files','folder','fo'],['files','contents','fo','updated_at','desc'],['files','search','courses','c','files','updated_at','desc'],['files','search','courses','c','x','updated_at','desc']]);
  assert.equal(specs[0][2],undefined);assert.deepEqual(specs[1][2],{enabled:false});assert.deepEqual(specs[2][2],{enabled:true});assert.deepEqual(specs[3][2],{enabled:true});assert.equal(specs[4][2].enabled,true);assert.equal(specs[5][2].enabled,false);const previous={raw:true};assert.equal(specs[4][2].placeholderData(previous),previous);
 }
 const readCalls=[],signal=new AbortController().signal;
 const rawFolder={id:'b',name:'Folder',full_name:'Folder',parent_folder_id:'root',context_type:'Course',context_id:'c'},rawFile={id:'f',display_name:'Files',filename:'file.txt'};
 const synthetic={get:async(...args)=>{readCalls.push(['get',...args]);return rawFolder;},getAll:async(...args)=>{readCalls.push(['getAll',...args]);return args[0].endsWith('/folders')?[rawFolder,{...rawFolder,id:'a'}]:[rawFile,{...rawFile,id:'z'}];}};
 const contents=await api.fetchFolderContents(synthetic,'fo',sort,signal);assert.deepEqual(contents.folders.map(f=>f.id),['b','a']);assert.deepEqual(contents.files.map(f=>f.id),['f','z']);
 assert.deepEqual(readCalls.splice(0),[['getAll','/api/v1/folders/fo/folders',undefined,{signal}],['getAll','/api/v1/folders/fo/files',{sort:'updated_at',order:'desc',include:['user']},{signal}]]);
 await api.searchFiles(synthetic,ctx,'Files',sort,signal);assert.deepEqual(readCalls.splice(0),[['getAll','/api/v1/courses/c/folders',{search_term:'Files'},{signal,maxPages:5}],['getAll','/api/v1/courses/c/files',{search_term:'Files',sort:'updated_at',order:'desc'},{signal,maxPages:10}]]);
 for(const can_upload of [true,false,undefined])assert.equal(api.toFolderItem({...rawFolder,can_upload}).canUpload,can_upload??false,'raw missing permission still maps false');
 console.log(`file-browsing: catalogs ${Object.keys(catalogs[0]).length}, browser/card/routes/sheet, refresh and permission checks passed (${process.env.TZ??'host'})`);
})().catch(error=>{console.error(error);process.exitCode=1;});
