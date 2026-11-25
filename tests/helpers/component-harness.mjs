// Executes a component's real handlers/effects without a browser or network.
// JSX children remain elements: this checks state transitions, not DOM layout.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

export function memoryStorage(initial={}){
 const values=new Map(Object.entries(initial));
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};
}
export function browserGlobals({storage=memoryStorage(),session=memoryStorage(),search=''}={}){
 const window=new EventTarget(),document=new EventTarget();
 Object.assign(window,{localStorage:storage,sessionStorage:session,location:{search,pathname:'/'},history:{replaceState(){}},scrollTo(){}});
 Object.assign(document,{activeElement:null,visibilityState:'visible',getElementById:()=>null});
 return {window,document,localStorage:storage,sessionStorage:session,navigator:{}};
}
const components=new Proxy({}, {get:(object,key)=>object[key]??(object[key]=Object.assign(()=>null,{displayName:String(key)}))});
export async function componentHarness(file,{modules={},globals=browserGlobals(),exportName,props={},expose=[]}={}){
 const filename=path.resolve(file),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 // Expose private page components only in this in-memory test module.
 const source=await fs.readFile(filename,'utf8')+(expose.length?'\nexport {'+expose.join(',')+'};':'');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const hooks=[],pending=[];let index=0,dirty=false,tree,mounted=true,currentProps=props;
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((value,i)=>!Object.is(value,b[i]));
 const react={
  useState(initial){const i=index++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
  useRef(initial){const i=index++;if(!hooks[i])hooks[i]={value:{current:initial}};return hooks[i].value;},
  useEffect(effect,deps){const i=index++,old=hooks[i];if(!old||changed(old.deps,deps)){hooks[i]={...old,deps};pending.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=effect();});}},
  useMemo(factory,deps){const i=index++;if(!hooks[i]||changed(hooks[i].deps,deps))hooks[i]={value:factory(),deps};return hooks[i].value;},
  useCallback(callback,deps){return react.useMemo(()=>callback,deps);},
  useId(){return 'component-test-'+index++;},
 };
 const dependencies={react,'react/jsx-runtime':jsx,'lucide-react':components,...modules};
 for(const [,name] of output.matchAll(/require\("([^"]+)"\)/g)){
  if(name in dependencies)continue;
  if(name.startsWith('@/lib/')){
   const target=path.join(root,name.slice(2));
   dependencies[name]=name.endsWith('.json')?JSON.parse(await fs.readFile(target,'utf8')):await import(pathToFileURL(target+'.ts').href);
  }else if(name.startsWith('@/components/')||name.startsWith('./'))dependencies[name]=components;
  else throw new Error('Mock the component dependency '+name);
 }
 const exports={},context=vm.createContext({exports,require:name=>dependencies[name],console,crypto,Error,TypeError,RangeError,AbortController,DOMException,URL,URLSearchParams,Event,CustomEvent,EventTarget,Response,Request,setTimeout,clearTimeout,fetch:()=>{throw new Error('Network is disabled in component tests');},...globals});
 new vm.Script(output,{filename}).runInContext(context);
 const Component=exportName?exports[exportName]:exports.default||Object.values(exports).find(value=>typeof value==='function'&&/^[A-Z]/.test(value.name));
 if(!Component)throw new Error('No component export in '+filename);
 function render(nextProps){
  if(nextProps)currentProps=nextProps;
  if(!mounted)return tree;
  for(let pass=0;pass<40;pass++){
   dirty=false;index=0;tree=Component(currentProps);
   while(pending.length)pending.shift()();
   if(!dirty)return tree;
  }
  throw new Error('Component did not settle after its effects');
 }
 function elements(predicate=()=>true){const found=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;if(predicate(node))found.push(node);walk(node.props?.children);}walk(tree);return found;}
 function text(node=tree){if(Array.isArray(node))return node.map(child=>text(child??null)).join('');if(node===null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);return text(node.props?.children??null);}
 const harness={globals,render,elements,text,get tree(){return tree;},async flush(){for(let i=0;i<8;i++){await Promise.resolve();if(dirty)render();}return tree;},unmount(){mounted=false;for(const hook of hooks)hook.cleanup?.();}};
 render();return harness;
}
