import {user} from './api';
export const MODE_KEY='sps-display-mode';
const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
export function simplePreferred() {
  const mode=read(MODE_KEY);
  if(mode==='simple'||mode==='full')return mode==='simple';
  const legacy=read('sps-simple:'+(user()?.id||'guest'));
  if(legacy==='true'||legacy==='false')return legacy==='true';
  try{return new URL(location.href).searchParams.get('mode')!=='full';}catch{return true;}
}
export function setSimplePreferred(value) {
  try{localStorage.setItem(MODE_KEY,value?'simple':'full');}catch{}
}
export const preferredRoute=()=>simplePreferred()?'/simple':'/mine';
