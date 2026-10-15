
(function () {
  "use strict";

  const CONFIG = Object.freeze({
    kitchenStartMinute: 16 * 60 + 30,
    stepMinutes: 5,
    normalHoldingMinutes: 10,
    maxSearchNodes: 100000
  });

  function toMinute(value) {
    if (!(value instanceof Date) ||
        !Number.isFinite(value.getTime())) {
      throw new Error("Master Wok: invalid placement date");
    }

    return value.getHours() * 60 +
           value.getMinutes() +
           value.getSeconds() / 60;
  }

  function durationFor(classification) {
    const pressure =
      window.MasterWokModelV1.calculateCombinedKitchenPressure([classification]);

    const duration = pressure?.productionWindow?.reservedMinutes;

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Master Wok: invalid cooking duration");
    }

    return duration;
  }


function schedule(reservations, options = {}) {
  const holding =
    options.maxHoldingMinutes ?? CONFIG.normalHoldingMinutes;
    const asOfMinute =
  options.asOfMinute ?? CONFIG.kitchenStartMinute;

if (!Number.isFinite(asOfMinute) ||
    asOfMinute < 0 ||
    asOfMinute >= 24 * 60) {
  throw new Error("Master Wok: invalid scheduling start time");
}

const effectiveStartMinute = Math.max(
  CONFIG.kitchenStartMinute,
  asOfMinute
);

const blockedIntervals = options.blockedIntervals ?? [];

if (
  !Array.isArray(blockedIntervals) ||
  blockedIntervals.some(interval =>
    !Number.isFinite(interval.start) ||
    !Number.isFinite(interval.finish) ||
    interval.finish <= interval.start
  )
) {
  throw new Error(
    "Master Wok: invalid blocked intervals"
  );
}

function overlapsBlockedInterval(start, finish) {
  return blockedIntervals.some(interval =>
    start < interval.finish &&
    finish > interval.start
  );
}

  const jobs = reservations.map((order, index) => {
    const duration = Number.isFinite(order.durationOverride)
      ? order.durationOverride
      : durationFor(order.classification);

    const placedMinute = toMinute(order.placedAt);
    let placed = placedMinute;

    if (options.serviceDate !== undefined) {
      if (
        typeof options.serviceDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(options.serviceDate)
      ) {
        throw new Error("Master Wok: invalid service date");
      }

      const placementDate = [
        order.placedAt.getFullYear(),
        String(order.placedAt.getMonth() + 1).padStart(2, "0"),
        String(order.placedAt.getDate()).padStart(2, "0")
      ].join("-");

      if (placementDate < options.serviceDate) {
        placed = CONFIG.kitchenStartMinute;
      } else if (placementDate > options.serviceDate) {
        throw new Error(
          "Master Wok: order placed after service date"
        );
      }
    }

    const ready = Number(order.readyMinute);

    if (
      !Number.isFinite(ready) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error("Master Wok: invalid scheduling input");
    }

    const earliest = Math.max(
        effectiveStartMinute,
        placed,
        ready - holding - duration
        );

    const latest = ready - duration;

    return {
      id: order.orderId ?? `ORDER-${index + 1}`,
      index,
      ready,
      duration,
      earliest: Math.ceil(earliest),
      latest: Math.floor(latest)
    };
  });

  const jobSummaries = jobs.map(job => ({
    id: job.id,
    index: job.index,
    ready: job.ready,
    duration: job.duration,
    candidateSlots: Math.max(
      0,
      job.latest - job.earliest + 1
    )
  }));

  // An order with no valid cooking window cannot fit.
  if (jobs.some(job => job.earliest > job.latest)) {
    return {
      feasible: false,
      exhausted: false,
      nodes: 0,
      timeline: [],
      jobs: jobSummaries
    };
  }

  /*
   * Exact single-resource feasibility search.
   *
   * Each job has:
   * - an earliest permitted start
   * - a latest permitted start
   * - a fixed cooking duration
   *
   * Memoisation avoids revisiting identical scheduling
   * states. We also prune branches where remaining work
   * cannot fit before its deadlines.
   */

  const ordered = [...jobs].sort(
    (a, b) =>
      a.latest + a.duration -
      (b.latest + b.duration) ||
      a.earliest - b.earliest
  );

  let nodes = 0;
  let exhausted = false;

  const failedStates = new Set();

  function search(remaining, currentTime, timeline) {
    nodes++;

    if (nodes > CONFIG.maxSearchNodes) {
      exhausted = true;
      return null;
    }

    if (remaining.length === 0) {
      return timeline;
    }

    const stateKey =
      `${currentTime}|${remaining.map(j => j.index).join(",")}`;

    if (failedStates.has(stateKey)) {
      return null;
    }

    // Check whether any remaining deadline is already lost.
    for (const job of remaining) {
      if (
        Math.max(currentTime, job.earliest) >
        job.latest
      ) {
        failedStates.add(stateKey);
        return null;
      }
    }

    // Check cumulative demand before each deadline.
    const deadlines = [
      ...new Set(
        remaining.map(job => job.latest + job.duration)
      )
    ].sort((a, b) => a - b);

    for (const deadline of deadlines) {
      const dueJobs = remaining.filter(
        job => job.latest + job.duration <= deadline
      );

      const required = dueJobs.reduce(
        (sum, job) => sum + job.duration,
        0
      );

      if (currentTime + required > deadline) {
        failedStates.add(stateKey);
        return null;
      }
    }

    // Try the most urgent jobs first.
    const choices = [...remaining].sort(
      (a, b) =>
        a.latest + a.duration -
        (b.latest + b.duration) ||
        a.latest - b.latest
    );

    for (const job of choices) {

      // Find the earliest available slot without
      // overlapping protected kitchen allocations.
      let start = Math.max(
        currentTime,
        job.earliest
      );

      while (start <= job.latest) {
        const finish = start + job.duration;

        const conflict = blockedIntervals.find(
          interval =>
            start < interval.finish &&
            finish > interval.start
        );

        if (!conflict) break;

        // Jump to the end of the protected interval.
        start = conflict.finish;
      }

      if (start > job.latest) continue;

      const finish = start + job.duration;


      const candidate = {
        id: job.id,
        index: job.index,
        start,
        finish,
        ready: job.ready,
        duration: job.duration,
        holdingMinutes: job.ready - finish
      };

      const nextRemaining = remaining.filter(
        other => other.index !== job.index
      );

      const result = search(
        nextRemaining,
        finish,
        [...timeline, candidate]
      );

      if (result) return result;
      if (exhausted) return null;
    }

    failedStates.add(stateKey);
    return null;
  }

    const result = search(
    ordered,
    effectiveStartMinute,
    []
    );

  return {
    feasible: result !== null,
    exhausted,
    nodes,
    timeline: result || [],
    jobs: jobSummaries
  };
}


function scheduleWithCommitments(
  committedTimeline = [],
  proposedOrder,
  options = {}
) {
  const asOfMinute = Number(options.asOfMinute);

  if (!Number.isFinite(asOfMinute)) {
    throw new Error(
      "Master Wok: decision time required"
    );
  }

  if (!proposedOrder) {
    throw new Error(
      "Master Wok: proposed order required"
    );
  }

  const duration = Number(
    options.durationOverride ??
    durationFor(proposedOrder.classification)
  );

  const ready = Number(proposedOrder.readyMinute);
  const holding = Number(
    options.maxHoldingMinutes ??
    CONFIG.normalHoldingMinutes
  );

  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(ready) ||
    !Number.isFinite(holding) ||
    holding < 0
  ) {
    throw new Error(
      "Master Wok: invalid proposed order"
    );
  }

  const effectiveStart = Math.max(
    CONFIG.kitchenStartMinute,
    asOfMinute,
    toMinute(proposedOrder.placedAt)
  );

  const commitments = committedTimeline
    .filter(job => job.finish > asOfMinute)
    .map(job => ({
      id: job.id,
      start: Number(job.start),
      finish: Number(job.finish)
    }))
    .sort((a, b) => a.start - b.start);

  // Existing allocations are treated as fixed.
  // They may represent planned, not confirmed, work.
  for (const job of commitments) {
    if (
      !Number.isFinite(job.start) ||
      !Number.isFinite(job.finish) ||
      job.finish <= job.start
    ) {
      return {
        feasible: false,
        unverified: true,
        reason: "Invalid existing commitment",
        timeline: []
      };
    }
  }

  for (let i = 1; i < commitments.length; i++) {
    if (
      commitments[i].start <
      commitments[i - 1].finish
    ) {
      return {
        feasible: false,
        unverified: true,
        reason: "Overlapping existing commitments",
        timeline: []
      };
    }
  }

  const earliest = Math.ceil(
    Math.max(
      effectiveStart,
      ready - holding - duration
    )
  );

  const latest = Math.floor(ready - duration);

  for (
    let start = earliest;
    start <= latest;
    start += 1
  ) {
    const finish = start + duration;

    const conflict = commitments.some(
      job =>
        start < job.finish &&
        finish > job.start
    );

    if (!conflict) {
      return {
        feasible: true,
        unverified: false,
        reason: "Fits around existing commitments",
        timeline: [
          ...commitments,
          {
            id: proposedOrder.orderId,
            start,
            finish,
            ready,
            duration,
            holdingMinutes: ready - finish
          }
        ].sort((a, b) => a.start - b.start)
      };
    }
  }

  return {
    feasible: false,
    unverified: false,
    reason: "No available production window",
    timeline: commitments
  };
}


function scheduleFromExistingPlanV1({
  acceptedOrders = [],
  committedTimeline = [],
  proposedOrder,
  asOfMinute
} = {}) {
  const unverified = reason => ({
    status: "UNVERIFIED",
    feasible: false,
    reason,
    timeline: []
  });

  if (!Number.isFinite(asOfMinute) || !proposedOrder) {
    return unverified("Decision time or proposed order missing");
  }

  if (!Array.isArray(acceptedOrders) ||
      !Array.isArray(committedTimeline)) {
    return unverified("Invalid existing plan");
  }

  const ids = acceptedOrders.map(order => String(order.orderId));
  const planIds = committedTimeline.map(job => String(job.id));

  if (ids.some(id => id === "undefined") ||
      new Set(ids).size !== ids.length ||
      new Set(planIds).size !== planIds.length) {
    return unverified("Missing or duplicate order identifiers");
  }

  if (ids.includes(String(proposedOrder.orderId))) {
    return unverified("Proposed order already accepted");
  }

  if (ids.length !== planIds.length ||
      ids.some(id => !planIds.includes(id)) ||
      planIds.some(id => !ids.includes(id))) {
    return unverified("Existing plan does not match accepted orders");
  }




  const sorted = [...committedTimeline]
    .sort((a, b) => a.start - b.start);


for (let i = 0; i < sorted.length; i++) {
  const job = sorted[i];
  const order = acceptedOrders.find(
    item => String(item.orderId) === String(job.id)
  );

  if (!Number.isFinite(job.start) ||
      !Number.isFinite(job.finish) ||
      job.finish <= job.start ||
      !Number.isFinite(job.ready) ||
      job.ready !== order.readyMinute ||
      job.finish > job.ready ||
      (i > 0 && job.start < sorted[i - 1].finish)) {
    return unverified("Invalid or conflicting existing allocation");
  }

  // Reject existing plans that exceed normal holding time.
  if (job.ready - job.finish > CONFIG.normalHoldingMinutes) {
    return unverified(
      "Existing plan exceeds maximum holding time"
    );
  }
}


  const protectedJobs = sorted.filter(
    job => job.start < asOfMinute
  );

  const movableIds = new Set(
    sorted.filter(job => job.start >= asOfMinute)
      .map(job => String(job.id))
  );

  const movableOrders = acceptedOrders.filter(
    order => movableIds.has(String(order.orderId))
  );

  const blockedIntervals = protectedJobs
    .filter(job => job.finish > asOfMinute)
    .map(job => ({
      start: job.start,
      finish: job.finish
    }));

  const result = schedule(
    [...movableOrders, proposedOrder],
    { asOfMinute, blockedIntervals }
  );

  if (result.exhausted) {
    return unverified("Scheduling search limit reached");
  }


  return {
    status: result.feasible ? "FEASIBLE" : "NO_FIT",
    feasible: result.feasible,

    reason: result.feasible
      ? "Future work fits around protected allocations"
      : "No arrangement found under current assumptions",
    protectedJobs,
    movableOrders: movableOrders.length,
    timeline: result.feasible
      ? [...protectedJobs, ...result.timeline]
          .sort((a, b) => a.start - b.start)
      : [],
    diagnostics: result
  };
}



function assessOrderDelayV1({
  acceptedOrders = [],
  committedTimeline = [],
  proposedOrder,
  asOfMinute,
  delayedOrderId,
  additionalMinutes
} = {}) {
  const unverified = reason => ({
    status: "UNVERIFIED",
    feasible: false,
    reason,
    lateOrders: [],
    requiresAttention: true,
    timeline: []
  });

  if (!Number.isFinite(asOfMinute) ||
      !Number.isInteger(additionalMinutes) ||
      additionalMinutes <= 0 ||
      !proposedOrder ||
      !Array.isArray(acceptedOrders) ||
      !Array.isArray(committedTimeline)) {
    return unverified("Invalid delay parameters");
  }

  const affected = committedTimeline.filter(
    job => String(job.id) === String(delayedOrderId)
  );

  if (affected.length !== 1) {
    return unverified("Delayed order not uniquely identified");
  }

  const original = affected[0];

  if (!Number.isFinite(original.start) ||
      !Number.isFinite(original.finish) ||
      !(original.start < asOfMinute &&
        original.finish > asOfMinute)) {
    return unverified("Delayed order is not currently in progress");
  }

  // Validate the original plan BEFORE applying the delay.
  // This also checks that every accepted order is represented.
  const baseline = scheduleFromExistingPlanV1({
    acceptedOrders,
    committedTimeline,
    proposedOrder,
    asOfMinute
  });

  if (baseline.status === "UNVERIFIED") {
    return unverified(baseline.reason);
  }

  // Extend only the affected protected allocation.
  // Do not mutate the original timeline.
  const revisedProtectedJobs = committedTimeline
    .filter(job => job.start < asOfMinute)
    .map(job => ({
      ...job,
      finish: String(job.id) === String(delayedOrderId)
        ? job.finish + additionalMinutes
        : job.finish
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < revisedProtectedJobs.length; i++) {
    if (revisedProtectedJobs[i].start <
        revisedProtectedJobs[i - 1].finish) {
      return unverified("Conflicting protected allocations");
    }
  }

  // Unstarted orders remain movable.
  const movableIds = new Set(
    committedTimeline
      .filter(job => job.start >= asOfMinute)
      .map(job => String(job.id))
  );

  const movableOrders = acceptedOrders.filter(
    order => movableIds.has(String(order.orderId))
  );

  const blockedIntervals = revisedProtectedJobs
    .filter(job => job.finish > asOfMinute)
    .map(job => ({
      start: job.start,
      finish: job.finish
    }));

  const result = schedule(
    [...movableOrders, proposedOrder],
    { asOfMinute, blockedIntervals }
  );

  const lateOrders = revisedProtectedJobs
    .filter(job => job.finish > job.ready)
    .map(job => ({
      id: job.id,
      promisedReady: job.ready,
      earliestFinish: job.finish,
      lateByMinutes: job.finish - job.ready
    }));

  if (result.exhausted) {
    return {
      ...unverified("Scheduling search limit reached"),
      lateOrders
    };
  }

  return {

status: !result.feasible
  ? "NO_FIT"
  : lateOrders.length > 0
    ? "AT_RISK"
    : "FEASIBLE",
    feasible: result.feasible,
    reason: result.feasible
      ? "Remaining work fits around delayed cooking"
      : "Remaining work cannot meet all promised times",
    lateOrders,
    requiresAttention:
      lateOrders.length > 0 || !result.feasible,
    delayedOrderId,
    additionalMinutes,
    protectedJobs: revisedProtectedJobs,
    movableOrders: movableOrders.length,
    timeline: result.feasible
      ? [...revisedProtectedJobs, ...result.timeline]
          .sort((a, b) => a.start - b.start)
      : [],
    diagnostics: result
  };
}


function recommendKitchenActionV1(assessment) {
  if (!assessment || typeof assessment !== "object") {
    return {
      recommendation: "AMBER",
      requiresReview: true,
      reason: "Kitchen assessment unavailable"
    };
  }

  switch (assessment.status) {
    case "FEASIBLE":
      // Require both fields to agree before recommending GREEN.
      if (assessment.feasible === true &&
          assessment.requiresAttention !== true) {
        return {
          recommendation: "GREEN",
          requiresReview: false,
          reason: "Kitchen capacity available"
        };
      }

      return {
        recommendation: "AMBER",
        requiresReview: true,
        reason: "Kitchen assessment requires attention"
      };

    case "AT_RISK":
      return {
        recommendation: "AMBER",
        requiresReview: true,
        reason: "Existing orders may be delayed"
      };

    case "NO_FIT":
      return {
        recommendation: "AMBER",
        requiresReview: true,
        reason: "Kitchen cannot meet all requested times"
      };

    case "UNVERIFIED":
    default:
      return {
        recommendation: "AMBER",
        requiresReview: true,
        reason: "Kitchen capacity could not be verified"
      };
  }
}


function assessKitchenDelayV1({
  acceptedOrders = [],
  committedTimeline = [],
  proposedOrder,
  asOfMinute,
  backlogMinutes
} = {}) {
  const unverified = reason => ({
    status: "UNVERIFIED",
    feasible: false,
    reason,
    lateOrders: [],
    requiresAttention: true,
    timeline: []
  });

  if (!Number.isFinite(asOfMinute) ||
      !Number.isInteger(backlogMinutes) ||
      backlogMinutes < 0 ||
      !proposedOrder ||
      !Array.isArray(acceptedOrders) ||
      !Array.isArray(committedTimeline)) {
    return unverified("Invalid kitchen backlog parameters");
  }

  // Validate the original plan before modifying it.
  const baseline = scheduleFromExistingPlanV1({
    acceptedOrders,
    committedTimeline,
    proposedOrder,
    asOfMinute
  });

  if (baseline.status === "UNVERIFIED") {
    return unverified(baseline.reason);
  }

  // First version supports exactly one active allocation.
  const active = committedTimeline.filter(job =>
    job.start < asOfMinute &&
    job.finish > asOfMinute
  );

  if (active.length !== 1) {
    return unverified(
      "Expected exactly one active cooking allocation"
    );
  }

  const current = active[0];
  const elapsed = asOfMinute - current.start;

  // A larger backlog could mean a previously scheduled
  // order is still unfinished. We cannot infer which one.
  if (backlogMinutes > elapsed) {
    return unverified(
      "Backlog exceeds progress within active allocation"
    );
  }

  // Kitchen progress is behind the original plan.
  // Extend only the active allocation, not every order.
  const revisedFinish = current.finish + backlogMinutes;

  const protectedJobs = committedTimeline
    .filter(job => job.start < asOfMinute)
    .map(job => ({
      ...job,
      finish: String(job.id) === String(current.id)
        ? revisedFinish
        : job.finish
    }))
    .sort((a, b) => a.start - b.start);

  const movableIds = new Set(
    committedTimeline
      .filter(job => job.start >= asOfMinute)
      .map(job => String(job.id))
  );

  const movableOrders = acceptedOrders.filter(
    order => movableIds.has(String(order.orderId))
  );

  const blockedIntervals = protectedJobs
    .filter(job => job.finish > asOfMinute)
    .map(job => ({
      start: job.start,
      finish: job.finish
    }));

  const result = schedule(
    [...movableOrders, proposedOrder],
    { asOfMinute, blockedIntervals }
  );

  const lateOrders = protectedJobs
    .filter(job => job.finish > job.ready)
    .map(job => ({
      id: job.id,
      promisedReady: job.ready,
      earliestFinish: job.finish,
      lateByMinutes: job.finish - job.ready
    }));

  if (result.exhausted) {
    return {
      ...unverified("Scheduling search limit reached"),
      lateOrders
    };
  }

  const status = !result.feasible
    ? "NO_FIT"
    : lateOrders.length > 0
      ? "AT_RISK"
      : "FEASIBLE";

  return {
    status,
    feasible: result.feasible,
    reason: result.feasible
      ? "Remaining work assessed against kitchen backlog"
      : "Remaining work cannot meet all promised times",
    lateOrders,
    requiresAttention:
      lateOrders.length > 0 || !result.feasible,
    backlogMinutes,
    snapshotMinute: asOfMinute,
    protectedJobs,
    movableOrders: movableOrders.length,
    timeline: result.feasible
      ? [...protectedJobs, ...result.timeline]
          .sort((a, b) => a.start - b.start)
      : [],
    diagnostics: result
  };
}


function scheduleBatches(reservations, options = {}) {
  const holding =
    options.maxHoldingMinutes ?? CONFIG.normalHoldingMinutes;

  const jobs = reservations.map((order, index) => {
    const placed = toMinute(order.placedAt);
    const ready = Number(order.readyMinute);

    const batches = (order.batches || []).map((batch, i) => ({
      id: `${order.orderId || index}-${batch.batchId || i}`,
      duration: Number(batch.durationMinutes),
      group: batch.group
    }));

    if (
      !Number.isFinite(ready) ||
      batches.length === 0 ||
      batches.some(batch =>
        !Number.isFinite(batch.duration) ||
        batch.duration <= 0
      )
    ) {
      throw new Error("Master Wok: invalid batch input");
    }

    const totalDuration = batches.reduce(
      (sum, batch) => sum + batch.duration,
      0
    );

    return {
      id: order.orderId ?? `ORDER-${index + 1}`,
      index,
      ready,
      placed,
      batches,
      totalDuration,
      earliestStart: Math.ceil(Math.max(
        CONFIG.kitchenStartMinute,
        placed,
        ready - holding - totalDuration
      ))
    };
  });

  let nodes = 0;
  let exhausted = false;

  function search(progress, currentTime, timeline) {
    if (++nodes > CONFIG.maxSearchNodes) {
      exhausted = true;
      return null;
    }

    if (progress.every((position, i) =>
      position === jobs[i].batches.length
    )) {
      return timeline;
    }

    const choices = [];

    jobs.forEach((job, index) => {
      const position = progress[index];

      if (position >= job.batches.length) return;

      const batch = job.batches[position];

      const start = Math.max(
        currentTime,
        job.earliestStart
      );

      const finish = start + batch.duration;

      if (finish > job.ready) return;

      choices.push({
        job,
        index,
        batch,
        start,
        finish
      });
    });

    choices.sort((a, b) =>
      a.job.ready - b.job.ready ||
      a.finish - b.finish
    );

    for (const choice of choices) {
      const nextProgress = [...progress];
      nextProgress[choice.index]++;

      const result = search(
        nextProgress,
        choice.finish,
        [
          ...timeline,
          {
            orderId: choice.job.id,
            orderIndex: choice.index,
            batchId: choice.batch.id,
            group: choice.batch.group,
            start: choice.start,
            finish: choice.finish,
            ready: choice.job.ready
          }
        ]
      );

      if (result) return result;
      if (exhausted) return null;
    }

    return null;
  }

  const result = search(
    jobs.map(() => 0),
    CONFIG.kitchenStartMinute,
    []
  );

  return {
    feasible: result !== null,
    exhausted,
    nodes,
    timeline: result || [],
    orders: jobs.length,
    batches: jobs.reduce(
      (sum, job) => sum + job.batches.length,
      0
    )
  };
}


  function evaluate({ acceptedOrders = [], proposedOrder } = {}) {
    if (!proposedOrder) {
      throw new Error("Master Wok: proposed order required");
    }

    const baseline = schedule(acceptedOrders);

    if (!baseline.feasible) {
      return {
        status: "UNVERIFIED",
        reason: baseline.exhausted
          ? "Existing schedule search limit reached"
          : "Existing commitments cannot be reproduced",
        baseline
      };
    }

    const combined = schedule([
      ...acceptedOrders,
      proposedOrder
    ]);

    if (combined.exhausted) {
      return {
        status: "UNVERIFIED",
        reason: "Scheduling search limit reached",
        baseline,
        combined
      };
    }

    if (!combined.feasible) {
      return {
        status: "RED",
        reason: "No feasible production arrangement",
        baseline,
        combined
      };
    }

    // We deliberately avoid claiming GREEN from holding
    // time alone. A verified fit is provisionally AMBER
    // until genuine capacity margin is implemented.
    return {
      status: "AMBER",
      reason: "Feasible in the simplified model; review required",
      baseline,
      combined,
      proposedSlot: combined.timeline.find(
        slot => slot.index === acceptedOrders.length
      )
    };
  }


function assessCapacityV1({
  acceptedOrders = [],
  proposedOrder,
  asOfMinute
} = {}) {
  if (!proposedOrder) {
    throw new Error("Master Wok: proposed order required");
  }

  function withRawDuration(order) {
    const pressure =
      window.MasterWokModelV1.calculateCombinedKitchenPressure([
        order.classification
      ]);

    const rawMinutes =
      pressure?.productionWindow?.rawMinutes;

    if (!Number.isFinite(rawMinutes) ||
        rawMinutes <= 0) {
      throw new Error(
        "Master Wok: invalid raw production duration"
      );
    }

    return {
      ...order,
      durationOverride: rawMinutes
    };
  }


const proposedRaw = withRawDuration(proposedOrder);
const existingRaw = acceptedOrders.map(withRawDuration);

const schedulingOptions = asOfMinute === undefined
  ? {}
  : { asOfMinute };

const conservativeBaseline = schedule(
  acceptedOrders,
  schedulingOptions
);

const conservativeCombined = schedule(
  [...acceptedOrders, proposedOrder],
  schedulingOptions
);

const rawBaseline = schedule(
  existingRaw,
  schedulingOptions
);

const rawCombined = schedule(
  [...existingRaw, proposedRaw],
  schedulingOptions
);


  const diagnostics = {
    conservativeBaseline,
    conservativeCombined,
    rawBaseline,
    rawCombined
  };

  // Search exhaustion is uncertainty, not evidence
  // that the kitchen cannot accommodate an order.
  if (Object.values(diagnostics).some(
    result => result.exhausted
  )) {
    return {
      status: "UNVERIFIED",
      reason: "Scheduling search limit reached",
      diagnostics
    };
  }

  // If we cannot reproduce existing commitments,
  // we cannot reliably assess the additional order.
  if (!conservativeBaseline.feasible ||
      !rawBaseline.feasible) {
    return {
      status: "UNVERIFIED",
      reason: "Existing commitments cannot be reproduced",
      diagnostics
    };
  }

  // Both estimates fit: strongest positive evidence.
  if (conservativeCombined.feasible &&
      rawCombined.feasible) {
    return {
      status: "GREEN",
      reason: "Fits both production estimates",
      diagnostics
    };
  }

  // At least one estimate fits, but not both.
  if (conservativeCombined.feasible ||
      rawCombined.feasible) {
    return {
      status: "AMBER",
      reason: "Fits one production estimate; review required",
      diagnostics
    };
  }

  // Both simplified estimates fail. This does not
  // establish that the order is physically impossible.
  return {
    status: "AMBER",
    reason: "Neither estimate fits; manual review required",
    diagnostics
  };
}


function measureHeadroomV1({
  acceptedOrders = [],
  proposedOrder,
  asOfMinute,
  maxDelayMinutes = 20
} = {}) {
  if (!proposedOrder) {
    throw new Error("Master Wok: proposed order required");
  }

  if (!Number.isFinite(asOfMinute)) {
    throw new Error("Master Wok: asOfMinute required");
  }

  if (!Number.isInteger(maxDelayMinutes) ||
      maxDelayMinutes < 0 ||
      maxDelayMinutes > 60) {
    throw new Error("Master Wok: invalid headroom limit");
  }

  const results = [];

  for (let delay = 0; delay <= maxDelayMinutes; delay++) {
    const assessment = assessCapacityV1({
      acceptedOrders,
      proposedOrder,
      asOfMinute: asOfMinute + delay
    });

    const conservativeFits =
      assessment.diagnostics.conservativeCombined.feasible;

    const rawFits =
      assessment.diagnostics.rawCombined.feasible;

    const exhausted = Object.values(
      assessment.diagnostics
    ).some(result => result.exhausted);

    results.push({
      delay,
      conservativeFits,
      rawFits,
      exhausted
    });

    if (exhausted || !conservativeFits || !rawFits) {
      break;
    }
  }

  const allFit = results.every(result =>
    !result.exhausted &&
    result.conservativeFits &&
    result.rawFits
  );

  const firstFailure = results.find(result =>
    result.exhausted ||
    !result.conservativeFits ||
    !result.rawFits
  );

  return {
    baselineFits:
      results[0].conservativeFits &&
      results[0].rawFits &&
      !results[0].exhausted,

    testedThroughMinutes:
      results[results.length - 1].delay,

    headroomMinutes: firstFailure
      ? Math.max(0, firstFailure.delay - 1)
      : maxDelayMinutes,

    capped: allFit,
    results
  };
}


function assessWithHeadroomV1({
  acceptedOrders = [],
  proposedOrder,
  asOfMinute
} = {}) {
  const assessment = assessCapacityV1({
    acceptedOrders,
    proposedOrder,
    asOfMinute
  });

  if (assessment.status !== "GREEN") {
    return {
      ...assessment,
      headroom: null
    };
  }

  // Headroom needs a real decision-time boundary.
  // Without one, don't promote a result to GREEN.
  if (!Number.isFinite(asOfMinute)) {
    return {
      ...assessment,
      status: "UNVERIFIED",
      reason: "Decision time required for headroom assessment",
      headroom: null
    };
  }

  const headroom = measureHeadroomV1({
    acceptedOrders,
    proposedOrder,
    asOfMinute,
    maxDelayMinutes: 10
  });

  if (!headroom.baselineFits) {
    return {
      ...assessment,
      status: "UNVERIFIED",
      reason: "Headroom baseline could not be verified",
      headroom
    };
  }

  if (headroom.headroomMinutes < 10) {
    return {
      ...assessment,
      status: "AMBER",
      reason: "Feasible but less than 10 minutes headroom",
      headroom
    };
  }

  return {
    ...assessment,
    status: "GREEN",
    reason: "Both estimates fit with at least 10 minutes headroom",
    headroom
  };
}


window.MasterWokV1 = Object.freeze({
  version: "1.0-local-comparison",
  config: CONFIG,
  schedule,
  scheduleBatches,
  evaluate,
  assessCapacityV1,
  measureHeadroomV1,
  scheduleWithCommitments,
  scheduleFromExistingPlanV1,
  assessOrderDelayV1,
  assessKitchenDelayV1,
  recommendKitchenActionV1,
  assessWithHeadroomV1
});
})();
