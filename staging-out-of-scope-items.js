'use strict';
// Explicit menu IDs outside the Master Wok capacity model.
// Standalone starters/sides are prepared independently by Sam/Dave.
// Excluded from wok capacity; fryer diagnosis separately flags fried items as unmodelled.
// Unknown IDs still fail closed.
const OUT_OF_SCOPE=new Set([
 'veg-spring-rolls','chicken-spring-rolls','chicken-satay',
 'prawn-crackers','moo-ping','fried-tofu','fish-cakes',
 'pork-dumplings','fried-prawns','thai-sausage','spare-ribs',
 'jasmine-rice','sticky-rice','chips','fried-egg'
]);
module.exports={OUT_OF_SCOPE};
