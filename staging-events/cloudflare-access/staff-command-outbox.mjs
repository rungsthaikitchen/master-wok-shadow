// Offline UI candidate. Inject browser storage; no automatic network requests.
import {validateStaffCommand} from './versioned-staff-command.mjs';
const KEY='master-wok:synthetic-staff-intent:v1';
export function createStaffIntentStore(storage){
 function resume(){
  const raw=storage.getItem(KEY);if(raw===null)return null;
  try{if(typeof raw!=='string'||raw.length>8192)throw Error();return Object.freeze(validateStaffCommand(JSON.parse(raw)));}
  catch{throw Error('STAFF_INTENT_STORAGE_REFUSED');}
 }
 return Object.freeze({resume,
  begin(input){
   if(resume())throw Error('STAFF_INTENT_PENDING');
   if(!input||Object.hasOwn(input,'commandId')||Object.hasOwn(input,'version'))throw Error('STAFF_COMMAND_REQUIRED');
   const c=validateStaffCommand({...input,version:1,commandId:crypto.randomUUID()});
   const raw=JSON.stringify(c);storage.setItem(KEY,raw);
   if(storage.getItem(KEY)!==raw)throw Error('STAFF_INTENT_NOT_PERSISTED');
   return Object.freeze(c);
  },
  acknowledge(commandId,result){
   const c=resume();if(!c||c.commandId!==commandId||!result||!['RECORDED','ALREADY_RECORDED'].includes(result.status)||!Number.isSafeInteger(result.revision)||result.revision<1)throw Error('STAFF_INTENT_ACK_REFUSED');
   storage.removeItem(KEY);if(storage.getItem(KEY)!==null)throw Error('STAFF_INTENT_NOT_CLEARED');
  }
 });
}
