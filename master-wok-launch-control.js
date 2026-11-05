'use strict';
// Read on the dedicated connection AFTER acquiring the shared writer lock.
// The release operator uses that same lock to drain in-flight writes. Neither
// request payloads nor this module can approve a release or change the mode.
function createLaunchControl({schema='public',releaseId}={}){
 if(!['public','master_wok_rehearsal'].includes(schema)||
  !/^[a-zA-Z0-9._-]{8,128}$/.test(releaseId||''))throw Error('INVALID_RELEASE_CONFIGURATION');
 const table='"'+schema+'".master_wok_launch_control';
 async function read(connection){
  const row=(await connection.query(`SELECT mode,approved_release_id,revision FROM ${table} WHERE id=1`)).rows[0];
  if(!row||!['LEGACY','DRAINING','MASTER_WOK'].includes(row.mode))throw Error('LAUNCH_CONTROL_UNAVAILABLE');
  if(row.mode==='MASTER_WOK'&&row.approved_release_id!==releaseId)throw Error('RELEASE_NOT_APPROVED');
  return row;
 }
 return {read,async assertWriteAllowed(connection){
  if((await read(connection)).mode!=='MASTER_WOK')throw Error('AUTHORITATIVE_WRITER_DISABLED');
 }};
}
module.exports={createLaunchControl};
