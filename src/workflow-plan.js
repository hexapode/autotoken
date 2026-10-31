const ORDERS = [
 ['baseline','singleton','workflow'], ['singleton','workflow','baseline'],
 ['workflow','baseline','singleton'], ['baseline','workflow','singleton'],
 ['workflow','singleton','baseline'], ['singleton','baseline','workflow']
];
export function expandPlan(plan, inventory) {
 if (plan?.version !== 1 || inventory?.split !== 'dev' || !Array.isArray(inventory.tasks)) throw new Error('Expected development plan and inventory');
 if (!Array.isArray(plan.issues) || !plan.issues.length || plan.issues.some(id => typeof id !== 'string' || !id.trim()) || new Set(plan.issues).size !== plan.issues.length) throw new Error('Expected unique nonempty issues');
 if (!Number.isSafeInteger(plan.repeats) || plan.repeats < 1 || plan.repeats > 5) throw new Error('Repeats must be 1..5');
 if (plan.issues.some(id => !inventory.tasks.some(t => t.instance_id === id))) throw new Error('Unknown issue');
 const runs=[];let block=0;
 for(let repeat=1;repeat<=plan.repeats;repeat++)for(const instance of plan.issues) {
  for(const arm of ORDERS[block++ % ORDERS.length]) runs.push({instance,arm,repeat,key:`${instance}-r${repeat}-${arm}`});
 }
 return runs;
}
