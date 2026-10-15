(function (global) {
'use strict';

const MASTER_WOK_ITEMS_BY_ID = new Map(([
  {
    "id": "salt-chicken",
    "production": [
      "fry",
      "fast"
    ],
    "productionType": null,
    "fryProduction": {
      "crispyChicken": 1
    },
    "fryPairing": null
  },
  {
    "id": "veg-spring-rolls",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "chicken-satay",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "prawn-crackers",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "moo-ping",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "chicken-spring-rolls",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "fried-tofu",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "fish-cakes",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "pork-dumplings",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "fried-prawns",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "thai-sausage",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "spare-ribs",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "tom-yum",
    "production": [
      "fast"
    ],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "tom-kha",
    "production": [
      "fast"
    ],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "papaya-salad",
    "production": [
      "salad"
    ],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "beef-salad",
    "production": [
      "salad"
    ],
    "productionType": "cookedSalad",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "pork-salad",
    "production": [
      "salad"
    ],
    "productionType": "cookedSalad",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "laab",
    "production": [
      "salad"
    ],
    "productionType": "cookedSalad",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "massaman-curry",
    "production": [
      "fast"
    ],
    "productionType": "curry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "panang-curry",
    "production": [
      "fast"
    ],
    "productionType": "curry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "rung-curry",
    "production": [
      "fast"
    ],
    "productionType": "curry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "green-curry",
    "production": [
      "fast"
    ],
    "productionType": "curry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "red-curry",
    "production": [
      "fast"
    ],
    "productionType": "curry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-crispy",
    "production": [
      "fry",
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {
      "crispyChicken": 1
    },
    "fryPairing": null
  },
  {
    "id": "salt-chickenchips",
    "production": [
      "fry",
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {
      "crispyChicken": 1,
      "chips": 1
    },
    "fryPairing": "crispyChickenWithChips"
  },
  {
    "id": "stir-basil",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-ginger",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-cashew",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-sweetsour",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-yellow",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-chilli",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "stir-pepper",
    "production": [
      "fast"
    ],
    "productionType": "stirFry",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "pad-thai",
    "production": [
      "noodle"
    ],
    "productionType": "noodle",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "chef-pad-thai",
    "production": [
      "noodle"
    ],
    "productionType": "noodle",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "pad-kee-mao",
    "production": [
      "noodle"
    ],
    "productionType": "noodle",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "pad-see-ew",
    "production": [
      "noodle"
    ],
    "productionType": "noodle",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "fried-rice",
    "production": [
      "noodle"
    ],
    "productionType": "noodle",
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "salt-chips",
    "production": [
      "fry",
      "fast"
    ],
    "productionType": null,
    "fryProduction": {
      "chips": 1
    },
    "fryPairing": null
  },
  {
    "id": "jasmine-rice",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "egg-rice",
    "production": [
      "fast"
    ],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "sticky-rice",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "coconut-rice",
    "production": [
      "fast"
    ],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "chips",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  },
  {
    "id": "fried-egg",
    "production": [],
    "productionType": null,
    "fryProduction": {},
    "fryPairing": null
  }
]).map(item => [item.id, item]));


function classifyBasket(basket = []) {
  const result = {
  groups: {
    fast: 0,
    noodle: 0,
    salad: 0
  },
  fry: {
    batteredChicken: 0,
    crispyChicken: 0,
    tofu: 0,
    chips: 0
  },
  fryPairings: {
    crispyChickenWithChips: 0
  },
  rungDependencies: {
    batteredChicken: 0,
    crispyChicken: 0,
    tofu: 0
  },
  productionLines: []
};

  const lines = Array.isArray(basket) ? basket : [];

  for (const line of lines) {
    const item = MASTER_WOK_ITEMS_BY_ID.get(line.itemId);
    if (!item) continue;

    const qty = Number(line.qty || 0);
    if (qty <= 0) continue;

    const production = Array.isArray(item.production)
      ? item.production
      : [];

    for (const component of production) {
      if (Object.prototype.hasOwnProperty.call(result.groups, component)) {
        result.groups[component] += qty;
      }
    }

    const fryProduction = item.fryProduction || {};

    for (const [fryType, portions] of Object.entries(fryProduction)) {
  const portionCount = Number(portions || 0) * qty;

  if (Object.prototype.hasOwnProperty.call(result.fry, fryType)) {
    result.fry[fryType] += portionCount;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      result.rungDependencies,
      fryType
    )
  ) {
    result.rungDependencies[fryType] += portionCount;
  }
}

    // Preserve special fryer pairings
      if (
        item.fryPairing &&
        Object.prototype.hasOwnProperty.call(
          result.fryPairings,
          item.fryPairing
        )
      ) {
        result.fryPairings[item.fryPairing] += qty;
      }

    const mods = Array.isArray(line.mods) ? line.mods : [];

    const lineDependencies = {
  batteredChicken: 0,
  crispyChicken: 0,
  tofu: 0
};

// Fixed dependencies defined by the menu item
for (const [fryType, portions] of Object.entries(fryProduction)) {
  if (
    Object.prototype.hasOwnProperty.call(
      lineDependencies,
      fryType
    )
  ) {
    lineDependencies[fryType] += Number(portions || 0) * qty;
  }
}

// Dependencies introduced by modifiers
for (const mod of mods) {
  if (mod.id === 'tofu' || mod.id === 'extra-tofu') {
    lineDependencies.tofu += qty;
  }

  if (mod.id === 'batter-chicken' || mod.id === 'extra-bchicken') {
    lineDependencies.batteredChicken += qty;
  }
}

    for (const mod of mods) {
  if (mod.id === 'tofu' || mod.id === 'extra-tofu') {
  result.fry.tofu += qty;
  result.rungDependencies.tofu += qty;
}

if (mod.id === 'batter-chicken' || mod.id === 'extra-bchicken') {
  result.fry.batteredChicken += qty;
  result.rungDependencies.batteredChicken += qty;
}
}

result.productionLines.push({
  itemId: line.itemId,
  quantity: qty,
  production: [...production],
  dependencies: lineDependencies
});
  }

  return result;
}

function combineKitchenClassifications(
  classifications = []
) {
  const combined = {
    groups: {
      fast: 0,
      noodle: 0,
      salad: 0
    },

    fry: {
      batteredChicken: 0,
      crispyChicken: 0,
      tofu: 0,
      chips: 0
    },

    fryPairings: {
      crispyChickenWithChips: 0
    },

    rungDependencies: {
      batteredChicken: 0,
      crispyChicken: 0,
      tofu: 0
    },

    productionLines: []
  };

  for (const classification of classifications) {
    if (!classification) {
      continue;
    }

    for (const group of Object.keys(combined.groups)) {
      combined.groups[group] +=
        Number(classification.groups?.[group] || 0);
    }

    for (const fryType of Object.keys(combined.fry)) {
      combined.fry[fryType] +=
        Number(classification.fry?.[fryType] || 0);
    }

    for (
      const pairing of
      Object.keys(combined.fryPairings)
    ) {
      combined.fryPairings[pairing] +=
        Number(
          classification.fryPairings?.[pairing] || 0
        );
    }

    for (
      const dependency of
      Object.keys(combined.rungDependencies)
    ) {
      combined.rungDependencies[dependency] +=
        Number(
          classification.rungDependencies?.[dependency] || 0
        );
    }

    const productionLines =
      Array.isArray(classification.productionLines)
        ? classification.productionLines
        : [];

    combined.productionLines.push(
      ...productionLines.map(line => ({
        ...line,

        production:
          Array.isArray(line.production)
            ? [...line.production]
            : [],

        dependencies: {
          batteredChicken:
            Number(
              line.dependencies?.batteredChicken || 0
            ),

          crispyChicken:
            Number(
              line.dependencies?.crispyChicken || 0
            ),

          tofu:
            Number(
              line.dependencies?.tofu || 0
            )
        }
      }))
    );
  }

  return combined;
}

function calculateCombinedKitchenPressure(
  classifications = []
) {
  const validClassifications =
    classifications.filter(Boolean);

  if (validClassifications.length === 0) {
    return null;
  }

  const classification =
    combineKitchenClassifications(
      validClassifications
    );

  const batches =
    buildRungProductionBatches(
      classification
    );

  const productionWindow =
    calculateProductionWindow(
      batches
    );

  return {
    classification,
    batches,
    productionWindow
  };
}

function calculateProductionRequirements(classification) {
  const requirements = {
  fast: [],
  noodle: [],
  salad: [],
  fry: {
    batteredChicken: 0,
    crispyChicken: 0,
    tofu: 0,
    chips: 0
  },
  fryPairings: {
    crispyChickenWithChips: 0
  }
};

  const fastCount = Number(classification?.groups?.fast || 0);

  let remaining = fastCount;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, 4);

    let durationMinutes;

    switch (batchSize) {
      case 1:
        durationMinutes = 5;
        break;
      case 2:
        durationMinutes = 6;
        break;
      case 3:
        durationMinutes = 8;
        break;
      case 4:
        durationMinutes = 10;
        break;
    }

    requirements.fast.push({
      portions: batchSize,
      durationMinutes,
      resetAfterMinutes: remaining > batchSize ? 1 : 0
    });

    remaining -= batchSize;
  }

  const noodleCount = Number(classification?.groups?.noodle || 0);

let noodleRemaining = noodleCount;

while (noodleRemaining > 0) {
  const batchSize = Math.min(noodleRemaining, 2);

  const durationMinutes = batchSize === 1 ? 8 : 10;

  requirements.noodle.push({
    portions: batchSize,
    durationMinutes,
    resetAfterMinutes: noodleRemaining > batchSize ? 1 : 0
  });

  noodleRemaining -= batchSize;
}

const saladCount = Number(classification?.groups?.salad || 0);

let saladRemaining = saladCount;

while (saladRemaining > 0) {
  const batchSize = Math.min(saladRemaining, 4);

  const durationMinutes = batchSize <= 2 ? 10 : 15;

  requirements.salad.push({
    portions: batchSize,
    durationMinutes
  });

  saladRemaining -= batchSize;
}

requirements.fry.batteredChicken =
  Number(classification?.fry?.batteredChicken || 0);

requirements.fry.crispyChicken =
  Number(classification?.fry?.crispyChicken || 0);

requirements.fry.tofu =
  Number(classification?.fry?.tofu || 0);

requirements.fry.chips =
  Number(classification?.fry?.chips || 0);

requirements.fryPairings.crispyChickenWithChips =
  Number(classification?.fryPairings?.crispyChickenWithChips || 0);

  return requirements;
}

function buildRungProductionBatches(classification) {
  const batches = {
    fast: [],
    noodle: [],
    salad: []
  };

  const fastLines = (classification?.productionLines || [])
    .filter(line => line.production.includes('fast'));

  let currentBatch = null;

  for (const line of fastLines) {
    let remainingQty = Number(line.quantity || 0);

    while (remainingQty > 0) {
      // Start a new Fast batch if necessary
      if (!currentBatch || currentBatch.portions >= 4) {
        currentBatch = {
          portions: 0,
          durationMinutes: 0,
          resetAfterMinutes: 0,
          lines: []
        };

        batches.fast.push(currentBatch);
      }

      const availableSpace = 4 - currentBatch.portions;
      const quantityForBatch = Math.min(remainingQty, availableSpace);

      currentBatch.lines.push({
        itemId: line.itemId,
        quantity: quantityForBatch,
        dependencies: {
          batteredChicken:
            Number(line.dependencies?.batteredChicken || 0) *
            (quantityForBatch / line.quantity),

          crispyChicken:
            Number(line.dependencies?.crispyChicken || 0) *
            (quantityForBatch / line.quantity),

          tofu:
            Number(line.dependencies?.tofu || 0) *
            (quantityForBatch / line.quantity)
        }
      });

      currentBatch.portions += quantityForBatch;
      remainingQty -= quantityForBatch;
    }
  }

  // Apply the already-agreed Fast timings
  for (let i = 0; i < batches.fast.length; i++) {
    const batch = batches.fast[i];

    switch (batch.portions) {
      case 1:
        batch.durationMinutes = 5;
        break;
      case 2:
        batch.durationMinutes = 6;
        break;
      case 3:
        batch.durationMinutes = 8;
        break;
      case 4:
        batch.durationMinutes = 10;
        break;
    }

    batch.resetAfterMinutes =
      i < batches.fast.length - 1 ? 1 : 0;
  }

  const noodleLines = (classification?.productionLines || [])
  .filter(line => line.production.includes('noodle'));

let currentNoodleBatch = null;

for (const line of noodleLines) {
  let remainingQty = Number(line.quantity || 0);

  while (remainingQty > 0) {
    // Start a new Noodle batch if necessary
    if (!currentNoodleBatch || currentNoodleBatch.portions >= 2) {
      currentNoodleBatch = {
        portions: 0,
        durationMinutes: 0,
        resetAfterMinutes: 0,
        lines: []
      };

      batches.noodle.push(currentNoodleBatch);
    }

    const availableSpace = 2 - currentNoodleBatch.portions;
    const quantityForBatch = Math.min(remainingQty, availableSpace);

    currentNoodleBatch.lines.push({
      itemId: line.itemId,
      quantity: quantityForBatch,
      dependencies: {
        batteredChicken:
          Number(line.dependencies?.batteredChicken || 0) *
          (quantityForBatch / line.quantity),

        crispyChicken:
          Number(line.dependencies?.crispyChicken || 0) *
          (quantityForBatch / line.quantity),

        tofu:
          Number(line.dependencies?.tofu || 0) *
          (quantityForBatch / line.quantity)
      }
    });

    currentNoodleBatch.portions += quantityForBatch;
    remainingQty -= quantityForBatch;
  }
}

// Apply the agreed Noodle timings
for (let i = 0; i < batches.noodle.length; i++) {
  const batch = batches.noodle[i];

  batch.durationMinutes =
    batch.portions === 1 ? 8 : 10;

  batch.resetAfterMinutes =
    i < batches.noodle.length - 1 ? 1 : 0;
}

const saladLines = (classification?.productionLines || [])
  .filter(line => line.production.includes('salad'));

let currentSaladBatch = null;

for (const line of saladLines) {
  let remainingQty = Number(line.quantity || 0);

  while (remainingQty > 0) {
    // Start a new Salad batch if necessary
    if (!currentSaladBatch || currentSaladBatch.portions >= 4) {
      currentSaladBatch = {
        portions: 0,
        durationMinutes: 0,
        lines: []
      };

      batches.salad.push(currentSaladBatch);
    }

    const availableSpace = 4 - currentSaladBatch.portions;
    const quantityForBatch = Math.min(remainingQty, availableSpace);

    currentSaladBatch.lines.push({
      itemId: line.itemId,
      quantity: quantityForBatch,
      dependencies: {
        batteredChicken:
          Number(line.dependencies?.batteredChicken || 0) *
          (quantityForBatch / line.quantity),

        crispyChicken:
          Number(line.dependencies?.crispyChicken || 0) *
          (quantityForBatch / line.quantity),

        tofu:
          Number(line.dependencies?.tofu || 0) *
          (quantityForBatch / line.quantity)
      }
    });

    currentSaladBatch.portions += quantityForBatch;
    remainingQty -= quantityForBatch;
  }
}

// Apply the agreed Salad timings
for (const batch of batches.salad) {
  batch.durationMinutes =
    batch.portions <= 2 ? 10 : 15;
}

  return batches;
}

function buildRungProductionStages(batch) {
  const stages = [];

  const lines = Array.isArray(batch?.lines)
    ? batch.lines
    : [];

  const curryPortions = lines.reduce((total, line) => {
    const item = MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

    if (item?.productionType === 'curry') {
      return total + Number(line.quantity || 0);
    }

    return total;
  }, 0);

  // First controlled implementation:
  // only describe a pure 3-portion curry batch.
  if (
    curryPortions === 3 &&
    curryPortions === Number(batch?.portions || 0)
  ) {
    stages.push(
      {
        type: 'active',
        durationMinutes: 2,
        activity: 'load'
      },
      {
        type: 'passive',
        durationMinutes: 4,
        activity: 'heat'
      },
      {
        type: 'active',
        durationMinutes: 1,
        activity: 'decant'
      }
    );
  }

  const stirFryPortions = lines.reduce((total, line) => {
  const item = MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

  if (item?.productionType === 'stirFry') {
    return total + Number(line.quantity || 0);
  }

  return total;
}, 0);

// First controlled implementation:
// only describe a pure 3-portion stir-fry batch.
if (
  stirFryPortions === 3 &&
  stirFryPortions === Number(batch?.portions || 0)
) {
  stages.push({
    type: 'active',
    durationMinutes: Number(batch.durationMinutes || 0),
    activity: 'wok'
  });
}

const noodlePortions = lines.reduce((total, line) => {
  const item = MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

  if (item?.productionType === 'noodle') {
    return total + Number(line.quantity || 0);
  }

  return total;
}, 0);

// Noodle production is treated as fully active Rung time.
if (
  noodlePortions > 0 &&
  noodlePortions === Number(batch?.portions || 0)
) {
  stages.push({
    type: 'active',
    durationMinutes: Number(batch.durationMinutes || 0),
    activity: 'noodle'
  });
}

const cookedSaladPortions = lines.reduce((total, line) => {
  const item = MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

  if (item?.productionType === 'cookedSalad') {
    return total + Number(line.quantity || 0);
  }

  return total;
}, 0);

// First controlled implementation:
// 3-portion cooked-salad batch.
if (
  cookedSaladPortions === 3 &&
  cookedSaladPortions === Number(batch?.portions || 0)
) {
  stages.push(
    {
      type: 'active',
      durationMinutes: 4,
      activity: 'cookProtein'
    },
    {
      type: 'passive',
      minDurationMinutes: 5,
      activity: 'cool'
    },
    {
      type: 'active',
      durationMinutes: 3,
      activity: 'assemble'
    }
  );
}

  return stages;
}

function calculateProductionWindow(batches) {
  const fastMinutes = (batches.fast || []).reduce(
    (total, batch) =>
      total +
      Number(batch.durationMinutes || 0) +
      Number(batch.resetAfterMinutes || 0),
    0
  );

  const noodleMinutes = (batches.noodle || []).reduce(
    (total, batch) =>
      total +
      Number(batch.durationMinutes || 0) +
      Number(batch.resetAfterMinutes || 0),
    0
  );

  const saladMinutes = (batches.salad || []).reduce(
    (total, batch) =>
      total +
      Number(batch.durationMinutes || 0) +
      Number(batch.resetAfterMinutes || 0),
    0
  );

  const rawMinutes =
    fastMinutes +
    noodleMinutes +
    saladMinutes;

  const fastProductionTypes = [
    ...new Set(
      (batches.fast || []).flatMap(batch =>
        (batch.lines || [])
          .map(line =>
            MASTER_WOK_ITEMS_BY_ID.get(line.itemId)?.productionType
          )
          .filter(Boolean)
      )
    )
  ];

  const saladProductionTypes = [
    ...new Set(
      (batches.salad || []).flatMap(batch =>
        (batch.lines || [])
          .map(line =>
            MASTER_WOK_ITEMS_BY_ID.get(line.itemId)?.productionType
          )
          .filter(Boolean)
      )
    )
  ];

    /*
   * Coarse production-pressure model.
   *
   * We deliberately do NOT attempt to simulate Rung's
   * minute-by-minute cooking sequence.
   *
   * Instead we measure the composition of the basket so
   * that it can later be mapped to a conservative capacity
   * reservation band.
   */

  let curryPortions = 0;
  let stirFryPortions = 0;
  let otherFastPortions = 0;
  let noodlePortions = 0;
  let cookedSaladPortions = 0;
  let otherSaladPortions = 0;

  for (const batch of batches.fast || []) {
    for (const line of batch.lines || []) {
      const item =
        MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

      const qty = Number(line.quantity || 0);

      switch (item?.productionType) {
        case 'curry':
          curryPortions += qty;
          break;

        case 'stirFry':
          stirFryPortions += qty;
          break;

        default:
          otherFastPortions += qty;
          break;
      }
    }
  }

  for (const batch of batches.noodle || []) {
    for (const line of batch.lines || []) {
      noodlePortions +=
        Number(line.quantity || 0);
    }
  }

  for (const batch of batches.salad || []) {
    for (const line of batch.lines || []) {
      const item =
        MASTER_WOK_ITEMS_BY_ID.get(line.itemId);

      const qty = Number(line.quantity || 0);

      if (item?.productionType === 'cookedSalad') {
        cookedSaladPortions += qty;
      } else {
        otherSaladPortions += qty;
      }
    }
  }

  const pressure = {
    highAttentionPortions:
      noodlePortions +
      stirFryPortions +
      otherFastPortions +
      otherSaladPortions,

    overlapFriendlyPortions:
      curryPortions +
      cookedSaladPortions,

    totalPortions:
      curryPortions +
      stirFryPortions +
      otherFastPortions +
      noodlePortions +
      cookedSaladPortions +
      otherSaladPortions,

    breakdown: {
      curry: curryPortions,
      stirFry: stirFryPortions,
      otherFast: otherFastPortions,
      noodle: noodlePortions,
      cookedSalad: cookedSaladPortions,
      otherSalad: otherSaladPortions
    }
  };

  /*
   * Convert production pressure into a coarse kitchen
   * reservation band.
   *
   * High-attention portions drive the base reservation.
   * Overlap-friendly portions add pressure more slowly.
   *
   * Deliberately coarse: this is capacity protection,
   * not a prediction of exact cooking time.
   */

  let pressurePoints =
    pressure.highAttentionPortions;

  pressurePoints +=
    Math.ceil(pressure.overlapFriendlyPortions / 3);

  let reservedMinutes = 0;

  if (pressure.totalPortions > 0) {
    if (pressurePoints <= 2) {
      reservedMinutes = 10;
    } else if (pressurePoints <= 3) {
      reservedMinutes = 15;
    } else if (pressurePoints <= 5) {
      reservedMinutes = 20;
    } else if (pressurePoints <= 7) {
      reservedMinutes = 25;
    } else {
      reservedMinutes = 30;
    }
  }

// Large repeated noodle batches create a physical minimum
// production requirement that may exceed the general
// pressure-band reservation.
//
// 1â€“3 noodle portions remain governed by the calibrated
// pressure model: Rung can comfortably produce 3 portions
// in approximately 15 minutes despite the mechanical
// batch calculation being higher.
if (noodlePortions >= 4) {
  reservedMinutes =
    Math.max(
      reservedMinutes,
      noodleMinutes
    );
}

  return {
    rawMinutes,
    reservedMinutes,
    pressurePoints,

    groups: {
      fast: fastMinutes,
      noodle: noodleMinutes,
      salad: saladMinutes
    },

    fastProductionTypes,
    saladProductionTypes,

    pressure
  };
}





global.MasterWokModelV1 = Object.freeze({
  hasItem: itemId => MASTER_WOK_ITEMS_BY_ID.has(itemId),
  classifyBasket,
  combineKitchenClassifications,
  calculateCombinedKitchenPressure,
  calculateProductionRequirements,
  buildRungProductionBatches,
  calculateProductionWindow
});
})(typeof window !== 'undefined' ? window : globalThis);
