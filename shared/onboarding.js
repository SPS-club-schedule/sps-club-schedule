// The preference belongs to one membership in this browser, not to every user
// sharing the device. In-memory fallback also works when storage is unavailable.
export function tutorialKey(accountId, clubId) {
  return accountId && clubId ? 'sps-member-guide-v2:'+JSON.stringify([accountId,clubId]) : '';
}

export function tutorialPreferences(storage) {
  const dismissed=new Set();
  return {
    seen(key) {
      if (!key || dismissed.has(key)) return true;
      try { return ['skipped','completed'].includes(storage()?.getItem(key)); }
      catch { return false; }
    },
    dismiss(key, completed=false) {
      if (!key) return;
      dismissed.add(key);
      try { storage()?.setItem(key,completed?'completed':'skipped'); } catch {}
    }
  };
}

export function canOfferTutorial(s, accountId) {
  return !!accountId && ['board','mine','calendar'].includes(s.page) &&
    s.sync?.phase==='ready' && !!s.sync.board?.club?.id && !!s.sync.board?.me?.id &&
    !s.busy && !s.recovery && !s.error;
}

// Keep the coach beside the real control when space permits; on phones place it
// above/below. Four opaque hit areas leave the highlighted control interactive.
export function spotlightLayout(rect, viewport, card) {
  const {width:w,height:h,left:x=0,top:y=0}=viewport,pad=8,gap=16,edge=12;
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,Math.max(min,max)));
  const left=clamp(rect.left-pad,x+4,x+w-4),right=clamp(rect.right+pad,left,x+w-4);
  let top=clamp(rect.top-pad,y+4,y+h-4),bottom=clamp(rect.bottom+pad,top,y+h-4);
  const cw=Math.min(card.width,w-2*edge),ch=Math.min(card.height,h-2*edge);
  let cx,cy;
  if(x+w-right>=cw+gap+edge) {cx=right+gap;cy=clamp(top,y+edge,y+h-ch-edge);}
  else if(left-x>=cw+gap+edge) {cx=left-gap-cw;cy=clamp(top,y+edge,y+h-ch-edge);}
  else {
    cx=clamp(left,x+edge,x+w-cw-edge);
    if(y+h-bottom>=ch+gap+edge)cy=bottom+gap;
    else if(top-y>=ch+gap+edge)cy=top-gap-ch;
    else {
      // Oversized regions remain scrollable; reserve a visible coach below them.
      cy=y+h-ch-edge;bottom=Math.min(bottom,cy-gap);top=Math.min(top,bottom);
    }
  }
  return {hole:{left,top,width:right-left,height:bottom-top},card:{left:cx,top:cy},shades:[
    {left:x,top:y,width:w,height:top-y},
    {left:x,top,width:left-x,height:bottom-top},
    {left:right,top,width:x+w-right,height:bottom-top},
    {left:x,top:bottom,width:w,height:y+h-bottom}
  ]};
}
