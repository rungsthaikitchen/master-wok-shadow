'use strict';
const {phoneKey}=require('./master-wok-commercial-validator');
// Called inside the order lifecycle transaction after the order row is locked.
// New Master Wok checkouts reserve rewards; their balance changes exactly once,
// on completion. Imported legacy orders retain their existing settlement path.
async function settleMasterWokLoyalty(connection,order,{schema='public'}={}){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_LOYALTY_SCHEMA');
 if(order.status!=='completed'||order.is_test)return {handled:false};
 const q='"'+schema+'".';
 const receipt=(await connection.query(`SELECT order_id FROM ${q}master_wok_booking_receipts WHERE order_id=$1`,[order.id])).rows[0];
 if(!receipt)return {handled:false};
 if(order.loyalty_settled)return {handled:true,settled:true};
 const customer=(await connection.query(`SELECT phone,email FROM ${q}customers WHERE id=$1`,[order.customer_id])).rows[0];
 const phone=phoneKey(customer?.phone);
 if(!phone)throw Error('LOYALTY_CUSTOMER_REQUIRED');
 const earned=Number(order.loyalty_points_earned_pending||0),redeemed=Number(order.loyalty_points_redeem_pending||0);
 if(!Number.isInteger(earned)||earned<0||!Number.isInteger(redeemed)||redeemed<0)throw Error('INVALID_PENDING_LOYALTY');
 await connection.query(`INSERT INTO ${q}loyalty_accounts(customer_phone,customer_email,points_balance,lifetime_points)
  VALUES($1,$2,0,0) ON CONFLICT(customer_phone) DO NOTHING`,[phone,customer.email]);
 const account=(await connection.query(`SELECT id,points_balance,lifetime_points FROM ${q}loyalty_accounts WHERE customer_phone=$1 FOR UPDATE`,[phone])).rows[0];
 if(!account)throw Error('LOYALTY_ACCOUNT_REQUIRED');
 const balance=Math.max(0,Number(account.points_balance)-redeemed+earned);
 await connection.query(`UPDATE ${q}loyalty_accounts SET points_balance=$2,lifetime_points=$3,
  customer_email=$4,last_order_at=$5,updated_at=clock_timestamp() WHERE id=$1`,
  [account.id,balance,Number(account.lifetime_points||0)+earned,customer.email,order.created_at]);
 await connection.query(`UPDATE ${q}orders SET loyalty_settled=true WHERE id=$1`,[order.id]);
 return {handled:true,settled:true,pointsBalance:balance};
}
module.exports={settleMasterWokLoyalty};
