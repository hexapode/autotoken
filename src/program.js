import { isDeepStrictEqual } from 'node:util';

export const LANGUAGE = `A program is {name, description, input: "array"|"string", steps: [...], tests: [...], sourceIds: [...] }.
Steps are fixed operations: {op:"sort", field?:string, direction:"asc"|"desc"}, {op:"unique"}, {op:"sum",field?:string}, {op:"count"}, {op:"pluck",field:string}, {op:"lower"}, {op:"upper"}, {op:"trim"}.
No executable source, expressions, external access, or dynamic arguments. At most 8 steps.
Sort accepts uniformly numbers or strings, comparing strings by JS code units; sum accepts finite numbers only. Fields are direct own properties, not paths. unique uses structural JSON equality. count counts array entries or Unicode code points in a string. lower/upper use JS Unicode conversion.
Tests: at least 3 distinct successful {input,expected} examples and one {input,reject:true} example. Include edge cases. sourceIds must identify at least 3 distinct observed requests supporting the same semantics.
Output is always a JSON value, with no prose. Description must specify exact applicability and exclusions, including output format.`;

function insist(condition, message) { if (!condition) throw new Error(message); }
const fields = { sort: ['op', 'field', 'direction'], unique: ['op'], sum: ['op', 'field'], count: ['op'], pluck: ['op', 'field'], lower: ['op'], upper: ['op'], trim: ['op'] };
export function validateProgram(p) {
  insist(p && typeof p.name === 'string' && p.name.length <= 100 && typeof p.description === 'string' && p.description.length <= 2000, 'Invalid program description');
  insist(['array', 'string'].includes(p.input), 'Invalid input contract');
  insist(Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 8, 'Invalid step count');
  for (const step of p.steps) {
    insist(step && Object.hasOwn(fields, step.op), 'Unsupported operation');
    insist(Object.keys(step).every(k => fields[step.op].includes(k)), 'Unexpected operation parameter');
    if (step.field !== undefined) insist(typeof step.field === 'string' && step.field.length < 100 && !['__proto__', 'constructor', 'prototype'].includes(step.field), 'Invalid field');
    if (step.op === 'pluck') insist(typeof step.field === 'string', 'pluck requires field');
    if (step.op === 'sort') insist(['asc', 'desc'].includes(step.direction), 'Invalid sort direction');
  }
}
function valueAt(value, field) {
  if (field === undefined) return value;
  insist(value !== null && typeof value === 'object' && Object.hasOwn(value, field), 'Missing field');
  return value[field];
}
export function execute(p, input) {
  validateProgram(p);
  insist(p.input === 'array' ? Array.isArray(input) : typeof input === 'string', 'Input contract rejected');
  insist(JSON.stringify(input).length <= 64000, 'Input too large');
  let result = structuredClone(input);
  for (const step of p.steps) {
    if (['lower', 'upper', 'trim'].includes(step.op)) {
      insist(typeof result === 'string', 'Expected string');
      result = step.op === 'lower' ? result.toLowerCase() : step.op === 'upper' ? result.toUpperCase() : result.trim();
    } else if (step.op === 'count') {
      insist(Array.isArray(result) || typeof result === 'string', 'Expected array or string');
      result = Array.isArray(result) ? result.length : [...result].length;
    } else {
      insist(Array.isArray(result) && result.length <= 2000, 'Expected array of at most 2000 entries');
      if (step.op === 'unique') result = result.filter((v, i, a) => a.findIndex(x => isDeepStrictEqual(x, v)) === i);
      if (step.op === 'pluck') result = result.map(v => valueAt(v, step.field));
      if (step.op === 'sum') {
        const numbers = result.map(v => valueAt(v, step.field));
        insist(numbers.every(Number.isFinite), 'Expected finite numbers');
        result = numbers.reduce((a, b) => a + b, 0);
        insist(Number.isFinite(result), 'Numeric overflow');
      }
      if (step.op === 'sort') {
        const keys = result.map(v => valueAt(v, step.field));
        insist(keys.every(k => typeof k === 'string') || keys.every(Number.isFinite), 'Sort requires uniform strings or finite numbers');
        result.sort((a, b) => {
          const x = valueAt(a, step.field), y = valueAt(b, step.field);
          return (x < y ? -1 : x > y ? 1 : 0) * (step.direction === 'asc' ? 1 : -1);
        });
      }
    }
  }
  return result;
}
export function checkTests(p) {
  validateProgram(p);
  insist(Array.isArray(p.tests) && p.tests.length <= 30, 'Invalid tests');
  const positives = p.tests.filter(t => t.reject !== true);
  insist(new Set(positives.map(t => JSON.stringify(t.input))).size >= 3 && p.tests.some(t => t.reject === true), 'Need 3 distinct positive tests and a rejection test');
  for (const test of p.tests) {
    let result;
    try { result = execute(p, test.input); }
    catch (error) { if (test.reject === true) continue; throw error; }
    insist(test.reject !== true && isDeepStrictEqual(result, test.expected), 'Candidate test failed');
  }
  return p.tests.length;
}
export function agrees(output, text) {
  try { return isDeepStrictEqual(output, JSON.parse(text)); } catch { return false; }
}
