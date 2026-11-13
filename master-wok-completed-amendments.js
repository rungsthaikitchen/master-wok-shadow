'use strict';
const {phoneKey}=require('./master-wok-commercial-validator');
const {paymentBalance}=require('./master-wok-payment-validation');
function paymentSummary(order,payment){
 return payment?{recorded:true,billAmount:Number(payment.bill_amount).toFixed(2),billMethod:payment.bill_method,tipAmount:Number(payment.tip_amount).toFixed(2),tipMethod:payment.tip_method,balance:paymentBalance(String(order.total),String(payment.bill_amount))}:{recorded:false,methodUnknown:order.paid===true,balance:null};
}
async function completedLoyalty(connection,before,after,{schema}={}){
 if(!before.loyalty_settled)return null;
 const earned=Number(after.loyalty_points_earned_pending)-Number(before.loyalty_points_earned_pending||0);
 const restored=Number(before.loyalty_points_redeem_pending||0)-Number(after.loyalty_points_redeem_pending||0);
 if(!Number.isInteger(earned)||!Number.isInteger(restored)||restored<0)throw Error('AMENDMENT_INVALID_LOYALTY_STATE');
 if(!earned&&!restored)return null;
 if(before.loyalty_points_earned_pending==null||before.loyalty_points_redeem_pending==null||Number(before.loyalty_points_earned_pending)<0||Number(before.loyalty_points_redeem_pending)<0)throw Error('AMENDMENT_INVALID_LOYALTY_STATE');
 const customer=(await connection.query(`SELECT phone FROM "${schema}".customers WHERE id=$1`,[before.customer_id])).rows[0];
 const phone=phoneKey(customer?.phone);if(!phone)throw Error('AMENDMENT_LOYALTY_ACCOUNT_REQUIRED');
 const account=(await connection.query(`SELECT id,points_balance,lifetime_points FROM "${schema}".loyalty_accounts WHERE customer_phone=$1 FOR UPDATE`,[phone])).rows[0];
 if(!account)throw Error('AMENDMENT_LOYALTY_ACCOUNT_REQUIRED');
 const balance=Number(account.points_balance)+earned+restored,lifetime=Number(account.lifetime_points)+earned;
 if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(lifetime)||balance<0||lifetime<0)throw Error('AMENDMENT_LOYALTY_BALANCE_NEEDS_REVIEW');
 return {accountId:account.id,before:{pointsBalance:Number(account.points_balance),lifetimePoints:Number(account.lifetime_points)},after:{pointsBalance:balance,lifetimePoints:lifetime},earnedPointsChange:earned,redeemedPointsRestored:restored};
}
module.exports={paymentSummary,completedLoyalty};
