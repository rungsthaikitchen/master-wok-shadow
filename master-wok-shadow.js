
(function () {
  "use strict";

  function unverified(reason) {
    return {
      status: "UNVERIFIED",
      verified: false,
      reason,
      reservations: []
    };
  }

  async function loadReservationsStrictV1(serviceDate) {
    try {
      const sb = window.sb;

      if (!sb || typeof sb.from !== "function") {
        return unverified("Supabase client unavailable");
      }

      // Parse YYYY-MM-DD as a local service day, not UTC midnight.
      if (typeof serviceDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
        return unverified("Invalid service date");
      }
      const [year, month, day] = serviceDate.split("-").map(Number);
      const dayStart = new Date(year, month - 1, day);
      if (!Number.isFinite(dayStart.getTime()) ||
          dayStart.getFullYear() !== year ||
          dayStart.getMonth() !== month - 1 ||
          dayStart.getDate() !== day) {
        return unverified("Invalid service date");
      }

      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      // Retrieve all visible non-test orders in stable pages.
      // Filter by effective service date after retrieval.
      const pageSize = 500;
      const data = [];
      const seenIds = new Set();

      let expectedCount = null;
      let offset = 0;

      while (true) {
        const { data: page, error, count } = await sb
          .from("orders")
          .select(`
            id,
            created_at,
            preferred_time,
            proposed_time,
            confirmed_time,
            status,
            order_items(
              item_id,
              qty,
              kitchen_load,
              modifiers,
              spice
            )
          `, { count: "exact" })
          .eq("is_test", false)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          return unverified(`Database error: ${error.message}`);
        }

        if (!Array.isArray(page) || !Number.isInteger(count)) {
          return unverified("Query results incomplete");
        }

        if (expectedCount === null) {
          expectedCount = count;
        } else if (count !== expectedCount) {
          return unverified("Order count changed during loading");
        }

        for (const order of page) {
          const id = String(order.id ?? "");

          if (!id || seenIds.has(id)) {
            return unverified("Missing or duplicate order ID");
          }

          seenIds.add(id);
          data.push(order);
        }

        offset += page.length;

        if (data.length >= expectedCount) break;

        if (page.length === 0) {
          return unverified("Missing order page");
        }
      }

      if (data.length !== expectedCount) {
        return unverified("Query results incomplete");
      }

      // Independent order-item completeness check.
      // Fail closed if the nested query omitted any items.
      const orderIds = data.map(order => order.id);

      if (orderIds.length > 0) {
        const batchSize = 100;
        let actualItemCount = 0;

        for (let offset = 0; offset < orderIds.length; offset += batchSize) {
          const batchIds = orderIds.slice(offset, offset + batchSize);

          const { count, error } = await sb
            .from("order_items")
            .select("id", { count: "exact", head: true })
            .in("order_id", batchIds);

          if (
            error ||
            !Number.isSafeInteger(count) ||
            count < 0
          ) {
            return unverified("Order-item count verification failed");
          }

          actualItemCount += count;

          if (!Number.isSafeInteger(actualItemCount)) {
            return unverified("Order-item count verification failed");
          }
        }

        const nestedItemCount = data.reduce(
          (total, order) =>
            total + (
              Array.isArray(order.order_items)
                ? order.order_items.length
                : 0
            ),
          0
        );

        if (nestedItemCount !== actualItemCount) {
          return unverified("Incomplete order items");
        }
      }

      const reservations = [];
      const seen = new Set();
      let validatedItems = 0;
      const excluded = {
        cancelled: 0,
        noEffectiveTime: 0,
        outsideServiceDate: 0
      };

      for (const order of data) {
        const id = String(order.id ?? "");

        if (!id || seen.has(id)) {
          return unverified("Missing or duplicate order ID");
        }

        seen.add(id);

        if (order.status === "cancelled") {
          excluded.cancelled++;
          continue;
        }

        const effective = getShadowEffectiveOrderTime(order);

        if (!effective) {
          excluded.noEffectiveTime++;
          continue;
        }

        const ready = new Date(effective);

        if (!Number.isFinite(ready.getTime())) {
          return unverified(`Invalid ready time: ${id}`);
        }

        if (ready < dayStart || ready >= dayEnd) {
          excluded.outsideServiceDate++;
          continue;
        }

        const placedAt = new Date(order.created_at);

        if (!Number.isFinite(placedAt.getTime())) {
          return unverified(`Invalid placement time: ${id}`);
        }

        if (
          !Array.isArray(order.order_items) ||
          order.order_items.length === 0
        ) {
          return unverified(`Missing order items: ${id}`);
        }

        const lines = [];

        for (const line of order.order_items) {
          if (
            !line ||
            !window.MasterWokModelV1?.hasItem(line.item_id)
          ) {
            return unverified(`Unknown menu item: ${id}`);
          }

          if (
            typeof line.qty !== "number" ||
            !Number.isInteger(line.qty) ||
            line.qty <= 0
          ) {
            return unverified(`Invalid quantity: ${id}`);
          }

          if (
            line.modifiers != null &&
            !Array.isArray(line.modifiers)
          ) {
            return unverified(`Invalid modifiers: ${id}`);
          }

          lines.push({
            itemId: line.item_id,
            qty: line.qty,
            mods: line.modifiers || []
          });

          validatedItems++;
        }

        const classification = window.MasterWokModelV1.classifyBasket(lines);

        const pressure =
          window.MasterWokModelV1.calculateCombinedKitchenPressure([classification]);

        if (
          !Number.isFinite(
            pressure?.productionWindow?.reservedMinutes
          )
        ) {
          return unverified(`Invalid kitchen pressure: ${id}`);
        }

        reservations.push({
          orderId: id,
          placedAt,
          readyMinute:
            ready.getHours() * 60 +
            ready.getMinutes() +
            ready.getSeconds() / 60,
          classification
        });
      }

      return {
        status: "VALIDATED_RETRIEVED_ORDERS",
        verified: false,
        reason:
          "Retrieved order and item counts validated; consistent database snapshot not proven",
        serviceDate: dayStart.toLocaleDateString("en-GB"),
        queriedOrders: data.length,
        orderCount: reservations.length,
        excludedOrders: excluded,
        validatedItems,
        reservations
      };

    } catch (error) {
      return unverified(error.message);
    }
  }


async function assessHypotheticalV1(serviceDate) {
  const unverified = reason => ({
    status: "UNVERIFIED",
    verified: false,
    reason,
    hypothetical: null
  });

  try {
    if (
      typeof window.MasterWokV1?.schedule !== "function"
    ) {
      return unverified("Master Wok engine unavailable");
    }

    const loaded = await loadReservationsStrictV1(serviceDate);

    if (loaded.status !== "VALIDATED_RETRIEVED_ORDERS") {
      return unverified(loaded.reason);
    }

    const schedule = window.MasterWokV1.schedule(
      loaded.reservations,
      {
        serviceDate,
        asOfMinute:
          window.MasterWokV1.config.kitchenStartMinute
      }
    );

    return {
      status: "UNVERIFIED",
      verified: false,
      reason:
        "Hypothetical schedule only; live commitment completeness not established",
      serviceDate: loaded.serviceDate,
      queriedOrders: loaded.queriedOrders,
      reservations: loaded.reservations.length,
      hypothetical: {
        feasible: schedule.feasible,
        exhausted: schedule.exhausted,
        scheduledJobs: schedule.timeline?.length ?? 0,
        searchNodes: schedule.nodes
      }
    };

  } catch (error) {
    return unverified(error.message);
  }
}


  // Experimental replay only. It never changes orders or booking availability.
  // Existing historical orders are retained even when the model would flag them.
  function replayReservationsV1(serviceDate, reservations, { allowZeroRungWork = false } = {}) {
    const fail = reason => ({
      status: "UNVERIFIED", verified: false, reason, observations: []
    });
    const engine = window.MasterWokV1;
    const model = window.MasterWokModelV1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || "") ||
        !Array.isArray(reservations) ||
        typeof engine?.schedule !== "function" ||
        typeof model?.calculateCombinedKitchenPressure !== "function") {
      return fail("Invalid replay input or unavailable engine");
    }

    const dateKey = date => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    const kitchenStart = engine.config.kitchenStartMinute;
    const [year, month, day] = serviceDate.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (dateKey(parsed) !== serviceDate) return fail("Invalid service date");
    // Validate before sorting: malformed entries must not throw from comparator.
    const sorted = [...reservations];
    const ids = new Set();
    for (const order of sorted) {
      if (!order || !(order.placedAt instanceof Date) ||
          !Number.isFinite(order.placedAt.getTime()) ||
          dateKey(order.placedAt) > serviceDate ||
          !Number.isFinite(order.readyMinute) ||
          order.readyMinute < kitchenStart || order.readyMinute > 22 * 60 ||
          !order.classification ||
          !order.orderId || ids.has(String(order.orderId))) {
        return fail("Invalid, duplicate or post-service historical order");
      }
      ids.add(String(order.orderId));
    }

    sorted.sort((a, b) => a.placedAt - b.placedAt ||
      (String(a.orderId) < String(b.orderId) ? -1 : String(a.orderId) > String(b.orderId) ? 1 : 0));
    const accepted = [];
    const observations = [];
    const plans = { conservative: [], raw: [] };
    const valid = { conservative: true, raw: true };

    function withDuration(order, mode) {
      if (mode === "conservative" && allowZeroRungWork !== true) return order;
      const window = model.calculateCombinedKitchenPressure([
        order.classification
      ])?.productionWindow;
      // Opt-in server replay only: an excluded resource needs no invented job.
      // Both calibrated and raw workloads must explicitly agree on zero.
      if (allowZeroRungWork === true && window?.rawMinutes === 0 &&
          window?.reservedMinutes === 0) return null;
      if (mode === "conservative") return order;
      const minutes = window?.rawMinutes;
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error("Invalid raw production duration");
      }
      return { ...order, durationOverride: minutes };
    }

    for (const proposed of sorted) {
      const placementDay = dateKey(proposed.placedAt);
      const clock = proposed.placedAt.getHours() * 60 +
        proposed.placedAt.getMinutes() +
        proposed.placedAt.getSeconds() / 60;
      const asOfMinute = placementDay < serviceDate
        ? kitchenStart : Math.max(kitchenStart, clock);
      const outcomes = {};

      for (const mode of ["conservative", "raw"]) {
        if (!valid[mode]) {
          outcomes[mode] = "UNVERIFIED";
          continue;
        }
        try {
          const prior = plans[mode];
          const protectedJobs = prior.filter(job => job.start < asOfMinute);
          const movableIds = new Set(
            prior.filter(job => job.start >= asOfMinute)
              .map(job => String(job.id))
          );
          const movable = accepted.filter(order =>
            movableIds.has(String(order.orderId))
          );
          const result = engine.schedule(
            [...movable, proposed].map(order => {
              const job = withDuration(order, mode);
              if (job === null && order === proposed && order.readyMinute < asOfMinute) {
                throw new Error("Zero-work target precedes assessment time");
              }
              return job;
            }).filter(order => order !== null),
            {
              serviceDate,
              asOfMinute,
              blockedIntervals: protectedJobs
                .filter(job => job.finish > asOfMinute)
                .map(job => ({ start: job.start, finish: job.finish }))
            }
          );
          if (result.exhausted) {
            outcomes[mode] = "UNVERIFIED";
            valid[mode] = false;
          } else if (result.feasible) {
            outcomes[mode] = "FIT";
            plans[mode] = [...protectedJobs, ...result.timeline]
              .sort((a, b) => a.start - b.start);
          } else {
            outcomes[mode] = "NO_FIT";
            valid[mode] = false;
          }
        } catch (error) {
          outcomes[mode] = "UNVERIFIED";
          valid[mode] = false;
        }
      }

      const status = Object.values(outcomes).includes("UNVERIFIED")
        ? "UNVERIFIED"
        : outcomes.conservative === "FIT" && outcomes.raw === "FIT"
          ? "GREEN" : "AMBER";
      observations.push({
        orderId: String(proposed.orderId),
        placedAt: proposed.placedAt.toISOString(),
        readyMinute: proposed.readyMinute,
        asOfMinute,
        status,
        conservative: outcomes.conservative,
        raw: outcomes.raw
      });
      // This is a comparison with actual accepted orders, not a simulated
      // refusal policy. A failed plan is never fabricated for later orders.
      accepted.push(proposed);
    }

    return {
      status: "UNVERIFIED",
      verified: false,
      reason: "Hypothetical commitment-aware replay; actual kitchen allocations and snapshot completeness unverified",
      serviceDate,
      reservations: accepted.length,
      counts: {
        GREEN: observations.filter(x => x.status === "GREEN").length,
        AMBER: observations.filter(x => x.status === "AMBER").length,
        UNVERIFIED: observations.filter(x => x.status === "UNVERIFIED").length
      },
      evidenceBasis: "HYPOTHETICAL_PLANS_NOT_COOKING_ACTIVITY",
      chronologyBasis: "CREATED_AT_WITH_FINAL_EFFECTIVE_TIMES_NOT_DECISION_HISTORY",
      observations
    };
  }

  async function replayHistoricalCapacityV1(serviceDate) {
    const loaded = await loadReservationsStrictV1(serviceDate);
    if (loaded.status !== "VALIDATED_RETRIEVED_ORDERS") {
      return {
        status: "UNVERIFIED", verified: false,
        reason: loaded.reason, observations: []
      };
    }
    return replayReservationsV1(serviceDate, loaded.reservations);
  }


  function getShadowEffectiveOrderTime(order) {
    if (order.confirmed_time) return order.confirmed_time;
    if (order.status === "pending" && order.proposed_time) return null;
    if (order.proposed_time) return order.proposed_time;
    return order.preferred_time;
  }

  window.MasterWokShadowV1 = Object.freeze({
    loadReservationsStrictV1,
    assessHypotheticalV1,
    replayReservationsV1,
    replayHistoricalCapacityV1
  });
})();
