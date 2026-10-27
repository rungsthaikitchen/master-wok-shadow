const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=code=>{throw Error(code);};
export function validateStaffCommand(c){
 const keys=['version','commandId','orderId','expectedRevision','action',...(c?.action==='offer'?['target']:[])].sort();
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join()!==keys.join()||c.version!==1||typeof c.commandId!=='string'||typeof c.orderId!=='string'||!uuid.test(c.commandId)||!uuid.test(c.orderId)||!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<1||!['offer','confirm','cancel','complete'].includes(c.action))fail('STAFF_COMMAND_REQUIRED');
 if(c.action==='offer'){
  if(typeof c.target!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.target)||!Number.isFinite(Date.parse(c.target))||new Date(c.target).toISOString().replace('.000Z','Z')!==c.target)fail('STAFF_COMMAND_REQUIRED');
 }
 return c;
}
