'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertSecureStagingBundle}=require('../scripts/assert-secure-staging-bundle.cjs');
const safe="const value=Deno.env.get('MASTER_WOK_BOOKING_SECRET'); const fail='RELEASE_NOT_CERTIFIED_OR_CONFIGURED';";
test('accepts environment-only fail-closed bootstrap',()=>assert.equal(assertSecureStagingBundle(safe),true));
test('rejects inline private staging configuration',()=>assert.throws(
 ()=>assertSecureStagingBundle(safe+" const privateStagingConfiguration={};"),/EMBEDDED_STAGING_CONFIG_FORBIDDEN/));
test('rejects embedded booking secret assignment',()=>assert.throws(
 ()=>assertSecureStagingBundle(safe+' const obj={"MASTER_WOK_BOOKING_SECRET":"EXAMPLE_NOT_REAL"};'),/EMBEDDED_SECRET_FORBIDDEN/));
test('rejects embedded notification secret assignment',()=>assert.throws(
 ()=>assertSecureStagingBundle(safe+' const obj={"MASTER_WOK_NOTIFICATION_SECRET":"EXAMPLE_NOT_REAL"};'),/EMBEDDED_SECRET_FORBIDDEN/));
test('rejects missing environment lookup',()=>assert.throws(
 ()=>assertSecureStagingBundle("const fail='RELEASE_NOT_CERTIFIED_OR_CONFIGURED';"),/ENVIRONMENT_BOOTSTRAP_REQUIRED/));
test('rejects missing fail-closed response',()=>assert.throws(
 ()=>assertSecureStagingBundle("const x=Deno.env.get('SUPABASE_URL');"),/FAIL_CLOSED_RESPONSE_REQUIRED/));
