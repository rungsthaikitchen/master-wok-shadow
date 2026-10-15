'use strict';
// Backend supplies a durable, leased queue; this worker only acknowledges AFTER
// durable observation persistence. Queue messages carry minimal pre-decision inputs.
function createShadowWorker({queue,observer,enabled=false}={}) {
  if (!queue || !['claim','ack','retry'].every(key=>typeof queue[key]==='function') ||
      !observer || typeof observer.observe!=='function') throw Error('WORKER_DEPENDENCIES_REQUIRED');
  let running=false;
  async function runOnce() {
    if(enabled !== true) return {state:'DISABLED'};
    if(running) return {state:'BUSY'};
    running=true;
    let message;
    try {
      message=await queue.claim();
      if(!message) return {state:'IDLE'};
      const result=await observer.observe(message.event);
      if(!result.observed) {
        await queue.retry(message, result.reason);
        return {state:'RETRY'};
      }
      await queue.ack(message);
      return {state:'RECORDED'};
    } catch (_) {
      // A failed ack leaves the lease to expire; redelivery is idempotent.
      return {state:'QUEUE_OR_WORKER_ERROR'};
    } finally {running=false;}
  }
  return Object.freeze({runOnce});
}
module.exports={createShadowWorker};
