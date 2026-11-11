'use strict';
// Customer-supplied £150 examples, November 2026. Quantities are menu portions.
const examples={
 mixed:[
  ['salt-chicken',3],['pork-dumplings',2],['beef-salad',2],
  ['rung-curry',1,'chicken'],['rung-curry',1,'pork'],['rung-curry',1,'prawn'],
  ['salt-chickenchips',1],['stir-pepper',2,'beef'],['pad-see-ew',1,'chicken'],
  ['pad-kee-mao',1,'pork'],['chef-pad-thai',1,'tofu'],['pad-thai',1,'prawn'],
  ['salt-chips',1],['coconut-rice',1]
 ],
 startersAndCurries:[
  ['veg-spring-rolls',1],['chicken-satay',1],['moo-ping',1],['fish-cakes',1],
  ['fried-tofu',1],['spare-ribs',1],['thai-sausage',1],['beef-salad',1],
  ['massaman-curry',3,'prawn'],['green-curry',3,'pork'],
  ['massaman-curry',3,'prawn'],['pad-thai',1,'tofu']
 ],
 stirFries:[
  ['chicken-satay',2],['tom-kha',3,'prawn'],['rung-curry',1,'beef'],
  ['red-curry',1,'chicken'],['stir-crispy',4],['stir-basil',1,'beef'],
  ['stir-yellow',1,'prawn'],['stir-pepper',1,'chicken'],
  ['stir-sweetsour',1,'batter-chicken'],['stir-cashew',1,'batter-chicken'],
  ['stir-pepper',1,'vegetable']
 ],
 noodles:[
  ['moo-ping',1],['pork-dumplings',1],['rung-curry',1,'chicken'],
  ['massaman-curry',1,'prawn'],['stir-crispy',1],['pad-thai',3,'prawn'],
  ['chef-pad-thai',3,'pork'],['pad-kee-mao',3,'chicken'],
  ['pad-see-ew',1,'chicken'],['pad-kee-mao',1,'prawn'],['salt-chips',1]
 ]
};
const {catalog}=require('../master-wok-commercial');
module.exports=Object.fromEntries(Object.entries(examples).map(([name,lines])=>[
 name,lines.map(([item_id,qty,protein])=>{
  const item=catalog.items.find(i=>i.id===item_id);
  if(!item)throw Error('Unknown fixture item '+item_id);
  return {item_id,qty,modifiers:protein?[{id:protein}]:[],spice:item.spiceDefault||0};
 })
]));
