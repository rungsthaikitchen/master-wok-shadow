// staff-command-format.mjs
var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var fail = (code) => {
  throw Error(code);
};
function validateStaffCommand(c) {
  const keys = ["version", "commandId", "orderId", "expectedRevision", "action", ...c?.action === "offer" ? ["target"] : []].sort();
  if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).sort().join() !== keys.join() || c.version !== 1 || typeof c.commandId !== "string" || typeof c.orderId !== "string" || !uuid.test(c.commandId) || !uuid.test(c.orderId) || !Number.isSafeInteger(c.expectedRevision) || c.expectedRevision < 1 || !["offer", "confirm", "cancel", "complete"].includes(c.action)) fail("STAFF_COMMAND_REQUIRED");
  if (c.action === "offer") {
    if (typeof c.target !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.target) || !Number.isFinite(Date.parse(c.target)) || new Date(c.target).toISOString().replace(".000Z", "Z") !== c.target) fail("STAFF_COMMAND_REQUIRED");
  }
  return c;
}

// staff-command-outbox.mjs
var KEY = "master-wok:synthetic-staff-intent:v1";
function createStaffIntentStore(storage) {
  function resume() {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    try {
      if (typeof raw !== "string" || raw.length > 8192) throw Error();
      return Object.freeze(validateStaffCommand(JSON.parse(raw)));
    } catch {
      throw Error("STAFF_INTENT_STORAGE_REFUSED");
    }
  }
  return Object.freeze({
    resume,
    begin(input) {
      if (resume()) throw Error("STAFF_INTENT_PENDING");
      if (!input || Object.hasOwn(input, "commandId") || Object.hasOwn(input, "version")) throw Error("STAFF_COMMAND_REQUIRED");
      const c = validateStaffCommand({ ...input, version: 1, commandId: crypto.randomUUID() });
      const raw = JSON.stringify(c);
      storage.setItem(KEY, raw);
      if (storage.getItem(KEY) !== raw) throw Error("STAFF_INTENT_NOT_PERSISTED");
      return Object.freeze(c);
    },
    discardRefused(commandId, error) {
      const c = resume();
      if (!c || c.commandId !== commandId || error !== "STAFF_REVISION_CONFLICT") throw Error("STAFF_INTENT_DISCARD_REFUSED");
      storage.removeItem(KEY);
      if (storage.getItem(KEY) !== null) throw Error("STAFF_INTENT_NOT_CLEARED");
    },
    acknowledge(commandId, result) {
      const c = resume();
      if (!c || c.commandId !== commandId || !result || !["RECORDED", "ALREADY_RECORDED"].includes(result.status) || !Number.isSafeInteger(result.revision) || result.revision < 1) throw Error("STAFF_INTENT_ACK_REFUSED");
      storage.removeItem(KEY);
      if (storage.getItem(KEY) !== null) throw Error("STAFF_INTENT_NOT_CLEARED");
    }
  });
}

// staff-browser-client.mjs
var orderId = document.body.dataset.orderId;
var store = createStaffIntentStore(localStorage);
var $ = (id) => document.getElementById(id);
var message = $("message");
var actions = [...document.querySelectorAll("[data-action]")];
var labels = { pending: "Pending", proposed: "Time offered", confirmed: "Confirmed", customer_accepted_time: "Time accepted", customer_declined_time: "Time declined", cancelled: "Cancelled", completed: "Completed" };
var format = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
var state = null;
var busy = false;
var conflict = false;
var storageFailed = false;
function pending() {
  try {
    return store.resume();
  } catch {
    storageFailed = true;
    return null;
  }
}
function render() {
  const p = pending(), closed = state && ["cancelled", "completed"].includes(state.status);
  for (const button of actions) button.disabled = busy || storageFailed || !state || !!p || closed;
  $("retry").hidden = !p || conflict;
  $("retry").disabled = busy || storageFailed;
  $("review").hidden = !p || !conflict;
  $("review").disabled = busy || storageFailed;
  $("refresh").disabled = busy || !!p || storageFailed;
  $("target").disabled = busy || !!p || closed || storageFailed;
  if (state) {
    $("status").textContent = labels[state.status];
    $("current-target").textContent = format(state.target);
  }
  if (storageFailed) message.textContent = "Saved action could not be read. Stop here and ask for help.";
}
async function post(path, body) {
  const r = await fetch(path, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8e3), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const b = await r.json();
  if (!r.ok) {
    const e = Error("REQUEST_FAILED");
    e.status = r.status;
    e.code = b.error;
    throw e;
  }
  return b;
}
async function refresh() {
  state = null;
  render();
  const s = await post("/admin-api/staff-state-v1", { orderId });
  if (!s || s.orderId !== orderId || !Number.isSafeInteger(s.revision) || s.revision < 1 || !Object.hasOwn(labels, s.status) || typeof s.target !== "string" || !Number.isFinite(Date.parse(s.target)) || !Array.isArray(s.proposalTargets) || s.proposalTargets.length > 8 || !s.proposalTargets.every((t) => typeof t === "string" && Number.isFinite(Date.parse(t)))) throw Error("STATE_REQUIRED");
  state = s;
  $("target").replaceChildren(...s.proposalTargets.map((t) => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = format(t);
    return o;
  }));
  render();
}
async function send(c) {
  try {
    const result = await post("/admin-api/staff-command-v1", c);
    store.acknowledge(c.commandId, result);
    conflict = false;
    await refresh();
    message.textContent = "Action saved. Latest order details loaded.";
  } catch (e) {
    if (e.code === "STAFF_REVISION_CONFLICT") {
      conflict = true;
      message.textContent = "Order changed. Review the latest details before trying again.";
    } else if (e.status === 401 || e.status === 403) message.textContent = "Sign in again before retrying the saved action.";
    else message.textContent = pending() ? "We could not confirm the result. Retry the same saved action." : "Action saved, but latest details could not load. Refresh before another action.";
  }
}
async function run(fn) {
  if (busy) return;
  busy = true;
  message.textContent = "Working\u2026";
  render();
  try {
    await fn();
  } catch (e) {
    message.textContent = e.code === "STAFF_BROWSER_STAGING_DISABLED" ? "Staging route is disabled. No action has been sent." : e.status === 403 ? "Sign in before loading staging details." : "Could not load staging details. Refresh to try again.";
  } finally {
    busy = false;
    render();
  }
}
for (const button of actions) button.addEventListener("click", () => run(async () => {
  if (!state || pending() || storageFailed) return;
  const action = button.dataset.action;
  let c;
  try {
    c = store.begin({ orderId, expectedRevision: state.revision, action, ...action === "offer" ? { target: $("target").value } : {} });
  } catch {
    storageFailed = true;
    return;
  }
  await send(c);
}));
$("retry").addEventListener("click", () => run(async () => {
  const c = pending();
  if (c && c.orderId === orderId) await send(c);
}));
$("review").addEventListener("click", () => run(async () => {
  const c = pending();
  if (c) store.discardRefused(c.commandId, "STAFF_REVISION_CONFLICT");
  conflict = false;
  await refresh();
  message.textContent = "Latest details loaded. Choose a new action if needed.";
}));
$("refresh").addEventListener("click", () => run(async () => {
  await refresh();
  message.textContent = "Latest order details loaded.";
}));
run(async () => {
  const p = pending();
  if (p && p.orderId !== orderId) {
    storageFailed = true;
    return;
  }
  await refresh();
  message.textContent = p ? "Unfinished test action found. Retry to check its result." : "Ready for a test action.";
});
