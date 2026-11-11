'use strict';
// Server-only grants. A grant permits a new locked assessment, never a booking
// by itself. Tokens are random bearer capabilities and only hashes are stored.
const {priceBasket}=require('./master-wok-commercial');
const UUID=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const TOKEN=/^[a-f0-9]{64}$/;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function validApproval(input){
 return UUID.test(input?.reviewId||'')&&['pending','contacted','approved'].includes(input.expectedStatus)&&
  typeof input.agreedTime==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(input.agreedTime)&&Number.isFinite(Date.parse(input.agreedTime))&&
  Number.isInteger(input.maxHoldMinutes)&&input.maxHoldMinutes>=20&&input.maxHoldMinutes<=330&&
  input.customerDiscussed===true&&typeof input.reason==='string'&&input.reason.trim().length>=5&&input.reason.length<=1000&&
  typeof input.staffActor==='string'&&input.staffActor.trim().length>0&&input.staffActor.length<=320;
}
function createReviewApproval({schema='public',pool,assertWriteAllowed}={}){
 if(!['public','master_wok_rehearsal'].includes(schema)||!pool||typeof assertWriteAllowed!=='function')throw Error('INVALID_REVIEW_APPROVAL_CONFIGURATION');
 const reviews='"'+schema+'".master_wok_basket_reviews';
 const grants='"'+schema+'".master_wok_review_approvals';
 return {
  async approve(input){
   if(!validApproval(input))return {success:false,statusCode:400,reason:'INVALID_AGREED_TIME_APPROVAL'};
   const token=randomToken(),digest=await hash(token),c=await pool.connect();
   try{
    const {beginBookingTransaction}=require('./master-wok-transaction-writer');
    await beginBookingTransaction(c);await assertWriteAllowed(c);
    const row=(await c.query('SELECT * FROM '+reviews+' WHERE id=$1 FOR UPDATE',[input.reviewId])).rows[0];
    if(!row||row.status!==input.expectedStatus)throw Error('REVIEW_CHANGED_REFRESH');
    const saved=await c.query('INSERT INTO '+grants+' AS current_grant (review_id,token_hash,agreed_time,max_hold_minutes,reason,staff_actor,customer_discussed,expires_at) '+
     "VALUES($1,$2,$3,$4,$5,$6,true,clock_timestamp()+interval '30 minutes') ON CONFLICT(review_id) DO UPDATE SET token_hash=excluded.token_hash,agreed_time=excluded.agreed_time,max_hold_minutes=excluded.max_hold_minutes,reason=excluded.reason,staff_actor=excluded.staff_actor,customer_discussed=true,created_at=clock_timestamp(),expires_at=excluded.expires_at,audit_history=current_grant.audit_history||jsonb_build_array(to_jsonb(current_grant)-'audit_history') WHERE current_grant.order_id IS NULL RETURNING id,expires_at",
     [row.id,digest,new Date(input.agreedTime).toISOString(),input.maxHoldMinutes,input.reason.trim(),input.staffActor.trim()]);
    if(saved.rows.length!==1)throw Error('REVIEW_CHANGED_REFRESH');
    await c.query("UPDATE "+reviews+" SET status='approved',updated_at=clock_timestamp() WHERE id=$1",[row.id]);
    await c.query('COMMIT');return {success:true,token,approvalId:saved.rows[0].id,expiresAt:saved.rows[0].expires_at,
     reservesCapacity:false,message:'Customer must complete checkout. Capacity and price will be checked again.'};
   }catch(error){await c.query('ROLLBACK').catch(()=>{});return {success:false,statusCode:409,
    reason:error.message==='REVIEW_CHANGED_REFRESH'?error.message:'AGREED_TIME_APPROVAL_UNAVAILABLE'};
   }finally{c.release();}
  },
  async read(c,token,{forUpdate=false}={}){
   if(!TOKEN.test(token||''))throw Error('REVIEW_APPROVAL_INVALID');
   const row=(await c.query('SELECT a.*,r.basket,r.order_type,r.customer_name,r.customer_phone,r.delivery_address,r.status AS review_status FROM '+grants+' a JOIN '+reviews+
    ' r ON r.id=a.review_id WHERE a.token_hash=$1'+(forUpdate?' FOR UPDATE OF a,r':''),[await hash(token)])).rows[0];
   if(!row||row.review_status!=='approved'||row.order_id)throw Error('REVIEW_APPROVAL_INVALID');
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   if(!now||!Number.isFinite(+new Date(now))||!Number.isFinite(+new Date(row.expires_at))||new Date(row.expires_at)<=new Date(now))throw Error('REVIEW_APPROVAL_EXPIRED');
   return row;
  },
  async lookup(token){
   const c=await pool.connect();try{
    const row=await this.read(c,token);
    return {success:true,review:{items:row.basket,orderType:row.order_type,preferredTime:row.agreed_time,
     customer:{name:row.customer_name,phone:row.customer_phone,address:row.delivery_address||''},
     maxHoldMinutes:row.max_hold_minutes,expiresAt:row.expires_at},reservesCapacity:false};
   }catch(_){return {success:false,statusCode:409,reason:'REVIEW_APPROVAL_INVALID_OR_EXPIRED'};}finally{c.release();}
  },
  async authorize(c,input){
   const row=await this.read(c,input.reviewApprovalToken,{forUpdate:true});
   const same=JSON.stringify(priceBasket(input.items).items)===JSON.stringify(priceBasket(row.basket).items);
   const phone=s=>String(s||'').replace(/[^+0-9]/g,'');
   if(!same||input.orderType!==row.order_type||new Date(input.preferredTime).getTime()!==new Date(row.agreed_time).getTime()||
    phone(input.customer?.phone)!==phone(row.customer_phone)||(row.order_type==='delivery'&&input.customer?.address!==row.delivery_address)||
    input.reviewHoldingAcknowledged!==true)throw Error('REVIEW_APPROVAL_MISMATCH');
   return {approvalId:row.id,reviewId:row.review_id,maxMinutes:row.max_hold_minutes,reason:row.reason,
    staffActor:row.staff_actor,customerDiscussed:true,approvedAt:new Date(row.created_at).toISOString()};
  },
  async consume(c,approval,orderId){
   const updated=await c.query('UPDATE '+grants+' SET order_id=$2,consumed_at=clock_timestamp() WHERE id=$1 AND order_id IS NULL AND expires_at>clock_timestamp() RETURNING review_id',[approval.approvalId,orderId]);
   if(updated.rows.length!==1)throw Error('REVIEW_APPROVAL_ALREADY_USED');
   await c.query("UPDATE "+reviews+" SET status='resolved',updated_at=clock_timestamp() WHERE id=$1 AND status='approved'",[approval.reviewId]);
  }
 };
}
module.exports={createReviewApproval,validApproval,hash};
