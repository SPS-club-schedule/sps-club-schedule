'use strict';

// Only the bundled App opts into durable data snapshots. No sessions, passwords,
// invitations or account settings belong in this store.
const PREFIX='sps-app-snapshot-v1:';
function createSnapshotCache({storage,now=Date.now}) {
  const boardKey=context=>PREFIX+'board:'+JSON.stringify([context.namespace,context.clubId||'']);
  const bookingKey=origin=>PREFIX+'booking:'+origin;
  function remove(key){try{storage().removeItem(key);}catch{}}
  function read(key){
    try{
      const record=JSON.parse(storage().getItem(key));
      if(record?.schema!==1||!Number.isFinite(record.savedAt)||record.savedAt<=0||record.savedAt>now()+60000)throw new Error('Invalid snapshot');
      return record;
    }catch{remove(key);return null;}
  }
  function write(key,data,savedAt=now()){
    try{
      const value=JSON.stringify({schema:1,savedAt,data});
      if(value.length>2*1024*1024)return;
      storage().setItem(key,value);
      // Bound retained clubs; a storage failure must not interrupt live sync.
      const keys=Object.keys(storage()).filter(k=>k.startsWith(PREFIX)&&k!==key);
      if(keys.length>=8)keys.sort((a,b)=>(read(a)?.savedAt||0)-(read(b)?.savedAt||0)).slice(0,keys.length-7).forEach(remove);
    }catch{}
  }
  function validBoard(board,context){return board?.club?.id===context.clubId&&!!board.me?.id&&Number.isFinite(board.version)&&['tasks','members','templates'].every(k=>Array.isArray(board[k]));}
  return {
    readBoard(context){const record=read(boardKey(context));if(!record)return null;if(!validBoard(record.data,context)){remove(boardKey(context));return null;}return {board:record.data,checkedAt:record.savedAt};},
    writeBoard(context,board,checkedAt){
      if(!board?.club?.id){remove(boardKey(context));return;}
      const data={};for(const field of ['version','club','me','members','tasks','templates'])data[field]=board[field];
      data.templates ||= [];
      const selected={...context,clubId:board.club.id};
      if(validBoard(data,selected))write(boardKey(selected),data,checkedAt);
    },
    removeBoard(context){remove(boardKey(context));},
    clearPrivate(){try{Object.keys(storage()).filter(k=>k.startsWith(PREFIX+'board:')).forEach(remove);}catch{}},
    readBooking(origin){const record=read(bookingKey(origin));if(!record)return null;if(!Array.isArray(record.data?.activities)||typeof record.data.from!=='string'||typeof record.data.to!=='string'){remove(bookingKey(origin));return null;}return {...record.data,cached:true,checkedAt:record.savedAt};},
    writeBooking(origin,data){write(bookingKey(origin),{activities:data.activities,from:data.from,to:data.to});}
  };
}
module.exports={createSnapshotCache};
