#!/usr/bin/env node
// src/project.ts
import { existsSync, realpathSync } from "node:fs";
import { resolve as resolve3 } from "node:path";
import * as ts12 from "typescript";

// src/domain/number.ts
var float64Scratch = new Float64Array(1);
var bitsScratch = new BigInt64Array(float64Scratch.buffer);
function nextUp(value) {
  if (Number.isNaN(value) || value === Infinity)
    return value;
  if (value === 0)
    return Number.MIN_VALUE;
  float64Scratch[0] = value;
  bitsScratch[0] = bitsScratch[0] + (value > 0 ? 1n : -1n);
  return float64Scratch[0];
}
function nextDown(value) {
  return -nextUp(-value);
}
function isFiniteNumber(value) {
  return Number.isFinite(value.lower) && Number.isFinite(value.upper);
}
function finiteNumberPart(value) {
  const lower = Math.max(value.lower, -Number.MAX_VALUE);
  const upper = Math.min(value.upper, Number.MAX_VALUE);
  return lower <= upper ? { ...value, lower, upper, mayBeNaN: false } : null;
}
function finiteInputNumber() {
  return {
    kind: "number",
    lower: -Number.MAX_VALUE,
    upper: Number.MAX_VALUE,
    integer: false,
    mayBeNaN: false
  };
}
function constantNumber(value) {
  return {
    kind: "number",
    lower: value,
    upper: value,
    integer: Number.isInteger(value),
    mayBeNaN: Number.isNaN(value)
  };
}
function addNumbers(left, right) {
  const lower = left.lower + right.lower;
  const upper = left.upper + right.upper;
  const oppositeInfinities = left.upper === Number.POSITIVE_INFINITY && right.lower === Number.NEGATIVE_INFINITY || left.lower === Number.NEGATIVE_INFINITY && right.upper === Number.POSITIVE_INFINITY;
  const result = {
    kind: "number",
    lower: Number.isNaN(lower) ? Number.NEGATIVE_INFINITY : lower,
    upper: Number.isNaN(upper) ? Number.POSITIVE_INFINITY : upper,
    integer: left.integer && right.integer,
    mayBeNaN: left.mayBeNaN || right.mayBeNaN || oppositeInfinities
  };
  const pointSide = right.lower === right.upper && !right.mayBeNaN ? right : left.lower === left.upper && !left.mayBeNaN ? left : null;
  const otherSide = pointSide === right ? left : right;
  if (pointSide != null && pointExcluded(otherSide, -pointSide.lower) && result.lower < 0 && result.upper > 0) {
    result.excludesPoint = 0;
  }
  return result;
}
function subtractNumbers(left, right) {
  const negated = {
    kind: "number",
    lower: -right.upper,
    upper: -right.lower,
    integer: right.integer,
    mayBeNaN: right.mayBeNaN
  };
  if (right.excludesPoint != null)
    negated.excludesPoint = -right.excludesPoint;
  return addNumbers(left, negated);
}
function multiplyNumbers(left, right) {
  if (!safeOperands(left, right))
    return unknownNumber();
  const products = [
    left.lower * right.lower,
    left.lower * right.upper,
    left.upper * right.lower,
    left.upper * right.upper
  ];
  const result = boundedResult(Math.min(...products), Math.max(...products), left.integer && right.integer, left, right);
  const pointSide = right.lower === right.upper && !right.mayBeNaN ? right : left.lower === left.upper && !left.mayBeNaN ? left : null;
  const otherSide = pointSide === right ? left : right;
  if (pointSide != null && Number.isFinite(pointSide.lower) && Math.abs(pointSide.lower) >= 1 && pointExcluded(otherSide, 0) && !result.mayBeNaN && result.lower < 0 && result.upper > 0) {
    result.excludesPoint = 0;
  }
  return result;
}
function divideNumbers(left, right) {
  if (!left.mayBeNaN && !right.mayBeNaN && isFiniteNumber(right)) {
    if (right.lower > 0 || right.upper < 0) {
      const quotients2 = [
        left.lower / right.lower,
        left.lower / right.upper,
        left.upper / right.lower,
        left.upper / right.upper
      ];
      return {
        kind: "number",
        lower: Math.min(...quotients2),
        upper: Math.max(...quotients2),
        integer: false,
        mayBeNaN: false
      };
    }
    if (right.excludesPoint === 0)
      return divideAcrossZero(left, right);
  }
  if (!safeOperands(left, right) || right.lower <= 0 && right.upper >= 0)
    return unknownNumber();
  const quotients = [
    left.lower / right.lower,
    left.lower / right.upper,
    left.upper / right.lower,
    left.upper / right.upper
  ];
  return boundedResult(Math.min(...quotients), Math.max(...quotients), false, left, right);
}
function divideAcrossZero(left, right) {
  if (!right.integer) {
    return { kind: "number", lower: -Infinity, upper: Infinity, integer: false, mayBeNaN: false };
  }
  const negativePart = { ...right, upper: Math.min(right.upper, -1) };
  const positivePart = { ...right, lower: Math.max(right.lower, 1) };
  const parts = [negativePart, positivePart].filter((part) => part.lower <= part.upper);
  const quotients = parts.flatMap((part) => [
    left.lower / part.lower,
    left.lower / part.upper,
    left.upper / part.lower,
    left.upper / part.upper
  ]);
  if (quotients.length === 0)
    return unknownNumber();
  return boundedResult(Math.min(...quotients), Math.max(...quotients), false, left, right);
}
function floorNumber(value) {
  return {
    kind: "number",
    lower: Math.floor(value.lower),
    upper: Math.floor(value.upper),
    integer: true,
    mayBeNaN: value.mayBeNaN
  };
}
function divideNumbersNonzeroDivisor(left, right) {
  if (!safeOperands(left, right))
    return unknownNumber();
  if (!includesZero(right))
    return divideNumbers(left, right);
  return divideAcrossZero(left, right);
}
function roundedNumber(operator, value) {
  const apply = operator === "ceil" ? Math.ceil : operator === "round" ? Math.round : Math.trunc;
  return {
    kind: "number",
    lower: apply(value.lower),
    upper: apply(value.upper),
    integer: true,
    mayBeNaN: value.mayBeNaN
  };
}
function squareRootNumber(value) {
  const mayBeNegative = value.lower < 0;
  const clippedLower = Math.max(value.lower, 0);
  if (value.upper < 0) {
    return unknownNumber();
  }
  return {
    kind: "number",
    lower: Math.sqrt(clippedLower),
    upper: Math.sqrt(value.upper),
    integer: false,
    mayBeNaN: value.mayBeNaN || mayBeNegative
  };
}
function remainderNumbers(left, right, divisorNonzero) {
  if (left.mayBeNaN || right.mayBeNaN)
    return unknownNumber();
  const divisorMayBeZero = !divisorNonzero && includesZero(right);
  const dividendMayBeInfinite = !isFiniteNumber(left);
  const dividendMagnitude = Math.max(Math.abs(left.lower), Math.abs(left.upper));
  const divisorMagnitude = Math.max(Math.abs(right.lower), Math.abs(right.upper));
  const integer = left.integer && right.integer;
  const divisorBound = integer && Number.isFinite(divisorMagnitude) ? Math.max(divisorMagnitude - 1, 0) : divisorMagnitude;
  const bound = Math.min(dividendMagnitude, divisorBound);
  return {
    kind: "number",
    lower: left.lower < 0 ? Number.isFinite(bound) ? -bound : Number.NEGATIVE_INFINITY : 0,
    upper: left.upper > 0 ? Number.isFinite(bound) ? bound : Number.POSITIVE_INFINITY : 0,
    integer,
    mayBeNaN: divisorMayBeZero || dividendMayBeInfinite
  };
}
function absoluteNumber(value) {
  const lower = value.lower >= 0 ? value.lower : value.upper <= 0 ? -value.upper : 0;
  return {
    kind: "number",
    lower,
    upper: Math.max(-value.lower, value.upper),
    integer: value.integer,
    mayBeNaN: value.mayBeNaN
  };
}
function minimumNumbers(values) {
  if (values.length === 0)
    return unknownNumber();
  return {
    kind: "number",
    lower: Math.min(...values.map((value) => value.lower)),
    upper: Math.min(...values.map((value) => value.upper)),
    integer: values.every((value) => value.integer),
    mayBeNaN: values.some((value) => value.mayBeNaN)
  };
}
function maximumNumbers(values) {
  if (values.length === 0)
    return unknownNumber();
  return {
    kind: "number",
    lower: Math.max(...values.map((value) => value.lower)),
    upper: Math.max(...values.map((value) => value.upper)),
    integer: values.every((value) => value.integer),
    mayBeNaN: values.some((value) => value.mayBeNaN)
  };
}
function includesZero(value) {
  return value.lower <= 0 && value.upper >= 0 && value.excludesPoint !== 0;
}
function isDefinitelyZero(value) {
  return value.lower === 0 && value.upper === 0 && !value.mayBeNaN && value.excludesPoint !== 0;
}
function pointExcluded(value, point) {
  if (point < value.lower || point > value.upper)
    return true;
  if (value.integer && Number.isFinite(point) && !Number.isInteger(point))
    return true;
  return value.excludesPoint === point;
}
function sharedExcludedPoint(left, right, lower, upper) {
  for (const point of [left.excludesPoint, right.excludesPoint, 0]) {
    if (point == null)
      continue;
    if (pointExcluded(left, point) && pointExcluded(right, point) && lower < point && point < upper)
      return point;
  }
  return null;
}
function joinNumbers(left, right) {
  const joined = {
    kind: "number",
    lower: Math.min(left.lower, right.lower),
    upper: Math.max(left.upper, right.upper),
    integer: left.integer && right.integer,
    mayBeNaN: left.mayBeNaN || right.mayBeNaN
  };
  const excludesPoint = sharedExcludedPoint(left, right, joined.lower, joined.upper);
  if (excludesPoint != null)
    joined.excludesPoint = excludesPoint;
  const nonFiniteSite = (!isFiniteNumber(left) ? left.nonFiniteSite : undefined) ?? (!isFiniteNumber(right) ? right.nonFiniteSite : undefined);
  if (!isFiniteNumber(joined) && nonFiniteSite != null)
    joined.nonFiniteSite = nonFiniteSite;
  const nanSite = (left.mayBeNaN ? left.nanSite : undefined) ?? (right.mayBeNaN ? right.nanSite : undefined);
  if (joined.mayBeNaN && nanSite != null)
    joined.nanSite = nanSite;
  return joined;
}
function sameNumbers(left, right) {
  return left.lower === right.lower && left.upper === right.upper && left.integer === right.integer && left.mayBeNaN === right.mayBeNaN && left.excludesPoint === right.excludesPoint;
}
function widenNumber(previous, next) {
  const finite = isFiniteNumber(previous) && isFiniteNumber(next);
  const widened = {
    kind: "number",
    lower: next.lower < previous.lower ? finite ? -Number.MAX_VALUE : Number.NEGATIVE_INFINITY : next.lower,
    upper: next.upper > previous.upper ? finite ? Number.MAX_VALUE : Number.POSITIVE_INFINITY : next.upper,
    integer: next.integer,
    mayBeNaN: next.mayBeNaN
  };
  if (!isFiniteNumber(widened) && next.nonFiniteSite != null)
    widened.nonFiniteSite = next.nonFiniteSite;
  if (widened.mayBeNaN && next.nanSite != null)
    widened.nanSite = next.nanSite;
  const excludesPoint = sharedExcludedPoint(previous, next, widened.lower, widened.upper);
  if (excludesPoint != null)
    widened.excludesPoint = excludesPoint;
  return widened;
}
function boundedResult(lower, upper, integer, left, right) {
  if (!safeOperands(left, right))
    return unknownNumber();
  return { kind: "number", lower, upper, integer, mayBeNaN: false };
}
function safeOperands(left, right) {
  return isFiniteNumber(left) && isFiniteNumber(right) && !left.mayBeNaN && !right.mayBeNaN;
}
function unknownNumber() {
  return {
    kind: "number",
    lower: Number.NEGATIVE_INFINITY,
    upper: Number.POSITIVE_INFINITY,
    integer: false,
    mayBeNaN: true
  };
}

// src/domain/value.ts
function joinSentinels(left, right) {
  return left === right ? left : "both";
}
function unknownBoolean() {
  return { kind: "boolean", canBeTrue: true, canBeFalse: true };
}
function recordValue(properties) {
  return { kind: "record", properties };
}
function recordProperty(record, name) {
  const property = record.properties.find((candidate) => candidate.name === name);
  return property == null ? null : property.value;
}
function recordPropertiesByName(record) {
  return new Map(record.properties.map((property) => [property.name, property.value]));
}
function joinValues(left, right) {
  const joined = tryJoinValues(left, right);
  if (joined == null)
    throw new Error(`Cannot join ${left.kind} and ${right.kind}`);
  return joined;
}
function tryJoinValues(left, right) {
  if (left.kind === "nullish" && right.kind === "nullish") {
    return { kind: "nullish", sentinels: joinSentinels(left.sentinels, right.sentinels) };
  }
  if (left.kind === "nullish") {
    return right.kind === "maybeNullish" ? { kind: "maybeNullish", inner: right.inner, sentinels: joinSentinels(left.sentinels, right.sentinels) } : { kind: "maybeNullish", inner: right, sentinels: left.sentinels };
  }
  if (right.kind === "nullish")
    return tryJoinValues(right, left);
  if (left.kind === "maybeNullish" || right.kind === "maybeNullish") {
    const leftInner = left.kind === "maybeNullish" ? left.inner : left;
    const rightInner = right.kind === "maybeNullish" ? right.inner : right;
    const leftSentinels = left.kind === "maybeNullish" ? left.sentinels : null;
    const rightSentinels = right.kind === "maybeNullish" ? right.sentinels : null;
    const sentinels = leftSentinels == null ? rightSentinels : rightSentinels == null ? leftSentinels : joinSentinels(leftSentinels, rightSentinels);
    const inner = tryJoinValues(leftInner, rightInner);
    return inner == null ? null : { kind: "maybeNullish", inner, sentinels };
  }
  if ((left.kind === "tuple" || left.kind === "array") && (right.kind === "tuple" || right.kind === "array")) {
    if (left.kind === "tuple" && right.kind === "tuple" && left.elements.length === right.elements.length) {
      const elements = [];
      for (let index = 0;index < left.elements.length; index++) {
        const element2 = tryJoinValues(left.elements[index], right.elements[index]);
        if (element2 == null)
          return null;
        elements.push(element2);
      }
      return { kind: "tuple", elements };
    }
    const leftArray = left.kind === "tuple" ? arrayFromTupleTotal(left) : left;
    const rightArray = right.kind === "tuple" ? arrayFromTupleTotal(right) : right;
    if (leftArray == null || rightArray == null)
      return null;
    const element = leftArray.element == null ? rightArray.element : rightArray.element == null ? leftArray.element : tryJoinValues(leftArray.element, rightArray.element);
    if (element == null && leftArray.element != null && rightArray.element != null)
      return null;
    return { kind: "array", element, length: joinNumbers(leftArray.length, rightArray.length) };
  }
  if (left.kind === "record" && right.kind === "taggedUnion") {
    const hull = taggedUnionHull(right);
    return hull == null ? null : joinRecords(left, hull);
  }
  if (left.kind === "taggedUnion" && right.kind === "record") {
    const hull = taggedUnionHull(left);
    return hull == null ? null : joinRecords(hull, right);
  }
  if (left.kind === "opaque" || right.kind === "opaque") {
    if (left.kind === "opaque" && right.kind === "opaque" && left.content != null && left.content === right.content)
      return { kind: "opaque", content: left.content };
    return { kind: "opaque" };
  }
  if (left.kind !== right.kind)
    return null;
  switch (left.kind) {
    case "number":
      return joinNumbers(left, right);
    case "boolean":
      return joinBooleans(left, right);
    case "record":
      return joinRecords(left, right);
    case "void":
      return left;
    case "taggedUnion":
      return joinTaggedUnions(left, right);
    case "tuple":
    case "array":
      return null;
  }
}
function joinTaggedUnions(left, right) {
  if (left.tagProperty !== right.tagProperty)
    return null;
  const pairWithRight = (variant) => {
    const other = right.variants.find((candidate) => candidate.tagValue === variant.tagValue && sameVariantShape(candidate.record, variant.record));
    return other == null ? variant : { tagValue: variant.tagValue, record: joinRecords(variant.record, other.record) };
  };
  const [firstLeft, ...restLeft] = left.variants;
  const variants = [pairWithRight(firstLeft), ...restLeft.map(pairWithRight)];
  for (const variant of right.variants) {
    const paired = left.variants.some((candidate) => candidate.tagValue === variant.tagValue && sameVariantShape(candidate.record, variant.record));
    if (!paired)
      variants.push(variant);
  }
  return { kind: "taggedUnion", tagProperty: left.tagProperty, variants };
}
function taggedUnionHull(union) {
  let hull = union.variants[0].record;
  for (let index = 1;index < union.variants.length; index++) {
    if (hull == null)
      return null;
    hull = tryJoinValues(hull, union.variants[index].record);
  }
  return hull != null && hull.kind === "record" ? hull : null;
}
function sameVariantShape(left, right) {
  if (left.properties.length !== right.properties.length)
    return false;
  const rightProperties = recordPropertiesByName(right);
  return left.properties.every((property) => rightProperties.has(property.name));
}
function arrayFromTupleTotal(tuple) {
  if (tuple.elements.length === 0)
    return { kind: "array", element: null, length: constantLength(0) };
  let element = tuple.elements[0];
  for (let index = 1;index < tuple.elements.length; index++) {
    element = tryJoinValues(element, tuple.elements[index]);
    if (element == null)
      return null;
  }
  return { kind: "array", element, length: constantLength(tuple.elements.length) };
}
function constantLength(length) {
  return { kind: "number", lower: length, upper: length, integer: true, mayBeNaN: false };
}
function joinRecords(left, right) {
  const rightProperties = recordPropertiesByName(right);
  const properties = [];
  for (const property of left.properties) {
    const other = rightProperties.get(property.name);
    if (other == null)
      continue;
    const joined = tryJoinValues(property.value, other);
    if (joined == null)
      continue;
    properties.push({ name: property.name, value: joined });
  }
  return { kind: "record", properties };
}
function sameValues(left, right) {
  if (left.kind !== right.kind)
    return false;
  switch (left.kind) {
    case "number":
      return sameNumbers(left, right);
    case "boolean": {
      const other = right;
      return left.canBeTrue === other.canBeTrue && left.canBeFalse === other.canBeFalse;
    }
    case "record": {
      const other = right;
      const otherProperties = recordPropertiesByName(other);
      return left.properties.length === other.properties.length && left.properties.every((property) => {
        const otherValue = otherProperties.get(property.name);
        return otherValue != null && sameValues(property.value, otherValue);
      });
    }
    case "void":
      return true;
    case "opaque":
      return left.content === right.content;
    case "nullish":
      return left.sentinels === right.sentinels;
    case "maybeNullish": {
      const other = right;
      return left.sentinels === other.sentinels && sameValues(left.inner, other.inner);
    }
    case "tuple": {
      const other = right;
      return left.elements.length === other.elements.length && left.elements.every((element, index) => sameValues(element, other.elements[index]));
    }
    case "array": {
      const other = right;
      const sameElement = left.element == null || other.element == null ? left.element === other.element : sameValues(left.element, other.element);
      return sameElement && sameNumbers(left.length, other.length);
    }
    case "taggedUnion": {
      const other = right;
      return left.tagProperty === other.tagProperty && left.variants.length === other.variants.length && left.variants.every((variant, index) => variant.tagValue === other.variants[index].tagValue && sameValues(variant.record, other.variants[index].record));
    }
  }
}
function widenValue(previous, next) {
  switch (next.kind) {
    case "number":
      return previous.kind === "number" ? widenNumber(previous, next) : next;
    case "record": {
      if (previous.kind !== "record")
        return next;
      const previousProperties = recordPropertiesByName(previous);
      return {
        kind: "record",
        properties: next.properties.map((property) => {
          const before = previousProperties.get(property.name);
          return before == null ? property : { name: property.name, value: widenValue(before, property.value) };
        })
      };
    }
    case "maybeNullish": {
      const previousInner = previous.kind === "maybeNullish" ? previous.inner : previous;
      return { kind: "maybeNullish", inner: widenValue(previousInner, next.inner), sentinels: next.sentinels };
    }
    case "tuple": {
      if (previous.kind !== "tuple" || previous.elements.length !== next.elements.length)
        return next;
      const previousTuple = previous;
      return {
        kind: "tuple",
        elements: next.elements.map((element, index) => widenValue(previousTuple.elements[index], element))
      };
    }
    case "array": {
      if (previous.kind !== "array")
        return next;
      const element = next.element == null ? null : previous.element == null ? next.element : widenValue(previous.element, next.element);
      return { kind: "array", element, length: widenNumber(previous.length, next.length) };
    }
    case "taggedUnion": {
      if (previous.kind !== "taggedUnion" || previous.tagProperty !== next.tagProperty)
        return next;
      const widenVariant = (variant) => {
        const before = previous.variants.find((candidate) => candidate.tagValue === variant.tagValue && sameVariantShape(candidate.record, variant.record));
        if (before == null)
          return variant;
        const widened = widenValue(before.record, variant.record);
        return widened.kind === "record" ? { tagValue: variant.tagValue, record: widened } : variant;
      };
      const [firstNext, ...restNext] = next.variants;
      return {
        kind: "taggedUnion",
        tagProperty: next.tagProperty,
        variants: [widenVariant(firstNext), ...restNext.map(widenVariant)]
      };
    }
    case "boolean":
    case "void":
    case "nullish":
    case "opaque":
      return next;
  }
}
function joinBooleans(left, right) {
  return {
    kind: "boolean",
    canBeTrue: left.canBeTrue || right.canBeTrue,
    canBeFalse: left.canBeFalse || right.canBeFalse
  };
}

// src/ir/function-usage.ts
function functionUsage(program) {
  return program.functions.map((fn) => {
    const callees = new Set;
    const moduleBindings = new Set;
    if (fn.kind === "lowered") {
      for (const block of fn.blocks) {
        for (const instruction of block.instructions) {
          if (instruction.kind === "call")
            callees.add(instruction.function);
          if (instruction.kind === "moduleRead")
            moduleBindings.add(instruction.binding);
        }
      }
    }
    return { callees: [...callees], moduleBindings: [...moduleBindings] };
  });
}
function transitiveModuleBindings(usage, direct = usage.map((fn) => new Set(fn.moduleBindings))) {
  const callers = usage.map(() => []);
  for (let caller = 0;caller < usage.length; caller++) {
    for (const callee of usage[caller].callees)
      callers[callee].push(caller);
  }
  const bindings = direct.map((items) => new Set(items));
  const queue = [];
  for (let functionID = 0;functionID < bindings.length; functionID++) {
    for (const binding of bindings[functionID])
      queue.push({ functionID, binding });
  }
  let index = 0;
  while (index < queue.length) {
    const { functionID, binding } = queue[index++];
    for (const caller of callers[functionID]) {
      if (!bindings[caller].has(binding)) {
        bindings[caller].add(binding);
        queue.push({ functionID: caller, binding });
      }
    }
  }
  return bindings;
}

// src/ir/finite-inputs.ts
function finiteInputPaths(declared) {
  switch (declared.kind) {
    case "number":
      return declared.interval == null ? [[]] : [];
    case "record": {
      const paths = [];
      for (const property of declared.properties) {
        for (const path of finiteInputPaths(property.declared)) {
          paths.push([property.name, ...path]);
        }
      }
      return paths;
    }
    case "array":
    case "boolean":
    case "nullish":
    case "opaque":
    case "taggedUnion":
    case "tuple":
      return [];
  }
}
function finiteInputs(fn) {
  const inputs = [];
  for (let parameter = 0;parameter < fn.parameters.length; parameter++) {
    const current = fn.parameters[parameter];
    for (const properties of finiteInputPaths(current.type)) {
      inputs.push({ parameter, properties, site: current.site });
    }
  }
  return inputs;
}
function finiteInputExpression(input) {
  let expression = { kind: "parameter", index: input.parameter };
  for (const property of input.properties) {
    expression = { kind: "property", base: expression, name: property };
  }
  return expression;
}

// src/ir/program.ts
import { relative } from "node:path";
function declaredKindOf(category) {
  switch (category.kind) {
    case "value":
    case "kind":
      return category.declaredKind;
    case "importedConstant":
    case "import":
    case "opaque":
      return null;
  }
}
function declaredKindValue(declared) {
  return valueFromDeclaredKind(declared, finiteInputNumber, true);
}
function exactTagValue(tagValue) {
  if (typeof tagValue === "string")
    return { kind: "opaque", content: tagValue };
  return { kind: "boolean", canBeTrue: tagValue, canBeFalse: !tagValue };
}
function holdsMutableStructure(declared) {
  switch (declared.kind) {
    case "record":
    case "tuple":
    case "array":
    case "taggedUnion":
      return true;
    case "nullish":
      return holdsMutableStructure(declared.inner);
    case "number":
    case "boolean":
    case "opaque":
      return false;
  }
}
function coveringKindValue(declared) {
  return valueFromDeclaredKind(declared, unknownNumber, false);
}
function valueFromDeclaredKind(declared, numberValue, preserveLiteralIntervals) {
  switch (declared.kind) {
    case "number":
      return preserveLiteralIntervals && declared.interval != null ? {
        kind: "number",
        lower: declared.interval.lower,
        upper: declared.interval.upper,
        integer: declared.interval.integer,
        mayBeNaN: false
      } : numberValue();
    case "boolean":
      return unknownBoolean();
    case "record":
      return recordValue(declared.properties.map((property) => ({
        name: property.name,
        value: valueFromDeclaredKind(property.declared, numberValue, preserveLiteralIntervals)
      })));
    case "nullish":
      return {
        kind: "maybeNullish",
        inner: valueFromDeclaredKind(declared.inner, numberValue, preserveLiteralIntervals),
        sentinels: declared.sentinels
      };
    case "tuple":
      return {
        kind: "tuple",
        elements: declared.elements.map((element) => valueFromDeclaredKind(element, numberValue, preserveLiteralIntervals))
      };
    case "array":
      return {
        kind: "array",
        element: valueFromDeclaredKind(declared.element, numberValue, preserveLiteralIntervals),
        length: { kind: "number", lower: 0, upper: 4294967295, integer: true, mayBeNaN: false }
      };
    case "taggedUnion": {
      const convertVariant = (variant) => ({
        tagValue: variant.tagValue,
        record: recordValue(variant.properties.map((property) => ({
          name: property.name,
          value: property.name === declared.tagProperty ? exactTagValue(variant.tagValue) : valueFromDeclaredKind(property.declared, numberValue, preserveLiteralIntervals)
        })))
      });
      const [firstVariant, ...restVariants] = declared.variants;
      return {
        kind: "taggedUnion",
        tagProperty: declared.tagProperty,
        variants: [convertVariant(firstVariant), ...restVariants.map(convertVariant)]
      };
    }
    case "opaque":
      return { kind: "opaque" };
  }
}
var moduleInitializerName = "module initialization";
function nodeSpan(sourceFile, node) {
  return { start: node.getStart(sourceFile), end: node.getEnd() };
}
function formatSite(program, site) {
  const { line, column } = siteLocation(program, site);
  return `${reportPath(program)}:${line}:${column}`;
}
function reportPath(program) {
  return relative(program.baseDirectory, program.file);
}
function siteLocation(program, site) {
  const span = program.sites[site];
  if (span == null)
    throw new Error(`Unknown site ${site}`);
  const lineStarts = program.lineStarts;
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle] <= span.start)
      low = middle;
    else
      high = middle - 1;
  }
  return { line: low + 1, column: span.start - lineStarts[low] + 1 };
}

// src/requirements/infer.ts
function createExpressionContext(fn, parameterExpressions, parameterIdentityKeys, identityNamespace = `${fn.name}/`) {
  const identityKeys = parameterIdentityKeys ?? fn.parameters.map((_, index) => `p${index}`);
  if (identityKeys.length !== fn.parameters.length) {
    throw new Error(`Expected ${fn.parameters.length} parameter identity keys for ${fn.name}`);
  }
  const context = {
    parameterExpressions,
    parameterIdentityKeys: identityKeys,
    identityNamespace,
    parameterIndexByValue: [],
    instructionByValue: [],
    instructionCount: 0
  };
  for (let index = 0;index < fn.parameters.length; index++) {
    context.parameterIndexByValue[fn.parameters[index].value] = index;
  }
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      context.instructionByValue[instruction.result] = instruction;
      context.instructionCount += 1;
    }
  }
  return context;
}
function resolveStoredValue(value, context) {
  const producer = context.instructionByValue[value];
  if (producer?.kind === "moduleWrite")
    return resolveStoredValue(producer.value, context);
  if (producer?.kind === "property") {
    const object = resolveStoredValue(producer.object, context);
    const objectProducer = context.instructionByValue[object];
    if (objectProducer?.kind === "object") {
      const property = objectProducer.properties.find((candidate) => candidate.name === producer.property);
      if (property != null)
        return resolveStoredValue(property.value, context);
    }
  }
  return value;
}
function numericExpression(value, context) {
  let remainingVisits = context.instructionCount;
  const walk = (current) => {
    const stored = resolveStoredValue(current, context);
    if (stored !== current)
      return walk(stored);
    const parameterIndex = context.parameterIndexByValue[current];
    if (parameterIndex != null)
      return context.parameterExpressions[parameterIndex] ?? null;
    const instruction = context.instructionByValue[current];
    if (instruction == null)
      return null;
    if (remainingVisits <= 0)
      return null;
    remainingVisits -= 1;
    switch (instruction.kind) {
      case "constant":
        return { kind: "constant", value: instruction.value };
      case "binary": {
        const left = walk(instruction.left);
        const right = walk(instruction.right);
        return left == null || right == null ? null : { kind: "binary", operator: instruction.operator, left, right };
      }
      case "floor": {
        const operand = walk(instruction.value);
        return operand == null ? null : { kind: "floor", operand };
      }
      case "moduleWrite":
        return walk(instruction.value);
      case "moduleRead":
      case "moduleHavoc":
      case "platformValue":
      case "booleanConstant":
      case "not":
      case "absolute":
      case "call":
      case "compare":
      case "maximum":
      case "minimum":
      case "object":
      case "nullishConstant":
      case "opaqueConstant":
      case "unknownBoolean":
      case "mathUnary":
      case "stringLength":
      case "parsedNumber":
      case "numberCheck":
      case "staticRequire":
      case "staticAssert":
      case "tagCheck":
      case "nullishCheck":
      case "arrayLiteral":
      case "arrayIndex":
      case "crossCall":
        return null;
      case "arrayLength":
        return null;
      case "property": {
        const base = walk(instruction.object);
        return base == null ? null : { kind: "property", base, name: instruction.property };
      }
    }
  };
  return walk(value);
}
function staticRequirement(instruction, site, context, purpose) {
  if (instruction?.kind === "compare") {
    const left = numericExpression(instruction.left, context);
    const right = numericExpression(instruction.right, context);
    return left == null || right == null ? null : { kind: "declaredComparison", operator: instruction.operator, left, right, site };
  }
  if (instruction?.kind === "numberCheck") {
    const expression = numericExpression(instruction.value, context);
    return expression == null ? null : { kind: "declaredNumberCheck", predicate: instruction.predicate, expression, site, ...purpose == null ? {} : { purpose } };
  }
  return null;
}
function canonicalValueKey(value, context) {
  const stored = resolveStoredValue(value, context);
  if (stored !== value)
    return canonicalValueKey(stored, context);
  const parameterIndex = context.parameterIndexByValue[value];
  if (parameterIndex != null)
    return context.parameterIdentityKeys[parameterIndex] ?? `p${parameterIndex}`;
  const producer = context.instructionByValue[value];
  if (producer?.kind === "property") {
    return `${canonicalValueKey(producer.object, context)}.${JSON.stringify(producer.property)}`;
  }
  if (producer?.kind === "arrayLength")
    return `${canonicalValueKey(producer.array, context)}.length`;
  if (producer?.kind === "stringLength")
    return `${canonicalValueKey(producer.value, context)}.length`;
  if (producer?.kind === "arrayIndex") {
    return `${canonicalValueKey(producer.array, context)}[${canonicalValueKey(producer.index, context)}]`;
  }
  return `v:${context.identityNamespace}${value}`;
}
function sameRuntimeValue(left, right, context) {
  return left === right || canonicalValueKey(left, context) === canonicalValueKey(right, context);
}
function addPrecondition(preconditions, candidate) {
  if (candidate.kind === "declaredNumberCheck") {
    if (candidate.predicate === "finite" && preconditions.some((precondition) => precondition.kind === "declaredNumberCheck" && (precondition.predicate === "integer" || precondition.predicate === "finite") && sameExpression(precondition.expression, candidate.expression)))
      return;
    if (candidate.predicate === "integer") {
      const redundantFinite = preconditions.findIndex((precondition) => precondition.kind === "declaredNumberCheck" && precondition.predicate === "finite" && sameExpression(precondition.expression, candidate.expression));
      if (redundantFinite >= 0)
        preconditions.splice(redundantFinite, 1);
    }
  }
  if (!preconditions.some((precondition) => samePrecondition(precondition, candidate)))
    preconditions.push(candidate);
}
function numericParameterPath(expression) {
  if (expression.kind === "parameter")
    return { parameter: expression.index, properties: [] };
  if (expression.kind !== "property")
    return null;
  const base = numericParameterPath(expression.base);
  return base == null ? null : { ...base, properties: [...base.properties, expression.name] };
}
function constantRequirementStatus(requirement) {
  if (requirement.kind === "declaredNumberCheck") {
    const value = constantNumericExpression(requirement.expression);
    if (value == null)
      return null;
    switch (requirement.predicate) {
      case "finite":
        return Number.isFinite(value);
      case "integer":
        return Number.isInteger(value);
      case "nan":
        return Number.isNaN(value);
    }
  }
  const left = constantNumericExpression(requirement.left);
  const right = constantNumericExpression(requirement.right);
  if (left == null || right == null)
    return null;
  switch (requirement.operator) {
    case "lessThan":
      return left < right;
    case "lessThanOrEqual":
      return left <= right;
    case "greaterThan":
      return left > right;
    case "greaterThanOrEqual":
      return left >= right;
    case "equal":
      return left === right;
    case "notEqual":
      return left !== right;
  }
}
function substituteParameters(expression, argumentExpressions) {
  switch (expression.kind) {
    case "parameter":
      return argumentExpressions[expression.index] ?? null;
    case "constant":
      return expression;
    case "binary": {
      const left = substituteParameters(expression.left, argumentExpressions);
      const right = substituteParameters(expression.right, argumentExpressions);
      return left == null || right == null ? null : { kind: "binary", operator: expression.operator, left, right };
    }
    case "floor": {
      const operand = substituteParameters(expression.operand, argumentExpressions);
      return operand == null ? null : { kind: "floor", operand };
    }
    case "property": {
      const base = substituteParameters(expression.base, argumentExpressions);
      return base == null ? null : { kind: "property", base, name: expression.name };
    }
  }
}
function crossFileRequirementStatus(requirement, argumentExpressions) {
  if (requirement.kind === "declaredNumberCheck") {
    const expression = substituteParameters(requirement.expression, argumentExpressions);
    return expression == null ? null : constantRequirementStatus({ ...requirement, expression });
  }
  const left = substituteParameters(requirement.left, argumentExpressions);
  const right = substituteParameters(requirement.right, argumentExpressions);
  return left == null || right == null ? null : constantRequirementStatus({ ...requirement, left, right });
}
function constantNumericExpression(expression) {
  switch (expression.kind) {
    case "constant":
      return expression.value;
    case "parameter":
    case "property":
      return null;
    case "floor": {
      const operand = constantNumericExpression(expression.operand);
      return operand == null ? null : Math.floor(operand);
    }
    case "binary": {
      const left = constantNumericExpression(expression.left);
      const right = constantNumericExpression(expression.right);
      if (left == null || right == null)
        return null;
      switch (expression.operator) {
        case "add":
          return left + right;
        case "subtract":
          return left - right;
        case "multiply":
          return left * right;
        case "divide":
          return left / right;
        case "remainder":
          return left % right;
      }
    }
  }
}
function peelNonzero(expression, site, operation) {
  if (expression.kind === "binary") {
    const { operator, left, right } = expression;
    const constantSide = right.kind === "constant" ? right : left.kind === "constant" ? left : null;
    const otherSide = right.kind === "constant" ? left : right;
    if (constantSide != null && Number.isFinite(constantSide.value)) {
      if (operator === "subtract") {
        return { kind: "notEqualConstant", expression: otherSide, value: constantSide.value, operation, site };
      }
      if (operator === "add") {
        return { kind: "notEqualConstant", expression: otherSide, value: -constantSide.value, operation, site };
      }
      if (operator === "multiply" && Math.abs(constantSide.value) >= 1) {
        return peelNonzero(otherSide, site, operation);
      }
    }
  }
  return { kind: "nonzero", expression, operation, site };
}
function samePrecondition(left, right) {
  if (left.site !== right.site)
    return false;
  if (left.kind !== right.kind)
    return false;
  if (left.kind === "inBounds" && right.kind === "inBounds") {
    return sameExpression(left.index, right.index) && sameExpression(left.sequence, right.sequence);
  }
  if (left.kind === "inBounds" || right.kind === "inBounds")
    return false;
  if (left.kind === "declaredComparison" && right.kind === "declaredComparison") {
    return left.operator === right.operator && sameExpression(left.left, right.left) && sameExpression(left.right, right.right);
  }
  if (left.kind === "declaredComparison" || right.kind === "declaredComparison")
    return false;
  if (left.kind === "declaredNumberCheck" && right.kind === "declaredNumberCheck") {
    return left.predicate === right.predicate && sameExpression(left.expression, right.expression);
  }
  if (left.kind === "declaredNumberCheck" || right.kind === "declaredNumberCheck")
    return false;
  if (left.kind === "notEqualConstant" && right.kind === "notEqualConstant" && left.value !== right.value)
    return false;
  return sameExpression(left.expression, right.expression);
}
function sameExpression(left, right) {
  if (left.kind !== right.kind)
    return false;
  switch (left.kind) {
    case "parameter":
      return left.index === right.index;
    case "constant":
      return left.value === right.value;
    case "binary": {
      const other = right;
      return left.operator === other.operator && sameExpression(left.left, other.left) && sameExpression(left.right, other.right);
    }
    case "floor":
      return sameExpression(left.operand, right.operand);
    case "property": {
      const other = right;
      return left.name === other.name && sameExpression(left.base, other.base);
    }
  }
}

// src/engine/outcome.ts
function completedEvaluation(evaluation) {
  if (evaluation.stops.length > 0 || evaluation.normal == null)
    return null;
  return {
    returnValue: evaluation.normal.returnValue,
    sharedState: evaluation.normal.sharedState,
    valueFacts: evaluation.normal.valueFacts,
    preconditions: evaluation.preconditions,
    boundsAssumptions: evaluation.boundsAssumptions
  };
}

// src/engine/state.ts
function hasNonzeroFact(facts, value) {
  return facts.some((fact) => fact.kind === "nonzero" && fact.value === value);
}
function hasIndexFact(facts, kind, index, array) {
  return facts.some((fact) => fact.kind === kind && fact.index === index && fact.array === array);
}
function addValueFact(facts, candidate) {
  if (!facts.some((fact) => sameValueFact(fact, candidate)))
    facts.push(candidate);
}
function intersectValueFacts(left, right) {
  const intersection = [];
  for (const leftFact of left) {
    for (const rightFact of right) {
      const shared = intersectValueFact(leftFact, rightFact);
      if (shared != null)
        addValueFact(intersection, shared);
    }
  }
  return intersection;
}
function intersectValueFact(left, right) {
  if (sameValueFact(left, right))
    return left;
  if (left.kind === "nonzero" || right.kind === "nonzero")
    return null;
  if (left.index !== right.index || left.array !== right.array)
    return null;
  return { kind: "belowLength", index: left.index, array: left.array };
}
function sameValueFact(left, right) {
  if (left.kind !== right.kind)
    return false;
  if (left.kind === "nonzero" && right.kind === "nonzero")
    return left.value === right.value;
  if (left.kind === "nonzero" || right.kind === "nonzero")
    return false;
  return left.index === right.index && left.array === right.array;
}
function emptySharedState(moduleCount) {
  return Array.from({ length: moduleCount }, () => null);
}
function cloneSharedState(state) {
  return state.slice();
}
function cloneState(state) {
  return {
    values: state.values.slice(),
    shared: cloneSharedState(state.shared),
    valueFacts: state.valueFacts.slice()
  };
}
var mergedStateFields = { values: true, shared: true, valueFacts: true };
function mergeStates(previous, candidate, widen) {
  const values = [];
  const length = Math.max(previous.values.length, candidate.values.length);
  let changed = previous.values.length !== length;
  for (let index = 0;index < length; index++) {
    const previousValue = previous.values[index];
    const candidateValue = candidate.values[index];
    if (previousValue == null) {
      values[index] = candidateValue;
      if (candidateValue != null)
        changed = true;
    } else if (candidateValue == null) {
      values[index] = previousValue;
    } else {
      const joined = joinValues(previousValue, candidateValue);
      const merged = widen ? widenValue(previousValue, joined) : joined;
      values[index] = merged;
      if (!sameValues(previousValue, merged))
        changed = true;
    }
  }
  const shared = [];
  for (let index = 0;index < previous.shared.length; index++) {
    const previousValue = previous.shared[index];
    const candidateValue = candidate.shared[index];
    if (previousValue == null || candidateValue == null) {
      shared.push(null);
      if (previousValue != null)
        changed = true;
    } else {
      const joined = joinValues(previousValue, candidateValue);
      const merged = widen ? widenValue(previousValue, joined) : joined;
      shared.push(merged);
      if (!sameValues(previousValue, merged))
        changed = true;
    }
  }
  const valueFacts = intersectValueFacts(previous.valueFacts, candidate.valueFacts);
  if (valueFacts.length !== previous.valueFacts.length || valueFacts.some((fact) => !previous.valueFacts.some((previousFact) => sameValueFact(fact, previousFact))))
    changed = true;
  const state = {
    values,
    shared,
    valueFacts
  };
  return { state, changed };
}
function joinModuleSlots(left, right) {
  const joined = [];
  for (let index = 0;index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    joined.push(leftValue == null || rightValue == null ? null : joinValues(leftValue, rightValue));
  }
  return joined;
}

// src/engine/transfer.ts
class KindMismatch extends Error {
  value;
  constructor(message, value) {
    super(message);
    this.value = value;
  }
}
function failedRequirement(failure) {
  return { kind: "stop", stop: {
    site: failure.site,
    reason: { kind: "requirementFailure", failure, callee: null }
  } };
}
function value(result) {
  return { kind: "value", value: result };
}
function passthroughValue(result) {
  return { kind: "value", value: result.kind === "number" ? normalizeRefinedNumber(result) : result };
}
function computedNumber(raw, operands, site) {
  return { kind: "value", value: withLossBlame(normalizeRefinedNumber(raw), operands, site) };
}
function withLossBlame(result, operands, site) {
  if (isFiniteNumber(result) && !result.mayBeNaN)
    return result;
  let annotated = result;
  if (!isFiniteNumber(result) && result.nonFiniteSite == null) {
    const carrier = operands.find((operand) => !isFiniteNumber(operand) && operand.nonFiniteSite != null);
    const nonFiniteSite = carrier?.nonFiniteSite ?? (operands.every((operand) => isFiniteNumber(operand)) ? site : undefined);
    if (nonFiniteSite != null)
      annotated = { ...annotated, nonFiniteSite };
  }
  if (result.mayBeNaN && result.nanSite == null) {
    const carrier = operands.find((operand) => operand.mayBeNaN && operand.nanSite != null);
    const nanSite = carrier?.nanSite ?? (operands.every((operand) => !operand.mayBeNaN) ? site : undefined);
    if (nanSite != null)
      annotated = { ...annotated, nanSite };
  }
  return annotated;
}
function evaluateInstruction(instruction, state, context) {
  try {
    return evaluateInstructionKinded(instruction, state, context);
  } catch (error) {
    if (error instanceof KindMismatch) {
      const missingElementSite = possiblyMissingElementReadSite(state, error.value, context.expressionContext.instructionByValue);
      if (missingElementSite != null) {
        return { kind: "stop", stop: { site: missingElementSite, reason: { kind: "possiblyMissingElement" } } };
      }
      return { kind: "stop", stop: { site: instruction.site, reason: { kind: "kindMismatch" } } };
    }
    throw error;
  }
}
function evaluateInstructionKinded(instruction, state, context) {
  switch (instruction.kind) {
    case "constant":
      return passthroughValue(constantNumber(instruction.value));
    case "nullishConstant":
      return value({ kind: "nullish", sentinels: instruction.sentinel });
    case "opaqueConstant":
      return value(instruction.content == null ? { kind: "opaque" } : { kind: "opaque", content: instruction.content });
    case "unknownBoolean":
      return value(unknownBoolean());
    case "arrayLiteral": {
      const elements = instruction.elements.map((id) => requiredValue(state, id));
      if (instruction.form === "tuple")
        return value({ kind: "tuple", elements });
      const element = elements.length === 0 ? null : elements.reduce((joined, next) => joinValues(joined, next));
      return value({ kind: "array", element, length: constantNumber(instruction.elements.length) });
    }
    case "arrayLength": {
      const sequence = requiredSequence(state, instruction.array);
      return passthroughValue(sequence.kind === "tuple" ? constantNumber(sequence.elements.length) : sequence.length);
    }
    case "arrayIndex": {
      const sequence = requiredSequence(state, instruction.array);
      const index = requiredNumberWithFacts(state, instruction.index, context.expressionContext);
      const element = sequence.kind === "tuple" ? tupleElement(sequence, index) : sequence.element;
      const length = sequence.kind === "tuple" ? constantNumber(sequence.elements.length) : sequence.length;
      const indexKey = canonicalValueKey(instruction.index, context.expressionContext);
      const arrayKey = canonicalValueKey(instruction.array, context.expressionContext);
      const assumedValid = hasIndexFact(state.valueFacts, "validIndex", indexKey, arrayKey);
      const inBounds = assumedValid || index.integer && !index.mayBeNaN && index.lower >= 0 && index.upper < length.lower || index.integer && !index.mayBeNaN && index.lower >= 0 && hasIndexFact(state.valueFacts, "belowLength", indexKey, arrayKey);
      const firstPossibleIndex = Math.ceil(Math.max(index.lower, 0));
      const lastPossibleIndex = Math.floor(Math.min(index.upper, length.upper - 1));
      const provablyOut = element == null || firstPossibleIndex > lastPossibleIndex;
      if (provablyOut) {
        if (instruction.mode === "asserted") {
          return failedRequirement({ kind: "elementInBounds", site: instruction.site });
        }
        return value({ kind: "nullish", sentinels: "undefined" });
      }
      if (instruction.mode === "bare" || instruction.mode === "bareUnchecked") {
        return inBounds ? passthroughValue(element) : passthroughValue(joinValues({ kind: "nullish", sentinels: "undefined" }, element));
      }
      if (!inBounds) {
        const indexExpression = numericExpression(instruction.index, context.expressionContext);
        const sequenceExpression = numericExpression(instruction.array, context.expressionContext);
        if (indexExpression != null && sequenceExpression != null) {
          addPrecondition(context.preconditions, {
            kind: "inBounds",
            index: indexExpression,
            sequence: sequenceExpression,
            site: instruction.site
          });
        } else {
          addBoundsAssumption(context.boundsAssumptions, { site: instruction.site, kind: "elementInBounds" });
        }
        writeThroughProducers(state, instruction.index, validIndexNumber(index), context.expressionContext.instructionByValue);
        addValueFact(state.valueFacts, { kind: "validIndex", index: indexKey, array: arrayKey });
      }
      return passthroughValue(element);
    }
    case "numberCheck": {
      const operand = requiredNumberWithFacts(state, instruction.value, context.expressionContext);
      return value(evaluateNumberCheck(instruction.predicate, operand));
    }
    case "tagCheck": {
      const operand = requiredValue(state, instruction.union);
      if (operand.kind === "record")
        return value(unknownBoolean());
      const union = requiredTaggedUnion(state, instruction.union);
      const matches = union.variants.some((variant) => variant.tagValue === instruction.tagValue);
      const misses = union.variants.some((variant) => variant.tagValue !== instruction.tagValue);
      const equals = { kind: "boolean", canBeTrue: matches, canBeFalse: misses };
      return value(instruction.negated ? { kind: "boolean", canBeTrue: equals.canBeFalse, canBeFalse: equals.canBeTrue } : equals);
    }
    case "nullishCheck": {
      const operand = requiredValue(state, instruction.value);
      const opaqueInside = operand.kind === "opaque" || operand.kind === "maybeNullish" && operand.inner.kind === "opaque";
      const canBeSentinel = opaqueInside || (operand.kind === "nullish" || operand.kind === "maybeNullish" ? instruction.sentinel === "nullish" || sentinelsAdmit(operand.sentinels, instruction.sentinel) : false);
      const canMiss = operand.kind === "nullish" ? instruction.sentinel !== "nullish" && operand.sentinels !== instruction.sentinel : true;
      const equals = { kind: "boolean", canBeTrue: canBeSentinel, canBeFalse: canMiss };
      return value(instruction.negated ? { kind: "boolean", canBeTrue: equals.canBeFalse, canBeFalse: equals.canBeTrue } : equals);
    }
    case "booleanConstant":
      return value({
        kind: "boolean",
        canBeTrue: instruction.value,
        canBeFalse: !instruction.value
      });
    case "moduleRead": {
      const slot = state.shared[instruction.binding];
      if (slot === undefined)
        throw new Error(`Unknown module binding ${instruction.binding}`);
      if (slot === null) {
        return { kind: "stop", stop: { site: instruction.site, reason: { kind: "moduleRead", binding: instruction.binding } } };
      }
      return passthroughValue(slot);
    }
    case "moduleWrite": {
      const assigned = requiredValue(state, instruction.value);
      const binding = context.program.moduleBindings[instruction.binding];
      if (binding == null)
        throw new Error(`Unknown module binding ${instruction.binding}`);
      if (binding.category.kind !== "opaque") {
        state.shared[instruction.binding] = assigned;
      }
      return passthroughValue(assigned);
    }
    case "moduleHavoc": {
      const binding = context.program.moduleBindings[instruction.binding];
      if (binding == null)
        throw new Error(`Unknown module binding ${instruction.binding}`);
      const declaredKind = declaredKindOf(binding.category);
      state.shared[instruction.binding] = declaredKind == null ? null : coveringKindValue(declaredKind);
      return value({ kind: "void" });
    }
    case "object": {
      const record = recordValue(instruction.properties.map((property) => ({
        name: property.name,
        value: requiredValue(state, property.value)
      })));
      if (instruction.tag == null)
        return value(record);
      const tagPropertyValue = recordProperty(record, instruction.tag.property);
      const pinned = tagPropertyValue?.kind === "opaque" && tagPropertyValue.content != null ? tagPropertyValue.content : tagPropertyValue?.kind === "boolean" && tagPropertyValue.canBeTrue !== tagPropertyValue.canBeFalse ? tagPropertyValue.canBeTrue : null;
      if (pinned == null)
        return value(record);
      return value({
        kind: "taggedUnion",
        tagProperty: instruction.tag.property,
        variants: [{ tagValue: pinned, record }]
      });
    }
    case "property": {
      const object = requiredValue(state, instruction.object);
      if (object.kind === "taggedUnion") {
        const variantProperty = (variant) => {
          const inVariant = recordProperty(variant.record, instruction.property);
          if (inVariant == null) {
            throw new KindMismatch(`Variant ${variant.tagValue} has no property ${instruction.property}`, instruction.object);
          }
          return inVariant;
        };
        const [firstVariant, ...restVariants] = object.variants;
        let joined = variantProperty(firstVariant);
        for (const variant of restVariants) {
          const next = tryJoinValues(joined, variantProperty(variant));
          if (next == null) {
            throw new KindMismatch(`Property ${instruction.property} mixes kinds across variants`, instruction.object);
          }
          joined = next;
        }
        return passthroughValue(joined);
      }
      const record = requiredRecord(state, instruction.object);
      const propertyValue = recordProperty(record, instruction.property);
      if (propertyValue == null) {
        throw new KindMismatch(`Record has no property ${instruction.property}`, instruction.object);
      }
      return passthroughValue(propertyValue);
    }
    case "compare": {
      const left = requiredValue(state, instruction.left);
      const right = requiredValue(state, instruction.right);
      const same = sameRuntimeValue(instruction.left, instruction.right, context.expressionContext);
      if (left.kind === "boolean" && right.kind === "boolean" && (instruction.operator === "equal" || instruction.operator === "notEqual")) {
        if (same)
          return value(exactBoolean(instruction.operator === "equal"));
        return value(compareBooleans(left, right, instruction.operator === "notEqual"));
      }
      const leftNumber = requiredNumberWithFacts(state, instruction.left, context.expressionContext);
      const rightNumber = requiredNumberWithFacts(state, instruction.right, context.expressionContext);
      if (same) {
        return value(compareSameNumber(intersectSameNumbers(leftNumber, rightNumber), instruction.operator));
      }
      const intervalResult = compareNumbers(leftNumber, rightNumber, instruction.operator);
      return value(intervalResult);
    }
    case "parsedNumber":
      return computedNumber({
        kind: "number",
        lower: Number.NEGATIVE_INFINITY,
        upper: Number.POSITIVE_INFINITY,
        integer: instruction.integer,
        mayBeNaN: true
      }, [], instruction.site);
    case "stringLength":
      return computedNumber({
        kind: "number",
        lower: 0,
        upper: Number.MAX_SAFE_INTEGER,
        integer: true,
        mayBeNaN: false
      }, [], instruction.site);
    case "mathUnary": {
      const operand = requiredNumberWithFacts(state, instruction.value, context.expressionContext);
      return computedNumber(instruction.operator === "sqrt" ? squareRootNumber(operand) : roundedNumber(instruction.operator, operand), [operand], instruction.site);
    }
    case "floor": {
      const operand = requiredNumberWithFacts(state, instruction.value, context.expressionContext);
      return computedNumber(floorNumber(operand), [operand], instruction.site);
    }
    case "platformValue":
      return passthroughValue({
        kind: "number",
        lower: instruction.lower,
        upper: instruction.upper,
        integer: instruction.integer,
        mayBeNaN: false
      });
    case "absolute": {
      const operand = requiredNumberWithFacts(state, instruction.value, context.expressionContext);
      return computedNumber(absoluteNumber(operand), [operand], instruction.site);
    }
    case "not": {
      const operand = requiredBoolean(state, instruction.value);
      return value({ kind: "boolean", canBeTrue: operand.canBeFalse, canBeFalse: operand.canBeTrue });
    }
    case "staticAssert": {
      const observation = staticAssertionObservation(instruction.value, state, context);
      return { kind: "assertion", assertion: instruction.assertion, observation, value: { kind: "void" } };
    }
    case "staticRequire": {
      const failureKind = instruction.purpose === "finiteInput" ? "finiteInput" : "declared";
      const check = context.expressionContext.instructionByValue[instruction.value];
      if (check?.kind !== "compare" && check?.kind !== "numberCheck") {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "unproven" });
      }
      const condition = requiredValue(state, instruction.value);
      if (condition.kind !== "boolean") {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "unproven" });
      }
      if (!condition.canBeTrue) {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "refuted" });
      }
      if (!condition.canBeFalse)
        return value({ kind: "void" });
      const requirement = staticRequirement(check, instruction.site, context.expressionContext, instruction.purpose);
      if (requirement == null) {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "unproven" });
      }
      const constantStatus = constantRequirementStatus(requirement);
      if (constantStatus === false) {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "refuted" });
      }
      if (constantStatus === true)
        return value({ kind: "void" });
      const refined = refineCheck(state, check, true, context.expressionContext);
      if (refined == null) {
        return failedRequirement({ kind: failureKind, site: instruction.site, status: "refuted" });
      }
      state.values = refined.values;
      state.shared = refined.shared;
      state.valueFacts = refined.valueFacts;
      addPrecondition(context.preconditions, requirement);
      return value({ kind: "void" });
    }
    case "minimum": {
      const operands = instruction.values.map((id) => requiredNumberWithFacts(state, id, context.expressionContext));
      return computedNumber(minimumNumbers(operands), operands, instruction.site);
    }
    case "maximum": {
      const operands = instruction.values.map((id) => requiredNumberWithFacts(state, id, context.expressionContext));
      return computedNumber(maximumNumbers(operands), operands, instruction.site);
    }
    case "call": {
      const callee = context.program.functions[instruction.function];
      if (callee == null)
        throw new Error(`Unknown function ${instruction.function}`);
      if (callee.kind === "unsupported") {
        return { kind: "stop", stop: { site: instruction.site, reason: { kind: "calleeStopped", callee: instruction.function } } };
      }
      if (context.callStack.includes(instruction.function)) {
        return { kind: "stop", stop: { site: instruction.site, reason: { kind: "recursion", callee: instruction.function } } };
      }
      const arguments_ = instruction.arguments.map((id) => requiredValue(state, id));
      const argumentExpressions = instruction.arguments.map((id) => numericExpression(id, context.expressionContext));
      const argumentKeys = instruction.arguments.map((id) => canonicalValueKey(id, context.expressionContext));
      const calleeNamespace = `${context.expressionContext.identityNamespace}call:${instruction.function}:${instruction.site}/`;
      const evaluation = context.evaluateFunction(instruction.function, arguments_, argumentExpressions, state.shared, context.callStack, state.valueFacts, argumentKeys, calleeNamespace);
      const completed = completedEvaluation(evaluation);
      if (completed == null) {
        if (evaluation.stops.length === 0 && evaluation.normal == null) {
          for (const precondition of evaluation.preconditions)
            addPrecondition(context.preconditions, precondition);
          for (const assumption of evaluation.boundsAssumptions)
            addBoundsAssumption(context.boundsAssumptions, assumption);
          return { kind: "ends" };
        }
        const requirementFailure = evaluation.stops.find((stop) => stop.reason.kind === "requirementFailure");
        if (requirementFailure?.reason.kind === "requirementFailure") {
          const reason = requirementFailure.reason;
          return { kind: "stop", stop: {
            site: instruction.site,
            reason: { ...reason, callee: instruction.function }
          } };
        }
        return { kind: "stop", stop: { site: instruction.site, reason: { kind: "calleeStopped", callee: instruction.function } } };
      }
      state.shared = completed.sharedState;
      state.valueFacts = completed.valueFacts.filter((fact) => !valueFactUsesNamespace(fact, calleeNamespace));
      for (let index = 0;index < callee.parameters.length; index++) {
        refineFiniteCallArgument(state, instruction.arguments[index], callee.parameters[index].type, context.expressionContext);
      }
      for (const precondition of completed.preconditions)
        addPrecondition(context.preconditions, precondition);
      for (const assumption of completed.boundsAssumptions)
        addBoundsAssumption(context.boundsAssumptions, assumption);
      return passthroughValue(completed.returnValue);
    }
    case "crossCall": {
      for (const id of instruction.arguments)
        requiredValue(state, id);
      return passthroughValue(coveringKindValue(instruction.returnKind));
    }
    case "binary": {
      const left = requiredNumberWithFacts(state, instruction.left, context.expressionContext);
      const right = requiredNumberWithFacts(state, instruction.right, context.expressionContext);
      const sameOperand = sameRuntimeValue(instruction.left, instruction.right, context.expressionContext) ? intersectSameNumbers(left, right) : null;
      if ((instruction.operator === "divide" || instruction.operator === "remainder") && isDefinitelyZero(right)) {
        return failedRequirement({
          kind: "nonzeroDivisor",
          site: instruction.site,
          operation: instruction.operator === "divide" ? "division" : "remainder"
        });
      }
      if ((instruction.operator === "divide" || instruction.operator === "remainder") && includesZero(right)) {
        const operation = instruction.operator === "divide" ? "division" : "remainder";
        const expression = numericExpression(instruction.right, context.expressionContext);
        if (expression == null) {
          addBoundsAssumption(context.boundsAssumptions, { site: instruction.site, kind: "nonzeroDivisor" });
        } else {
          addPrecondition(context.preconditions, peelNonzero(expression, instruction.site, operation));
        }
        recordNonzeroValueFact(state, instruction.right, context.expressionContext);
        writeThroughProducers(state, instruction.right, excludePointFrom(right, constantNumber(0)), context.expressionContext.instructionByValue);
        return computedNumber(sameOperand == null ? instruction.operator === "divide" ? divideNumbersNonzeroDivisor(left, right) : remainderNumbers(left, right, true) : evaluateSameOperandBinary(instruction.operator, sameOperand), [left, right], instruction.site);
      }
      return computedNumber(sameOperand == null ? evaluateBinary(instruction.operator, left, right) : evaluateSameOperandBinary(instruction.operator, sameOperand), [left, right], instruction.site);
    }
  }
}
function addBoundsAssumption(assumptions, candidate) {
  if (!assumptions.some((assumption) => assumption.site === candidate.site && assumption.kind === candidate.kind)) {
    assumptions.push(candidate);
  }
}
function valueFactUsesNamespace(fact, namespace) {
  const marker = `v:${namespace}`;
  if (fact.kind === "nonzero")
    return fact.value.includes(marker);
  return fact.index.includes(marker) || fact.array.includes(marker);
}
function sentinelsAdmit(sentinels, sentinel) {
  return sentinels === "both" || sentinels === sentinel;
}
function withoutSentinel(sentinels, sentinel) {
  if (sentinels === "both")
    return sentinel === "null" ? "undefined" : "null";
  return sentinels === sentinel ? null : sentinels;
}
function requiredTaggedUnion(state, id) {
  const operand = requiredValue(state, id);
  if (operand.kind !== "taggedUnion")
    throw new KindMismatch(`IR value ${id} is not a tagged union`, id);
  return operand;
}
function refineTagCheck(state, check, truth, producers) {
  const result = cloneState(state);
  if (requiredValue(result, check.union).kind === "record")
    return result;
  const union = requiredTaggedUnion(result, check.union);
  const wantMatch = truth !== check.negated;
  const [firstKept, ...restKept] = union.variants.filter((variant) => variant.tagValue === check.tagValue === wantMatch);
  if (firstKept == null)
    return null;
  writeThroughProducers(result, check.union, { kind: "taggedUnion", tagProperty: union.tagProperty, variants: [firstKept, ...restKept] }, producers);
  return result;
}
function refineNullishCheck(state, check, truth, producers) {
  const result = cloneState(state);
  const operand = requiredValue(result, check.value);
  const isSentinel = truth !== check.negated;
  const refined = refineForSentinel(operand, check.sentinel, isSentinel);
  if (refined == null)
    return null;
  writeThroughProducers(result, check.value, refined, producers);
  return result;
}
function refineForSentinel(operand, sentinel, isSentinel) {
  if (isSentinel) {
    if (operand.kind === "nullish") {
      if (sentinel === "nullish")
        return operand;
      return sentinelsAdmit(operand.sentinels, sentinel) ? { kind: "nullish", sentinels: sentinel } : null;
    }
    if (operand.kind === "maybeNullish") {
      const opaqueInner = operand.inner.kind === "opaque";
      if (sentinel === "nullish") {
        return { kind: "nullish", sentinels: opaqueInner ? "both" : operand.sentinels };
      }
      return sentinelsAdmit(operand.sentinels, sentinel) || opaqueInner ? { kind: "nullish", sentinels: sentinel } : null;
    }
    if (operand.kind === "opaque") {
      return { kind: "nullish", sentinels: sentinel === "nullish" ? "both" : sentinel };
    }
    return null;
  }
  if (operand.kind === "nullish") {
    if (sentinel === "nullish")
      return null;
    const remaining = withoutSentinel(operand.sentinels, sentinel);
    return remaining == null ? null : { kind: "nullish", sentinels: remaining };
  }
  if (operand.kind === "maybeNullish") {
    if (sentinel === "nullish")
      return operand.inner;
    const remaining = withoutSentinel(operand.sentinels, sentinel);
    return remaining == null ? operand.inner : { kind: "maybeNullish", inner: operand.inner, sentinels: remaining };
  }
  return operand;
}
function writeThroughProducers(state, id, refined, producers) {
  const current = state.values[id];
  const met = current == null ? refined : meetValues(current, refined);
  state.values[id] = met;
  const producer = producers[id];
  if (producer?.kind === "property") {
    const parent = state.values[producer.object];
    if (parent?.kind === "record") {
      const rebuilt = {
        kind: "record",
        properties: parent.properties.map((property) => property.name === producer.property ? { name: property.name, value: meetValues(property.value, met) } : property)
      };
      writeThroughProducers(state, producer.object, rebuilt, producers);
    }
    if (parent?.kind === "taggedUnion") {
      const rebuildVariant = (variant) => {
        const existing = recordProperty(variant.record, producer.property);
        if (existing == null)
          return variant;
        return {
          tagValue: variant.tagValue,
          record: {
            kind: "record",
            properties: variant.record.properties.map((property) => property.name === producer.property ? { name: property.name, value: meetValues(property.value, met) } : property)
          }
        };
      };
      const [firstVariant, ...restVariants] = parent.variants;
      const rebuilt = {
        kind: "taggedUnion",
        tagProperty: parent.tagProperty,
        variants: [rebuildVariant(firstVariant), ...restVariants.map(rebuildVariant)]
      };
      writeThroughProducers(state, producer.object, rebuilt, producers);
    }
    const parentProducer = producers[producer.object];
    if (parentProducer?.kind === "object") {
      const source = parentProducer.properties.find((property) => property.name === producer.property);
      if (source != null)
        writeThroughProducers(state, source.value, met, producers);
    }
    return;
  }
  if (producer?.kind === "arrayLength" && met.kind === "number") {
    const parent = state.values[producer.array];
    if (parent?.kind !== "array")
      return;
    const length = meetValues(parent.length, met);
    if (length.kind !== "number")
      return;
    writeThroughProducers(state, producer.array, { kind: "array", element: parent.element, length }, producers);
  }
}
function refineFiniteCallArgument(state, value2, declared, expressionContext) {
  const current = requiredValue(state, value2);
  const refined = refineFiniteValue(current, declared);
  if (refined == null)
    return;
  if (refined !== current) {
    writeThroughProducers(state, value2, refined, expressionContext.instructionByValue);
  }
  if (declared.kind !== "record")
    return;
  const producer = expressionContext.instructionByValue[resolveStoredValue(value2, expressionContext)];
  if (producer?.kind !== "object")
    return;
  const declaredProperties = new Map(declared.properties.map((property) => [property.name, property.declared]));
  for (const field of producer.properties) {
    const fieldKind = declaredProperties.get(field.name);
    if (fieldKind != null)
      refineFiniteCallArgument(state, field.value, fieldKind, expressionContext);
  }
}
function refineFiniteValue(value2, declared) {
  if (declared.kind === "number") {
    if (declared.interval != null)
      return value2;
    if (value2.kind !== "number")
      return null;
    return !value2.mayBeNaN && isFiniteNumber(value2) ? value2 : finiteNumberPart(value2);
  }
  if (declared.kind !== "record")
    return value2;
  if (value2.kind === "record")
    return refineFiniteRecord(value2, declared);
  if (value2.kind !== "taggedUnion")
    return null;
  let changed = false;
  const variants = [];
  for (const variant of value2.variants) {
    const record = refineFiniteRecord(variant.record, declared);
    if (record == null)
      return null;
    changed ||= record !== variant.record;
    variants.push(record === variant.record ? variant : { ...variant, record });
  }
  if (!changed)
    return value2;
  const [first, ...rest] = variants;
  return { ...value2, variants: [first, ...rest] };
}
function refineFiniteRecord(value2, declared) {
  const declaredProperties = new Map(declared.properties.map((property) => [property.name, property.declared]));
  let changed = false;
  const properties = [];
  for (const property of value2.properties) {
    const fieldKind = declaredProperties.get(property.name);
    if (fieldKind == null) {
      properties.push(property);
      continue;
    }
    const refined = refineFiniteValue(property.value, fieldKind);
    if (refined == null)
      return null;
    changed ||= refined !== property.value;
    properties.push(refined === property.value ? property : { ...property, value: refined });
  }
  return changed ? { kind: "record", properties } : value2;
}
function meetValues(current, refined) {
  if (current === refined)
    return current;
  switch (refined.kind) {
    case "number": {
      if (current.kind !== "number")
        return refined;
      let met = normalizeRefinedNumber({
        kind: "number",
        lower: Math.max(current.lower, refined.lower),
        upper: Math.min(current.upper, refined.upper),
        integer: current.integer || refined.integer,
        mayBeNaN: current.mayBeNaN && refined.mayBeNaN
      });
      const excludedPoint = refined.excludesPoint ?? current.excludesPoint;
      if (excludedPoint != null)
        met = normalizeRefinedNumber({ ...met, excludesPoint: excludedPoint });
      if (!isFiniteNumber(met)) {
        const nonFiniteSite = refined.nonFiniteSite ?? current.nonFiniteSite;
        if (nonFiniteSite != null)
          met.nonFiniteSite = nonFiniteSite;
      }
      if (met.mayBeNaN) {
        const nanSite = refined.nanSite ?? current.nanSite;
        if (nanSite != null)
          met.nanSite = nanSite;
      }
      return met;
    }
    case "record": {
      if (current.kind !== "record")
        return refined;
      const currentProperties = recordPropertiesByName(current);
      return {
        kind: "record",
        properties: refined.properties.map((property) => {
          const existing = currentProperties.get(property.name);
          return existing == null ? property : { name: property.name, value: meetValues(existing, property.value) };
        })
      };
    }
    case "array": {
      if (current.kind !== "array")
        return refined;
      const length = meetValues(current.length, refined.length);
      const element = current.element == null ? refined.element : refined.element == null ? current.element : meetValues(current.element, refined.element);
      return { kind: "array", element, length: length.kind === "number" ? length : refined.length };
    }
    case "tuple": {
      if (current.kind !== "tuple" || current.elements.length !== refined.elements.length)
        return refined;
      return { kind: "tuple", elements: refined.elements.map((element, index) => meetValues(current.elements[index], element)) };
    }
    case "boolean":
    case "void":
    case "nullish":
    case "maybeNullish":
    case "opaque":
    case "taggedUnion":
      return refined;
  }
}
function evaluateNumberCheck(predicate, operand) {
  const finite = finiteNumberPart(operand);
  if (predicate === "nan") {
    return { kind: "boolean", canBeTrue: operand.mayBeNaN, canBeFalse: true };
  }
  if (predicate === "finite") {
    return {
      kind: "boolean",
      canBeTrue: finite != null,
      canBeFalse: operand.mayBeNaN || !isFiniteNumber(operand)
    };
  }
  return {
    kind: "boolean",
    canBeTrue: finite != null && Math.ceil(finite.lower) <= Math.floor(finite.upper),
    canBeFalse: !operand.integer || operand.mayBeNaN || !isFiniteNumber(operand)
  };
}
function refineNumberCheck(state, check, truth, producers) {
  const result = cloneState(state);
  const operand = requiredNumber(result, check.value);
  if (check.predicate === "nan") {
    if (truth)
      return operand.mayBeNaN ? result : null;
    const laundered = { ...operand, mayBeNaN: false };
    writeThroughProducers(result, check.value, laundered, producers);
    return result;
  }
  if (truth) {
    let refined = finiteNumberPart(operand);
    if (refined == null)
      return null;
    if (check.predicate === "integer") {
      refined = { ...refined, integer: true, lower: Math.ceil(refined.lower), upper: Math.floor(refined.upper) };
    }
    if (refined.lower > refined.upper)
      return null;
    writeThroughProducers(result, check.value, refined, producers);
    return result;
  }
  if (check.predicate === "finite" && !operand.mayBeNaN && isFiniteNumber(operand))
    return null;
  return result;
}
function refineComparison(state, comparison, truth, expressionContext) {
  const producers = expressionContext.instructionByValue;
  const result = cloneState(state);
  const leftOperand = requiredValue(result, comparison.left);
  const rightOperand = requiredValue(result, comparison.right);
  if (leftOperand.kind === "boolean" && rightOperand.kind === "boolean") {
    const equalHolds = truth === (comparison.operator === "equal");
    const known = (side) => side.canBeTrue === side.canBeFalse ? null : side.canBeTrue;
    const refineTo = (id, mustBe) => {
      const current = requiredBoolean(result, id);
      if (mustBe ? !current.canBeTrue : !current.canBeFalse)
        return false;
      writeThroughProducers(result, id, { kind: "boolean", canBeTrue: mustBe, canBeFalse: !mustBe }, producers);
      return true;
    };
    const leftKnown = known(leftOperand);
    const rightKnown = known(rightOperand);
    if (rightKnown != null && !refineTo(comparison.left, equalHolds ? rightKnown : !rightKnown))
      return null;
    if (leftKnown != null && !refineTo(comparison.right, equalHolds ? leftKnown : !leftKnown))
      return null;
    return result;
  }
  const left = requiredNumberWithFacts(result, comparison.left, expressionContext);
  const right = requiredNumberWithFacts(result, comparison.right, expressionContext);
  const operator = truth ? comparison.operator : invertedComparison(comparison.operator);
  if (!truth && operator !== "equal" && (left.mayBeNaN || right.mayBeNaN))
    return result;
  let refinedLeft = left;
  let refinedRight = right;
  switch (operator) {
    case "lessThan":
      refinedLeft = withBounds(left, left.lower, strictUpper(right.upper, left.integer));
      refinedRight = withBounds(right, strictLower(left.lower, right.integer), right.upper);
      break;
    case "lessThanOrEqual":
      refinedLeft = withBounds(left, left.lower, Math.min(left.upper, right.upper));
      refinedRight = withBounds(right, Math.max(right.lower, left.lower), right.upper);
      break;
    case "greaterThan":
      refinedLeft = withBounds(left, strictLower(right.lower, left.integer), left.upper);
      refinedRight = withBounds(right, right.lower, strictUpper(left.upper, right.integer));
      break;
    case "greaterThanOrEqual":
      refinedLeft = withBounds(left, Math.max(left.lower, right.lower), left.upper);
      refinedRight = withBounds(right, right.lower, Math.min(right.upper, left.upper));
      break;
    case "equal": {
      const intersection = intersectSameNumbers(left, right);
      refinedLeft = intersection;
      refinedRight = intersection;
      break;
    }
    case "notEqual": {
      refinedLeft = excludePointFrom(left, right);
      refinedRight = excludePointFrom(right, left);
      break;
    }
  }
  if (operator === "lessThan") {
    const rightProducer = producers[comparison.right];
    if (rightProducer?.kind === "arrayLength") {
      addValueFact(result.valueFacts, {
        kind: "belowLength",
        index: canonicalValueKey(comparison.left, expressionContext),
        array: canonicalValueKey(rightProducer.array, expressionContext)
      });
    }
  }
  if (operator === "greaterThan") {
    const leftProducer = producers[comparison.left];
    if (leftProducer?.kind === "arrayLength") {
      addValueFact(result.valueFacts, {
        kind: "belowLength",
        index: canonicalValueKey(comparison.right, expressionContext),
        array: canonicalValueKey(leftProducer.array, expressionContext)
      });
    }
  }
  const emptied = refinedLeft.lower > refinedLeft.upper || refinedRight.lower > refinedRight.upper;
  const holdsForNaN = operator === "notEqual";
  if (emptied) {
    if ((!truth || holdsForNaN) && (left.mayBeNaN || right.mayBeNaN))
      return cloneState(state);
    return null;
  }
  if (truth && !holdsForNaN) {
    refinedLeft = { ...refinedLeft, mayBeNaN: false };
    refinedRight = { ...refinedRight, mayBeNaN: false };
  }
  writeThroughProducers(result, comparison.left, refinedLeft, producers);
  writeThroughProducers(result, comparison.right, refinedRight, producers);
  recordNonzeroComparisonFacts(result, comparison, expressionContext);
  return result;
}
var refinableCheckKinds = ["compare", "nullishCheck", "numberCheck", "tagCheck"];
function asRefinableCheck(instruction) {
  if (instruction == null)
    return;
  return refinableCheckKinds.includes(instruction.kind) ? instruction : undefined;
}
function refineCheck(state, check, truth, expressionContext) {
  switch (check.kind) {
    case "compare":
      return refineComparison(state, check, truth, expressionContext);
    case "nullishCheck":
      return refineNullishCheck(state, check, truth, expressionContext.instructionByValue);
    case "numberCheck":
      return refineNumberCheck(state, check, truth, expressionContext.instructionByValue);
    case "tagCheck":
      return refineTagCheck(state, check, truth, expressionContext.instructionByValue);
  }
}
function requiredNumber(state, id) {
  const value2 = requiredValue(state, id);
  if (value2.kind !== "number")
    throw new KindMismatch(`IR value ${id} is not a number`, id);
  return value2;
}
function requiredNumberWithFacts(state, id, expressionContext) {
  const result = numberWithFacts(state, id, expressionContext);
  if (result == null)
    throw new KindMismatch(`IR value ${id} is not a number`, id);
  return result;
}
function numberWithFacts(state, id, expressionContext) {
  const held = state.values[id];
  if (held?.kind !== "number")
    return null;
  let result = held;
  const key = canonicalValueKey(id, expressionContext);
  if (state.valueFacts.some((fact) => fact.kind === "validIndex" && fact.index === key)) {
    result = validIndexNumber(result);
  }
  if (hasNonzeroFact(state.valueFacts, key))
    result = excludePointFrom(result, constantNumber(0));
  return result;
}
function validIndexNumber(value2) {
  return {
    ...value2,
    integer: true,
    mayBeNaN: false,
    lower: Math.ceil(Math.max(value2.lower, 0)),
    upper: Math.floor(value2.upper)
  };
}
function recordNonzeroComparisonFacts(state, check, expressionContext) {
  for (const id of [check.left, check.right]) {
    if (expressionContext.instructionByValue[id]?.kind === "constant")
      continue;
    const held = requiredValue(state, id);
    if (held.kind === "number" && !includesZero(held))
      recordNonzeroValueFact(state, id, expressionContext);
  }
}
function recordNonzeroValueFact(state, value2, expressionContext) {
  addValueFact(state.valueFacts, { kind: "nonzero", value: canonicalValueKey(value2, expressionContext) });
}
function requiredBoolean(state, id) {
  const value2 = requiredValue(state, id);
  if (value2.kind !== "boolean")
    throw new KindMismatch(`IR value ${id} is not a boolean`, id);
  return value2;
}
function branchConditionOutcome(state, id, site, expressionContext) {
  try {
    return { kind: "value", value: requiredBoolean(state, id) };
  } catch (error) {
    if (error instanceof KindMismatch) {
      const missingElementSite = possiblyMissingElementReadSite(state, id, expressionContext.instructionByValue);
      if (missingElementSite != null) {
        return { kind: "stop", stop: { site: missingElementSite, reason: { kind: "possiblyMissingElement" } } };
      }
      return { kind: "stop", stop: { site, reason: { kind: "kindMismatch" } } };
    }
    throw error;
  }
}
function possiblyMissingElementReadSite(state, valueID, producers) {
  const producer = producers[valueID];
  if (producer?.kind !== "arrayIndex" || producer.mode !== "bareUnchecked")
    return null;
  const value2 = state.values[valueID];
  if (value2 == null)
    return null;
  const canBeUndefined = (value2.kind === "nullish" || value2.kind === "maybeNullish") && value2.sentinels !== "null";
  return canBeUndefined ? producer.site : null;
}
function tupleElement(tuple, index) {
  if (tuple.elements.length === 0)
    return null;
  if (index.integer && !index.mayBeNaN && index.lower === index.upper) {
    const exact = tuple.elements[index.lower];
    if (exact != null)
      return exact;
  }
  return tuple.elements.reduce((joined, next) => joinValues(joined, next));
}
function requiredSequence(state, id) {
  const value2 = requiredValue(state, id);
  if (value2.kind !== "tuple" && value2.kind !== "array")
    throw new KindMismatch(`IR value ${id} is not an array`, id);
  return value2;
}
function requiredRecord(state, id) {
  const value2 = requiredValue(state, id);
  if (value2.kind !== "record")
    throw new KindMismatch(`IR value ${id} is not a record`, id);
  return value2;
}
function requiredValue(state, id) {
  const value2 = state.values[id];
  if (value2 == null)
    throw new Error(`Missing IR value ${id}`);
  return value2;
}
function evaluateBinary(operator, left, right) {
  switch (operator) {
    case "add":
      return addNumbers(left, right);
    case "subtract":
      return subtractNumbers(left, right);
    case "multiply":
      return multiplyNumbers(left, right);
    case "divide":
      return divideNumbers(left, right);
    case "remainder":
      return remainderNumbers(left, right, false);
  }
}
function intersectSameNumbers(left, right) {
  const met = meetValues(left, right);
  if (met.kind !== "number")
    throw new Error("Meeting two numbers produced a non-number");
  return met;
}
function evaluateSameOperandBinary(operator, operand) {
  switch (operator) {
    case "add": {
      const doubled = addNumbers(operand, operand);
      return { ...doubled, mayBeNaN: operand.mayBeNaN };
    }
    case "subtract":
      return {
        kind: "number",
        lower: 0,
        upper: 0,
        integer: true,
        mayBeNaN: operand.mayBeNaN || !isFiniteNumber(operand)
      };
    case "multiply": {
      const lowerSquare = operand.lower * operand.lower;
      const upperSquare = operand.upper * operand.upper;
      const crossesZero = operand.lower <= 0 && operand.upper >= 0;
      return {
        kind: "number",
        lower: crossesZero ? operand.integer && operand.excludesPoint === 0 ? 1 : 0 : Math.min(lowerSquare, upperSquare),
        upper: Math.max(lowerSquare, upperSquare),
        integer: operand.integer,
        mayBeNaN: operand.mayBeNaN
      };
    }
    case "divide":
      return {
        kind: "number",
        lower: 1,
        upper: 1,
        integer: true,
        mayBeNaN: operand.mayBeNaN || !isFiniteNumber(operand)
      };
    case "remainder":
      return {
        kind: "number",
        lower: 0,
        upper: 0,
        integer: true,
        mayBeNaN: operand.mayBeNaN || !isFiniteNumber(operand)
      };
  }
}
function staticAssertionObservation(valueID, state, context) {
  const held = requiredValue(state, valueID);
  if (held.kind !== "boolean")
    return unknownBoolean();
  if (!held.canBeTrue || !held.canBeFalse)
    return held;
  const producer = context.expressionContext.instructionByValue[valueID];
  if (producer?.kind === "not") {
    const operand = staticAssertionObservation(producer.value, state, context);
    return { kind: "boolean", canBeTrue: operand.canBeFalse, canBeFalse: operand.canBeTrue };
  }
  if (producer?.kind !== "compare")
    return held;
  const left = numberWithFacts(state, producer.left, context.expressionContext);
  const right = numberWithFacts(state, producer.right, context.expressionContext);
  if (left == null || right == null)
    return held;
  return comparisonLocalProof(left, right, producer, state, context) ?? held;
}
function comparisonLocalProof(left, right, instruction, state, context) {
  if (left.mayBeNaN || right.mayBeNaN)
    return null;
  const proof = createComparisonProof(state, context.expressionContext);
  switch (instruction.operator) {
    case "lessThan": {
      if (proof.strictlyBelow(instruction.left, instruction.right))
        return exactBoolean(true);
      return proof.atMost(instruction.right, instruction.left) ? exactBoolean(false) : null;
    }
    case "lessThanOrEqual": {
      if (proof.atMost(instruction.left, instruction.right))
        return exactBoolean(true);
      return proof.strictlyBelow(instruction.right, instruction.left) ? exactBoolean(false) : null;
    }
    case "greaterThan": {
      if (proof.strictlyBelow(instruction.right, instruction.left))
        return exactBoolean(true);
      return proof.atMost(instruction.left, instruction.right) ? exactBoolean(false) : null;
    }
    case "greaterThanOrEqual": {
      if (proof.atMost(instruction.right, instruction.left))
        return exactBoolean(true);
      return proof.strictlyBelow(instruction.left, instruction.right) ? exactBoolean(false) : null;
    }
    case "equal": {
      return proof.strictlyBelow(instruction.left, instruction.right) || proof.strictlyBelow(instruction.right, instruction.left) ? exactBoolean(false) : null;
    }
    case "notEqual": {
      return proof.strictlyBelow(instruction.left, instruction.right) || proof.strictlyBelow(instruction.right, instruction.left) ? exactBoolean(true) : null;
    }
  }
}
function createComparisonProof(state, context) {
  const atMostMemo = new Map;
  const heldNumber = (value2) => {
    return numberWithFacts(state, resolveStoredValue(value2, context), context);
  };
  const same = (left, right) => sameRuntimeValue(left, right, context);
  const nonnegative = (value2) => {
    const held = heldNumber(value2);
    return held != null && held.lower >= 0 && !held.mayBeNaN;
  };
  const atMost = (rawLeft, rawRight) => {
    const left = resolveStoredValue(rawLeft, context);
    const right = resolveStoredValue(rawRight, context);
    if (same(left, right))
      return true;
    const leftNumber = heldNumber(left);
    const rightNumber = heldNumber(right);
    if (leftNumber != null && rightNumber != null && !leftNumber.mayBeNaN && !rightNumber.mayBeNaN && leftNumber.upper <= rightNumber.lower)
      return true;
    const key = `${left}:${right}`;
    const cached = atMostMemo.get(key);
    if (cached != null)
      return cached;
    atMostMemo.set(key, false);
    const leftProducer = context.instructionByValue[left];
    const rightProducer = context.instructionByValue[right];
    let answer = false;
    if (leftProducer?.kind === "minimum") {
      answer = leftProducer.values.some((operand) => same(operand, right));
    }
    if (!answer && rightProducer?.kind === "maximum") {
      answer = rightProducer.values.some((operand) => same(left, operand));
    }
    if (leftProducer?.kind === "minimum" && rightProducer?.kind === "minimum" && leftProducer.values.length === rightProducer.values.length) {
      answer = leftProducer.values.every((operand, index) => atMost(operand, rightProducer.values[index]));
    }
    if (!answer && leftProducer?.kind === "binary" && leftProducer.operator === "subtract" && nonnegative(leftProducer.right)) {
      answer = atMost(leftProducer.left, right);
    }
    if (!answer && rightProducer?.kind === "binary" && rightProducer.operator === "add") {
      if (nonnegative(rightProducer.right))
        answer = atMost(left, rightProducer.left);
      if (!answer && nonnegative(rightProducer.left))
        answer = atMost(left, rightProducer.right);
    }
    if (!answer && leftProducer?.kind === "binary" && leftProducer.operator === "multiply" && rightProducer?.kind === "binary" && rightProducer.operator === "multiply") {
      const leftForms = [[leftProducer.left, leftProducer.right], [leftProducer.right, leftProducer.left]];
      const rightForms = [[rightProducer.left, rightProducer.right], [rightProducer.right, rightProducer.left]];
      for (const [leftBase, leftFactor] of leftForms) {
        for (const [rightBase, rightFactor] of rightForms) {
          if (same(leftFactor, rightFactor) && nonnegative(leftFactor) && atMost(leftBase, rightBase))
            answer = true;
        }
      }
    }
    if (!answer && leftProducer?.kind === "maximum" && rightProducer?.kind === "minimum") {
      atMostMemo.set(key, false);
      return false;
    }
    if (!answer && leftProducer?.kind === "maximum") {
      answer = leftProducer.values.every((operand) => atMost(operand, right));
    }
    if (!answer && rightProducer?.kind === "maximum") {
      answer = rightProducer.values.some((operand) => atMost(left, operand));
    }
    if (!answer && leftProducer?.kind === "minimum") {
      answer = leftProducer.values.some((operand) => atMost(operand, right));
    }
    if (!answer && rightProducer?.kind === "minimum") {
      answer = rightProducer.values.every((operand) => atMost(left, operand));
    }
    atMostMemo.set(key, answer);
    return answer;
  };
  const strictlyBelow = (rawLeft, rawRight) => {
    const left = resolveStoredValue(rawLeft, context);
    const right = resolveStoredValue(rawRight, context);
    const leftNumber = heldNumber(left);
    const rightNumber = heldNumber(right);
    if (leftNumber != null && rightNumber != null && !leftNumber.mayBeNaN && !rightNumber.mayBeNaN && leftNumber.upper < rightNumber.lower)
      return true;
    const producer = context.instructionByValue[left];
    if (producer?.kind !== "binary" || producer.operator !== "remainder" || !same(producer.right, right))
      return false;
    const divisor = heldNumber(producer.right);
    return divisor != null && !divisor.mayBeNaN && divisor.lower > 0;
  };
  return { same, atMost, strictlyBelow };
}
function compareNumbers(left, right, operator) {
  if (left.mayBeNaN || right.mayBeNaN)
    return unknownBoolean();
  switch (operator) {
    case "lessThan":
      return booleanRange(left.upper < right.lower, left.lower >= right.upper);
    case "lessThanOrEqual":
      return booleanRange(left.upper <= right.lower, left.lower > right.upper);
    case "greaterThan":
      return compareNumbers(right, left, "lessThan");
    case "greaterThanOrEqual":
      return compareNumbers(right, left, "lessThanOrEqual");
    case "equal": {
      const definitelyEqual = left.lower === left.upper && right.lower === right.upper && left.lower === right.lower;
      const definitelyDifferent = left.upper < right.lower || right.upper < left.lower || left.lower === left.upper && pointExcluded(right, left.lower) || right.lower === right.upper && pointExcluded(left, right.lower);
      return booleanRange(definitelyEqual, definitelyDifferent);
    }
    case "notEqual": {
      const equal = compareNumbers(left, right, "equal");
      return { kind: "boolean", canBeTrue: equal.canBeFalse, canBeFalse: equal.canBeTrue };
    }
  }
}
function compareSameNumber(operand, operator) {
  switch (operator) {
    case "lessThan":
    case "greaterThan":
      return exactBoolean(false);
    case "equal":
    case "lessThanOrEqual":
    case "greaterThanOrEqual":
      return operand.mayBeNaN ? unknownBoolean() : exactBoolean(true);
    case "notEqual":
      return operand.mayBeNaN ? unknownBoolean() : exactBoolean(false);
  }
}
function exactBoolean(answer) {
  return { kind: "boolean", canBeTrue: answer, canBeFalse: !answer };
}
function compareBooleans(left, right, negated) {
  const leftKnown = left.canBeTrue !== left.canBeFalse;
  const rightKnown = right.canBeTrue !== right.canBeFalse;
  const definitelyEqual = leftKnown && rightKnown && left.canBeTrue === right.canBeTrue;
  const definitelyDifferent = leftKnown && rightKnown && left.canBeTrue !== right.canBeTrue;
  const equals = booleanRange(definitelyEqual, definitelyDifferent);
  return negated ? { kind: "boolean", canBeTrue: equals.canBeFalse, canBeFalse: equals.canBeTrue } : equals;
}
function booleanRange(definitelyTrue, definitelyFalse) {
  return {
    kind: "boolean",
    canBeTrue: !definitelyFalse,
    canBeFalse: !definitelyTrue
  };
}
function invertedComparison(operator) {
  switch (operator) {
    case "lessThan":
      return "greaterThanOrEqual";
    case "lessThanOrEqual":
      return "greaterThan";
    case "greaterThan":
      return "lessThanOrEqual";
    case "greaterThanOrEqual":
      return "lessThan";
    case "equal":
      return "notEqual";
    case "notEqual":
      return "equal";
  }
}
function excludePointFrom(value2, other) {
  if (other.lower !== other.upper || other.mayBeNaN)
    return value2;
  const point = other.lower;
  let refined = value2;
  if (refined.lower === point)
    refined = { ...refined, lower: strictLower(point, refined.integer) };
  if (refined.upper === point)
    refined = { ...refined, upper: strictUpper(point, refined.integer) };
  if (refined.lower < point && point < refined.upper)
    refined = { ...refined, excludesPoint: point };
  return refined;
}
function withBounds(value2, lower, upper) {
  let refinedLower = Math.max(value2.lower, lower);
  let refinedUpper = Math.min(value2.upper, upper);
  if (value2.integer) {
    refinedLower = Math.ceil(refinedLower);
    refinedUpper = Math.floor(refinedUpper);
  }
  return normalizeRefinedNumber({ ...value2, lower: refinedLower, upper: refinedUpper });
}
function normalizeRefinedNumber(value2) {
  let lower = value2.lower;
  let upper = value2.upper;
  const integer = value2.integer || lower === upper && Number.isInteger(lower);
  const { excludesPoint, ...rest } = value2;
  if (excludesPoint != null) {
    if (lower === excludesPoint)
      lower = strictLower(excludesPoint, integer);
    if (upper === excludesPoint)
      upper = strictUpper(excludesPoint, integer);
  }
  const normalized = { ...rest, lower, upper, integer };
  if (excludesPoint != null && lower < excludesPoint && excludesPoint < upper) {
    normalized.excludesPoint = excludesPoint;
  }
  return normalized;
}
function strictLower(value2, integer) {
  return integer ? Math.floor(value2) + 1 : nextUp(value2);
}
function strictUpper(value2, integer) {
  return integer ? Math.ceil(value2) - 1 : nextDown(value2);
}

// src/engine/analyze.ts
var maximumLoopHeaderUpdates = 16;
function analyzeProgram(program) {
  const initializerState = emptySharedState(program.moduleBindings.length);
  for (let binding = 0;binding < program.moduleBindings.length; binding++) {
    const category = program.moduleBindings[binding].category;
    if (category.kind === "importedConstant") {
      initializerState[binding] = constantNumber(category.value);
    }
  }
  const initializer = runEvaluation(program.initializer, null, [], [], initializerState, program, [], { identityNamespace: "module/" });
  const moduleValues = publishedModuleValues(program, initializer.run, initializer.evaluation);
  const functionEntrySharedState = seedModuleSlots(program, moduleValues);
  const moduleReads = transitiveModuleBindings(functionUsage(program));
  const initializerBounds = initializer.evaluation.boundsAssumptions;
  const functions = [];
  for (let functionID = 0;functionID < program.functions.length; functionID++) {
    const fn = program.functions[functionID];
    if (fn.kind === "unsupported") {
      functions.push({ kind: "notLowered", lowering: fn });
      continue;
    }
    const arguments_ = [];
    const argumentExpressions = [];
    const sharedState = cloneSharedState(functionEntrySharedState);
    for (let index = 0;index < fn.parameters.length; index++) {
      const parameter = fn.parameters[index];
      arguments_.push(declaredKindValue(parameter.type));
      argumentExpressions.push({ kind: "parameter", index });
    }
    const { evaluation } = runEvaluation(fn, functionID, arguments_, argumentExpressions, sharedState, program, [], {
      boundsAssumptions: moduleReads[functionID].size > 0 ? initializerBounds : [],
      identityNamespace: `function:${functionID}/`
    });
    functions.push(publishedAnalysis(fn, evaluation));
  }
  return {
    functions,
    initializer: publishedAnalysis(program.initializer, initializer.evaluation),
    moduleValues
  };
}
function publishedAnalysis(fn, evaluation) {
  const completed = completedEvaluation(evaluation);
  if (completed != null) {
    return {
      kind: "analyzed",
      lowering: fn,
      preconditions: publishedPreconditions(fn, completed.preconditions),
      boundsAssumptions: completed.boundsAssumptions,
      returnValue: completed.returnValue,
      assertions: evaluation.assertions
    };
  }
  const [firstStop, ...laterStops] = evaluation.stops;
  if (firstStop == null && evaluation.normal == null) {
    return {
      kind: "analyzed",
      lowering: fn,
      preconditions: publishedPreconditions(fn, evaluation.preconditions),
      boundsAssumptions: evaluation.boundsAssumptions,
      returnValue: { kind: "void" },
      assertions: evaluation.assertions
    };
  }
  if (firstStop == null)
    throw new Error(`Function ${fn.name} has no reachable return`);
  return {
    kind: "partial",
    lowering: fn,
    stops: [firstStop, ...laterStops],
    observedReturn: evaluation.normal == null ? null : { value: evaluation.normal.returnValue },
    observedNeeds: evaluation.preconditions,
    observedBoundsAssumptions: evaluation.boundsAssumptions,
    assertions: evaluation.assertions
  };
}
function publishedPreconditions(fn, evaluated) {
  const preconditions = [];
  for (const input of finiteInputs(fn)) {
    preconditions.push({
      kind: "declaredNumberCheck",
      predicate: "finite",
      expression: finiteInputExpression(input),
      site: input.site,
      purpose: "finiteInput"
    });
  }
  const expressionContext = createExpressionContext(fn, fn.parameters.map((_, index) => ({ kind: "parameter", index })));
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      if (instruction.kind !== "staticRequire" || instruction.purpose === "finiteInput")
        continue;
      const requirement = staticRequirement(expressionContext.instructionByValue[instruction.value], instruction.site, expressionContext);
      if (requirement != null && constantRequirementStatus(requirement) == null) {
        addPrecondition(preconditions, requirement);
      }
    }
  }
  for (const precondition of evaluated)
    addPrecondition(preconditions, precondition);
  return preconditions;
}
function seedModuleSlots(program, moduleValues) {
  return program.moduleBindings.map((binding, index) => {
    const published = moduleValues[index];
    if (published != null)
      return published;
    if (binding.category.kind === "importedConstant") {
      return constantNumber(binding.category.value);
    }
    const declaredKind = declaredKindOf(binding.category);
    if (declaredKind == null)
      return null;
    return declaredKindValue(declaredKind);
  });
}
function publishedModuleValues(program, run, evaluation) {
  const fn = program.initializer;
  const end = evaluation.normal == null ? run.moduleEnd : run.moduleEnd == null ? evaluation.normal.sharedState : joinModuleSlots(run.moduleEnd, evaluation.normal.sharedState);
  const demoted = new Set;
  const successors = blockSuccessors(fn);
  const stoppingBlocks = [];
  for (let blockID = 0;blockID < fn.blocks.length; blockID++) {
    const stopIndex = run.blocks[blockID].stopIndex;
    if (stopIndex == null)
      continue;
    stoppingBlocks.push(blockID);
    const instructions = fn.blocks[blockID].instructions;
    for (let index = stopIndex;index < instructions.length; index++) {
      const instruction = instructions[index];
      if (instruction.kind === "moduleWrite")
        demoted.add(instruction.binding);
    }
  }
  const reachedAfterStops = reachableAfter(successors, stoppingBlocks);
  for (let target = 0;target < fn.blocks.length; target++) {
    if (reachedAfterStops[target] !== true)
      continue;
    for (const instruction of fn.blocks[target].instructions) {
      if (instruction.kind === "moduleWrite")
        demoted.add(instruction.binding);
    }
  }
  const fullyAnalyzed = evaluation.stops.length === 0 && program.initializerSkips.length === 0 && program.functions.every((lowered) => lowered.kind === "lowered");
  return program.moduleBindings.map((binding, index) => {
    if (binding.category.kind !== "value" || demoted.has(index))
      return null;
    if (holdsMutableStructure(binding.category.declaredKind) && !fullyAnalyzed)
      return null;
    const slot = end?.[index];
    return slot ?? null;
  });
}
function runEvaluation(fn, functionID, arguments_, argumentExpressions, sharedState, program, callStack, seed = {}) {
  if (arguments_.length !== fn.parameters.length)
    throw new Error(`Expected ${fn.parameters.length} arguments for ${fn.name}`);
  if (argumentExpressions.length !== fn.parameters.length)
    throw new Error(`Expected ${fn.parameters.length} argument expressions for ${fn.name}`);
  const initial = {
    values: [],
    shared: cloneSharedState(sharedState),
    valueFacts: seed.valueFacts?.slice() ?? []
  };
  for (let index = 0;index < fn.parameters.length; index++) {
    initial.values[fn.parameters[index].value] = arguments_[index];
  }
  const expressionContext = createExpressionContext(fn, argumentExpressions, seed.parameterIdentityKeys, seed.identityNamespace ?? fn.name);
  const preconditions = [];
  const boundsAssumptions = [...seed.boundsAssumptions ?? []];
  const successors = blockSuccessors(fn);
  const run = {
    fn,
    blocks: fn.blocks.map(() => ({ incoming: null, stopIndex: null, failedHeader: false, pendingReturn: null })),
    queue: [fn.entry],
    stops: [],
    assertionObservations: [],
    moduleEnd: null
  };
  run.blocks[fn.entry].incoming = { state: initial, updateCount: 0 };
  const transferContext = {
    program,
    callStack: functionID == null ? callStack : [...callStack, functionID],
    expressionContext,
    preconditions,
    boundsAssumptions,
    evaluateFunction: (callee, values, expressions, calleeState, stack, valueFacts, parameterIdentityKeys, identityNamespace) => {
      const calleeFn = program.functions[callee];
      if (calleeFn == null)
        throw new Error(`Unknown function ${callee}`);
      if (calleeFn.kind !== "lowered")
        throw new Error(`Analysis reached unlowered function ${calleeFn.name}`);
      return runEvaluation(calleeFn, callee, values, expressions, calleeState, program, stack, { valueFacts, parameterIdentityKeys, identityNamespace }).evaluation;
    }
  };
  let queueIndex = 0;
  while (queueIndex < run.queue.length) {
    const blockID = run.queue[queueIndex++];
    const block = fn.blocks[blockID];
    const entry = run.blocks[blockID]?.incoming;
    if (block == null || entry == null)
      throw new Error(`Missing block ${blockID} in ${fn.name}`);
    const state = cloneState(entry.state);
    let stopped = false;
    instructionLoop:
      for (let index = 0;index < block.instructions.length; index++) {
        const instruction = block.instructions[index];
        const result = evaluateInstruction(instruction, state, transferContext);
        switch (result.kind) {
          case "ends":
            run.blocks[blockID].pendingReturn = null;
            stopped = true;
            break instructionLoop;
          case "stop":
            addStop(run, blockID, result.stop, state.shared.slice(), index);
            run.blocks[blockID].pendingReturn = null;
            stopped = true;
            break instructionLoop;
          case "assertion":
            addAssertionObservation(run, result.assertion, result.observation);
            state.values[instruction.result] = result.value;
            break;
          case "value":
            state.values[instruction.result] = result.value;
            break;
        }
      }
    if (stopped)
      continue;
    switch (block.terminator.kind) {
      case "return": {
        const value2 = block.terminator.value == null ? { kind: "void" } : requiredValue(state, block.terminator.value);
        run.blocks[blockID].pendingReturn = {
          value: value2,
          shared: cloneSharedState(state.shared),
          valueFacts: state.valueFacts.slice()
        };
        break;
      }
      case "thrown":
        break;
      case "stop": {
        addStop(run, blockID, { site: block.terminator.site, reason: { kind: "unsupportedCode", reason: block.terminator.reason } }, state.shared.slice(), block.instructions.length);
        break;
      }
      case "jump": {
        propagate(state, blockID, block.terminator.target, run);
        break;
      }
      case "branch": {
        const conditionOutcome = branchConditionOutcome(state, block.terminator.condition, block.terminator.site, expressionContext);
        if (conditionOutcome.kind === "stop") {
          addStop(run, blockID, conditionOutcome.stop, state.shared.slice(), block.instructions.length);
          run.blocks[blockID].pendingReturn = null;
          break;
        }
        const condition = conditionOutcome.value;
        const check = asRefinableCheck(expressionContext.instructionByValue[block.terminator.condition]);
        if (condition.canBeTrue) {
          const branch = check != null ? refineCheck(state, check, true, expressionContext) : condition.canBeFalse ? cloneState(state) : state;
          if (branch != null)
            propagate(branch, blockID, block.terminator.whenTrue, run);
        }
        if (condition.canBeFalse) {
          const branch = check != null ? refineCheck(state, check, false, expressionContext) : state;
          if (branch != null)
            propagate(branch, blockID, block.terminator.whenFalse, run);
        }
        break;
      }
    }
  }
  const suppressed = [];
  if (run.stops.length > 0) {
    const predecessors = reverseEdges(successors);
    for (let headerID = 0;headerID < fn.blocks.length; headerID++) {
      if (fn.blocks[headerID].loopHeader == null)
        continue;
      const header = run.blocks[headerID];
      const reachedFromHeader = header.failedHeader ? undefined : reachableFrom(successors, headerID);
      if (reachedFromHeader != null) {
        const returnsToHeader = reachableFrom(predecessors, headerID);
        for (let stopBlock = 0;stopBlock < run.blocks.length; stopBlock++) {
          if (run.blocks[stopBlock].stopIndex == null || reachedFromHeader[stopBlock] !== true)
            continue;
          if (returnsToHeader[stopBlock] === true) {
            header.failedHeader = true;
            break;
          }
        }
      }
      if (!header.failedHeader)
        continue;
      const reached = reachedFromHeader ?? reachableFrom(successors, headerID);
      for (let block = 0;block < fn.blocks.length; block++) {
        if (reached[block] === true)
          suppressed[block] = true;
      }
    }
  }
  let normal = null;
  for (let blockID = 0;blockID < fn.blocks.length; blockID++) {
    const pending = run.blocks[blockID].pendingReturn;
    if (pending == null || suppressed[blockID] === true)
      continue;
    if (normal == null) {
      normal = { returnValue: pending.value, sharedState: pending.shared, valueFacts: pending.valueFacts };
      continue;
    }
    normal = {
      returnValue: joinValues(normal.returnValue, pending.value),
      sharedState: joinModuleSlots(normal.sharedState, pending.shared),
      valueFacts: intersectValueFacts(normal.valueFacts, pending.valueFacts)
    };
  }
  if (normal == null && run.stops.length === 0) {
    const predecessors = reverseEdges(successors);
    for (let headerID = 0;headerID < fn.blocks.length; headerID++) {
      const header = fn.blocks[headerID];
      const entry_ = run.blocks[headerID].incoming;
      if (header.loopHeader == null || entry_ == null)
        continue;
      const downstream = reachableFrom(successors, headerID);
      const returnsToHeader = reachableFrom(predecessors, headerID);
      let visitedDownstream = false;
      let stuckInCycle = true;
      for (let block = 0;block < fn.blocks.length; block++) {
        if (downstream[block] !== true || run.blocks[block].incoming == null)
          continue;
        visitedDownstream = true;
        if (returnsToHeader[block] !== true) {
          stuckInCycle = false;
          break;
        }
      }
      if (visitedDownstream && stuckInCycle) {
        addStop(run, headerID, { site: header.loopHeader, reason: { kind: "nonExitingLoop" } }, entry_.state.shared.slice(), 0);
      }
    }
  }
  return {
    evaluation: {
      normal,
      preconditions,
      boundsAssumptions,
      assertions: classifyAssertions(run, run.stops.length === 0 && boundsAssumptions.length === 0),
      stops: run.stops
    },
    run
  };
}
function requiredAssertion(run, assertionIndex) {
  const assertion = run.fn.assertions[assertionIndex];
  if (assertion == null) {
    throw new Error(`Unknown assertion ${assertionIndex} in ${run.fn.name}`);
  }
  return assertion;
}
function addAssertionObservation(run, assertionIndex, observation) {
  requiredAssertion(run, assertionIndex);
  if (!observation.canBeTrue && !observation.canBeFalse) {
    throw new Error(`Assertion ${assertionIndex} in ${run.fn.name} has no possible boolean value`);
  }
  const aggregate = run.assertionObservations[assertionIndex] ?? {
    sawDefinitelyTrue: false,
    sawDefinitelyFalse: false,
    sawMaybeFalse: false
  };
  if (!observation.canBeTrue)
    aggregate.sawDefinitelyFalse = true;
  else if (observation.canBeFalse)
    aggregate.sawMaybeFalse = true;
  else
    aggregate.sawDefinitelyTrue = true;
  run.assertionObservations[assertionIndex] = aggregate;
}
function classifyAssertions(run, proofComplete) {
  return run.fn.assertions.map((assertion, assertionIndex) => {
    const observation = run.assertionObservations[assertionIndex];
    const verdict = observation?.sawDefinitelyFalse === true ? "refuted" : observation?.sawMaybeFalse === true ? "unproven" : !proofComplete ? "blocked" : observation?.sawDefinitelyTrue === true ? "proven" : "dead";
    return { site: assertion.site, text: assertion.text, verdict };
  });
}
function addStop(run, blockID, stop, moduleCapture, instructionIndex) {
  const block = run.blocks[blockID];
  if (block.stopIndex == null || instructionIndex < block.stopIndex) {
    block.stopIndex = instructionIndex;
  }
  run.moduleEnd = run.moduleEnd == null ? moduleCapture : joinModuleSlots(run.moduleEnd, moduleCapture);
  if (run.stops.some((existing) => existing.site === stop.site))
    return;
  run.stops.push(stop);
}
function propagate(state, sourceBlock, edge, run) {
  const target = run.fn.blocks[edge.block];
  if (target == null)
    throw new Error(`Missing block ${edge.block} in ${run.fn.name}`);
  if (edge.arguments.length !== target.parameters.length) {
    throw new Error(`Expected ${target.parameters.length} arguments for block ${edge.block} in ${run.fn.name}`);
  }
  const argumentValues = edge.arguments.map((argument) => requiredValue(state, argument));
  const candidate = state;
  for (let index = 0;index < target.parameters.length; index++) {
    candidate.values[target.parameters[index]] = argumentValues[index];
  }
  const previous = run.blocks[edge.block].incoming;
  if (previous == null) {
    run.blocks[edge.block].incoming = { state: candidate, updateCount: 0 };
    run.queue.push(edge.block);
    return;
  }
  const update = mergeStates(previous.state, candidate, target.loopHeader != null && previous.updateCount >= 1);
  if (update.changed) {
    if (target.loopHeader != null && previous.updateCount >= maximumLoopHeaderUpdates) {
      addStop(run, sourceBlock, { site: target.loopHeader, reason: { kind: "loopLimit", updates: maximumLoopHeaderUpdates } }, state.shared.slice(), 0);
      run.blocks[edge.block].failedHeader = true;
      return;
    }
    run.blocks[edge.block].incoming = { state: update.state, updateCount: previous.updateCount + 1 };
    run.queue.push(edge.block);
  }
}
function blockSuccessors(fn) {
  return fn.blocks.map((block) => {
    switch (block.terminator.kind) {
      case "return":
        return [];
      case "stop":
        return [];
      case "thrown":
        return [];
      case "jump":
        return [block.terminator.target.block];
      case "branch":
        return [block.terminator.whenTrue.block, block.terminator.whenFalse.block];
    }
  });
}
function reverseEdges(successors) {
  const predecessors = successors.map(() => []);
  for (let source = 0;source < successors.length; source++) {
    for (const target of successors[source])
      predecessors[target].push(source);
  }
  return predecessors;
}
function reachableAfter(successors, starts) {
  const reached = [];
  const queue = [];
  for (const start of starts)
    queue.push(...successors[start]);
  let index = 0;
  while (index < queue.length) {
    const block = queue[index++];
    if (reached[block] === true)
      continue;
    reached[block] = true;
    queue.push(...successors[block]);
  }
  return reached;
}
function reachableFrom(successors, start) {
  return reachableAfter(successors, [start]);
}

// src/lower/program.ts
import * as ts8 from "typescript";

// src/lower/accept.ts
import * as ts from "typescript";

// src/lower/context.ts
function createFunctionContext(sourceFile, checker, functionsBySymbol, moduleBindingsBySymbol, sites, staticAnnotations = [], crossFile = null) {
  const entry = { loopHeader: null, parameters: [], instructions: [], terminator: null };
  return {
    sourceFile,
    checker,
    functionsBySymbol,
    moduleBindingsBySymbol,
    staticAnnotations: new Map(staticAnnotations.map((annotation) => [annotation.call, annotation])),
    crossFile,
    sites,
    nextValue: 0,
    currentBlock: entry,
    blocks: [entry],
    bindings: new Map,
    parameters: [],
    assertions: [],
    loops: []
  };
}
function snapshotLowering(context) {
  return {
    block: context.currentBlock,
    instructionCount: context.currentBlock.instructions.length,
    blockCount: context.blocks.length,
    bindings: new Map(context.bindings),
    assertionCount: context.assertions.length,
    loopCount: context.loops.length
  };
}
function restoreLowering(context, snapshot) {
  context.blocks.length = snapshot.blockCount;
  snapshot.block.instructions.length = snapshot.instructionCount;
  snapshot.block.terminator = null;
  context.currentBlock = snapshot.block;
  context.bindings = snapshot.bindings;
  context.assertions.length = snapshot.assertionCount;
  context.loops.length = snapshot.loopCount;
}
function addSite(context, node) {
  context.sites.push(nodeSpan(context.sourceFile, node));
  return context.sites.length - 1;
}
function addInstruction(context, node, instruction) {
  const site = addSite(context, node);
  return addInstructionAtSite(context, site, instruction);
}
function addInstructionAtSite(context, site, instruction) {
  const result = context.nextValue++;
  context.currentBlock.instructions.push({ ...instruction, result, site });
  return result;
}
function createBlock(context, parameterCount = 0, loopHeader = null) {
  const parameters = [];
  for (let index = 0;index < parameterCount; index++)
    parameters.push(context.nextValue++);
  const block = { loopHeader, parameters, instructions: [], terminator: null };
  context.blocks.push(block);
  return context.blocks.length - 1;
}
function sealBlocks(blocks, name) {
  return blocks.map((block) => {
    if (block.terminator == null)
      throw new Error(`Lowering left an unterminated block in ${name}`);
    return {
      loopHeader: block.loopHeader,
      parameters: block.parameters,
      instructions: block.instructions,
      terminator: block.terminator
    };
  });
}
function terminate(block, terminator) {
  if (block.terminator != null)
    throw new Error("IR block already has a terminator");
  block.terminator = terminator;
}
function requiredSymbol(node, checker) {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol == null)
    throw unsupported(node, { kind: "missingSymbol" });
  return symbol;
}
function changedBindings(before, branches) {
  const changed = [];
  for (const [symbol, value2] of before) {
    if (branches.some((branch) => requiredBranchBinding(symbol, branch) !== value2))
      changed.push(symbol);
  }
  return changed;
}
function mergeAtContinuation(exits, bindingsBefore, statement, context) {
  const changed = changedBindings(bindingsBefore, exits.map((exit) => exit.bindings));
  const continuation = createBlock(context, changed.length);
  for (const exit of exits) {
    terminate(exit.block, {
      kind: "jump",
      target: { block: continuation, arguments: changed.map((symbol) => requiredBranchBinding(symbol, exit.bindings)) },
      site: addSite(context, statement)
    });
  }
  context.currentBlock = context.blocks[continuation];
  context.bindings = new Map(bindingsBefore);
  for (let index = 0;index < changed.length; index++) {
    context.bindings.set(changed[index], context.currentBlock.parameters[index]);
  }
}
function bindingsVisibleAfterBranch(before, branch) {
  const visible = new Map(before);
  for (const symbol of before.keys())
    visible.set(symbol, requiredBranchBinding(symbol, branch));
  return visible;
}
function requiredBranchBinding(symbol, bindings) {
  const value2 = bindings.get(symbol);
  if (value2 == null)
    throw new Error(`Missing binding ${symbol.name} after branch`);
  return value2;
}

class LoweringStop extends Error {
  node;
  reason;
  constructor(node, reason) {
    super(`Lowering stopped: ${reason.kind}`);
    this.node = node;
    this.reason = reason;
  }
}
function unsupported(node, reason) {
  return new LoweringStop(node, reason);
}

// src/lower/accept.ts
function assertAccepted(root) {
  const visit = (node) => {
    if (ts.isTypeNode(node))
      return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      visitJsxValues(node);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isPropertyAccessExpression(node.left)) {
      throw unsupported(node, { kind: "propertyWrite" });
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) && ts.isPropertyAccessExpression(node.operand)) {
      throw unsupported(node, { kind: "propertyWrite" });
    }
    if (ts.isVariableDeclarationList(node) && (node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) {
      throw unsupported(node, { kind: "varDeclaration" });
    }
    ts.forEachChild(node, visit);
  };
  const visitJsxValues = (jsx) => {
    if (ts.isJsxExpression(jsx)) {
      if (jsx.expression != null)
        visit(jsx.expression);
      return;
    }
    ts.forEachChild(jsx, visitJsxValues);
  };
  visit(root);
}
var lineSuppression = /^\/\/\/?\s*@(ts-expect-error|ts-ignore)/;
var blockSuppression = /^(?:\/|\*)*\s*@(ts-expect-error|ts-ignore)/;
var noCheck = /^\/\/\/?\s*@ts-nocheck/;
function typeCheckSuppressionMention(sourceFile) {
  const text = sourceFile.text;
  const matchRanges = (ranges, includeNoCheck) => {
    for (const range of ranges ?? []) {
      const comment = text.slice(range.pos, range.end);
      const lastLine = comment.slice(Math.max(comment.lastIndexOf(`
`), comment.lastIndexOf("\r")) + 1);
      if (lineSuppression.test(comment) || blockSuppression.test(lastLine) || includeNoCheck && noCheck.test(comment)) {
        return { start: range.pos, end: range.end };
      }
    }
    return null;
  };
  const firstStatement = sourceFile.statements[0];
  const topLevel = matchRanges(ts.getLeadingCommentRanges(text, firstStatement?.getFullStart() ?? 0), true);
  if (topLevel != null)
    return topLevel;
  let found = null;
  const visit = (node) => {
    if (found != null)
      return;
    found = matchRanges(ts.getLeadingCommentRanges(text, node.getFullStart()), false);
    if (found == null)
      ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
function evalMention(sourceFile) {
  let found = null;
  const visit = (node) => {
    if (found != null)
      return;
    if (ts.isIdentifier(node) && node.text === "eval") {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// src/lower/expression.ts
import * as ts4 from "typescript";

// src/lower/platform.ts
import * as ts2 from "typescript";
var anyFinite = { lower: -Number.MAX_VALUE, upper: Number.MAX_VALUE };
var catalog = [
  { path: ["document", "documentElement", "clientWidth"], call: false, fact: { lower: 0, upper: Number.MAX_VALUE, integer: true } },
  { path: ["document", "documentElement", "clientHeight"], call: false, fact: { lower: 0, upper: Number.MAX_VALUE, integer: true } },
  { path: ["window", "innerWidth"], call: false, fact: { lower: 0, upper: Number.MAX_VALUE, integer: false } },
  { path: ["window", "innerHeight"], call: false, fact: { lower: 0, upper: Number.MAX_VALUE, integer: false } },
  { path: ["window", "scrollX"], call: false, fact: { ...anyFinite, integer: false } },
  { path: ["window", "scrollY"], call: false, fact: { ...anyFinite, integer: false } },
  { path: ["document", "body", "scrollTop"], call: false, fact: { ...anyFinite, integer: false } },
  { path: ["document", "body", "scrollLeft"], call: false, fact: { ...anyFinite, integer: false } },
  { path: ["performance", "now"], call: true, fact: { lower: 0, upper: Number.MAX_VALUE, integer: false } },
  { path: ["Date", "now"], call: true, fact: { lower: 0, upper: Number.MAX_VALUE, integer: true } }
];
function platformFact(expression, call, checker) {
  const parts = [];
  let current = expression;
  while (ts2.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts2.isIdentifier(current))
    return null;
  parts.unshift(current.text);
  const entry = catalog.find((candidate) => candidate.call === call && candidate.path.length === parts.length && candidate.path.every((segment, index) => segment === parts[index]));
  if (entry == null)
    return null;
  if (!declaredOnlyInDeclarationFiles(checker.getSymbolAtLocation(current)))
    return null;
  return entry.fact;
}
function declaredOnlyInDeclarationFiles(symbol) {
  const declarations = symbol?.declarations;
  if (declarations == null || declarations.length === 0)
    return false;
  return declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

// src/lower/literals.ts
import * as ts3 from "typescript";
function numericLiteralValue(expression) {
  const current = unwrapLiteral(expression);
  if (ts3.isNumericLiteral(current))
    return Number(current.text);
  if (ts3.isPrefixUnaryExpression(current) && (current.operator === ts3.SyntaxKind.PlusToken || current.operator === ts3.SyntaxKind.MinusToken)) {
    const operand = unwrapLiteral(current.operand);
    if (!ts3.isNumericLiteral(operand))
      return null;
    return Number(operand.text) * (current.operator === ts3.SyntaxKind.MinusToken ? -1 : 1);
  }
  return null;
}
function parameterDefaultLiteral(initializer, checker) {
  const current = unwrapLiteral(initializer);
  const number = numericLiteralValue(current);
  if (number != null)
    return Number.isFinite(number) ? { kind: "number", value: number } : null;
  if (current.kind === ts3.SyntaxKind.TrueKeyword || current.kind === ts3.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: current.kind === ts3.SyntaxKind.TrueKeyword };
  }
  if (ts3.isStringLiteral(current) || ts3.isNoSubstitutionTemplateLiteral(current)) {
    return { kind: "opaque", content: current.text };
  }
  if (current.kind === ts3.SyntaxKind.NullKeyword)
    return { kind: "nullish", sentinel: "null" };
  if (isUndefinedGlobal(current, checker)) {
    return { kind: "nullish", sentinel: "undefined" };
  }
  return null;
}
function isUndefinedGlobal(expression, checker) {
  if (!ts3.isIdentifier(expression) || expression.text !== "undefined")
    return false;
  const symbol = checker.getSymbolAtLocation(expression);
  const global = checker.resolveName("undefined", undefined, ts3.SymbolFlags.Value, false);
  return symbol != null && symbol === global;
}
function parameterDefaultFits(default_, declared) {
  if (declared.kind === "nullish") {
    if (default_.kind === "nullish") {
      return default_.sentinel === "null" ? declared.sentinels === "null" || declared.sentinels === "both" : declared.sentinels === "undefined" || declared.sentinels === "both";
    }
    return parameterDefaultFits(default_, declared.inner);
  }
  switch (declared.kind) {
    case "number": {
      if (default_.kind !== "number")
        return false;
      return declared.interval == null || default_.value >= declared.interval.lower && default_.value <= declared.interval.upper && (!declared.interval.integer || Number.isInteger(default_.value));
    }
    case "boolean":
      return default_.kind === "boolean";
    case "opaque":
      return default_.kind === "opaque";
    case "record":
    case "tuple":
    case "array":
    case "taggedUnion":
      return false;
  }
}
function unwrapLiteral(expression) {
  let current = expression;
  while (ts3.isParenthesizedExpression(current) || ts3.isAsExpression(current) || ts3.isTypeAssertionExpression(current))
    current = current.expression;
  return current;
}

// src/lower/expression.ts
function lowerStatementExpression(expression, context) {
  const current = unwrap(expression, context.checker);
  const assignment = identifierAssignment(current);
  if (assignment != null) {
    const symbol = requiredSymbol(assignment.target, context.checker);
    switch (assignment.form) {
      case "assign": {
        const moduleBinding = context.moduleBindingsBySymbol.get(symbol);
        if (!context.bindings.has(symbol) && moduleBinding == null) {
          throw unsupported(assignment.target, { kind: "unknownIdentifier", name: assignment.target.text });
        }
        const targetType = context.checker.getTypeAtLocation(assignment.target);
        const targetKind = valueKind(targetType, context.checker);
        if (targetKind == null) {
          throw unsupported(assignment.target, { kind: "valueType", typeText: context.checker.typeToString(targetType) });
        }
        const value2 = lowerExpression(assignment.node.right, context);
        const stored = targetKind === "opaque" ? addInstruction(context, current, { kind: "opaqueConstant" }) : value2;
        assignIdentifier(symbol, assignment.target, stored, current, context);
        return;
      }
      case "logical": {
        const currentValue = identifierValue(symbol, assignment.target, context);
        const targetType = context.checker.getTypeAtLocation(assignment.target);
        let condition;
        if (assignment.logical === "nullish") {
          condition = addInstruction(context, current, { kind: "nullishCheck", value: currentValue, sentinel: "nullish", negated: true });
        } else {
          const targetKind = valueKind(targetType, context.checker);
          if (targetKind !== "boolean") {
            throw unsupported(assignment.target, {
              kind: "nonBooleanCondition",
              conditionKind: targetKind === "number" ? "number" : "other",
              typeText: context.checker.typeToString(targetType)
            });
          }
          condition = currentValue;
        }
        const keepOnTrue = assignment.logical !== "and";
        const rebound = lowerValueBranch(current, condition, keepOnTrue ? () => currentValue : () => lowerExpression(assignment.node.right, context), keepOnTrue ? () => lowerExpression(assignment.node.right, context) : () => currentValue, context);
        assignIdentifier(symbol, assignment.target, rebound, current, context);
        return;
      }
      case "compound": {
        if (assignment.operator === "add" && (context.checker.getTypeAtLocation(current).flags & ts4.TypeFlags.StringLike) !== 0) {
          lowerExpression(assignment.node.right, context);
          const concatenated = addInstruction(context, current, { kind: "opaqueConstant" });
          assignIdentifier(symbol, assignment.target, concatenated, current, context);
          return;
        }
        requireNumberType(assignment.target, context.checker);
        requireNumberType(assignment.node.right, context.checker);
        const left = identifierValue(symbol, assignment.target, context);
        const right = lowerExpression(assignment.node.right, context);
        const value2 = addInstruction(context, current, { kind: "binary", operator: assignment.operator, left, right });
        assignIdentifier(symbol, assignment.target, value2, current, context);
        return;
      }
      case "update": {
        const previous = identifierValue(symbol, assignment.target, context);
        const one = addInstruction(context, current, { kind: "constant", value: 1 });
        const value2 = addInstruction(context, current, {
          kind: "binary",
          operator: assignment.node.operator === ts4.SyntaxKind.PlusPlusToken ? "add" : "subtract",
          left: previous,
          right: one
        });
        assignIdentifier(symbol, assignment.target, value2, current, context);
        return;
      }
    }
  }
  lowerExpression(expression, context);
}
function lowerExpression(expression, context) {
  const current = unwrap(expression, context.checker);
  if (ts4.isNumericLiteral(current)) {
    return addInstruction(context, current, { kind: "constant", value: Number(current.text) });
  }
  if (current.kind === ts4.SyntaxKind.TrueKeyword || current.kind === ts4.SyntaxKind.FalseKeyword) {
    return addInstruction(context, current, { kind: "booleanConstant", value: current.kind === ts4.SyntaxKind.TrueKeyword });
  }
  if (ts4.isPrefixUnaryExpression(current) && current.operator === ts4.SyntaxKind.PlusToken) {
    const positive = unwrap(current.operand, context.checker);
    if (ts4.isNumericLiteral(positive)) {
      return addInstruction(context, current, { kind: "constant", value: Number(positive.text) });
    }
    throw unsupported(current, { kind: "expressionForm", syntax: ts4.SyntaxKind[current.kind] });
  }
  if (ts4.isPrefixUnaryExpression(current) && current.operator === ts4.SyntaxKind.MinusToken) {
    const negated = unwrap(current.operand, context.checker);
    if (ts4.isNumericLiteral(negated)) {
      return addInstruction(context, current, { kind: "constant", value: -Number(negated.text) });
    }
    if (isGlobalInfinity(negated, context.checker)) {
      return addInstruction(context, current, { kind: "constant", value: Number.NEGATIVE_INFINITY });
    }
    const zero = addInstruction(context, current, { kind: "constant", value: 0 });
    const value2 = lowerExpression(current.operand, context);
    return addInstruction(context, current, { kind: "binary", operator: "subtract", left: zero, right: value2 });
  }
  if (ts4.isPrefixUnaryExpression(current) && current.operator === ts4.SyntaxKind.ExclamationToken) {
    requireBooleanCondition(current.operand, context.checker);
    const value2 = lowerExpression(current.operand, context);
    return addInstruction(context, current, { kind: "not", value: value2 });
  }
  if (ts4.isConditionalExpression(current)) {
    return lowerConditionalExpression(current, context);
  }
  if (ts4.isIdentifier(current)) {
    return identifierValue(requiredSymbol(current, context.checker), current, context);
  }
  if (ts4.isArrayLiteralExpression(current)) {
    const literalType = context.checker.getTypeAtLocation(current);
    const literalKind = valueKind(literalType, context.checker);
    if (literalKind !== "array" && literalKind !== "tuple" && current.elements.length > 0) {
      throw unsupported(current, { kind: "valueType", typeText: context.checker.typeToString(literalType) });
    }
    const elements = [];
    for (const element of current.elements) {
      if (ts4.isSpreadElement(element) || ts4.isOmittedExpression(element)) {
        throw unsupported(element, { kind: "expressionForm", syntax: ts4.SyntaxKind[element.kind] });
      }
      elements.push(lowerExpression(element, context));
    }
    return addInstruction(context, current, { kind: "arrayLiteral", elements, form: literalKind === "tuple" ? "tuple" : "array" });
  }
  if (ts4.isNonNullExpression(current) && ts4.isElementAccessExpression(current.expression)) {
    return lowerElementAccess(current.expression, true, context);
  }
  if (ts4.isElementAccessExpression(current)) {
    return lowerElementAccess(current, false, context);
  }
  if (ts4.isObjectLiteralExpression(current)) {
    const properties = new Map;
    for (const property of current.properties) {
      if (ts4.isShorthandPropertyAssignment(property)) {
        const symbol = context.checker.getShorthandAssignmentValueSymbol(property);
        if (symbol == null)
          throw unsupported(property, { kind: "missingSymbol" });
        properties.set(property.name.text, {
          name: property.name.text,
          value: identifierValue(symbol, property.name, context)
        });
        continue;
      }
      if (ts4.isPropertyAssignment(property)) {
        const name = propertyName(property.name);
        if (name === "__proto__")
          throw unsupported(property, { kind: "protoProperty" });
        properties.set(name, { name, value: lowerExpression(property.initializer, context) });
        continue;
      }
      if (ts4.isSpreadAssignment(property))
        throw unsupported(property, { kind: "objectSpread" });
      throw unsupported(property, { kind: "objectPropertyForm" });
    }
    const contextual = context.checker.getContextualType(current);
    const fillOptionalsFrom = (recordType) => {
      for (const member of context.checker.getPropertiesOfType(recordType)) {
        if ((member.flags & ts4.SymbolFlags.Optional) === 0 || properties.has(member.name))
          continue;
        const absent = addInstruction(context, current, { kind: "nullishConstant", sentinel: "undefined" });
        properties.set(member.name, { name: member.name, value: absent });
      }
    };
    const contextMembers = contextual == null ? [] : contextual.isUnion() ? nonMissingUnionMembers(contextual) : [contextual];
    if (contextMembers.length === 1 && valueKind(contextMembers[0], context.checker) === "object") {
      fillOptionalsFrom(contextMembers[0]);
    }
    let tag = null;
    if (contextMembers.length > 1) {
      const tagProperty = taggedUnionProperty(contextMembers, context.checker);
      if (tagProperty != null) {
        tag = { property: tagProperty };
        const ownLiteral = writtenTagLiteral(current, tagProperty, context);
        if (ownLiteral != null) {
          for (const member of contextMembers) {
            const memberTag = context.checker.getPropertyOfType(member, tagProperty);
            const memberTagType = memberTag == null ? null : context.checker.getTypeOfSymbol(memberTag);
            const memberLiterals = memberTagType == null ? null : tagLiteralValues(memberTagType);
            if (memberLiterals != null && memberLiterals.includes(ownLiteral)) {
              fillOptionalsFrom(member);
            }
          }
        }
      }
    }
    return addInstruction(context, current, { kind: "object", properties: [...properties.values()], ...tag == null ? {} : { tag } });
  }
  if (identifierAssignment(current) != null) {
    throw unsupported(current, { kind: "assignmentInValuePosition" });
  }
  if (ts4.isBinaryExpression(current) && (current.operatorToken.kind === ts4.SyntaxKind.AmpersandAmpersandToken || current.operatorToken.kind === ts4.SyntaxKind.BarBarToken)) {
    return lowerLogicalExpression(current, context);
  }
  if (current.kind === ts4.SyntaxKind.NullKeyword) {
    return addInstruction(context, current, { kind: "nullishConstant", sentinel: "null" });
  }
  if (ts4.isStringLiteral(current) || ts4.isNoSubstitutionTemplateLiteral(current)) {
    return addInstruction(context, current, { kind: "opaqueConstant", content: current.text });
  }
  if (ts4.isAsExpression(current) || ts4.isTypeAssertionExpression(current)) {
    lowerExpression(current.expression, context);
    return addInstruction(context, current, { kind: "opaqueConstant" });
  }
  if (ts4.isTemplateExpression(current)) {
    for (const span of current.templateSpans)
      lowerExpression(span.expression, context);
    return addInstruction(context, current, { kind: "opaqueConstant" });
  }
  if (ts4.isBinaryExpression(current) && current.operatorToken.kind === ts4.SyntaxKind.QuestionQuestionToken) {
    const resultType = context.checker.getTypeAtLocation(current);
    if (valueKind(resultType, context.checker) == null) {
      throw unsupported(current, { kind: "valueType", typeText: context.checker.typeToString(resultType) });
    }
    const left = lowerExpression(current.left, context);
    const notMissing = addInstruction(context, current, { kind: "nullishCheck", value: left, sentinel: "nullish", negated: true });
    return lowerValueBranch(current, notMissing, () => left, () => lowerExpression(current.right, context), context);
  }
  if (ts4.isBinaryExpression(current)) {
    const missingCheck = missingSentinelCheck(current, context);
    if (missingCheck != null)
      return missingCheck;
    if (current.operatorToken.kind === ts4.SyntaxKind.InstanceOfKeyword && ts4.isIdentifier(current.right) && declaredOnlyInDeclarationFiles(context.checker.getSymbolAtLocation(current.right))) {
      lowerExpression(current.left, context);
      return addInstruction(context, current, { kind: "unknownBoolean" });
    }
    const tagComparison = tagCheckComparison(current, context);
    if (tagComparison != null)
      return tagComparison;
    const opaqueComparison = opaqueEqualityCheck(current, context);
    if (opaqueComparison != null)
      return opaqueComparison;
    if (current.operatorToken.kind === ts4.SyntaxKind.PlusToken && (context.checker.getTypeAtLocation(current).flags & ts4.TypeFlags.StringLike) !== 0) {
      lowerExpression(current.left, context);
      lowerExpression(current.right, context);
      return addInstruction(context, current, { kind: "opaqueConstant" });
    }
    const arithmetic = arithmeticOperator(current.operatorToken.kind);
    const comparison = comparisonOperator(current.operatorToken.kind);
    if (arithmetic == null && comparison == null) {
      throw unsupported(current, { kind: "binaryOperator", operator: current.operatorToken.getText(context.sourceFile) });
    }
    if ((comparison === "equal" || comparison === "notEqual") && valueKind(context.checker.getTypeAtLocation(current.left), context.checker) === "boolean" && valueKind(context.checker.getTypeAtLocation(current.right), context.checker) === "boolean") {
      const left2 = lowerExpression(current.left, context);
      const right2 = lowerExpression(current.right, context);
      return addInstruction(context, current, { kind: "compare", operator: comparison, left: left2, right: right2 });
    }
    requireNumberType(current.left, context.checker);
    requireNumberType(current.right, context.checker);
    const left = lowerExpression(current.left, context);
    const right = lowerExpression(current.right, context);
    return arithmetic != null ? addInstruction(context, current, { kind: "binary", operator: arithmetic, left, right }) : addInstruction(context, current, { kind: "compare", operator: comparison, left, right });
  }
  if (ts4.isCallExpression(current)) {
    const staticAnnotation = context.staticAnnotations.get(current);
    if (staticAnnotation != null)
      return lowerStaticAnnotation(staticAnnotation, context);
    if (ts4.isIdentifier(current.expression)) {
      const globalName = current.expression.text;
      if ((globalName === "parseFloat" || globalName === "parseInt" || globalName === "Number") && declaredOnlyInDeclarationFiles(context.checker.getSymbolAtLocation(current.expression))) {
        for (const argument of current.arguments)
          lowerExpression(argument, context);
        return addInstruction(context, current, { kind: "parsedNumber", integer: globalName === "parseInt" });
      }
      const symbol = resolvedSymbol(context.checker.getSymbolAtLocation(current.expression), context.checker);
      const callee = symbol == null ? undefined : context.functionsBySymbol.get(symbol);
      if (callee == null) {
        const crossFileCall = symbol == null ? null : lowerCrossFileCall(current, symbol, context);
        if (crossFileCall != null)
          return crossFileCall;
        throw unsupported(current, { kind: "call", callee: current.expression.text });
      }
      if (current.arguments.length > callee.declaration.parameters.length) {
        throw unsupported(current, { kind: "callWithMoreArguments", callee: current.expression.text });
      }
      const arguments_ = lowerCallArguments(current, callee.declaration.parameters, context);
      return addInstruction(context, current, { kind: "call", function: callee.id, arguments: arguments_ });
    }
    if (ts4.isPropertyAccessExpression(current.expression)) {
      const platformCall = current.arguments.length === 0 ? platformFact(current.expression, true, context.checker) : null;
      if (platformCall != null) {
        return addInstruction(context, current, { kind: "platformValue", ...platformCall });
      }
      const method = current.expression.name.text;
      const standardMath = isStandardMathObject(current.expression.expression, context.checker);
      if (standardMath && method === "floor" && current.arguments.length === 1) {
        requireNumberType(current.arguments[0], context.checker);
        const value2 = lowerExpression(current.arguments[0], context);
        return addInstruction(context, current, { kind: "floor", value: value2 });
      }
      if (standardMath && method === "abs" && current.arguments.length === 1) {
        requireNumberType(current.arguments[0], context.checker);
        const value2 = lowerExpression(current.arguments[0], context);
        return addInstruction(context, current, { kind: "absolute", value: value2 });
      }
      if (standardMath && (method === "ceil" || method === "round" || method === "trunc" || method === "sqrt") && current.arguments.length === 1) {
        requireNumberType(current.arguments[0], context.checker);
        const value2 = lowerExpression(current.arguments[0], context);
        return addInstruction(context, current, { kind: "mathUnary", operator: method, value: value2 });
      }
      if (standardMath && (method === "min" || method === "max") && current.arguments.length > 0) {
        for (const argument of current.arguments)
          requireNumberType(argument, context.checker);
        const values = current.arguments.map((argument) => lowerExpression(argument, context));
        return addInstruction(context, current, { kind: method === "min" ? "minimum" : "maximum", values });
      }
      const standardNumber = isStandardNumberObject(current.expression.expression, context.checker);
      if (standardNumber && (method === "parseFloat" || method === "parseInt") && current.arguments.length >= 1) {
        for (const argument of current.arguments)
          lowerExpression(argument, context);
        return addInstruction(context, current, { kind: "parsedNumber", integer: method === "parseInt" });
      }
      if (standardNumber && (method === "isInteger" || method === "isFinite" || method === "isNaN") && current.arguments.length === 1) {
        requireNumberType(current.arguments[0], context.checker);
        const value2 = lowerExpression(current.arguments[0], context);
        return addInstruction(context, current, {
          kind: "numberCheck",
          predicate: method === "isInteger" ? "integer" : method === "isFinite" ? "finite" : "nan",
          value: value2
        });
      }
      const arrayMethod = ts4.isPropertyAccessExpression(current.expression) && context.checker.isArrayType(context.checker.getTypeAtLocation(current.expression.expression)) ? current.expression.name.text === "reduce" ? "reduce" : "other" : null;
      throw unsupported(current, {
        kind: "call",
        callee: calleeDisplayName(current.expression, context.sourceFile),
        ...arrayMethod == null ? {} : { arrayMethod }
      });
    }
  }
  if (ts4.isPropertyAccessExpression(current)) {
    const platform = platformFact(current, false, context.checker);
    if (platform != null) {
      return addInstruction(context, current, { kind: "platformValue", ...platform });
    }
    if (current.questionDotToken != null) {
      const receiver = lowerExpression(current.expression, context);
      const present = addInstruction(context, current, { kind: "nullishCheck", value: receiver, sentinel: "nullish", negated: true });
      return lowerValueBranch(current, present, () => {
        requireAccessedPropertyKind(current, context.checker);
        return addInstruction(context, current, { kind: "property", object: receiver, property: current.name.text });
      }, () => addInstruction(context, current, { kind: "nullishConstant", sentinel: "undefined" }), context);
    }
    const objectType = context.checker.getTypeAtLocation(current.expression);
    const receiverKind = valueKind(objectType, context.checker);
    if ((receiverKind === "array" || receiverKind === "tuple") && current.name.text === "length") {
      const array = lowerExpression(current.expression, context);
      return addInstruction(context, current, { kind: "arrayLength", array });
    }
    if (receiverKind === "opaque" && current.name.text === "length" && (objectType.flags & ts4.TypeFlags.StringLike) !== 0) {
      const value2 = lowerExpression(current.expression, context);
      return addInstruction(context, current, { kind: "stringLength", value: value2 });
    }
    const receiverSymbol = ts4.isIdentifier(current.expression) ? context.checker.getSymbolAtLocation(current.expression) : undefined;
    if (receiverSymbol != null && (receiverSymbol.flags & (ts4.SymbolFlags.RegularEnum | ts4.SymbolFlags.ConstEnum)) !== 0) {
      throw unsupported(current, { kind: "enumMemberRead" });
    }
    if (receiverKind !== "object" && receiverKind !== "taggedUnion") {
      throw unsupported(current.expression, { kind: "propertyReadOnNonObject", typeText: context.checker.typeToString(objectType) });
    }
    requireAccessedPropertyKind(current, context.checker);
    const object = lowerExpression(current.expression, context);
    return addInstruction(context, current, { kind: "property", object, property: current.name.text });
  }
  throw unsupported(current, { kind: "expressionForm", syntax: ts4.SyntaxKind[current.kind] });
}
function lowerStaticAnnotation(annotation, context) {
  if (annotation.kind === "invalid") {
    throw unsupported(annotation.node, { kind: "staticAssertionForm", problem: annotation.problem });
  }
  const condition = annotation.condition;
  requireBooleanCondition(condition, context.checker);
  const originalBlock = context.currentBlock;
  const originalBlockCount = context.blocks.length;
  const originalInstructionCount = originalBlock.instructions.length;
  let value2;
  if (annotation.role === "requirement") {
    const requirement = writtenRequirement(condition, context);
    if (requirement == null) {
      throw unsupported(condition, {
        kind: "staticAssertionForm",
        problem: staticAssertionProblem(condition, context.checker, "callerRequirement")
      });
    }
    value2 = lowerWrittenRequirement(requirement, condition, context);
  } else {
    if (!supportedWrittenAssertion(condition, context.checker)) {
      throw unsupported(condition, {
        kind: "staticAssertionForm",
        problem: staticAssertionProblem(condition, context.checker, "directCheck")
      });
    }
    value2 = lowerExpression(condition, context);
  }
  if (context.currentBlock !== originalBlock || context.blocks.length !== originalBlockCount) {
    throw unsupported(condition, { kind: "staticAssertionForm", problem: "bindValueFirst" });
  }
  const conditionInstructions = originalBlock.instructions.slice(originalInstructionCount);
  if (conditionInstructions.some((instruction) => !removableStaticConditionInstruction(instruction))) {
    throw unsupported(condition, { kind: "staticAssertionForm", problem: "bindValueFirst" });
  }
  const site = addSite(context, annotation.call);
  if (annotation.role === "requirement") {
    return addInstructionAtSite(context, site, { kind: "staticRequire", value: value2 });
  }
  const assertion = context.assertions.length;
  context.assertions.push({ site, text: condition.getText(context.sourceFile) });
  return addInstructionAtSite(context, site, { kind: "staticAssert", value: value2, assertion });
}
function writtenRequirement(condition, context) {
  const current = unwrapParentheses(condition);
  if (ts4.isCallExpression(current) && current.questionDotToken == null && current.arguments.length === 1 && ts4.isPropertyAccessExpression(current.expression) && current.expression.questionDotToken == null && isStandardNumberObject(current.expression.expression, context.checker) && (current.expression.name.text === "isInteger" || current.expression.name.text === "isFinite")) {
    const argument = current.arguments[0];
    const value2 = staticRequirementParameterPathValue(argument, context);
    return value2 == null ? null : {
      kind: "numberCheck",
      predicate: current.expression.name.text === "isInteger" ? "integer" : "finite",
      value: value2
    };
  }
  if (!ts4.isBinaryExpression(current) || !staticAssertionComparison(current.operatorToken.kind))
    return null;
  const leftParameter = staticRequirementParameterPathValue(current.left, context);
  const rightParameter = staticRequirementParameterPathValue(current.right, context);
  const leftConstant = leftParameter == null ? staticFiniteValue(current.left, context) : null;
  const rightConstant = rightParameter == null ? staticFiniteValue(current.right, context) : null;
  const left = leftParameter != null ? { kind: "parameter", value: leftParameter } : leftConstant != null ? { kind: "constant", value: leftConstant } : null;
  const right = rightParameter != null ? { kind: "parameter", value: rightParameter } : rightConstant != null ? { kind: "constant", value: rightConstant } : null;
  const operator = comparisonOperator(current.operatorToken.kind);
  if (left == null || right == null || operator == null || leftParameter != null && rightParameter != null)
    return null;
  return { kind: "comparison", left, right, operator };
}
function staticRequirementParameterPathValue(expression, context) {
  requireNumberType(expression, context.checker);
  let root = unwrapParentheses(expression);
  while (ts4.isPropertyAccessExpression(root) && root.questionDotToken == null) {
    root = unwrapParentheses(root.expression);
  }
  if (!ts4.isIdentifier(root))
    return null;
  const symbol = context.checker.getSymbolAtLocation(root);
  const rootValue = symbol == null ? null : context.bindings.get(symbol);
  if (rootValue == null || !valueComesFromParameter(rootValue, context))
    return null;
  return lowerExpression(expression, context);
}
function valueComesFromParameter(value2, context) {
  if (context.parameters.some((parameter) => parameter.value === value2))
    return true;
  for (const block of context.blocks) {
    const producer = block.instructions.find((instruction) => instruction.result === value2);
    if (producer != null) {
      return producer.kind === "property" && valueComesFromParameter(producer.object, context);
    }
  }
  return false;
}
function staticFiniteValue(expression, context) {
  const seen = new Set;
  let current = expression;
  while (true) {
    const literal = numericLiteralValue(current);
    if (literal != null)
      return Number.isFinite(literal) ? literal : null;
    const unwrapped = unwrapParentheses(current);
    if (!ts4.isIdentifier(unwrapped))
      return null;
    const symbol = resolvedSymbol(context.checker.getSymbolAtLocation(unwrapped), context.checker);
    if (symbol == null || seen.has(symbol))
      return null;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration;
    if (declaration == null || !ts4.isVariableDeclaration(declaration) || (ts4.getCombinedNodeFlags(declaration) & ts4.NodeFlags.Const) === 0 || declaration.getSourceFile().isDeclarationFile || declaration.initializer == null)
      return null;
    current = declaration.initializer;
  }
}
function lowerWrittenRequirement(requirement, condition, context) {
  if (requirement.kind === "numberCheck") {
    return addInstruction(context, condition, {
      kind: "numberCheck",
      predicate: requirement.predicate,
      value: requirement.value
    });
  }
  const lowerOperand = (operand) => {
    if (operand.kind === "parameter")
      return operand.value;
    return addInstruction(context, condition, { kind: "constant", value: operand.value });
  };
  return addInstruction(context, condition, {
    kind: "compare",
    operator: requirement.operator,
    left: lowerOperand(requirement.left),
    right: lowerOperand(requirement.right)
  });
}
function supportedWrittenAssertion(condition, checker) {
  const current = unwrapParentheses(condition);
  if (ts4.isBinaryExpression(current) && staticAssertionComparison(current.operatorToken.kind)) {
    return staticAssertionNumericAtom(current.left, checker) && staticAssertionNumericAtom(current.right, checker);
  }
  const operand = staticNumberCheckOperand(current, checker);
  return operand != null && staticAssertionNumericAtom(operand, checker);
}
function staticAssertionNumericAtom(expression, checker) {
  return staticAssertionAtom(expression) && valueKind(checker.getTypeAtLocation(expression), checker) === "number";
}
function staticAssertionComparison(kind) {
  switch (kind) {
    case ts4.SyntaxKind.LessThanToken:
    case ts4.SyntaxKind.LessThanEqualsToken:
    case ts4.SyntaxKind.GreaterThanToken:
    case ts4.SyntaxKind.GreaterThanEqualsToken:
    case ts4.SyntaxKind.EqualsEqualsEqualsToken:
    case ts4.SyntaxKind.ExclamationEqualsEqualsToken:
      return true;
    default:
      return false;
  }
}
function staticAssertionAtomProblem(expression) {
  const current = unwrapParentheses(expression);
  if (ts4.isIdentifier(current) || ts4.isNumericLiteral(current))
    return null;
  if (ts4.isPrefixUnaryExpression(current) && (current.operator === ts4.SyntaxKind.PlusToken || current.operator === ts4.SyntaxKind.MinusToken)) {
    return ts4.isNumericLiteral(unwrapParentheses(current.operand)) ? null : "bindValueFirst";
  }
  if (ts4.isElementAccessExpression(current))
    return "bindValueFirst";
  if (ts4.isNonNullExpression(current))
    return staticAssertionAtomProblem(current.expression);
  if (ts4.isCallExpression(current))
    return "functionCall";
  if (ts4.isBinaryExpression(current))
    return "bindValueFirst";
  if (ts4.isPropertyAccessExpression(current)) {
    return current.questionDotToken == null ? staticAssertionAtomProblem(current.expression) : "directCheck";
  }
  return "directCheck";
}
function staticAssertionAtom(expression) {
  const current = unwrapParentheses(expression);
  if (ts4.isIdentifier(current) || ts4.isNumericLiteral(current))
    return true;
  if (ts4.isPrefixUnaryExpression(current) && (current.operator === ts4.SyntaxKind.PlusToken || current.operator === ts4.SyntaxKind.MinusToken)) {
    return ts4.isNumericLiteral(unwrapParentheses(current.operand));
  }
  return ts4.isPropertyAccessExpression(current) && current.questionDotToken == null && staticAssertionAtom(current.expression);
}
function staticAssertionProblem(condition, checker, fallback) {
  const current = unwrapParentheses(condition);
  if (ts4.isBinaryExpression(current) && staticAssertionComparison(current.operatorToken.kind)) {
    return staticAssertionAtomProblem(current.left) ?? staticAssertionAtomProblem(current.right) ?? fallback;
  }
  const operand = staticNumberCheckOperand(current, checker);
  if (operand != null)
    return staticAssertionAtomProblem(operand) ?? fallback;
  if (ts4.isCallExpression(current))
    return "functionCall";
  return "directCheck";
}
function staticNumberCheckOperand(expression, checker) {
  if (!ts4.isCallExpression(expression) || expression.questionDotToken != null || expression.arguments.length !== 1 || !ts4.isPropertyAccessExpression(expression.expression) || expression.expression.questionDotToken != null)
    return null;
  const callee = expression.expression;
  return isStandardNumberObject(callee.expression, checker) && (callee.name.text === "isInteger" || callee.name.text === "isFinite" || callee.name.text === "isNaN") ? expression.arguments[0] : null;
}
function unwrapParentheses(expression) {
  let current = expression;
  while (ts4.isParenthesizedExpression(current))
    current = current.expression;
  return current;
}
function removableStaticConditionInstruction(instruction) {
  switch (instruction.kind) {
    case "constant":
    case "arrayLength":
    case "moduleRead":
    case "compare":
    case "platformValue":
    case "numberCheck":
    case "property":
      return true;
    default:
      return false;
  }
}
function identifierAssignment(node) {
  if (ts4.isBinaryExpression(node) && ts4.isIdentifier(node.left)) {
    if (node.operatorToken.kind === ts4.SyntaxKind.EqualsToken)
      return { form: "assign", target: node.left, node };
    const operator = compoundAssignmentOperator(node.operatorToken.kind);
    if (operator != null)
      return { form: "compound", target: node.left, node, operator };
    const logical = node.operatorToken.kind === ts4.SyntaxKind.QuestionQuestionEqualsToken ? "nullish" : node.operatorToken.kind === ts4.SyntaxKind.BarBarEqualsToken ? "or" : node.operatorToken.kind === ts4.SyntaxKind.AmpersandAmpersandEqualsToken ? "and" : null;
    if (logical != null)
      return { form: "logical", target: node.left, node, logical };
  }
  if ((ts4.isPrefixUnaryExpression(node) || ts4.isPostfixUnaryExpression(node)) && (node.operator === ts4.SyntaxKind.PlusPlusToken || node.operator === ts4.SyntaxKind.MinusMinusToken) && ts4.isIdentifier(node.operand)) {
    return { form: "update", target: node.operand, node };
  }
  return null;
}
function compoundAssignmentOperator(kind) {
  switch (kind) {
    case ts4.SyntaxKind.PlusEqualsToken:
      return "add";
    case ts4.SyntaxKind.MinusEqualsToken:
      return "subtract";
    case ts4.SyntaxKind.AsteriskEqualsToken:
      return "multiply";
    case ts4.SyntaxKind.SlashEqualsToken:
      return "divide";
    default:
      return null;
  }
}
function lowerValueBranch(node, condition, lowerTrueArm, lowerFalseArm, context) {
  const whenTrue = createBlock(context);
  const whenFalse = createBlock(context);
  terminate(context.currentBlock, {
    kind: "branch",
    condition,
    whenTrue: { block: whenTrue, arguments: [] },
    whenFalse: { block: whenFalse, arguments: [] },
    site: addSite(context, node)
  });
  context.currentBlock = context.blocks[whenTrue];
  const trueValue = lowerTrueArm();
  const trueBlock = context.currentBlock;
  context.currentBlock = context.blocks[whenFalse];
  const falseValue = lowerFalseArm();
  const falseBlock = context.currentBlock;
  const continuation = createBlock(context, 1);
  terminate(trueBlock, {
    kind: "jump",
    target: { block: continuation, arguments: [trueValue] },
    site: addSite(context, node)
  });
  terminate(falseBlock, {
    kind: "jump",
    target: { block: continuation, arguments: [falseValue] },
    site: addSite(context, node)
  });
  context.currentBlock = context.blocks[continuation];
  return context.currentBlock.parameters[0];
}
function lowerConditionalExpression(expression, context) {
  requireBooleanCondition(expression.condition, context.checker);
  const resultType = context.checker.getTypeAtLocation(expression);
  if (valueKind(resultType, context.checker) == null) {
    throw unsupported(expression, { kind: "valueType", typeText: context.checker.typeToString(resultType) });
  }
  const whenTrue = createBlock(context);
  const whenFalse = createBlock(context);
  lowerBranchingCondition(expression.condition, whenTrue, whenFalse, context);
  context.currentBlock = context.blocks[whenTrue];
  const trueValue = lowerExpression(expression.whenTrue, context);
  const trueBlock = context.currentBlock;
  context.currentBlock = context.blocks[whenFalse];
  const falseValue = lowerExpression(expression.whenFalse, context);
  const falseBlock = context.currentBlock;
  const continuation = createBlock(context, 1);
  terminate(trueBlock, {
    kind: "jump",
    target: { block: continuation, arguments: [trueValue] },
    site: addSite(context, expression)
  });
  terminate(falseBlock, {
    kind: "jump",
    target: { block: continuation, arguments: [falseValue] },
    site: addSite(context, expression)
  });
  context.currentBlock = context.blocks[continuation];
  return context.currentBlock.parameters[0];
}
function lowerBranchingCondition(expression, whenTrue, whenFalse, context) {
  const current = unwrap(expression, context.checker);
  if (ts4.isBinaryExpression(current) && (current.operatorToken.kind === ts4.SyntaxKind.AmpersandAmpersandToken || current.operatorToken.kind === ts4.SyntaxKind.BarBarToken)) {
    const isAnd = current.operatorToken.kind === ts4.SyntaxKind.AmpersandAmpersandToken;
    const middle = createBlock(context);
    if (isAnd) {
      lowerBranchingCondition(current.left, middle, whenFalse, context);
    } else {
      lowerBranchingCondition(current.left, whenTrue, middle, context);
    }
    context.currentBlock = context.blocks[middle];
    lowerBranchingCondition(current.right, whenTrue, whenFalse, context);
    return;
  }
  if (ts4.isPrefixUnaryExpression(current) && current.operator === ts4.SyntaxKind.ExclamationToken) {
    lowerBranchingCondition(current.operand, whenFalse, whenTrue, context);
    return;
  }
  requireBooleanCondition(current, context.checker);
  const tagUnion = taggedUnionTagRead(current, context);
  const condition = tagUnion != null ? addInstruction(context, current, { kind: "tagCheck", union: lowerExpression(tagUnion, context), tagValue: true, negated: false }) : lowerExpression(current, context);
  terminate(context.currentBlock, {
    kind: "branch",
    condition,
    whenTrue: { block: whenTrue, arguments: [] },
    whenFalse: { block: whenFalse, arguments: [] },
    site: addSite(context, current)
  });
}
function lowerLogicalExpression(expression, context) {
  requireBooleanCondition(expression.left, context.checker);
  requireBooleanCondition(expression.right, context.checker);
  const isAnd = expression.operatorToken.kind === ts4.SyntaxKind.AmpersandAmpersandToken;
  const condition = lowerExpression(expression.left, context);
  return lowerValueBranch(expression, condition, () => isAnd ? lowerExpression(expression.right, context) : addInstruction(context, expression, { kind: "booleanConstant", value: true }), () => isAnd ? addInstruction(context, expression, { kind: "booleanConstant", value: false }) : lowerExpression(expression.right, context), context);
}
function arithmeticOperator(kind) {
  switch (kind) {
    case ts4.SyntaxKind.PlusToken:
      return "add";
    case ts4.SyntaxKind.MinusToken:
      return "subtract";
    case ts4.SyntaxKind.AsteriskToken:
      return "multiply";
    case ts4.SyntaxKind.SlashToken:
      return "divide";
    case ts4.SyntaxKind.PercentToken:
      return "remainder";
    default:
      return null;
  }
}
function comparisonOperator(kind) {
  switch (kind) {
    case ts4.SyntaxKind.LessThanToken:
      return "lessThan";
    case ts4.SyntaxKind.LessThanEqualsToken:
      return "lessThanOrEqual";
    case ts4.SyntaxKind.GreaterThanToken:
      return "greaterThan";
    case ts4.SyntaxKind.GreaterThanEqualsToken:
      return "greaterThanOrEqual";
    case ts4.SyntaxKind.EqualsEqualsToken:
    case ts4.SyntaxKind.EqualsEqualsEqualsToken:
      return "equal";
    case ts4.SyntaxKind.ExclamationEqualsToken:
    case ts4.SyntaxKind.ExclamationEqualsEqualsToken:
      return "notEqual";
    default:
      return null;
  }
}
function requireNumberType(node, checker) {
  const type = checker.getTypeAtLocation(node);
  if (valueKind(type, checker) !== "number" && (type.flags & ts4.TypeFlags.Any) === 0) {
    throw unsupported(node, { kind: "nonNumberOperand", typeText: checker.typeToString(type) });
  }
}
function typeCanIncludeUndefined(type) {
  if ((type.flags & (ts4.TypeFlags.Undefined | ts4.TypeFlags.Any | ts4.TypeFlags.Unknown)) !== 0)
    return true;
  return type.isUnion() && type.types.some(typeCanIncludeUndefined);
}
function lowerParameterDefault(default_, node, context) {
  switch (default_.kind) {
    case "number":
      return addInstruction(context, node, { kind: "constant", value: default_.value });
    case "boolean":
      return addInstruction(context, node, { kind: "booleanConstant", value: default_.value });
    case "opaque":
      return addInstruction(context, node, { kind: "opaqueConstant", content: default_.content });
    case "nullish":
      return addInstruction(context, node, { kind: "nullishConstant", sentinel: default_.sentinel });
  }
}
function lowerCallArguments(current, parameters, context) {
  const calleeName = current.expression.getText(context.sourceFile);
  const arguments_ = [];
  for (let index = 0;index < parameters.length; index++) {
    const parameter = parameters[index];
    const argument = current.arguments[index];
    if (argument == null) {
      if (parameter.initializer != null) {
        const default_2 = parameterDefaultLiteral(parameter.initializer, context.checker);
        if (default_2 == null)
          throw unsupported(current, { kind: "callWithFewerArguments", callee: calleeName });
        arguments_.push(lowerParameterDefault(default_2, parameter.initializer, context));
        continue;
      }
      if (parameter.questionToken != null) {
        arguments_.push(addInstruction(context, parameter, { kind: "nullishConstant", sentinel: "undefined" }));
        continue;
      }
      throw unsupported(current, { kind: "callWithFewerArguments", callee: calleeName });
    }
    const value2 = lowerExpression(argument, context);
    const default_ = parameter.initializer == null ? null : parameterDefaultLiteral(parameter.initializer, context.checker);
    if (default_ == null || !typeCanIncludeUndefined(context.checker.getTypeAtLocation(argument))) {
      arguments_.push(value2);
      continue;
    }
    const supplied = addInstruction(context, argument, { kind: "nullishCheck", value: value2, sentinel: "undefined", negated: true });
    arguments_.push(lowerValueBranch(argument, supplied, () => value2, () => lowerParameterDefault(default_, parameter.initializer, context), context));
  }
  return arguments_;
}
function lowerCrossFileCall(current, symbol, context) {
  if (context.crossFile == null)
    return null;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (declaration == null || !ts4.isFunctionDeclaration(declaration) || declaration.name == null)
    return null;
  if (declaration.getSourceFile() === context.sourceFile)
    return null;
  const resolved = context.crossFile.resolve(declaration);
  if (resolved.kind !== "contract")
    return null;
  if (current.arguments.length > declaration.parameters.length) {
    throw unsupported(current, { kind: "callWithMoreArguments", callee: declaration.name.text });
  }
  const arguments_ = lowerCallArguments(current, declaration.parameters, context);
  return addInstruction(context, current, {
    kind: "crossCall",
    arguments: arguments_,
    returnKind: crossFileReturnKind(declaration, context.checker),
    contract: resolved.contract
  });
}
function crossFileReturnKind(declaration, checker) {
  const signature = checker.getSignatureFromDeclaration(declaration);
  const returnType = signature == null ? null : checker.getReturnTypeOfSignature(signature);
  return returnType != null && valueKind(returnType, checker) === "number" ? { kind: "number", interval: null } : { kind: "opaque" };
}
var valueKindCache = new WeakMap;
function valueKind(type, checker, depth = 0) {
  if (depth > 8)
    return null;
  let byDepth = valueKindCache.get(type);
  if (byDepth == null) {
    byDepth = [];
    valueKindCache.set(type, byDepth);
  }
  const cached = byDepth[depth];
  if (cached !== undefined)
    return cached;
  const result = valueKindUncached(type, checker, depth);
  byDepth[depth] = result;
  return result;
}
function valueKindUncached(type, checker, depth) {
  if ((type.flags & ts4.TypeFlags.NumberLike) !== 0)
    return "number";
  if ((type.flags & ts4.TypeFlags.BooleanLike) !== 0)
    return "boolean";
  if ((type.flags & ts4.TypeFlags.StringLike) !== 0)
    return "opaque";
  if (checker.isTupleType(type))
    return "tuple";
  if (checker.isArrayType(type)) {
    const element = checker.getIndexTypeOfType(type, ts4.IndexKind.Number);
    return element != null && valueKind(element, checker, depth + 1) != null ? "array" : null;
  }
  const objectLike = (type.flags & ts4.TypeFlags.Object) !== 0 || type.isIntersection() && type.types.every((member) => valueKind(member, checker, depth + 1) === "object");
  if (objectLike) {
    if (checker.getIndexInfosOfType(type).length > 0)
      return null;
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) {
      const dataProperties = checker.getPropertiesOfType(type).some((property) => checker.getTypeOfSymbol(property).getCallSignatures().length === 0);
      return dataProperties ? null : "opaque";
    }
    const anchored = checker.getPropertiesOfType(type).some((property) => checker.getTypeOfSymbol(property).getCallSignatures().length === 0);
    return anchored ? "object" : null;
  }
  if ((type.flags & (ts4.TypeFlags.Unknown | ts4.TypeFlags.Any)) !== 0)
    return "opaque";
  if (type.isUnion()) {
    const missingFlags = ts4.TypeFlags.Null | ts4.TypeFlags.Undefined;
    if (type.types.some((member) => (member.flags & missingFlags) !== 0)) {
      const rest = nonMissingUnionMembers(type);
      const restKind = classifyUnionMembers(rest, checker, depth + 1);
      if (restKind != null)
        return "nullable";
      return taggedUnionProperty(rest, checker, depth) == null ? null : "nullable";
    }
    if (taggedUnionProperty(type.types, checker, depth) != null)
      return "taggedUnion";
    return classifyUnionMembers(type.types, checker, depth + 1);
  }
  return null;
}
var nonMissingUnionMembersCache = new WeakMap;
function nonMissingUnionMembers(type) {
  const cached = nonMissingUnionMembersCache.get(type);
  if (cached != null)
    return cached;
  const missingFlags = ts4.TypeFlags.Null | ts4.TypeFlags.Undefined;
  const members = type.types.filter((member) => (member.flags & missingFlags) === 0);
  nonMissingUnionMembersCache.set(type, members);
  return members;
}
var taggedUnionPropertyCache = new WeakMap;
function taggedUnionProperty(members, checker, depth = 0) {
  if (members.length < 2)
    return null;
  let byDepth = taggedUnionPropertyCache.get(members);
  if (byDepth == null) {
    byDepth = [];
    taggedUnionPropertyCache.set(members, byDepth);
  }
  const cached = byDepth[depth];
  if (cached !== undefined)
    return cached;
  const result = taggedUnionPropertyUncached(members, checker, depth);
  byDepth[depth] = result;
  return result;
}
function taggedUnionPropertyUncached(members, checker, depth) {
  for (const member of members) {
    if (valueKind(member, checker, depth + 1) !== "object")
      return null;
  }
  const first = members[0];
  const qualifies = (candidateName, singleLiteralOnly) => {
    for (const member of members) {
      const property = checker.getPropertyOfType(member, candidateName);
      if (property == null || (property.flags & ts4.SymbolFlags.Optional) !== 0)
        return false;
      const literals = tagLiteralValues(checker.getTypeOfSymbol(property));
      if (literals == null || singleLiteralOnly && literals.length !== 1)
        return false;
    }
    return true;
  };
  for (const singleLiteralOnly of [true, false]) {
    for (const candidate of checker.getPropertiesOfType(first)) {
      if ((candidate.flags & ts4.SymbolFlags.Optional) !== 0)
        continue;
      if (qualifies(candidate.name, singleLiteralOnly))
        return candidate.name;
    }
  }
  return null;
}
function calleeDisplayName(expression, sourceFile) {
  if (ts4.isPropertyAccessExpression(expression)) {
    const receiver = expression.expression;
    const receiverName = ts4.isIdentifier(receiver) ? receiver.text : ts4.isPropertyAccessExpression(receiver) && ts4.isIdentifier(receiver.expression) ? `${receiver.expression.text}.${receiver.name.text}` : "(…)";
    return `${receiverName}.${expression.name.text}`;
  }
  return expression.getText(sourceFile).replace(/\s+/g, " ").slice(0, 60);
}
function writtenTagLiteral(literal, tagProperty, context) {
  if (!ts4.isObjectLiteralExpression(literal))
    return null;
  for (const property of literal.properties) {
    if (!ts4.isPropertyAssignment(property))
      continue;
    const name = ts4.isIdentifier(property.name) || ts4.isStringLiteral(property.name) ? property.name.text : null;
    if (name !== tagProperty)
      continue;
    const initializer = unwrap(property.initializer, context.checker);
    if (ts4.isStringLiteral(initializer) || ts4.isNoSubstitutionTemplateLiteral(initializer))
      return initializer.text;
    if (initializer.kind === ts4.SyntaxKind.TrueKeyword)
      return true;
    if (initializer.kind === ts4.SyntaxKind.FalseKeyword)
      return false;
    return null;
  }
  return null;
}
function tagLiteralValues(type) {
  const single = (member) => {
    if (member.isStringLiteral())
      return member.value;
    if ((member.flags & ts4.TypeFlags.BooleanLiteral) !== 0) {
      return member.intrinsicName === "true";
    }
    return null;
  };
  const members = type.isUnion() ? type.types : [type];
  const literals = [];
  for (const member of members) {
    const literal = single(member);
    if (literal == null)
      return null;
    literals.push(literal);
  }
  return literals;
}
function classifyUnionMembers(members, checker, depth) {
  if (depth > 8)
    return null;
  let shared = null;
  for (const member of members) {
    const kind = valueKind(member, checker, depth);
    if (kind == null || kind === "nullable" || kind === "taggedUnion" || shared != null && kind !== shared)
      return null;
    if (kind === "object" || kind === "array" || kind === "tuple") {
      if (members.length > 1 || !structuralTypeWalkCompletes(member, checker, []))
        return null;
    }
    shared = kind;
  }
  return shared;
}
function structuralTypeWalkCompletes(type, checker, seen) {
  if (type.isIntersection() && valueKind(type, checker) === "object") {
    if (seen.length >= 8 || seen.includes(type))
      return false;
    return structuralPropertiesComplete(type, checker, seen);
  }
  if (type.isUnion())
    return type.types.every((member) => structuralTypeWalkCompletes(member, checker, seen));
  if (checker.isTupleType(type)) {
    if (seen.length >= 8 || seen.includes(type))
      return false;
    return checker.getTypeArguments(type).every((member) => structuralTypeWalkCompletes(member, checker, [...seen, type]));
  }
  if (checker.isArrayType(type)) {
    if (seen.length >= 8 || seen.includes(type))
      return false;
    const element = checker.getIndexTypeOfType(type, ts4.IndexKind.Number);
    return element == null || structuralTypeWalkCompletes(element, checker, [...seen, type]);
  }
  if ((type.flags & ts4.TypeFlags.Object) === 0)
    return true;
  if (seen.length >= 8 || seen.includes(type))
    return false;
  if (declaredOnlyInDeclarationFiles(type.getSymbol() ?? type.aliasSymbol))
    return true;
  if (checker.getIndexInfosOfType(type).length > 0)
    return true;
  if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0)
    return true;
  return structuralPropertiesComplete(type, checker, seen);
}
function structuralPropertiesComplete(type, checker, seen) {
  const nextSeen = [...seen, type];
  for (const property of checker.getPropertiesOfType(type)) {
    if ((property.flags & ts4.SymbolFlags.Optional) !== 0)
      continue;
    if (!structuralTypeWalkCompletes(checker.getTypeOfSymbol(property), checker, nextSeen))
      return false;
  }
  return true;
}
function requireBooleanCondition(node, checker) {
  const type = checker.getTypeAtLocation(node);
  const kind = valueKind(type, checker);
  if (kind === "boolean")
    return;
  throw unsupported(node, {
    kind: "nonBooleanCondition",
    conditionKind: kind === "number" ? "number" : "other",
    typeText: checker.typeToString(type)
  });
}
function requireAccessedPropertyKind(access, checker) {
  const receiverType = checker.getTypeAtLocation(access.expression);
  const presentType = access.questionDotToken != null ? checker.getNonNullableType(receiverType) : receiverType;
  const property = checker.getPropertyOfType(presentType, access.name.text);
  if (valueKind(presentType, checker) === "object" && property != null && declaredOnlyInDeclarationFiles(property)) {
    throw unsupported(access, { kind: "prototypeMemberRead", property: access.name.text });
  }
  const type = checker.getTypeAtLocation(access);
  if (valueKind(type, checker) != null)
    return;
  throw unsupported(access, { kind: "valueType", typeText: checker.typeToString(type) });
}
function resolvedSymbol(symbol, checker) {
  if (symbol == null)
    return null;
  return (symbol.flags & ts4.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}
function isStandardMathObject(expression, checker) {
  if (!ts4.isIdentifier(expression) || expression.text !== "Math")
    return false;
  return declaredOnlyInDeclarationFiles(checker.getSymbolAtLocation(expression));
}
function isStandardNumberObject(expression, checker) {
  if (!ts4.isIdentifier(expression) || expression.text !== "Number")
    return false;
  return declaredOnlyInDeclarationFiles(checker.getSymbolAtLocation(expression));
}
function lowerElementAccess(access, asserted, context) {
  const receiverType = context.checker.getTypeAtLocation(access.expression);
  const receiverKind = valueKind(receiverType, context.checker);
  if (receiverKind !== "array" && receiverKind !== "tuple") {
    throw unsupported(access.expression, { kind: "propertyReadOnNonObject", typeText: context.checker.typeToString(receiverType) });
  }
  const resultType = context.checker.getTypeAtLocation(access);
  if (valueKind(resultType, context.checker) == null) {
    throw unsupported(access, { kind: "valueType", typeText: context.checker.typeToString(resultType) });
  }
  requireNumberType(access.argumentExpression, context.checker);
  const array = lowerExpression(access.expression, context);
  const index = lowerExpression(access.argumentExpression, context);
  const missingFlag = ts4.TypeFlags.Undefined;
  const staticTypeAllowsUndefined = (resultType.flags & missingFlag) !== 0 || resultType.isUnion() && resultType.types.some((member) => (member.flags & missingFlag) !== 0);
  return addInstruction(context, access, {
    kind: "arrayIndex",
    array,
    index,
    mode: asserted ? "asserted" : staticTypeAllowsUndefined ? "bare" : "bareUnchecked"
  });
}
function taggedUnionTagRead(expression, context) {
  const unwrapped = unwrap(expression, context.checker);
  if (!ts4.isPropertyAccessExpression(unwrapped))
    return null;
  const objectType = context.checker.getTypeAtLocation(unwrapped.expression);
  if (valueKind(objectType, context.checker) !== "taggedUnion" || !objectType.isUnion())
    return null;
  const tagProperty = taggedUnionProperty(objectType.types, context.checker);
  return tagProperty === unwrapped.name.text ? unwrapped.expression : null;
}
function tagCheckComparison(expression, context) {
  const operator = expression.operatorToken.kind;
  const equals = operator === ts4.SyntaxKind.EqualsEqualsEqualsToken || operator === ts4.SyntaxKind.EqualsEqualsToken;
  const notEquals = operator === ts4.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsToken;
  if (!equals && !notEquals)
    return null;
  const literalOf = (side) => {
    const unwrapped = unwrap(side, context.checker);
    if (ts4.isStringLiteral(unwrapped) || ts4.isNoSubstitutionTemplateLiteral(unwrapped))
      return unwrapped.text;
    if (unwrapped.kind === ts4.SyntaxKind.TrueKeyword)
      return true;
    if (unwrapped.kind === ts4.SyntaxKind.FalseKeyword)
      return false;
    return null;
  };
  const sides = [
    { union: taggedUnionTagRead(expression.left, context), literal: literalOf(expression.right) },
    { union: taggedUnionTagRead(expression.right, context), literal: literalOf(expression.left) }
  ];
  for (const side of sides) {
    if (side.union != null && side.literal != null) {
      const union = lowerExpression(side.union, context);
      return addInstruction(context, expression, { kind: "tagCheck", union, tagValue: side.literal, negated: notEquals });
    }
  }
  return null;
}
function opaqueEqualityCheck(expression, context) {
  const operator = expression.operatorToken.kind;
  const isEquality = operator === ts4.SyntaxKind.EqualsEqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts4.SyntaxKind.EqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsToken;
  if (!isEquality)
    return null;
  const opaqueOrMissingOpaque = (side) => {
    const type = context.checker.getTypeAtLocation(side);
    const kind = valueKind(type, context.checker);
    if (kind === "opaque")
      return true;
    if (kind === "nullable" && type.isUnion()) {
      const missing = ts4.TypeFlags.Null | ts4.TypeFlags.Undefined;
      const rest = type.types.filter((member) => (member.flags & missing) === 0);
      return rest.length >= 1 && rest.every((member) => valueKind(member, context.checker) === "opaque");
    }
    return false;
  };
  if (!opaqueOrMissingOpaque(expression.left) || !opaqueOrMissingOpaque(expression.right))
    return null;
  lowerExpression(expression.left, context);
  lowerExpression(expression.right, context);
  return addInstruction(context, expression, { kind: "unknownBoolean" });
}
function missingSentinelCheck(expression, context) {
  const operator = expression.operatorToken.kind;
  const strict = operator === ts4.SyntaxKind.EqualsEqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsEqualsToken;
  const loose = operator === ts4.SyntaxKind.EqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsToken;
  if (!strict && !loose)
    return null;
  const negated = operator === ts4.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts4.SyntaxKind.ExclamationEqualsToken;
  const sentinelOf = (side) => {
    const unwrapped = unwrap(side, context.checker);
    if (unwrapped.kind === ts4.SyntaxKind.NullKeyword)
      return "null";
    if (isUndefinedGlobal(unwrapped, context.checker))
      return "undefined";
    return null;
  };
  const isUndefinedString = (side) => {
    const unwrapped = unwrap(side, context.checker);
    return ts4.isStringLiteral(unwrapped) && unwrapped.text === "undefined";
  };
  if (ts4.isTypeOfExpression(expression.left) && isUndefinedString(expression.right)) {
    const value3 = lowerExpression(expression.left.expression, context);
    return addInstruction(context, expression, { kind: "nullishCheck", value: value3, sentinel: "undefined", negated });
  }
  if (ts4.isTypeOfExpression(expression.right) && isUndefinedString(expression.left)) {
    const value3 = lowerExpression(expression.right.expression, context);
    return addInstruction(context, expression, { kind: "nullishCheck", value: value3, sentinel: "undefined", negated });
  }
  const primitiveTypeofFlags = (side) => {
    const unwrapped = unwrap(side, context.checker);
    if (!ts4.isStringLiteral(unwrapped))
      return null;
    switch (unwrapped.text) {
      case "number":
        return ts4.TypeFlags.NumberLike;
      case "string":
        return ts4.TypeFlags.StringLike;
      case "boolean":
        return ts4.TypeFlags.BooleanLike;
      default:
        return null;
    }
  };
  const rightFlags = primitiveTypeofFlags(expression.right);
  const leftFlags = primitiveTypeofFlags(expression.left);
  const typeofSide = ts4.isTypeOfExpression(expression.left) && rightFlags != null ? { operand: expression.left, flags: rightFlags } : ts4.isTypeOfExpression(expression.right) && leftFlags != null ? { operand: expression.right, flags: leftFlags } : null;
  if (typeofSide != null) {
    const operandType = context.checker.getTypeAtLocation(typeofSide.operand.expression);
    const missing = ts4.TypeFlags.Null | ts4.TypeFlags.Undefined;
    const members = operandType.isUnion() ? operandType.types : [operandType];
    const restMatches = members.every((member) => (member.flags & missing) !== 0 || (member.flags & typeofSide.flags) !== 0) && members.some((member) => (member.flags & missing) === 0);
    const value3 = lowerExpression(typeofSide.operand.expression, context);
    if (restMatches) {
      return addInstruction(context, expression, { kind: "nullishCheck", value: value3, sentinel: "nullish", negated: !negated });
    }
    return addInstruction(context, expression, { kind: "unknownBoolean" });
  }
  const leftSentinel = sentinelOf(expression.left);
  const rightSentinel = sentinelOf(expression.right);
  const sentinel = leftSentinel ?? rightSentinel;
  if (sentinel == null || leftSentinel != null && rightSentinel != null)
    return null;
  const checked = leftSentinel == null ? expression.left : expression.right;
  const checkedType = context.checker.getTypeAtLocation(checked);
  const missingFlags = ts4.TypeFlags.Null | ts4.TypeFlags.Undefined;
  const pureSentinel = (checkedType.flags & missingFlags) !== 0 || checkedType.isUnion() && checkedType.types.every((member) => (member.flags & missingFlags) !== 0);
  if (!pureSentinel && valueKind(checkedType, context.checker) == null) {
    throw unsupported(checked, { kind: "valueType", typeText: context.checker.typeToString(checkedType) });
  }
  const value2 = lowerExpression(checked, context);
  return addInstruction(context, expression, {
    kind: "nullishCheck",
    value: value2,
    sentinel: loose ? "nullish" : sentinel,
    negated
  });
}
function isGlobalInfinity(expression, checker) {
  if (!ts4.isIdentifier(expression) || expression.text !== "Infinity")
    return false;
  return declaredOnlyInDeclarationFiles(checker.getSymbolAtLocation(expression));
}
function identifierValue(symbol, node, context) {
  const local = context.bindings.get(symbol);
  if (local != null)
    return local;
  const binding = context.moduleBindingsBySymbol.get(symbol);
  if (binding != null)
    return addInstruction(context, node, { kind: "moduleRead", binding });
  if (isGlobalInfinity(node, context.checker)) {
    return addInstruction(context, node, { kind: "constant", value: Number.POSITIVE_INFINITY });
  }
  if (isUndefinedGlobal(node, context.checker)) {
    return addInstruction(context, node, { kind: "nullishConstant", sentinel: "undefined" });
  }
  throw unsupported(node, { kind: "unknownIdentifier", name: node.text });
}
function assignIdentifier(symbol, node, value2, wholeExpression, context) {
  if (context.bindings.has(symbol)) {
    context.bindings.set(symbol, value2);
    return value2;
  }
  const binding = context.moduleBindingsBySymbol.get(symbol);
  if (binding != null)
    return addInstruction(context, wholeExpression, { kind: "moduleWrite", binding, value: value2 });
  throw unsupported(node, { kind: "unknownIdentifier", name: node.text });
}
function propertyName(name) {
  if (ts4.isIdentifier(name) || ts4.isStringLiteral(name) || ts4.isNumericLiteral(name))
    return name.text;
  throw unsupported(name, { kind: "computedPropertyName" });
}
function unwrap(expression, checker) {
  let current = expression;
  while (true) {
    if (ts4.isParenthesizedExpression(current) || ts4.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    if ((ts4.isAsExpression(current) || ts4.isTypeAssertionExpression(current)) && ts4.isConstTypeReference(current.type)) {
      current = current.expression;
      continue;
    }
    if (ts4.isNonNullExpression(current)) {
      const assertedType = checker.getTypeAtLocation(current);
      const operandType = checker.getTypeAtLocation(current.expression);
      if (ts4.isElementAccessExpression(current.expression) && valueKind(assertedType, checker) != null) {
        return current;
      }
      if (valueKind(assertedType, checker) !== valueKind(operandType, checker)) {
        throw unsupported(current, {
          kind: "kindChangingAssertion",
          fromText: checker.typeToString(operandType),
          toText: checker.typeToString(assertedType)
        });
      }
      current = current.expression;
      continue;
    }
    return current;
  }
}

// src/lower/module.ts
import * as ts6 from "typescript";

// src/lower/statements.ts
import * as ts5 from "typescript";
function lowerStatements(statements, context) {
  for (const statement of statements) {
    if (context.currentBlock.terminator != null)
      throw unsupported(statement, { kind: "statementAfterReturn" });
    lowerStatement(statement, context);
  }
}
function lowerStatement(statement, context) {
  if (ts5.isVariableStatement(statement)) {
    lowerVariableDeclarationList(statement.declarationList, context);
    return;
  }
  if (ts5.isReturnStatement(statement)) {
    let value2 = statement.expression == null ? null : lowerExpression(statement.expression, context);
    if (value2 == null) {
      const enclosing = ts5.findAncestor(statement, ts5.isFunctionDeclaration);
      const signature = enclosing == null ? undefined : context.checker.getSignatureFromDeclaration(enclosing);
      const returnType = signature == null ? null : context.checker.getReturnTypeOfSignature(signature);
      const returnsVoid = returnType == null || (returnType.flags & (ts5.TypeFlags.Void | ts5.TypeFlags.Undefined)) !== 0;
      if (!returnsVoid) {
        value2 = addInstruction(context, statement, { kind: "nullishConstant", sentinel: "undefined" });
      }
    }
    terminate(context.currentBlock, { kind: "return", value: value2, site: addSite(context, statement) });
    return;
  }
  if (ts5.isExpressionStatement(statement)) {
    lowerStatementExpression(statement.expression, context);
    return;
  }
  if (ts5.isIfStatement(statement)) {
    lowerIfStatement(statement, context);
    return;
  }
  if (ts5.isForOfStatement(statement)) {
    lowerForOfStatement(statement, context);
    return;
  }
  if (ts5.isForStatement(statement)) {
    lowerForStatement(statement, context);
    return;
  }
  if (ts5.isWhileStatement(statement)) {
    lowerWhileStatement(statement, context);
    return;
  }
  if (ts5.isContinueStatement(statement)) {
    lowerContinueStatement(statement, context);
    return;
  }
  if (ts5.isBlock(statement)) {
    lowerStatements(statement.statements, context);
    return;
  }
  if (ts5.isSwitchStatement(statement)) {
    lowerSwitchStatement(statement, context);
    return;
  }
  if (ts5.isThrowStatement(statement)) {
    terminate(context.currentBlock, { kind: "thrown", site: addSite(context, statement) });
    return;
  }
  throw unsupported(statement, { kind: "statementForm", syntax: ts5.SyntaxKind[statement.kind] });
}
function lowerIfStatement(statement, context) {
  const bindingsBeforeBranch = new Map(context.bindings);
  const whenTrue = createBlock(context);
  const whenFalse = createBlock(context);
  lowerBranchingCondition(statement.expression, whenTrue, whenFalse, context);
  const trueBranch = lowerBranch(statement.thenStatement, whenTrue, bindingsBeforeBranch, context);
  const falseBranch = statement.elseStatement == null ? { block: context.blocks[whenFalse], bindings: new Map(bindingsBeforeBranch) } : lowerBranch(statement.elseStatement, whenFalse, bindingsBeforeBranch, context);
  const continuingBranches = [trueBranch, falseBranch].filter((branch) => branch.block.terminator == null);
  if (continuingBranches.length === 0) {
    context.currentBlock = trueBranch.block;
    context.bindings = bindingsBeforeBranch;
    return;
  }
  if (continuingBranches.length === 1) {
    const continuing = continuingBranches[0];
    context.currentBlock = continuing.block;
    context.bindings = bindingsVisibleAfterBranch(bindingsBeforeBranch, continuing.bindings);
    return;
  }
  mergeAtContinuation([trueBranch, falseBranch], bindingsBeforeBranch, statement, context);
}
function lowerSwitchStatement(statement, context) {
  const subjectType = context.checker.getTypeAtLocation(statement.expression);
  const subjectKind = valueKind(subjectType, context.checker);
  const tagUnionExpression = taggedUnionTagRead(statement.expression, context);
  const missingFlags = ts5.TypeFlags.Null | ts5.TypeFlags.Undefined;
  const nullableOpaqueSubject = subjectKind === "nullable" && subjectType.isUnion() && subjectType.types.every((member) => (member.flags & missingFlags) !== 0 || valueKind(member, context.checker) === "opaque");
  if (tagUnionExpression == null && subjectKind !== "number" && subjectKind !== "opaque" && !nullableOpaqueSubject) {
    throw unsupported(statement.expression, { kind: "switchSubject", typeText: context.checker.typeToString(subjectType) });
  }
  const subject = lowerExpression(tagUnionExpression ?? statement.expression, context);
  const groups = [];
  let pendingLabels = [];
  let defaultGroup = null;
  const clauses = statement.caseBlock.clauses;
  for (let index = 0;index < clauses.length; index++) {
    const clause = clauses[index];
    if (ts5.isDefaultClause(clause)) {
      if (index !== clauses.length - 1 || pendingLabels.length > 0) {
        throw unsupported(clause, { kind: "switchDefaultNotLast" });
      }
      defaultGroup = { labels: [], statements: [...clause.statements], clause };
      continue;
    }
    pendingLabels.push(clause.expression);
    if (clause.statements.length > 0) {
      groups.push({ labels: pendingLabels, statements: [...clause.statements], clause });
      pendingLabels = [];
    }
  }
  if (pendingLabels.length > 0) {
    throw unsupported(statement, { kind: "switchFallthrough" });
  }
  const bindingsBefore = new Map(context.bindings);
  const exits = [];
  const lowerBody = (group) => {
    const body = group.statements;
    const last = body[body.length - 1];
    const endsWithBreak = last != null && ts5.isBreakStatement(last);
    lowerStatements(endsWithBreak ? body.slice(0, -1) : body, context);
    if (context.currentBlock.terminator == null) {
      if (!endsWithBreak)
        throw unsupported(group.clause, { kind: "switchFallthrough" });
      exits.push({ block: context.currentBlock, bindings: context.bindings });
    }
  };
  for (const group of groups) {
    const bodyBlock = createBlock(context);
    for (const label of group.labels) {
      const labelKind = valueKind(context.checker.getTypeAtLocation(label), context.checker);
      const effectiveSubjectKind = nullableOpaqueSubject ? "opaque" : subjectKind;
      if (tagUnionExpression == null && labelKind !== effectiveSubjectKind) {
        throw unsupported(label, { kind: "switchLabel", typeText: context.checker.typeToString(context.checker.getTypeAtLocation(label)) });
      }
      let condition;
      if (tagUnionExpression != null) {
        const unwrappedLabel = label;
        if (!ts5.isStringLiteral(unwrappedLabel) && !ts5.isNoSubstitutionTemplateLiteral(unwrappedLabel)) {
          throw unsupported(label, { kind: "switchLabel", typeText: context.checker.typeToString(context.checker.getTypeAtLocation(label)) });
        }
        condition = addInstruction(context, label, { kind: "tagCheck", union: subject, tagValue: unwrappedLabel.text, negated: false });
      } else {
        const labelValue = lowerExpression(label, context);
        condition = effectiveSubjectKind === "number" ? addInstruction(context, label, { kind: "compare", operator: "equal", left: subject, right: labelValue }) : addInstruction(context, label, { kind: "unknownBoolean" });
      }
      const nextTest = createBlock(context);
      terminate(context.currentBlock, {
        kind: "branch",
        condition,
        whenTrue: { block: bodyBlock, arguments: [] },
        whenFalse: { block: nextTest, arguments: [] },
        site: addSite(context, label)
      });
      context.currentBlock = context.blocks[nextTest];
    }
    const afterTests = context.currentBlock;
    const bindingsAtTests = new Map(context.bindings);
    context.currentBlock = context.blocks[bodyBlock];
    context.bindings = new Map(bindingsBefore);
    lowerBody(group);
    context.currentBlock = afterTests;
    context.bindings = bindingsAtTests;
  }
  if (defaultGroup == null) {
    exits.push({ block: context.currentBlock, bindings: context.bindings });
  } else {
    lowerBody(defaultGroup);
  }
  if (exits.length === 0) {
    return;
  }
  if (exits.length === 1) {
    context.currentBlock = exits[0].block;
    context.bindings = bindingsVisibleAfterBranch(bindingsBefore, exits[0].bindings);
    return;
  }
  mergeAtContinuation(exits, bindingsBefore, statement, context);
}
function lowerForOfStatement(statement, context) {
  if (!ts5.isVariableDeclarationList(statement.initializer) || statement.initializer.declarations.length !== 1 || !ts5.isIdentifier(statement.initializer.declarations[0].name)) {
    throw unsupported(statement.initializer, { kind: "variableDeclarationShape" });
  }
  const elementName = statement.initializer.declarations[0].name;
  const elementType = context.checker.getTypeAtLocation(elementName);
  if (valueKind(elementType, context.checker) == null) {
    throw unsupported(elementName, { kind: "valueType", typeText: context.checker.typeToString(elementType) });
  }
  const arrayType = context.checker.getTypeAtLocation(statement.expression);
  const arrayKind = valueKind(arrayType, context.checker);
  if (arrayKind !== "array" && arrayKind !== "tuple") {
    throw unsupported(statement.expression, { kind: "valueType", typeText: context.checker.typeToString(arrayType) });
  }
  const array = lowerExpression(statement.expression, context);
  const zero = addInstruction(context, statement, { kind: "constant", value: 0 });
  const bindingsBeforeLoop = new Map(context.bindings);
  const assigned = assignedSymbols([statement.statement], context.checker);
  const carried = [...bindingsBeforeLoop.keys()].filter((symbol) => assigned.has(symbol));
  const header = createBlock(context, carried.length + 1, addSite(context, statement));
  terminate(context.currentBlock, {
    kind: "jump",
    target: {
      block: header,
      arguments: [...carried.map((symbol) => requiredBranchBinding(symbol, bindingsBeforeLoop)), zero]
    },
    site: addSite(context, statement)
  });
  context.currentBlock = context.blocks[header];
  context.bindings = new Map(bindingsBeforeLoop);
  for (let index = 0;index < carried.length; index++) {
    context.bindings.set(carried[index], context.currentBlock.parameters[index]);
  }
  const counter = context.currentBlock.parameters[carried.length];
  const length = addInstruction(context, statement, { kind: "arrayLength", array });
  const condition = addInstruction(context, statement, { kind: "compare", operator: "lessThan", left: counter, right: length });
  const conditionBindings = new Map(context.bindings);
  const body = createBlock(context);
  const exit = createBlock(context);
  terminate(context.currentBlock, {
    kind: "branch",
    condition,
    whenTrue: { block: body, arguments: [] },
    whenFalse: { block: exit, arguments: [] },
    site: addSite(context, statement)
  });
  const advance = (advanceContext) => {
    const one = addInstruction(advanceContext, statement, { kind: "constant", value: 1 });
    const next = addInstruction(advanceContext, statement, { kind: "binary", operator: "add", left: counter, right: one });
    return [next];
  };
  context.currentBlock = context.blocks[body];
  context.bindings = new Map(conditionBindings);
  context.bindings.set(requiredSymbol(elementName, context.checker), addInstruction(context, statement, {
    kind: "arrayIndex",
    array,
    index: counter,
    mode: "bare"
  }));
  context.loops.push({ header, carried, advance });
  lowerStatement(statement.statement, context);
  context.loops.pop();
  if (context.currentBlock.terminator == null) {
    const extra = advance(context);
    terminate(context.currentBlock, {
      kind: "jump",
      target: {
        block: header,
        arguments: [...carried.map((symbol) => requiredBranchBinding(symbol, context.bindings)), ...extra]
      },
      site: addSite(context, statement)
    });
  }
  context.currentBlock = context.blocks[exit];
  context.bindings = new Map(conditionBindings);
}
function lowerForStatement(statement, context) {
  if (statement.initializer != null) {
    if (ts5.isVariableDeclarationList(statement.initializer)) {
      lowerVariableDeclarationList(statement.initializer, context);
    } else {
      lowerStatementExpression(statement.initializer, context);
    }
  }
  if (statement.condition == null)
    throw unsupported(statement, { kind: "forLoopWithoutCondition" });
  requireBooleanCondition(statement.condition, context.checker);
  const bindingsBeforeLoop = new Map(context.bindings);
  const scanned = statement.incrementor == null ? [statement.condition, statement.statement] : [statement.condition, statement.statement, statement.incrementor];
  const assigned = assignedSymbols(scanned, context.checker);
  const carried = [...bindingsBeforeLoop.keys()].filter((symbol) => assigned.has(symbol));
  const header = createBlock(context, carried.length, addSite(context, statement));
  terminate(context.currentBlock, {
    kind: "jump",
    target: { block: header, arguments: carried.map((symbol) => requiredBranchBinding(symbol, bindingsBeforeLoop)) },
    site: addSite(context, statement)
  });
  context.currentBlock = context.blocks[header];
  context.bindings = new Map(bindingsBeforeLoop);
  for (let index = 0;index < carried.length; index++) {
    context.bindings.set(carried[index], context.currentBlock.parameters[index]);
  }
  const conditionBindings = new Map(context.bindings);
  const body = createBlock(context);
  const exit = createBlock(context);
  lowerBranchingCondition(statement.condition, body, exit, context);
  const advance = (advanceContext) => {
    if (statement.incrementor != null)
      lowerStatementExpression(statement.incrementor, advanceContext);
    return [];
  };
  context.currentBlock = context.blocks[body];
  context.bindings = new Map(conditionBindings);
  context.loops.push({ header, carried, advance });
  lowerStatement(statement.statement, context);
  context.loops.pop();
  if (context.currentBlock.terminator == null) {
    advance(context);
    terminate(context.currentBlock, {
      kind: "jump",
      target: { block: header, arguments: carried.map((symbol) => requiredBranchBinding(symbol, context.bindings)) },
      site: addSite(context, statement)
    });
  }
  context.currentBlock = context.blocks[exit];
  context.bindings = conditionBindings;
}
function lowerWhileStatement(statement, context) {
  requireBooleanCondition(statement.expression, context.checker);
  const bindingsBeforeLoop = new Map(context.bindings);
  const assigned = assignedSymbols([statement.expression, statement.statement], context.checker);
  const carried = [...bindingsBeforeLoop.keys()].filter((symbol) => assigned.has(symbol));
  const header = createBlock(context, carried.length, addSite(context, statement));
  terminate(context.currentBlock, {
    kind: "jump",
    target: { block: header, arguments: carried.map((symbol) => requiredBranchBinding(symbol, bindingsBeforeLoop)) },
    site: addSite(context, statement)
  });
  context.currentBlock = context.blocks[header];
  context.bindings = new Map(bindingsBeforeLoop);
  for (let index = 0;index < carried.length; index++) {
    context.bindings.set(carried[index], context.currentBlock.parameters[index]);
  }
  const conditionBindings = new Map(context.bindings);
  const body = createBlock(context);
  const exit = createBlock(context);
  lowerBranchingCondition(statement.expression, body, exit, context);
  context.currentBlock = context.blocks[body];
  context.bindings = new Map(conditionBindings);
  context.loops.push({ header, carried, advance: () => [] });
  lowerStatement(statement.statement, context);
  context.loops.pop();
  if (context.currentBlock.terminator == null) {
    terminate(context.currentBlock, {
      kind: "jump",
      target: { block: header, arguments: carried.map((symbol) => requiredBranchBinding(symbol, context.bindings)) },
      site: addSite(context, statement)
    });
  }
  context.currentBlock = context.blocks[exit];
  context.bindings = conditionBindings;
}
function lowerContinueStatement(statement, context) {
  if (statement.label != null) {
    throw unsupported(statement, { kind: "statementForm", syntax: "ContinueStatement with a label" });
  }
  const loop = context.loops[context.loops.length - 1];
  if (loop == null)
    throw unsupported(statement, { kind: "statementForm", syntax: "ContinueStatement" });
  const extra = loop.advance(context);
  terminate(context.currentBlock, {
    kind: "jump",
    target: {
      block: loop.header,
      arguments: [...loop.carried.map((symbol) => requiredBranchBinding(symbol, context.bindings)), ...extra]
    },
    site: addSite(context, statement)
  });
}
function lowerBranch(statement, block, bindings, context) {
  context.currentBlock = context.blocks[block];
  context.bindings = new Map(bindings);
  lowerStatement(statement, context);
  return { block: context.currentBlock, bindings: context.bindings };
}
function lowerVariableDeclarationList(declarations, context) {
  for (const declaration of declarations.declarations) {
    if (ts5.isObjectBindingPattern(declaration.name) && declaration.initializer != null) {
      const source = lowerExpression(declaration.initializer, context);
      for (const element of declaration.name.elements) {
        if (!ts5.isIdentifier(element.name) || element.dotDotDotToken != null || element.initializer != null) {
          throw unsupported(element, { kind: "variableDeclarationShape" });
        }
        const property = element.propertyName == null ? element.name.text : ts5.isIdentifier(element.propertyName) ? element.propertyName.text : null;
        if (property == null)
          throw unsupported(element, { kind: "variableDeclarationShape" });
        const elementType = context.checker.getTypeAtLocation(element.name);
        const sourceType = context.checker.getTypeAtLocation(declaration.initializer);
        const propertySymbol = context.checker.getPropertyOfType(sourceType, property);
        if (propertySymbol != null && declaredOnlyInDeclarationFiles(propertySymbol)) {
          throw unsupported(element, { kind: "prototypeMemberRead", property });
        }
        if (valueKind(elementType, context.checker) == null) {
          throw unsupported(element, { kind: "valueType", typeText: context.checker.typeToString(elementType) });
        }
        const value3 = addInstruction(context, element, { kind: "property", object: source, property });
        context.bindings.set(requiredSymbol(element.name, context.checker), value3);
      }
      continue;
    }
    if (!ts5.isIdentifier(declaration.name) || declaration.initializer == null) {
      throw unsupported(declaration, { kind: "variableDeclarationShape" });
    }
    const value2 = lowerExpression(declaration.initializer, context);
    const declaredType = context.checker.getTypeAtLocation(declaration.name);
    const declaredValueKind = valueKind(declaredType, context.checker);
    if (declaredValueKind == null) {
      throw unsupported(declaration.type ?? declaration.name, {
        kind: "valueType",
        typeText: context.checker.typeToString(declaredType)
      });
    }
    const stored = declaredValueKind === "opaque" ? addInstruction(context, declaration, { kind: "opaqueConstant" }) : value2;
    context.bindings.set(requiredSymbol(declaration.name, context.checker), stored);
  }
}
function assignedSymbols(nodes, checker) {
  const symbols = new Set;
  const visit = (node) => {
    if (ts5.isFunctionLike(node))
      return;
    const assignment = identifierAssignment(node);
    if (assignment != null)
      symbols.add(requiredSymbol(assignment.target, checker));
    ts5.forEachChild(node, visit);
  };
  for (const node of nodes)
    visit(node);
  return symbols;
}

// src/lower/module.ts
function scanModuleBindings(sourceFile, checker) {
  const bindings = [];
  const bindingsBySymbol = new Map;
  const register = (name, category) => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol == null)
      return;
    bindingsBySymbol.set(symbol, bindings.length);
    bindings.push({ name: name.text, category });
  };
  for (const statement of sourceFile.statements) {
    if (ts6.isVariableStatement(statement)) {
      if ((statement.declarationList.flags & (ts6.NodeFlags.Let | ts6.NodeFlags.Const)) === 0)
        continue;
      for (const declarator of statement.declarationList.declarations) {
        if (ts6.isIdentifier(declarator.name)) {
          register(declarator.name, declaredCategory(declarator.name, checker));
          continue;
        }
        if (ts6.isObjectBindingPattern(declarator.name)) {
          for (const element of declarator.name.elements) {
            if (ts6.isIdentifier(element.name))
              register(element.name, declaredCategory(element.name, checker));
          }
        }
      }
      continue;
    }
    if (ts6.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause == null || clause.isTypeOnly)
        continue;
      if (clause.name != null)
        register(clause.name, importedCategory(clause.name, checker));
      const named = clause.namedBindings;
      if (named != null && ts6.isNamedImports(named)) {
        for (const element of named.elements) {
          if (!element.isTypeOnly)
            register(element.name, importedCategory(element.name, checker));
        }
      }
      if (named != null && ts6.isNamespaceImport(named))
        register(named.name, { kind: "import" });
    }
  }
  const visit = (node, insideFunction) => {
    if (insideFunction)
      demoteModuleWritesInNode(node, checker, bindingsBySymbol, bindings);
    const enteringFunction = insideFunction || ts6.isFunctionLike(node);
    ts6.forEachChild(node, (child) => {
      visit(child, enteringFunction);
    });
  };
  visit(sourceFile, false);
  return { bindings, bindingsBySymbol };
}
function importedCategory(name, checker) {
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol == null || (symbol.flags & ts6.SymbolFlags.Alias) === 0)
    return { kind: "import" };
  const target = checker.getAliasedSymbol(symbol);
  const declaration = target.valueDeclaration;
  if (declaration == null || !ts6.isVariableDeclaration(declaration))
    return { kind: "import" };
  if ((ts6.getCombinedNodeFlags(declaration) & ts6.NodeFlags.Const) === 0)
    return { kind: "import" };
  if (declaration.getSourceFile().isDeclarationFile)
    return { kind: "import" };
  if (declaration.initializer == null)
    return { kind: "import" };
  const value2 = numericLiteralValue(declaration.initializer);
  return value2 == null ? { kind: "import" } : { kind: "importedConstant", value: value2 };
}
function demoteModuleWritesInNode(node, checker, bindingsBySymbol, bindings, written) {
  const record = (binding) => {
    demote(bindings, binding);
    if (written != null)
      written[binding] = true;
  };
  const target = (expression) => {
    if (ts6.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression);
      const binding = symbol == null ? undefined : bindingsBySymbol.get(symbol);
      if (binding != null)
        record(binding);
      return;
    }
    const visitPattern = (child) => {
      if (ts6.isShorthandPropertyAssignment(child)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(child);
        const binding = symbol == null ? undefined : bindingsBySymbol.get(symbol);
        if (binding != null)
          record(binding);
        ts6.forEachChild(child, visitPattern);
        return;
      }
      if (ts6.isIdentifier(child)) {
        const symbol = checker.getSymbolAtLocation(child);
        const binding = symbol == null ? undefined : bindingsBySymbol.get(symbol);
        if (binding != null)
          record(binding);
        return;
      }
      ts6.forEachChild(child, visitPattern);
    };
    ts6.forEachChild(expression, visitPattern);
  };
  if (ts6.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (kind >= ts6.SyntaxKind.FirstAssignment && kind <= ts6.SyntaxKind.LastAssignment)
      target(node.left);
  }
  if ((ts6.isPrefixUnaryExpression(node) || ts6.isPostfixUnaryExpression(node)) && (node.operator === ts6.SyntaxKind.PlusPlusToken || node.operator === ts6.SyntaxKind.MinusMinusToken) && ts6.isExpression(node.operand)) {
    target(node.operand);
  }
  if ((ts6.isForOfStatement(node) || ts6.isForInStatement(node)) && ts6.isExpression(node.initializer)) {
    target(node.initializer);
  }
}
function lowerModuleInitializer(sourceFile, checker, functionsBySymbol, scan, sites, crossFile) {
  const context = createFunctionContext(sourceFile, checker, functionsBySymbol, scan.bindingsBySymbol, sites, [], crossFile ?? null);
  const skips = [];
  const statements = sourceFile.statements;
  for (const statement of statements) {
    if (skippedAtTopLevel(statement))
      continue;
    const recovery = snapshotLowering(context);
    try {
      assertAccepted(statement);
      if (ts6.isVariableStatement(statement)) {
        lowerTopLevelDeclarations(statement, context, scan);
        continue;
      }
      lowerStatement(statement, context);
    } catch (error) {
      if (!(error instanceof LoweringStop))
        throw error;
      restoreLowering(context, recovery);
      lowerSupportedArgumentsOfSkippedTopLevelCall(statement, error, context);
      skips.push({ site: addSite(context, error.node), reason: error.reason });
      const effects = scanSkippedModuleEffects(statement, checker, scan.bindingsBySymbol, scan.bindings);
      for (let binding = 0;binding < scan.bindings.length; binding++) {
        const category = scan.bindings[binding].category;
        const declared = declaredKindOf(category);
        if (effects.directWrites[binding] === true || category.kind === "kind" && effects.invokesUnknownCode || declared != null && holdsMutableStructure(declared)) {
          addInstruction(context, statement, { kind: "moduleHavoc", binding });
        }
      }
    }
  }
  if (context.currentBlock.terminator == null) {
    terminate(context.currentBlock, { kind: "return", value: null, site: addSite(context, sourceFile) });
  }
  return {
    initializer: {
      kind: "lowered",
      name: moduleInitializerName,
      assertions: [],
      returnPropertyNames: null,
      parameters: [],
      entry: 0,
      blocks: sealBlocks(context.blocks, moduleInitializerName)
    },
    skips
  };
}
function containsArrayLiteral(root) {
  if (ts6.isArrayLiteralExpression(root))
    return true;
  let found = false;
  ts6.forEachChild(root, (child) => {
    if (!found && containsArrayLiteral(child))
      found = true;
  });
  return found;
}
function forEachImmediatelyEvaluatedChild(node, visit) {
  if (ts6.isFunctionLike(node)) {
    if (node.name != null && ts6.isComputedPropertyName(node.name)) {
      visit(node.name.expression);
    }
    return;
  }
  ts6.forEachChild(node, visit);
}
function lowerSupportedArgumentsOfSkippedTopLevelCall(statement, stop, context) {
  if (!ts6.isExpressionStatement(statement))
    return;
  let expression = statement.expression;
  while (ts6.isParenthesizedExpression(expression))
    expression = expression.expression;
  if (!ts6.isCallExpression(expression) || expression !== stop.node || expression.questionDotToken != null || !plainCallTarget(expression.expression))
    return;
  for (const argument of expression.arguments) {
    const recovery = snapshotLowering(context);
    try {
      lowerExpression(argument, context);
    } catch (error) {
      if (!(error instanceof LoweringStop))
        throw error;
      restoreLowering(context, recovery);
      return;
    }
  }
}
function plainCallTarget(expression) {
  if (ts6.isIdentifier(expression))
    return true;
  if (ts6.isParenthesizedExpression(expression))
    return plainCallTarget(expression.expression);
  return ts6.isPropertyAccessExpression(expression) && expression.questionDotToken == null && plainCallTarget(expression.expression);
}
function lowerTopLevelDeclarations(statement, context, scan) {
  for (const declarator of statement.declarationList.declarations) {
    if (declarator.initializer == null)
      throw new LoweringStop(declarator, { kind: "variableDeclarationShape" });
    if (ts6.isObjectBindingPattern(declarator.name)) {
      const source = lowerExpression(declarator.initializer, context);
      for (const element of declarator.name.elements) {
        if (!ts6.isIdentifier(element.name) || element.dotDotDotToken != null || element.initializer != null) {
          throw new LoweringStop(element, { kind: "variableDeclarationShape" });
        }
        const property = element.propertyName == null ? element.name.text : ts6.isIdentifier(element.propertyName) ? element.propertyName.text : null;
        if (property == null)
          throw new LoweringStop(element, { kind: "variableDeclarationShape" });
        const elementType = context.checker.getTypeAtLocation(element.name);
        if (valueKind(elementType, context.checker) == null) {
          throw new LoweringStop(element, { kind: "valueType", typeText: context.checker.typeToString(elementType) });
        }
        const symbol2 = context.checker.getSymbolAtLocation(element.name);
        const binding2 = symbol2 == null ? undefined : scan.bindingsBySymbol.get(symbol2);
        if (binding2 == null)
          throw new LoweringStop(element, { kind: "variableDeclarationShape" });
        const value3 = addInstruction(context, element, { kind: "property", object: source, property });
        addInstruction(context, element, { kind: "moduleWrite", binding: binding2, value: value3 });
      }
      continue;
    }
    if (!ts6.isIdentifier(declarator.name)) {
      throw new LoweringStop(declarator, { kind: "variableDeclarationShape" });
    }
    const symbol = context.checker.getSymbolAtLocation(declarator.name);
    const binding = symbol == null ? undefined : scan.bindingsBySymbol.get(symbol);
    if (binding == null)
      throw new LoweringStop(declarator, { kind: "variableDeclarationShape" });
    const value2 = lowerExpression(declarator.initializer, context);
    addInstruction(context, declarator, { kind: "moduleWrite", binding, value: value2 });
  }
}
function skippedAtTopLevel(statement) {
  return ts6.isFunctionDeclaration(statement) && statement.name != null || ts6.isImportDeclaration(statement) || ts6.isTypeAliasDeclaration(statement) || ts6.isInterfaceDeclaration(statement) || ts6.isExportDeclaration(statement);
}
function scanSkippedModuleEffects(root, checker, bindingsBySymbol, bindings) {
  const directWrites = [];
  let invokesUnknownCode = false;
  const visit = (node) => {
    demoteModuleWritesInNode(node, checker, bindingsBySymbol, bindings, directWrites);
    invokesUnknownCode ||= ts6.isCallExpression(node) || ts6.isNewExpression(node) || ts6.isTaggedTemplateExpression(node) || ts6.isAwaitExpression(node) || ts6.isYieldExpression(node) || ts6.isForOfStatement(node) || ts6.isSpreadElement(node) || ts6.isArrayBindingPattern(node) || ts6.isVariableDeclarationList(node) && (node.flags & ts6.NodeFlags.Using) !== 0 || ts6.isBinaryExpression(node) && (node.operatorToken.kind === ts6.SyntaxKind.InstanceOfKeyword || node.operatorToken.kind === ts6.SyntaxKind.EqualsToken && containsArrayLiteral(node.left)) || ts6.isJsxElement(node) || ts6.isJsxSelfClosingElement(node) || ts6.isJsxFragment(node) || ts6.isClassDeclaration(node) || ts6.isClassExpression(node);
    if (ts6.isVariableDeclaration(node) && ts6.isIdentifier(node.name)) {
      const symbol = checker.getSymbolAtLocation(node.name);
      const binding = symbol == null ? undefined : bindingsBySymbol.get(symbol);
      if (binding != null) {
        demote(bindings, binding);
        directWrites[binding] = true;
      }
    }
    forEachImmediatelyEvaluatedChild(node, visit);
  };
  visit(root);
  return { directWrites, invokesUnknownCode };
}
function declaredCategory(name, checker) {
  const declared = declaredKind(checker.getTypeAtLocation(name), checker, []);
  return declared == null ? { kind: "opaque" } : { kind: "value", declaredKind: declared };
}
function declaredRecordProperties(type, checker, seen) {
  if (cutByAncestor(seen, type))
    return null;
  const properties = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const optional = (property.flags & ts6.SymbolFlags.Optional) !== 0;
    const walked = declaredKind(checker.getTypeOfSymbol(property), checker, [...seen, type]);
    const opaqueLeaf = { kind: "opaque" };
    const propertyDeclared = declaredOnlyInDeclarationFiles(property) ? opaqueLeaf : walked ?? opaqueLeaf;
    properties.push({
      name: property.name,
      declared: optional ? wrapOptional(propertyDeclared) : propertyDeclared
    });
  }
  if (properties.length === 0)
    return null;
  return properties;
}
function wrapOptional(declared) {
  if (declared.kind === "nullish") {
    return {
      kind: "nullish",
      inner: declared.inner,
      sentinels: declared.sentinels === "null" || declared.sentinels === "both" ? "both" : "undefined"
    };
  }
  return { kind: "nullish", inner: declared, sentinels: "undefined" };
}
function declaredTaggedVariants(member, tagProperty, checker, seen) {
  const tag = checker.getPropertyOfType(member, tagProperty);
  if (tag == null)
    return null;
  const literals = tagLiteralValues(checker.getTypeOfSymbol(tag));
  if (literals == null)
    return null;
  const properties = declaredRecordProperties(member, checker, seen);
  if (properties == null)
    return null;
  return literals.map((tagValue) => ({ tagValue, properties }));
}
var declaredKindByDepth = new WeakMap;
var ancestorCuts = 0;
function cutByAncestor(seen, type) {
  if (seen.length >= 8)
    return true;
  if (seen.includes(type)) {
    ancestorCuts += 1;
    return true;
  }
  return false;
}
function declaredKind(type, checker, seen) {
  const depth = seen.length;
  let byDepth = declaredKindByDepth.get(type);
  if (byDepth == null) {
    byDepth = [];
    declaredKindByDepth.set(type, byDepth);
  }
  const cached = byDepth[depth];
  if (cached !== undefined)
    return cached;
  const cutsBefore = ancestorCuts;
  const walked = declaredKindUncached(type, checker, seen);
  if (depth === 0 || ancestorCuts === cutsBefore)
    byDepth[depth] = walked;
  return walked;
}
function declaredKindUncached(type, checker, seen) {
  switch (valueKind(type, checker)) {
    case "number": {
      const interval = numericLiteralInterval(type);
      return interval === "nonFinite" ? null : { kind: "number", interval };
    }
    case "boolean":
      return { kind: "boolean" };
    case "nullable": {
      if (!type.isUnion())
        return null;
      const rest = nonMissingUnionMembers(type);
      if (rest.length === 0)
        return null;
      if (rest.some((member) => seen.includes(member))) {
        ancestorCuts += 1;
        return null;
      }
      let inner;
      if (rest.length === 1) {
        inner = declaredKind(rest[0], checker, seen);
      } else {
        const members = rest.map((member) => declaredKind(member, checker, seen));
        inner = joinScalarDeclaredKinds(members);
        const restTagProperty = inner == null ? taggedUnionProperty(rest, checker) : null;
        if (restTagProperty != null) {
          const unionVariants = [];
          let allClassified = true;
          for (const member of rest) {
            const variants = declaredTaggedVariants(member, restTagProperty, checker, seen);
            if (variants == null) {
              allClassified = false;
              break;
            }
            unionVariants.push(...variants);
          }
          const [firstVariant, ...restVariants] = unionVariants;
          if (allClassified && firstVariant != null) {
            inner = { kind: "taggedUnion", tagProperty: restTagProperty, variants: [firstVariant, ...restVariants] };
          }
        }
      }
      if (inner == null)
        return null;
      const admitsNull = type.types.some((member) => (member.flags & ts6.TypeFlags.Null) !== 0);
      const admitsUndefined = type.types.some((member) => (member.flags & ts6.TypeFlags.Undefined) !== 0);
      return { kind: "nullish", inner, sentinels: admitsNull && admitsUndefined ? "both" : admitsNull ? "null" : "undefined" };
    }
    case "opaque":
      return { kind: "opaque" };
    case "array": {
      const element = checker.getIndexTypeOfType(type, ts6.IndexKind.Number);
      if (element == null)
        return null;
      const elementKind = declaredKind(element, checker, [...seen, type]);
      return elementKind == null ? null : { kind: "array", element: elementKind };
    }
    case "tuple": {
      if (cutByAncestor(seen, type))
        return null;
      if (tupleHasOptionalOrRestPositions(type, checker))
        return null;
      const elements = [];
      for (const elementType of checker.getTypeArguments(type)) {
        const element = declaredKind(elementType, checker, [...seen, type]);
        if (element == null)
          return null;
        elements.push(element);
      }
      if (elements.length === 0)
        return null;
      return { kind: "tuple", elements };
    }
    case "object": {
      if (declaredOnlyInDeclarationFiles(type.getSymbol() ?? type.aliasSymbol))
        return { kind: "opaque" };
      const properties = declaredRecordProperties(type, checker, seen);
      return properties == null ? null : { kind: "record", properties };
    }
    case "taggedUnion": {
      if (!type.isUnion())
        return null;
      const tagProperty = taggedUnionProperty(type.types, checker);
      if (tagProperty == null)
        return null;
      const variants = [];
      for (const member of type.types) {
        const memberVariants = declaredTaggedVariants(member, tagProperty, checker, seen);
        if (memberVariants == null)
          return null;
        variants.push(...memberVariants);
      }
      const [firstVariant, ...restVariants] = variants;
      if (firstVariant == null)
        return null;
      return { kind: "taggedUnion", tagProperty, variants: [firstVariant, ...restVariants] };
    }
    case null:
      return null;
  }
}
function numericLiteralInterval(type) {
  const members = type.isUnion() ? type.types : [type];
  if (!members.every((member) => (member.flags & ts6.TypeFlags.NumberLiteral) !== 0 && (member.flags & ts6.TypeFlags.EnumLiteral) === 0))
    return null;
  let lower = Infinity;
  let upper = -Infinity;
  let integer = true;
  for (const member of members) {
    const value2 = member.value;
    if (!Number.isFinite(value2))
      return "nonFinite";
    lower = Math.min(lower, value2);
    upper = Math.max(upper, value2);
    integer = integer && Number.isInteger(value2);
  }
  return members.length === 0 ? null : { lower, upper, integer };
}
function joinScalarDeclaredKinds(members) {
  const first = members[0];
  if (first == null)
    return null;
  switch (first.kind) {
    case "number": {
      let interval = first.interval;
      for (let index = 1;index < members.length; index++) {
        const member = members[index];
        if (member?.kind !== "number")
          return null;
        if (interval == null || member.interval == null) {
          interval = null;
        } else {
          interval = {
            lower: Math.min(interval.lower, member.interval.lower),
            upper: Math.max(interval.upper, member.interval.upper),
            integer: interval.integer && member.interval.integer
          };
        }
      }
      return { kind: "number", interval };
    }
    case "boolean":
      return members.every((member) => member?.kind === "boolean") ? first : null;
    case "opaque":
      return members.every((member) => member?.kind === "opaque") ? first : null;
    case "record":
    case "nullish":
    case "tuple":
    case "array":
    case "taggedUnion":
      return null;
  }
}
function tupleHasOptionalOrRestPositions(type, checker) {
  if (!checker.isTupleType(type))
    return false;
  return type.target.elementFlags.some((flags) => (flags & ts6.ElementFlags.Required) === 0);
}
function demote(bindings, binding) {
  const category = bindings[binding].category;
  switch (category.kind) {
    case "value": {
      bindings[binding].category = { kind: "kind", declaredKind: category.declaredKind };
      break;
    }
    case "importedConstant": {
      bindings[binding].category = { kind: "import" };
      break;
    }
    case "kind":
    case "import":
    case "opaque":
      break;
  }
}

// src/lower/static-intrinsics.ts
import * as ts7 from "typescript";
function scanStaticAnnotations(sourceFile, declarations, checker) {
  const ownerIndex = new Map(declarations.map((declaration, index) => [declaration, index]));
  const callsByFunction = declarations.map(() => []);
  const outsideTopLevelFunctions = [];
  const visit = (node) => {
    if (ts7.isCallExpression(node) && isStaticIntent(node, checker)) {
      const owner = ts7.findAncestor(node, ts7.isFunctionLike);
      const index = owner != null && ts7.isFunctionDeclaration(owner) ? ownerIndex.get(owner) : undefined;
      if (index == null)
        outsideTopLevelFunctions.push(node);
      else
        callsByFunction[index].push(node);
    }
    ts7.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    functions: declarations.map((declaration, index) => {
      const calls = callsByFunction[index];
      const callSet = new Set(calls);
      const leading = new Set;
      if (declaration.body != null) {
        for (const statement of declaration.body.statements) {
          if (!ts7.isExpressionStatement(statement) || !ts7.isCallExpression(statement.expression) || !callSet.has(statement.expression))
            break;
          leading.add(statement.expression);
        }
      }
      return calls.map((call) => annotationForCall(call, leading.has(call) ? "requirement" : "assertion"));
    }),
    outsideTopLevelFunctions
  };
}
function annotationForCall(call, role) {
  if (call.arguments.length !== 1) {
    return { kind: "invalid", call, role, node: call, problem: "argumentCount" };
  }
  if (!ts7.isExpressionStatement(call.parent) || call.parent.expression !== call) {
    return { kind: "invalid", call, role, node: call, problem: "position" };
  }
  const callee = call.expression;
  if (call.questionDotToken != null || ts7.isPropertyAccessExpression(callee) && callee.questionDotToken != null) {
    return { kind: "invalid", call, role, node: call, problem: "optionalCall" };
  }
  return { kind: "valid", call, role, condition: call.arguments[0] };
}
function isStaticIntent(call, checker) {
  if (!ts7.isPropertyAccessExpression(call.expression))
    return false;
  const access = call.expression;
  if (!ts7.isIdentifier(access.expression) || access.expression.text !== "console" || access.name.text !== "assert")
    return false;
  const resolved = checker.getSymbolAtLocation(access.expression);
  const globalConsole = checker.resolveName("console", undefined, ts7.SymbolFlags.Value, false);
  return resolved != null && resolved === globalConsole;
}

// src/lower/program.ts
function lowerSource(checked, baseDirectory = process.cwd(), crossFile) {
  const { sourceFile, checker } = checked;
  const declarations = [];
  for (const statement of sourceFile.statements) {
    if (ts8.isFunctionDeclaration(statement) && statement.name != null)
      declarations.push(statement);
  }
  const staticScan = scanStaticAnnotations(sourceFile, declarations, checker);
  const recordStaticAnnotationIssues = (sites2) => staticScan.outsideTopLevelFunctions.map((call) => {
    sites2.push(nodeSpan(sourceFile, call));
    return { kind: "outsideTopLevelFunction", site: sites2.length - 1 };
  });
  const rejectFile = (span, reason) => {
    const sites2 = [span];
    const staticAnnotationIssues2 = recordStaticAnnotationIssues(sites2);
    return {
      file: sourceFile.fileName,
      baseDirectory,
      lineStarts: [...sourceFile.getLineStarts()],
      sites: sites2,
      functions: declarations.map((declaration, index) => ({
        kind: "unsupported",
        name: declaration.name.text,
        hasStaticAnnotations: staticScan.functions[index].length > 0,
        site: 0,
        reason
      })),
      staticAnnotationIssues: staticAnnotationIssues2,
      moduleBindings: [],
      initializer: {
        kind: "lowered",
        name: moduleInitializerName,
        assertions: [],
        parameters: [],
        returnPropertyNames: null,
        entry: 0,
        blocks: [{ loopHeader: null, parameters: [], instructions: [], terminator: { kind: "stop", site: 0, reason } }]
      },
      initializerSkips: []
    };
  };
  const suppression = typeCheckSuppressionMention(sourceFile);
  if (suppression != null)
    return rejectFile(suppression, { kind: "typeCheckSuppressed" });
  const evalNode = evalMention(sourceFile);
  if (evalNode != null) {
    return rejectFile(nodeSpan(sourceFile, evalNode), { kind: "evalInFile" });
  }
  const functionsBySymbol = new Map;
  for (let index = 0;index < declarations.length; index++) {
    const declaration = declarations[index];
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (symbol == null)
      throw new Error(`Function declaration ${declaration.name.text} has no TypeScript symbol`);
    functionsBySymbol.set(symbol, { id: index, declaration });
  }
  const scan = scanModuleBindings(sourceFile, checker);
  const sites = [];
  const staticAnnotationIssues = recordStaticAnnotationIssues(sites);
  const functions = [];
  for (let index = 0;index < declarations.length; index++) {
    const declaration = declarations[index];
    const staticAnnotations = staticScan.functions[index];
    try {
      functions.push(lowerFunction(declaration, staticAnnotations, sourceFile, checker, functionsBySymbol, scan, sites, crossFile));
    } catch (error) {
      if (!(error instanceof LoweringStop))
        throw error;
      sites.push(nodeSpan(sourceFile, error.node));
      functions.push({
        kind: "unsupported",
        name: declaration.name.text,
        hasStaticAnnotations: staticAnnotations.length > 0,
        site: sites.length - 1,
        reason: error.reason
      });
    }
  }
  const { initializer, skips } = lowerModuleInitializer(sourceFile, checker, functionsBySymbol, scan, sites, crossFile);
  return {
    file: sourceFile.fileName,
    baseDirectory,
    lineStarts: [...sourceFile.getLineStarts()],
    sites,
    functions,
    staticAnnotationIssues,
    moduleBindings: scan.bindings,
    initializer,
    initializerSkips: skips
  };
}
function lowerFunction(declaration, staticAnnotations, sourceFile, checker, functionsBySymbol, scan, sites, crossFile) {
  for (const annotation of staticAnnotations) {
    if (annotation.kind === "invalid") {
      throw unsupported(annotation.node, { kind: "staticAssertionForm", problem: annotation.problem });
    }
  }
  if (declaration.body == null)
    throw unsupported(declaration, { kind: "functionWithoutBody" });
  if (declaration.asteriskToken != null || declaration.modifiers?.some((modifier) => modifier.kind === ts8.SyntaxKind.AsyncKeyword) === true) {
    throw unsupported(declaration, { kind: "asyncOrGeneratorFunction" });
  }
  assertAccepted(declaration);
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (signature != null && checker.getTypePredicateOfSignature(signature) != null) {
    throw unsupported(declaration, { kind: "typePredicate" });
  }
  const returnType = functionReturnType(declaration, checker);
  const returnsVoid = (returnType.flags & (ts8.TypeFlags.Void | ts8.TypeFlags.Undefined | ts8.TypeFlags.Never)) !== 0;
  if (!returnsVoid && valueKind(returnType, checker) == null) {
    throw unsupported(declaration.type ?? declaration, { kind: "valueType", typeText: checker.typeToString(returnType) });
  }
  const context = createFunctionContext(sourceFile, checker, functionsBySymbol, scan.bindingsBySymbol, sites, staticAnnotations, crossFile ?? null);
  const entry = context.currentBlock;
  for (const parameter of declaration.parameters) {
    if (ts8.isObjectBindingPattern(parameter.name)) {
      const type2 = lowerParameterType(parameter, checker);
      const patternName = parameter.name.getText(sourceFile).replace(/\s+/g, " ");
      if (parameter.initializer != null) {
        throw unsupported(parameter, { kind: "parameterDefaultValue", name: patternName });
      }
      const value3 = context.nextValue++;
      const bindings = [];
      context.parameters.push({ value: value3, name: patternName, type: type2, site: addSite(context, parameter), bindings });
      for (const element of parameter.name.elements) {
        if (!ts8.isIdentifier(element.name) || element.dotDotDotToken != null || element.initializer != null) {
          throw unsupported(element, { kind: "destructuredParameter" });
        }
        const property = element.propertyName == null ? element.name.text : ts8.isIdentifier(element.propertyName) ? element.propertyName.text : null;
        if (property == null)
          throw unsupported(element, { kind: "destructuredParameter" });
        bindings.push({ property, local: element.name.text });
        const read = {
          kind: "property",
          object: value3,
          property,
          result: context.nextValue++,
          site: addSite(context, element)
        };
        entry.instructions.push(read);
        context.bindings.set(requiredSymbol(element.name, checker), read.result);
      }
      continue;
    }
    if (!ts8.isIdentifier(parameter.name))
      throw unsupported(parameter.name, { kind: "destructuredParameter" });
    if (parameter.dotDotDotToken != null) {
      throw unsupported(parameter, { kind: "parameterType", typeText: `...${checker.typeToString(checker.getTypeAtLocation(parameter))}`, optionalOrRestTuple: false });
    }
    let type = lowerParameterType(parameter, checker);
    if (parameter.initializer != null) {
      const default_ = parameterDefaultLiteral(parameter.initializer, checker);
      if (default_ == null || !parameterDefaultFits(default_, type)) {
        throw unsupported(parameter, { kind: "parameterDefaultValue", name: parameter.name.text });
      }
      type = parameterBodyKind(type, default_);
    }
    const value2 = context.nextValue++;
    context.bindings.set(requiredSymbol(parameter.name, checker), value2);
    context.parameters.push({ value: value2, name: parameter.name.text, type, site: addSite(context, parameter), bindings: null });
  }
  lowerFiniteInputRequirements(context);
  lowerStatements(declaration.body.statements, context);
  if (context.currentBlock.terminator == null) {
    if (!returnsVoid) {
      terminate(context.currentBlock, { kind: "stop", site: addSite(context, declaration), reason: { kind: "missingReturn" } });
    } else {
      terminate(context.currentBlock, { kind: "return", value: null, site: addSite(context, declaration) });
    }
  }
  return {
    kind: "lowered",
    name: declaration.name.text,
    assertions: context.assertions,
    parameters: context.parameters,
    returnPropertyNames: declaredRecordReturnNames(returnType, checker),
    entry: 0,
    blocks: sealBlocks(context.blocks, declaration.name.text)
  };
}
function lowerFiniteInputRequirements(context) {
  for (const parameter of context.parameters) {
    for (const properties of finiteInputPaths(parameter.type)) {
      let value2 = parameter.value;
      for (const property of properties) {
        value2 = addInstructionAtSite(context, parameter.site, { kind: "property", object: value2, property });
      }
      const check = addInstructionAtSite(context, parameter.site, {
        kind: "numberCheck",
        predicate: "finite",
        value: value2,
        purpose: "finiteInput"
      });
      addInstructionAtSite(context, parameter.site, { kind: "staticRequire", value: check, purpose: "finiteInput" });
    }
  }
}
function parameterBodyKind(declared, default_) {
  if (declared.kind !== "nullish" || declared.sentinels === "null")
    return declared;
  if (default_.kind === "nullish" && default_.sentinel === "undefined")
    return declared;
  if (declared.sentinels === "undefined")
    return declared.inner;
  return { kind: "nullish", inner: declared.inner, sentinels: "null" };
}
function declaredRecordReturnNames(returnType, checker) {
  const kind = valueKind(returnType, checker);
  if (kind === "object")
    return checker.getPropertiesOfType(returnType).map((property) => property.name);
  if (kind === "nullable" && returnType.isUnion()) {
    const missing = ts8.TypeFlags.Null | ts8.TypeFlags.Undefined;
    const members = returnType.types.filter((member) => (member.flags & missing) === 0);
    if (members.length > 0 && members.every((member) => valueKind(member, checker) === "object")) {
      const names = new Set;
      for (const member of members) {
        for (const property of checker.getPropertiesOfType(member))
          names.add(property.name);
      }
      return [...names];
    }
  }
  return null;
}
function lowerParameterType(parameter, checker) {
  const type = checker.getTypeAtLocation(parameter);
  const declared = declaredKind(type, checker, []);
  if (declared == null) {
    throw unsupported(parameter, {
      kind: "parameterType",
      typeText: checker.typeToString(type),
      optionalOrRestTuple: tupleHasOptionalOrRestPositions(type, checker)
    });
  }
  return declared;
}
function functionReturnType(declaration, checker) {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (signature == null)
    throw unsupported(declaration, { kind: "functionWithoutSignature" });
  return checker.getReturnTypeOfSignature(signature);
}

// src/analyze.ts
function analyzeCheckedSource(checked, baseDirectory, crossFile) {
  const program = lowerSource(checked, baseDirectory, crossFile);
  const analysis = analyzeProgram(program);
  return { program, analysis };
}

// src/ir/instructions.ts
function forEachOperand(instruction, visit) {
  switch (instruction.kind) {
    case "constant":
    case "nullishConstant":
    case "opaqueConstant":
    case "unknownBoolean":
    case "parsedNumber":
    case "booleanConstant":
    case "moduleRead":
    case "moduleHavoc":
    case "platformValue":
      return;
    case "stringLength":
      visit(instruction.value);
      return;
    case "moduleWrite":
      visit(instruction.value);
      return;
    case "binary":
      visit(instruction.left);
      visit(instruction.right);
      return;
    case "compare":
      visit(instruction.left);
      visit(instruction.right);
      return;
    case "floor":
    case "absolute":
    case "mathUnary":
    case "numberCheck":
    case "not":
    case "staticRequire":
    case "staticAssert":
      visit(instruction.value);
      return;
    case "nullishCheck":
      visit(instruction.value);
      return;
    case "tagCheck":
      visit(instruction.union);
      return;
    case "arrayLiteral":
      for (const element of instruction.elements)
        visit(element);
      return;
    case "arrayLength":
      visit(instruction.array);
      return;
    case "arrayIndex":
      visit(instruction.array);
      visit(instruction.index);
      return;
    case "minimum":
    case "maximum":
      for (const id of instruction.values)
        visit(id);
      return;
    case "call":
      for (const id of instruction.arguments)
        visit(id);
      return;
    case "crossCall":
      for (const id of instruction.arguments)
        visit(id);
      return;
    case "object":
      for (const property of instruction.properties)
        visit(property.value);
      return;
    case "property":
      visit(instruction.object);
      return;
  }
}

// src/report/format-requirement.ts
function formatPrecondition(precondition, parameters, program) {
  const description = describePrecondition(precondition, parameters);
  const source = description.operation === "declared requirement" ? "declared at" : `${description.operation} at`;
  return `${description.condition} (${source} ${formatSite(program, precondition.site)})`;
}
function describePrecondition(precondition, parameters) {
  return {
    condition: conditionWords(precondition, parameters),
    operation: precondition.kind === "inBounds" ? "element read" : precondition.kind === "declaredComparison" || precondition.kind === "declaredNumberCheck" ? "declared requirement" : precondition.operation
  };
}
function formatObservedNeed(precondition, parameters, program) {
  if (precondition.kind === "declaredComparison" || precondition.kind === "declaredNumberCheck") {
    return `the requirement declared at ${formatSite(program, precondition.site)} is ${conditionWords(precondition, parameters)}`;
  }
  if (precondition.kind === "inBounds") {
    return `the element read at ${formatSite(program, precondition.site)} hits an element only when ${conditionWords(precondition, parameters)}`;
  }
  return `the ${precondition.operation} at ${formatSite(program, precondition.site)} gives a finite result only when ${conditionWords(precondition, parameters)}`;
}
function conditionWords(precondition, parameters) {
  switch (precondition.kind) {
    case "nonzero":
      return `${formatExpression(precondition.expression, parameters)} is nonzero`;
    case "notEqualConstant":
      return `${formatExpression(precondition.expression, parameters)} is not ${precondition.value}`;
    case "inBounds":
      return `${formatExpression(precondition.index, parameters)} is a valid ${formatExpression(precondition.sequence, parameters)} index`;
    case "declaredComparison":
      return `${formatExpression(precondition.left, parameters)} ${comparisonOperatorText(precondition.operator)} ${formatExpression(precondition.right, parameters)}`;
    case "declaredNumberCheck": {
      const predicate = precondition.predicate === "integer" ? "isInteger" : precondition.predicate === "finite" ? "isFinite" : "isNaN";
      return `Number.${predicate}(${formatExpression(precondition.expression, parameters)})`;
    }
  }
}
function formatExpression(expression, parameters) {
  const path = numericParameterPath(expression);
  if (path != null)
    return formatParameterPath(parameters, path.parameter, path.properties);
  switch (expression.kind) {
    case "parameter":
      throw new Error(`Missing parameter ${expression.index}`);
    case "constant":
      return String(expression.value);
    case "floor":
      return `Math.floor(${formatExpression(expression.operand, parameters)})`;
    case "property":
      return `${formatExpression(expression.base, parameters)}.${expression.name}`;
    case "binary": {
      return `(${formatExpression(expression.left, parameters)} ${operatorText(expression.operator)} ${formatExpression(expression.right, parameters)})`;
    }
  }
}
function formatParameterPath(parameters, index, properties) {
  const parameter = parameters[index];
  if (parameter == null)
    throw new Error(`Missing parameter ${index}`);
  const [first, ...rest] = properties;
  if (first == null)
    return parameter.name;
  const binding = parameter.bindings?.find((candidate) => candidate.property === first);
  return binding == null ? `${parameter.name}.${properties.join(".")}` : [binding.local, ...rest].join(".");
}
function operatorText(operator) {
  switch (operator) {
    case "add":
      return "+";
    case "subtract":
      return "-";
    case "multiply":
      return "*";
    case "divide":
      return "/";
    case "remainder":
      return "%";
  }
}
function comparisonOperatorText(operator) {
  switch (operator) {
    case "lessThan":
      return "<";
    case "lessThanOrEqual":
      return "<=";
    case "greaterThan":
      return ">";
    case "greaterThanOrEqual":
      return ">=";
    case "equal":
      return "===";
    case "notEqual":
      return "!==";
  }
}

// src/report/index.ts
function createReport(program, analysis) {
  const functions = [];
  const assumedBindings = functionModuleAssumptions(program, analysis);
  const initializerBounds = analysis.initializer.kind === "analyzed" ? analysis.initializer.boundsAssumptions : analysis.initializer.observedBoundsAssumptions;
  const initializerBoundsLines = initializerBounds.map((assumption) => formatBoundsAssumption(assumption, program));
  const firstSkip = program.initializerSkips[0];
  const skippedLines = firstSkip == null ? [] : [`${formatUnsupportedReason(firstSkip.reason)} at ${formatSite(program, firstSkip.site)}`];
  if (analysis.initializer.kind === "partial" || skippedLines.length > 0) {
    const observed = [];
    if (analysis.initializer.kind === "partial") {
      for (const need of analysis.initializer.observedNeeds)
        observed.push(formatObservedNeed(need, [], program));
    }
    functions.push({
      kind: "partial",
      name: program.initializer.name,
      assumptions: initializerBoundsLines,
      partialReasons: analysis.initializer.kind === "partial" ? analysis.initializer.stops.map((stop) => formatStop(stop, program, analysis)) : [],
      skipped: skippedLines,
      observed
    });
  }
  for (let functionID = 0;functionID < analysis.functions.length; functionID++) {
    const fn = analysis.functions[functionID];
    switch (fn.kind) {
      case "notLowered": {
        const lowering = fn.lowering;
        functions.push({
          kind: "unsupported",
          name: lowering.name,
          unsupported: `${formatUnsupportedReason(lowering.reason)} at ${formatSite(program, lowering.site)}`
        });
        break;
      }
      case "partial": {
        const lowering = fn.lowering;
        const observed = [];
        if (fn.observedReturn != null) {
          observed.push(...returnSummaries("return", declaredReturn(fn.observedReturn.value, lowering), program));
        }
        for (const need of fn.observedNeeds)
          observed.push(formatObservedNeed(need, lowering.parameters, program));
        functions.push({
          kind: "partial",
          name: lowering.name,
          assumptions: assumptionLines(lowering, program, assumedBindings[functionID], fn.observedBoundsAssumptions, []),
          partialReasons: fn.stops.map((stop) => formatStop(stop, program, analysis)),
          observed,
          ...fn.assertions.length === 0 ? {} : { assertions: assertionReports(fn.assertions, program) }
        });
        break;
      }
      case "analyzed": {
        const lowering = fn.lowering;
        const finite = finiteInputs(lowering);
        const requires = requirementLines(lowering, finite, fn.preconditions, program);
        const assumptions = assumptionLines(lowering, program, assumedBindings[functionID], fn.boundsAssumptions, finiteAssumptionInputs(lowering, finite, fn.preconditions));
        functions.push({
          kind: "analyzed",
          name: lowering.name,
          assumptions,
          requires,
          ensures: returnSummaries("return", declaredReturn(fn.returnValue, lowering), program),
          ...fn.assertions.length === 0 ? {} : { assertions: assertionReports(fn.assertions, program) }
        });
        break;
      }
    }
  }
  return { functions };
}
function finiteAssumptionInputs(fn, automatic, preconditions) {
  const inputs = [...automatic];
  const paths = finitePathIndexes(fn, inputs);
  for (const precondition of preconditions) {
    if (precondition.kind !== "declaredNumberCheck" || precondition.predicate !== "finite" && precondition.predicate !== "integer")
      continue;
    const path = numericParameterPath(precondition.expression);
    if (path == null || pathIndexHas(paths[path.parameter], path.properties))
      continue;
    inputs.push({ parameter: path.parameter, properties: path.properties, site: precondition.site });
    pathIndexAdd(paths[path.parameter], path.properties);
  }
  return inputs;
}
function requirementLines(fn, inputs, preconditions, program) {
  const inputsByParameter = fn.parameters.map(() => []);
  for (const input of inputs)
    inputsByParameter[input.parameter].push(input);
  const folded = [];
  for (let parameter = 0;parameter < fn.parameters.length; parameter++) {
    const current = fn.parameters[parameter];
    folded[parameter] = current.bindings != null || inputsByParameter[parameter].length >= 3;
  }
  const lines = [];
  const emitted = [];
  for (const precondition of preconditions) {
    const isFiniteInput = precondition.kind === "declaredNumberCheck" && precondition.predicate === "finite" && precondition.purpose === "finiteInput";
    const path = isFiniteInput ? numericParameterPath(precondition.expression) : null;
    if (path != null && folded[path.parameter]) {
      if (!emitted[path.parameter]) {
        const parameter = fn.parameters[path.parameter];
        const parameterInputs = inputsByParameter[path.parameter];
        const condition = parameter.bindings == null ? `every number field in ${parameter.name} is finite` : finiteBindingList(parameter, parameterInputs);
        lines.push(`${condition} (input at ${formatSite(program, parameter.site)})`);
        emitted[path.parameter] = true;
      }
      continue;
    }
    if (isFiniteInput) {
      lines.push(`${describePrecondition(precondition, fn.parameters).condition} (input at ${formatSite(program, precondition.site)})`);
      continue;
    }
    lines.push(formatPrecondition(precondition, fn.parameters, program));
  }
  return lines;
}
function finiteBindingList(parameter, inputs) {
  const bindings = parameter.bindings == null ? null : new Map(parameter.bindings.map((binding) => [binding.property, binding.local]));
  const names = inputs.map((input) => {
    const [first, ...rest] = input.properties;
    const binding = first == null ? null : bindings?.get(first);
    return binding == null ? input.properties.join(".") : [binding, ...rest].join(".");
  });
  if (names.length === 1)
    return `${names[0]} is finite`;
  if (names.length === 2)
    return `${names[0]} and ${names[1]} are finite`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} are finite`;
}
function formatReport(report) {
  const lines = [];
  for (const fn of report.functions) {
    if (lines.length > 0)
      lines.push("");
    lines.push(fn.name);
    switch (fn.kind) {
      case "analyzed": {
        for (const precondition of fn.requires)
          lines.push(`  requires: ${precondition}`);
        for (const assertion of fn.assertions ?? [])
          lines.push(formatAssertionReport(assertion));
        for (const guarantee of fn.ensures)
          lines.push(`  ensures: ${guarantee}`);
        for (const assumption of fn.assumptions)
          lines.push(`  assumes: ${assumption}`);
        break;
      }
      case "unsupported": {
        lines.push(`  unsupported: ${fn.unsupported}`);
        break;
      }
      case "partial": {
        for (const assertion of fn.assertions ?? [])
          lines.push(formatAssertionReport(assertion));
        for (const assumption of fn.assumptions)
          lines.push(`  assumes: ${assumption}`);
        for (const reason of fn.partialReasons)
          lines.push(`  partially supported: ${reason}`);
        for (const skip of fn.skipped ?? [])
          lines.push(`  skipped: ${skip}`);
        for (const evidence of fn.observed)
          lines.push(`  on analyzed paths: ${evidence}`);
        break;
      }
    }
  }
  return lines.join(`
`);
}
function assertionReports(assertions, program) {
  return assertions.map((assertion) => ({
    verdict: assertion.verdict,
    text: assertion.text,
    location: formatSite(program, assertion.site)
  }));
}
function formatAssertionReport(assertion) {
  switch (assertion.verdict) {
    case "proven":
      return `  proves: ${assertion.text} (assertion at ${assertion.location})`;
    case "refuted":
      return `  assertion can fail: ${assertion.text} (at ${assertion.location})`;
    case "unproven":
      return `  assertion unproven: could not prove ${assertion.text} (at ${assertion.location})`;
    case "dead":
      return `  unreachable assertion: ${assertion.text} (at ${assertion.location})`;
    case "blocked":
      return `  assertion blocked: the function did not finish analysis without site-specific assumptions: ${assertion.text} (at ${assertion.location})`;
  }
}
function formatTagValue(tagValue) {
  return typeof tagValue === "string" ? `'${tagValue}'` : String(tagValue);
}
function parameterReadPaths(fn) {
  const tracked = new Map;
  const projections = new Map;
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      if (instruction.kind !== "property")
        continue;
      const dependents = projections.get(instruction.object) ?? [];
      dependents.push({ result: instruction.result, property: instruction.property });
      projections.set(instruction.object, dependents);
    }
  }
  const queue = [];
  for (let index = 0;index < fn.parameters.length; index++) {
    const value2 = fn.parameters[index].value;
    tracked.set(value2, { parameter: index, segments: [] });
    queue.push(value2);
  }
  for (let current = 0;current < queue.length; current++) {
    const value2 = queue[current];
    const base = tracked.get(value2);
    for (const projection of projections.get(value2) ?? []) {
      if (tracked.has(projection.result))
        continue;
      tracked.set(projection.result, {
        parameter: base.parameter,
        segments: [...base.segments, projection.property]
      });
      queue.push(projection.result);
    }
  }
  const reads = fn.parameters.map(() => ({ terminal: false, children: new Map }));
  const markOperand = (operand) => {
    const path = tracked.get(operand);
    if (path != null)
      pathIndexAdd(reads[path.parameter], path.segments);
  };
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      switch (instruction.kind) {
        case "property":
          break;
        case "tagCheck":
          break;
        case "numberCheck": {
          if (instruction.purpose !== "finiteInput")
            forEachOperand(instruction, markOperand);
          break;
        }
        default:
          forEachOperand(instruction, markOperand);
      }
    }
    const terminator = block.terminator;
    switch (terminator.kind) {
      case "return": {
        if (terminator.value != null)
          markOperand(terminator.value);
        break;
      }
      case "jump": {
        for (const argument of terminator.target.arguments)
          markOperand(argument);
        break;
      }
      case "branch": {
        markOperand(terminator.condition);
        for (const argument of terminator.whenTrue.arguments)
          markOperand(argument);
        for (const argument of terminator.whenFalse.arguments)
          markOperand(argument);
        break;
      }
      case "stop":
      case "thrown":
        break;
    }
  }
  return reads;
}
var keepEverything = () => true;
function assumptionLines(fn, program, assumedBindings, boundsAssumptions, finiteRequirements) {
  const assumptions = [];
  const reads = parameterReadPaths(fn);
  const finitePaths = finitePathIndexes(fn, finiteRequirements);
  for (let index = 0;index < fn.parameters.length; index++) {
    const parameter = fn.parameters[index];
    const keep = (path) => !pathIndexHas(finitePaths[index], path) && pathIndexOverlaps(reads[index], path);
    if (parameter.bindings == null) {
      pushRootAssumptions(parameter.name, parameter.type, assumptions, keep);
      continue;
    }
    if (parameter.type.kind !== "record") {
      const start = assumptions.length;
      pushRootAssumptions(parameter.name, parameter.type, assumptions, keep);
      for (let line = start;line < assumptions.length; line++) {
        for (const binding of parameter.bindings) {
          assumptions[line] = assumptions[line].replaceAll(`${parameter.name}.${binding.property}`, binding.local);
        }
      }
      continue;
    }
    const properties = new Map(parameter.type.properties.map((property) => [property.name, property.declared]));
    for (const binding of parameter.bindings) {
      const property = properties.get(binding.property);
      if (property == null)
        continue;
      pushRootAssumptions(binding.local, property, assumptions, (path) => keep([binding.property, ...path]));
    }
  }
  for (const bindingID of assumedBindings) {
    const binding = program.moduleBindings[bindingID];
    const declaredKind2 = declaredKindOf(binding.category);
    if (declaredKind2 == null)
      throw new Error(`Module binding ${binding.name} has no declared kind to assume`);
    pushRootAssumptions(binding.name, declaredKind2, assumptions, keepEverything);
  }
  for (const assumption of boundsAssumptions) {
    assumptions.push(formatBoundsAssumption(assumption, program));
  }
  return assumptions;
}
function finitePathIndexes(fn, inputs) {
  const indexes = fn.parameters.map(() => ({ terminal: false, children: new Map }));
  for (const input of inputs)
    pathIndexAdd(indexes[input.parameter], input.properties);
  return indexes;
}
function pathIndexAdd(index, path) {
  let current = index;
  for (const segment of path) {
    let child = current.children.get(segment);
    if (child == null) {
      child = { terminal: false, children: new Map };
      current.children.set(segment, child);
    }
    current = child;
  }
  current.terminal = true;
}
function pathIndexHas(index, path) {
  let current = index;
  for (const segment of path) {
    const child = current.children.get(segment);
    if (child == null)
      return false;
    current = child;
  }
  return current.terminal;
}
function pathIndexOverlaps(index, path) {
  let current = index;
  if (current.terminal)
    return true;
  for (const segment of path) {
    const child = current.children.get(segment);
    if (child == null)
      return false;
    current = child;
    if (current.terminal)
      return true;
  }
  return current.children.size > 0;
}
function formatBoundsAssumption(assumption, program) {
  switch (assumption.kind) {
    case "elementInBounds":
      return `the element read at ${formatSite(program, assumption.site)} is in bounds`;
    case "nonzeroDivisor":
      return `the divisor at ${formatSite(program, assumption.site)} is nonzero`;
  }
}
function pushRootAssumptions(path, declared, assumptions, keep) {
  const numberLeaves = numberLeafCount(declared, [], keep);
  const folds = !hasLiteralNumberInterval(declared) && numberLeaves.total >= 3 && numberLeaves.kept === numberLeaves.total && declared.kind !== "number";
  if (folds)
    assumptions.push(`every property declared as a number in ${path} holds a finite non-NaN number`);
  if (declared.kind === "record") {
    const arrayProperties = declared.properties.filter((property) => property.declared.kind === "array");
    const keptArrayProperties = arrayProperties.filter((property) => keep([property.name]));
    if (arrayProperties.length >= 3 && keptArrayProperties.length === arrayProperties.length) {
      assumptions.push(`every property declared as an array in ${path} holds a plain array — its length counts its elements, and every index below the length holds an element`);
      for (const property of declared.properties) {
        pushDeclaredAssumptions(`${path}.${property.name}`, [property.name], property.declared, assumptions, keep, {
          skipNumberLeaves: folds,
          skipOwnArrayLine: property.declared.kind === "array"
        });
      }
      return;
    }
  }
  pushDeclaredAssumptions(path, [], declared, assumptions, keep, { skipNumberLeaves: folds, skipOwnArrayLine: false });
}
function numberLeafCount(declared, segments, keep) {
  switch (declared.kind) {
    case "number":
      return { total: 1, kept: keep(segments) ? 1 : 0 };
    case "boolean":
      return { total: 0, kept: 0 };
    case "opaque":
      return { total: 0, kept: 0 };
    case "nullish":
      return { total: 0, kept: 0 };
    case "array":
      return numberLeafCount(declared.element, [...segments, "[each]"], keep);
    case "tuple": {
      const count = { total: 0, kept: 0 };
      for (let index = 0;index < declared.elements.length; index++) {
        const element = numberLeafCount(declared.elements[index], [...segments, String(index)], keep);
        count.total += element.total;
        count.kept += element.kept;
      }
      return count;
    }
    case "record": {
      const count = { total: 0, kept: 0 };
      for (const property of declared.properties) {
        const inner = numberLeafCount(property.declared, [...segments, property.name], keep);
        count.total += inner.total;
        count.kept += inner.kept;
      }
      return count;
    }
    case "taggedUnion":
      return { total: 0, kept: 0 };
  }
}
var exactLeaves = { skipNumberLeaves: false, skipOwnArrayLine: false };
function pushDeclaredAssumptions(path, segments, declared, assumptions, keep, options = exactLeaves) {
  switch (declared.kind) {
    case "number": {
      if (!options.skipNumberLeaves && keep(segments)) {
        assumptions.push(`${path} is ${declaredNumberAssumption(declared)}`);
      }
      break;
    }
    case "boolean": {
      if (keep(segments))
        assumptions.push(`${path} is a boolean`);
      break;
    }
    case "tuple": {
      const count = declared.elements.length;
      if (keep(segments)) {
        assumptions.push(`${path} is a plain array of exactly ${count} element${count === 1 ? "" : "s"} — its length counts its elements, and every index below the length holds an element`);
      }
      for (let index = 0;index < declared.elements.length; index++) {
        pushDeclaredAssumptions(`${path}[${index}]`, [...segments, String(index)], declared.elements[index], assumptions, keep, options);
      }
      break;
    }
    case "array": {
      if (!options.skipOwnArrayLine && keep(segments)) {
        assumptions.push(`${path} is a plain array — its length counts its elements, and every index below the length holds an element`);
      }
      const leaf = [];
      pushDeclaredAssumptions(`${path}[each]`, [...segments, "[each]"], declared.element, leaf, keep, { skipNumberLeaves: options.skipNumberLeaves, skipOwnArrayLine: false });
      for (const line of leaf) {
        const prefix = `${path}[each] is `;
        const mentionsOnce = line.split(`${path}[each]`).length === 2;
        assumptions.push(line.startsWith(prefix) && mentionsOnce ? `every ${path} element is ${line.slice(prefix.length)}` : line);
      }
      break;
    }
    case "opaque":
      break;
    case "nullish": {
      if (!keep(segments))
        break;
      const sentinelWords = declared.sentinels === "both" ? "null or undefined" : declared.sentinels;
      if (declared.inner.kind === "number") {
        const numberWords = declared.inner.interval == null ? "a finite non-NaN number" : declaredNumberAssumption(declared.inner);
        assumptions.push(`${path} is ${sentinelWords} or ${numberWords}`);
      } else if (declared.inner.kind === "boolean") {
        assumptions.push(`${path} is ${sentinelWords} or a boolean`);
      } else {
        const leaf = [];
        pushDeclaredAssumptions(path, segments, declared.inner, leaf, keep, exactLeaves);
        for (const line of leaf)
          assumptions.push(`${path} is ${sentinelWords} or ${line}`);
      }
      break;
    }
    case "record": {
      for (const property of declared.properties) {
        pushDeclaredAssumptions(`${path}.${property.name}`, [...segments, property.name], property.declared, assumptions, keep, options);
      }
      break;
    }
    case "taggedUnion": {
      for (const variant of declared.variants) {
        const sharedTag = declared.variants.filter((candidate) => candidate.tagValue === variant.tagValue).length > 1;
        const leaf = [];
        for (const property of variant.properties) {
          if (property.name === declared.tagProperty)
            continue;
          const qualifier = sharedTag ? `when ${path}.${declared.tagProperty} is ${formatTagValue(variant.tagValue)} and ${path}.${property.name} is present` : `when ${path}.${declared.tagProperty} is ${formatTagValue(variant.tagValue)}`;
          const perProperty = [];
          pushDeclaredAssumptions(`${path}.${property.name}`, [...segments, property.name], property.declared, perProperty, keep, exactLeaves);
          for (const line of perProperty)
            leaf.push(`${line} (${qualifier})`);
        }
        for (const line of leaf) {
          if (!assumptions.includes(line))
            assumptions.push(line);
        }
      }
      break;
    }
  }
}
function hasLiteralNumberInterval(declared) {
  switch (declared.kind) {
    case "number":
      return declared.interval != null;
    case "boolean":
    case "opaque":
      return false;
    case "nullish":
      return hasLiteralNumberInterval(declared.inner);
    case "tuple":
      return declared.elements.some(hasLiteralNumberInterval);
    case "array":
      return hasLiteralNumberInterval(declared.element);
    case "record":
      return declared.properties.some((property) => hasLiteralNumberInterval(property.declared));
    case "taggedUnion":
      return declared.variants.some((variant) => variant.properties.some((property) => hasLiteralNumberInterval(property.declared)));
  }
}
function declaredNumberAssumption(declared) {
  if (declared.interval == null)
    return "finite and not NaN";
  const integer = declared.interval.integer ? " integer" : "";
  return `a finite${integer} number from ${String(declared.interval.lower)} through ${String(declared.interval.upper)}`;
}
function functionModuleAssumptions(program, analysis) {
  const usage = functionUsage(program);
  const direct = usage.map((fn) => {
    const reads = new Set;
    for (const bindingID of fn.moduleBindings) {
      if (analysis.moduleValues[bindingID] != null)
        continue;
      const binding = program.moduleBindings[bindingID];
      if (binding == null)
        throw new Error(`Unknown module binding ${bindingID}`);
      if (declaredKindOf(binding.category) != null)
        reads.add(bindingID);
    }
    return reads;
  });
  return transitiveModuleBindings(usage, direct);
}
function formatStop(stop, program, analysis) {
  const reason = stop.reason;
  switch (reason.kind) {
    case "recursion": {
      return `recursive call to ${functionName(program, reason.callee)} (call at ${formatSite(program, stop.site)})`;
    }
    case "calleeStopped": {
      const calleeState = calleeStateText(analysis.functions[reason.callee]);
      return `calls ${functionName(program, reason.callee)}, ${calleeState} (call at ${formatSite(program, stop.site)})`;
    }
    case "kindMismatch": {
      return `uses a value whose runtime kind the analysis cannot establish (at ${formatSite(program, stop.site)})`;
    }
    case "possiblyMissingElement": {
      return `uses a possibly missing array element without handling undefined (at ${formatSite(program, stop.site)})`;
    }
    case "requirementFailure": {
      return formatRequirementFailure(reason.failure, reason.callee, stop.site, program);
    }
    case "loopLimit": {
      return `the loop at ${formatSite(program, stop.site)} did not converge after ${reason.updates} updates`;
    }
    case "nonExitingLoop": {
      return `the loop at ${formatSite(program, stop.site)} never exits on any analyzed path`;
    }
    case "unsupportedCode": {
      return `${formatUnsupportedReason(reason.reason)} at ${formatSite(program, stop.site)}`;
    }
    case "moduleRead": {
      const binding = program.moduleBindings[reason.binding];
      if (binding == null)
        throw new Error(`Unknown module binding ${reason.binding}`);
      switch (binding.category.kind) {
        case "import":
        case "importedConstant":
          return `reads ${binding.name}, which is imported from another module (read at ${formatSite(program, stop.site)})`;
        case "opaque":
          return `reads ${binding.name}, whose value the analysis does not track (read at ${formatSite(program, stop.site)})`;
        case "value":
        case "kind":
          return `reads ${binding.name} before it is initialized (read at ${formatSite(program, stop.site)})`;
      }
    }
  }
}
function formatRequirementFailure(failure, calleeID, stopSite, program) {
  const origin = formatSite(program, failure.site);
  if (calleeID == null) {
    switch (failure.kind) {
      case "elementInBounds":
        return `reads an element provably outside the array (at ${origin})`;
      case "nonzeroDivisor":
        return `${failure.operation} has a divisor that is definitely zero (at ${origin})`;
      case "finiteInput":
        return failure.status === "refuted" ? `number input is definitely not finite (at ${origin})` : `could not verify the number input (at ${origin})`;
      case "declared":
        return failure.status === "refuted" ? `declared requirement is false (at ${origin})` : `could not express or prove the declared requirement (at ${origin})`;
    }
  }
  const callee = functionName(program, calleeID);
  const callSite = formatSite(program, stopSite);
  switch (failure.kind) {
    case "elementInBounds":
      return `call to ${callee} makes an asserted element read definitely out of bounds (call at ${callSite}; element read at ${origin})`;
    case "nonzeroDivisor":
      return `call to ${callee} violates its nonzero divisor requirement (call at ${callSite}; ${failure.operation} at ${origin})`;
    case "finiteInput":
      return failure.status === "refuted" ? `call to ${callee} passes a number that is definitely not finite (call at ${callSite}; input declared at ${origin})` : `could not verify ${callee}'s number input (call at ${callSite}; input declared at ${origin})`;
    case "declared":
      return failure.status === "refuted" ? `call to ${callee} makes its declared requirement definitely false (call at ${callSite}; declared at ${origin})` : `could not express or prove ${callee}'s declared requirement (call at ${callSite}; declared at ${origin})`;
  }
}
function calleeStateText(callee) {
  if (callee == null)
    return "which is only partially supported";
  switch (callee.kind) {
    case "notLowered":
      return "which hit unsupported code";
    case "partial":
      return "which is only partially supported";
    case "analyzed":
      return "which could not be fully analyzed for this specific call";
  }
}
function functionName(program, callee) {
  const fn = program.functions[callee];
  if (fn == null)
    throw new Error(`Unknown function ${callee}`);
  return fn.name;
}
function formatUnsupportedReason(reason) {
  switch (reason.kind) {
    case "unknownIdentifier":
      return `unknown identifier ${reason.name}`;
    case "missingSymbol":
      return "node without a TypeScript symbol";
    case "functionWithoutSignature":
      return "function without a TypeScript signature";
    case "functionWithoutBody":
      return "function declarations need bodies";
    case "destructuredParameter":
      return "destructured parameters (take a named parameter and destructure it in the body)";
    case "parameterType":
      return reason.optionalOrRestTuple ? `function parameter with type ${reason.typeText} (a tuple position marked optional or rest makes the runtime length a range, which is outside the analyzed subset; model the value as number[], or as a fixed tuple like [number, number])` : `function parameter with type ${reason.typeText}`;
    case "parameterDefaultValue":
      return `default value for parameter ${reason.name}; supported defaults are literals provably inside the assumed kind (= 5 for a number, = null for a nullable) — otherwise drop the default and pass the argument explicitly`;
    case "missingReturn":
      return "function path without a return (add a return on every path)";
    case "objectPropertyForm":
      return "object property form (use plain data properties: name: value or shorthand)";
    case "computedPropertyName":
      return "computed object property name";
    case "objectSpread":
      return "object spread (list every field explicitly, e.g. {gain: config.gain})";
    case "asyncOrGeneratorFunction":
      return "an async or generator function (the runtime result is a Promise or iterator, not the body's return value)";
    case "typePredicate":
      return "a type predicate (the checker takes the predicate on faith; return a plain boolean and check properties where they are read)";
    case "protoProperty":
      return "a property named __proto__ (prototype-setting syntax at runtime, not a data property)";
    case "enumMemberRead":
      return "an enum member read (replace the enum with plain module consts, e.g. const directionUp = 1)";
    case "prototypeMemberRead":
      return `read of the inherited prototype member ${reason.property} (records carry only their own data properties)`;
    case "binaryOperator":
      return reason.operator === "in" ? "the `in` operator (use a distinct string or boolean tag when property presence distinguishes union variants)" : `binary operator ${reason.operator} (supported: + - * / %, comparisons, and boolean && || !)`;
    case "call":
      return reason.callee === "Object.assign" ? "function call Object.assign (object mutation is outside the subset; rebuilding a plain-data record may be suitable when identity and mutation are not observed)" : reason.arrayMethod != null ? `function call ${reason.callee} (array methods are outside the subset; a for loop may suit simple dense-array aggregation)` : `function call ${reason.callee}`;
    case "callWithFewerArguments":
      return `call to ${reason.callee} with fewer arguments than parameters (pass every argument explicitly)`;
    case "callWithMoreArguments":
      return `call to ${reason.callee} with more arguments than its implementation declares`;
    case "nonNumberOperand":
      return `non-number operand of type ${reason.typeText}`;
    case "nonBooleanCondition":
      return `condition of type ${reason.typeText} (compare explicitly, e.g. width > 0 or mode !== undefined)`;
    case "valueType":
      return `value of type ${reason.typeText}`;
    case "kindChangingAssertion":
      return `a non-null assertion turning ${reason.fromText} into ${reason.toText}`;
    case "propertyReadOnNonObject":
      return `property read from ${reason.typeText}`;
    case "statementAfterReturn":
      return "statements after return";
    case "assignmentInValuePosition":
      return "an assignment used as a value (write it as its own statement)";
    case "propertyWrite":
      return "a write into an object (mutation is outside the subset; rebuilding a plain-data record may be suitable when identity and mutation are not observed)";
    case "staticAssertionForm": {
      switch (reason.problem) {
        case "argumentCount":
          return "console.assert must have exactly one condition argument";
        case "position":
          return "console.assert must be a standalone statement";
        case "optionalCall":
          return "optional console.assert calls are not supported";
        case "directCheck":
          return "console.assert must contain one direct numeric comparison using ===, !==, <, <=, >, or >=, or a supported Number check";
        case "bindValueFirst":
          return "calculate or read the value before console.assert, then check the variable";
        case "functionCall":
          return "console.assert cannot call a function inside its condition except Number.isInteger, Number.isFinite, or Number.isNaN";
        case "callerRequirement":
          return "a leading console.assert describes what callers must provide. It can compare one parameter with a fixed finite number, require one parameter to be an integer, or require a parameter or fixed-record property to be finite";
      }
    }
    case "varDeclaration":
      return "var declarations (use let or const)";
    case "evalInFile":
      return "eval appears in this file; an eval string can rewrite any binding, so no function in the file is analyzed";
    case "typeCheckSuppressed":
      return "a @ts-ignore, @ts-expect-error, or @ts-nocheck comment turns off type checking in this file, so declared types cannot be trusted and no function is analyzed";
    case "forLoopWithoutCondition":
      return "for loop without a condition";
    case "variableDeclarationShape":
      return "variables without identifier names and initializers";
    case "expressionForm":
      return `expression (${reason.syntax})`;
    case "statementForm":
      return `statement (${reason.syntax})`;
    case "switchFallthrough":
      return "switch case that falls through to the next case (end every case body with break or return)";
    case "switchDefaultNotLast":
      return "switch with a default clause before other cases (write default as the last clause)";
    case "switchSubject":
      return `switch on a value of type ${reason.typeText} (only numbers and strings dispatch)`;
    case "switchLabel":
      return `switch case label of type ${reason.typeText} (labels must be literals matching the subject's kind)`;
  }
}
function declaredReturn(value2, lowering) {
  if (lowering.returnPropertyNames == null)
    return value2;
  const declared = new Set(lowering.returnPropertyNames);
  if (value2.kind === "record") {
    return { kind: "record", properties: value2.properties.filter((property) => declared.has(property.name)) };
  }
  if (value2.kind === "maybeNullish" && value2.inner.kind === "record") {
    return {
      ...value2,
      inner: { kind: "record", properties: value2.inner.properties.filter((property) => declared.has(property.name)) }
    };
  }
  return value2;
}
function returnSummaries(path, value2, program) {
  switch (value2.kind) {
    case "number":
      return [numberSummary(path, value2, program)];
    case "boolean":
      return [`${path} is ${value2.canBeFalse ? value2.canBeTrue ? "boolean" : "false" : "true"}`];
    case "record": {
      const summaries = [];
      for (const property of value2.properties) {
        summaries.push(...returnSummaries(`${path}.${property.name}`, property.value, program));
      }
      return summaries;
    }
    case "void":
      return [];
    case "opaque":
      return [];
    case "nullish":
      return [`${path} is ${sentinelsText(value2.sentinels)}`];
    case "tuple": {
      const lines = [`${path}.length is exactly ${value2.elements.length}`];
      for (let index = 0;index < value2.elements.length; index++) {
        lines.push(...returnSummaries(`${path}[${index}]`, value2.elements[index], program));
      }
      return lines;
    }
    case "array": {
      const lines = [numberSummary(`${path}.length`, value2.length, program)];
      if (value2.element != null) {
        lines.push(...returnSummaries(`${path}[each]`, value2.element, program).map((line) => line.startsWith(`${path}[each] is `) ? `every ${path} element is ${line.slice(`${path}[each] is `.length)}` : line));
      }
      return lines;
    }
    case "taggedUnion": {
      const uniqueTags = [];
      for (const variant of value2.variants) {
        if (!uniqueTags.includes(variant.tagValue))
          uniqueTags.push(variant.tagValue);
      }
      const lines = [`${path}.${value2.tagProperty} is ${uniqueTags.map(formatTagValue).join(" or ")}`];
      for (const tagValue of uniqueTags) {
        const group = value2.variants.filter((variant) => variant.tagValue === tagValue);
        const names = [];
        for (const variant of group) {
          for (const property of variant.record.properties) {
            if (property.name === value2.tagProperty)
              continue;
            if (!names.includes(property.name))
              names.push(property.name);
          }
        }
        for (const name of names) {
          const carried = group.map((variant) => recordProperty(variant.record, name)).filter((propertyValue) => propertyValue != null);
          let joined = null;
          for (const propertyValue of carried) {
            joined = joined == null ? propertyValue : tryJoinValues(joined, propertyValue);
            if (joined == null)
              break;
          }
          if (joined == null)
            continue;
          const qualifier = value2.variants.length === 1 ? null : carried.length === group.length ? `when ${path}.${value2.tagProperty} is ${formatTagValue(tagValue)}` : `when ${path}.${value2.tagProperty} is ${formatTagValue(tagValue)} and ${path}.${name} is present`;
          const summaries = returnSummaries(`${path}.${name}`, joined, program);
          lines.push(...qualifier == null ? summaries : summaries.map((line) => `${line} (${qualifier})`));
        }
      }
      return lines;
    }
    case "maybeNullish": {
      const inner = returnSummaries(path, value2.inner, program);
      if (inner.length === 0)
        return [`${path} may be ${sentinelsText(value2.sentinels)}`];
      if (inner.length === 1 && inner[0].startsWith(`${path} is `)) {
        return [`${path} is ${sentinelsText(value2.sentinels)} or ${inner[0].slice(`${path} is `.length)}`];
      }
      return [`${path} may be ${sentinelsText(value2.sentinels)}; when present:`, ...inner];
    }
  }
}
function sentinelsText(sentinels) {
  return sentinels === "both" ? "null or undefined" : sentinels;
}
function numberSummary(path, value2, program) {
  const kind = value2.integer ? "integer " : "";
  const domain = value2.mayBeNaN ? "possibly NaN " : isFiniteNumber(value2) ? "finite " : "possibly non-finite ";
  const blameSite = value2.mayBeNaN ? value2.nanSite : value2.nonFiniteSite;
  const blame = blameSite == null || isFiniteNumber(value2) && !value2.mayBeNaN ? "" : value2.mayBeNaN ? ` (NaN possible from the operation at ${formatSite(program, blameSite)})` : ` (can overflow at ${formatSite(program, blameSite)})`;
  const subject = `${path} is a ${domain}${kind}number`;
  const pointInterval = value2.lower === value2.upper;
  const strictLower2 = pointInterval ? null : strictBoundWords(value2.lower, "lower");
  const strictUpper2 = pointInterval ? null : strictBoundWords(value2.upper, "upper");
  if (value2.lower === -Number.MAX_VALUE && value2.upper === Number.MAX_VALUE)
    return `${subject}${blame}`;
  if (value2.upper === Number.MAX_VALUE) {
    return `${subject} ${strictLower2 ?? `at least ${formatNumber(value2.lower)}`}${blame}`;
  }
  if (value2.lower === -Number.MAX_VALUE) {
    return `${subject} ${strictUpper2 ?? `at most ${formatNumber(value2.upper)}`}${blame}`;
  }
  if (strictLower2 != null || strictUpper2 != null) {
    const low = strictLower2 ?? `at least ${formatNumber(value2.lower)}`;
    const high = strictUpper2 ?? `at most ${formatNumber(value2.upper)}`;
    return `${subject} ${low} and ${high}${blame}`;
  }
  return `${subject} from ${formatNumber(value2.lower)} through ${formatNumber(value2.upper)}${blame}`;
}
function strictBoundWords(bound, side) {
  const stepped = side === "lower" ? nextDown(bound) : nextUp(bound);
  if (formatNumber(stepped).length + 4 <= formatNumber(bound).length) {
    return `${side === "lower" ? "more than" : "less than"} ${formatNumber(stepped)}`;
  }
  return null;
}
function formatNumber(value2) {
  return String(value2);
}

// src/typescript/diagnostics.ts
import * as ts9 from "typescript";

class TypeScriptDiagnosticsError extends Error {
  diagnostics;
  options;
  currentDirectory;
  constructor(diagnostics, options, currentDirectory) {
    super(formatTypeScriptDiagnostics(diagnostics, { ...options, pretty: false }, currentDirectory));
    this.diagnostics = diagnostics;
    this.options = options;
    this.currentDirectory = currentDirectory;
    this.name = "TypeScriptDiagnosticsError";
  }
}
function formatTypeScriptDiagnostics(diagnostics, options, currentDirectory) {
  const host = {
    getCurrentDirectory: () => currentDirectory,
    getCanonicalFileName: ts9.sys.useCaseSensitiveFileNames ? (file) => file : (file) => file.toLowerCase(),
    getNewLine: () => ts9.sys.newLine
  };
  return usePrettyOutput(options["pretty"]) ? ts9.formatDiagnosticsWithColorAndContext(diagnostics, host) : ts9.formatDiagnostics(diagnostics, host);
}
function usePrettyOutput(configured) {
  if (typeof configured === "boolean")
    return configured;
  const noColor = process.env["NO_COLOR"];
  if (noColor != null && noColor !== "")
    return false;
  const forceColor = process.env["FORCE_COLOR"];
  if (forceColor != null && forceColor !== "")
    return true;
  return ts9.sys.writeOutputIsTTY?.() === true;
}
function color(code, text) {
  return `\x1B[${code}m${text}\x1B[0m`;
}
function formatDiagnosticPrefix(location, level, rule, pretty) {
  const formattedLocation = formatDiagnosticLocation(location, pretty);
  const separator = pretty ? " - " : ": ";
  const levelColor = level === "error" ? 91 : level === "warning" ? 93 : 96;
  const formattedLevel = pretty ? color(levelColor, level) : level;
  const ruleLabel = ` [${rule}]: `;
  return `${formattedLocation}${separator}${formattedLevel}${pretty ? color(90, ruleLabel) : ruleLabel}`;
}
function formatDiagnosticLocation(location, pretty) {
  const { file, line, column } = location;
  return pretty ? `${color(96, file)}:${color(93, line)}:${color(93, column)}` : `${file}(${line},${column})`;
}

// src/audit.ts
var refactorGuides = [
  {
    id: "guard-derived-value",
    title: "Check the exact divisor",
    summary: "Give the divisor expression a name, then handle zero before dividing.",
    caveat: "The function owns the zero case. If zero is invalid input, keep the caller requirement instead.",
    before: `export function remap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  if (oldMin === oldMax) return (newMin + newMax) / 2
  return (value - oldMin) / (oldMax - oldMin) * (newMax - newMin) + newMin
}`,
    after: `export function remap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  const oldSpan = oldMax - oldMin
  if (oldMin === oldMax) return (newMin + newMax) / 2
  if (oldSpan === 0) return (newMin + newMax) / 2
  return (value - oldMin) / oldSpan * (newMax - newMin) + newMin
}`
  },
  {
    id: "encode-input-rule",
    title: "Encode a real input rule where the calculation begins",
    summary: 'Turn a domain rule such as "column count is a positive integer" into code once, before downstream calculations use it.',
    caveat: "A positive integer is the real API rule. This changes fractional and nonpositive values, and external NaN still needs validation.",
    before: `export function perColumn(total: number, columnCount: number): number {
  if (columnCount === 0) return 0
  return total / columnCount
}`,
    after: `export function perColumn(total: number, columnCount: number): number {
  const columns = Math.max(1, Math.floor(columnCount))
  return total / columns
}`
  },
  {
    id: "use-direct-operands",
    title: "Use guarded dimensions directly instead of dividing by a ratio",
    summary: "A positive ratio can still round down to zero. Guard the original dimensions and divide by one of those values directly.",
    caveat: "The positive minimum is a real product rule and small rounding differences are acceptable. Nonpositive values change, NaN still needs validation, and multiplication can still overflow.",
    before: `export function fittedHeight(frameWidth: number, imageWidth: number, imageHeight: number): number {
  const aspectRatio = imageWidth / imageHeight
  return frameWidth / aspectRatio
}`,
    after: `export function fittedHeight(frameWidth: number, imageWidth: number, imageHeight: number): number {
  const width = Math.max(1, imageWidth)
  const height = Math.max(1, imageHeight)
  return (frameWidth * height) / width
}`
  },
  {
    id: "write-explicit-condition",
    title: "Write the numeric case explicitly",
    summary: "Replace number truthiness with the exact comparison that expresses the intended case.",
    caveat: "The code means a specific condition such as zero. Choose the comparison that states that condition; NaN can behave differently from truthiness.",
    before: `export function safeWidth(width: number): number {
  return width || 1
}`,
    after: `export function safeWidth(width: number): number {
  return width === 0 ? 1 : width
}`
  },
  {
    id: "use-loop-for-aggregation",
    title: "Use an explicit loop for dense-array aggregation",
    summary: "For a simple aggregation, a for loop exposes the accumulator and each numeric step.",
    caveat: "The array is dense, the reduction has an initial value, and callback arguments or effects do not matter. Indexed loops differ for sparse arrays.",
    before: `export function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0)
}`,
    after: `export function total(values: number[]): number {
  let sum = 0
  for (let index = 0; index < values.length; index++) {
    sum += values[index]!
  }
  return sum
}`
  },
  {
    id: "handle-missing-element",
    title: "Handle a possibly missing array element",
    summary: "A bare array read may be undefined even when the project's TypeScript settings show a plain element type. Handle the missing case before using the value.",
    caveat: "A fallback is real application behavior. Otherwise validate or throw; a bounds check alone does not detect a sparse-array hole.",
    before: `export function incrementAt(values: number[], index: number): number {
  return values[index] + 1
}`,
    after: `export function incrementAt(values: number[], index: number): number {
  const value = values[index] ?? 0
  return value + 1
}`
  },
  {
    id: "guard-array-index",
    title: "Check an asserted array index",
    summary: "Before using values[index]!, prove that the index is an integer inside the array bounds.",
    caveat: "The function owns invalid-index behavior. Otherwise keep the caller requirement; any fallback changes an invalid read.",
    before: `export function valueAt(values: number[], index: number): number {
  return values[index]!
}`,
    after: `export function valueAt(values: number[], index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) return 0
  return values[index]!
}`
  }
];
function createFileAudit({ program, analysis }) {
  const contracts = createReport(program, analysis);
  let analyzed = 0;
  let partial = 0;
  let unsupported2 = 0;
  const references = [];
  const addReference = (functionName2, site, reason) => {
    const span = program.sites[site];
    if (span == null)
      throw new Error(`Unknown site ${site}`);
    references.push({
      functionName: functionName2,
      ...siteLocation(program, site),
      span: { ...span },
      reason,
      guideIDs: guidesForReason(reason)
    });
  };
  const addPartialReason = (functionName2, stop) => {
    addReference(functionName2, stop.site, { kind: "partialSupport", reason: stop.reason });
  };
  const addPrecondition2 = (functionName2, precondition) => {
    addReference(functionName2, precondition.site, { kind: "requires", precondition });
  };
  const addAssumption = (functionName2, assumption) => {
    addReference(functionName2, assumption.site, { kind: "assumes", assumption });
  };
  const addAssertion = (functionName2, assertion) => {
    addReference(functionName2, assertion.site, { kind: "assertion", assertion });
  };
  for (const fn of analysis.functions) {
    switch (fn.kind) {
      case "analyzed": {
        analyzed++;
        for (const precondition of fn.preconditions)
          addPrecondition2(fn.lowering.name, precondition);
        for (const assumption of fn.boundsAssumptions)
          addAssumption(fn.lowering.name, assumption);
        for (const assertion of fn.assertions)
          addAssertion(fn.lowering.name, assertion);
        break;
      }
      case "partial": {
        partial++;
        for (const precondition of fn.observedNeeds)
          addPrecondition2(fn.lowering.name, precondition);
        for (const assumption of fn.observedBoundsAssumptions)
          addAssumption(fn.lowering.name, assumption);
        for (const assertion of fn.assertions)
          addAssertion(fn.lowering.name, assertion);
        for (const stop of fn.stops)
          addPartialReason(fn.lowering.name, stop);
        break;
      }
      case "notLowered": {
        unsupported2++;
        addReference(fn.lowering.name, fn.lowering.site, { kind: "unsupported", reason: fn.lowering.reason });
        break;
      }
    }
  }
  if (analysis.initializer.kind === "partial") {
    for (const precondition of analysis.initializer.observedNeeds) {
      addPrecondition2(program.initializer.name, precondition);
    }
    for (const assumption of analysis.initializer.observedBoundsAssumptions) {
      addAssumption(program.initializer.name, assumption);
    }
    for (const stop of analysis.initializer.stops)
      addPartialReason(program.initializer.name, stop);
  }
  for (const assertion of analysis.initializer.assertions) {
    addAssertion(program.initializer.name, assertion);
  }
  for (const issue of program.staticAnnotationIssues) {
    addReference(program.initializer.name, issue.site, { kind: "staticAnnotationIssue", issue });
  }
  for (const skip of program.initializerSkips) {
    addReference(program.initializer.name, skip.site, { kind: "skipped", reason: skip.reason });
  }
  const initializer = analysis.initializer.kind;
  const functions = analysis.functions.length;
  const initializerSkips = program.initializerSkips.length;
  references.sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
  const guideIDs = [];
  for (const reference of references) {
    for (const guideID of reference.guideIDs) {
      if (!guideIDs.includes(guideID))
        guideIDs.push(guideID);
    }
  }
  return {
    file: reportPath(program),
    coverage: {
      functions,
      analyzed,
      partial,
      unsupported: unsupported2,
      initializer,
      initializerSkips
    },
    contracts,
    references,
    guideIDs
  };
}
function formatAuditCoverage(coverage) {
  const parts = coverage.functions === 0 ? ["no named function declarations"] : [`${coverage.analyzed}/${coverage.functions} functions fully analyzed`];
  if (coverage.partial > 0)
    parts.push(`${coverage.partial} partially supported`);
  if (coverage.unsupported > 0)
    parts.push(`${coverage.unsupported} unsupported`);
  if (coverage.initializer !== "analyzed")
    parts.push("module setup partially supported");
  if (coverage.initializerSkips > 0) {
    parts.push(`${coverage.initializerSkips} module statement${coverage.initializerSkips === 1 ? "" : "s"} skipped`);
  }
  return parts.join("; ");
}
function formatFileAuditUnit(audit, pretty = false) {
  const { coverage } = audit;
  const file = pretty ? color(96, audit.file) : audit.file;
  const lines = [`# ${file} (${formatAuditCoverage(coverage)})`];
  if (audit.contracts.functions.length > 0) {
    lines.push("", "## Contracts", "", colorAuditLocations(formatReport(audit.contracts), audit.file, pretty));
  }
  if (audit.guideIDs.length > 0) {
    const printedSuggestions = new Set;
    lines.push("", "## Refactoring suggestions");
    for (const reference of audit.references) {
      const guideIDs = reference.guideIDs.filter((guideID) => !printedSuggestions.has(`${reference.span.start}:${guideID}`));
      if (guideIDs.length === 0)
        continue;
      lines.push("");
      for (const guideID of guideIDs) {
        printedSuggestions.add(`${reference.span.start}:${guideID}`);
        const guide = refactorGuide(guideID);
        const prefix = formatDiagnosticPrefix({ file: audit.file, line: reference.line, column: reference.column }, "suggestion", guide.id, pretty);
        lines.push(`${prefix}${guide.title}. ${guide.summary}`);
      }
    }
  }
  return lines.join(`
`);
}
function colorAuditLocations(output, file, pretty) {
  if (!pretty)
    return output;
  const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return output.replace(new RegExp(`${escapedFile}:(\\d+):(\\d+)`, "g"), (_location, line, column) => `${color(96, file)}:${color(93, line)}:${color(93, column)}`);
}
function refactorGuide(id) {
  const guide = refactorGuides.find((candidate) => candidate.id === id);
  if (guide == null)
    throw new Error(`Missing refactor guide ${id}`);
  return guide;
}
function guidesForReason(reason) {
  switch (reason.kind) {
    case "requires":
      return guidesForPrecondition(reason.precondition);
    case "assumes":
      return reason.assumption.kind === "nonzeroDivisor" ? ["guard-derived-value"] : ["guard-array-index"];
    case "assertion":
    case "staticAnnotationIssue":
      return [];
    case "unsupported":
      return guidesForUnsupportedReason(reason.reason);
    case "partialSupport":
      return guidesForStop(reason.reason);
    case "skipped":
      return guidesForUnsupportedReason(reason.reason);
  }
}
function guidesForPrecondition(precondition) {
  switch (precondition.kind) {
    case "inBounds":
      return ["guard-array-index"];
    case "declaredComparison":
    case "declaredNumberCheck":
      return [];
    case "nonzero":
    case "notEqualConstant":
      break;
  }
  const directRatio = precondition.kind === "nonzero" && precondition.operation === "division" && precondition.expression.kind === "binary" && precondition.expression.operator === "divide";
  const guides = directRatio ? ["use-direct-operands", "guard-derived-value"] : ["guard-derived-value"];
  if (precondition.kind === "nonzero") {
    if (isCallerInput(precondition.expression))
      guides.push("encode-input-rule");
  }
  return guides;
}
function guidesForUnsupportedReason(reason) {
  switch (reason.kind) {
    case "call":
      return reason.arrayMethod === "reduce" ? ["use-loop-for-aggregation"] : [];
    case "nonBooleanCondition":
      return reason.conditionKind === "number" ? ["write-explicit-condition"] : [];
    case "unknownIdentifier":
    case "missingSymbol":
    case "functionWithoutSignature":
    case "functionWithoutBody":
    case "destructuredParameter":
    case "parameterType":
    case "parameterDefaultValue":
    case "missingReturn":
    case "objectPropertyForm":
    case "computedPropertyName":
    case "objectSpread":
    case "asyncOrGeneratorFunction":
    case "typePredicate":
    case "protoProperty":
    case "enumMemberRead":
    case "prototypeMemberRead":
    case "binaryOperator":
    case "callWithFewerArguments":
    case "callWithMoreArguments":
    case "nonNumberOperand":
    case "valueType":
    case "kindChangingAssertion":
    case "propertyReadOnNonObject":
    case "statementAfterReturn":
    case "assignmentInValuePosition":
    case "propertyWrite":
    case "staticAssertionForm":
    case "varDeclaration":
    case "evalInFile":
    case "typeCheckSuppressed":
    case "forLoopWithoutCondition":
    case "variableDeclarationShape":
    case "expressionForm":
    case "statementForm":
    case "switchFallthrough":
    case "switchDefaultNotLast":
    case "switchSubject":
    case "switchLabel":
      return [];
  }
}
function guidesForStop(reason) {
  switch (reason.kind) {
    case "unsupportedCode":
      return guidesForUnsupportedReason(reason.reason);
    case "possiblyMissingElement":
      return ["handle-missing-element"];
    case "requirementFailure":
    case "moduleRead":
    case "recursion":
    case "calleeStopped":
    case "loopLimit":
    case "nonExitingLoop":
    case "kindMismatch":
      return [];
  }
}
function isCallerInput(expression) {
  switch (expression.kind) {
    case "parameter":
      return true;
    case "property":
      return isCallerInput(expression.base);
    case "floor":
      return isCallerInput(expression.operand);
    case "constant":
    case "binary":
      return false;
  }
}

// src/lower/cross-file.ts
import { resolve as resolvePath } from "node:path";
var maximumCrossFileDepth = 8;
function createCrossFileResolver(sources) {
  const fileAnalysis = new Map;
  const contractsByFile = new Map;
  const analyzing = new Set;
  let resolver;
  function analyzeFile(file) {
    const cached = fileAnalysis.get(file);
    if (cached !== undefined)
      return cached;
    const source = sources.get(file);
    if (source == null) {
      fileAnalysis.set(file, null);
      return null;
    }
    const result = analyzeCheckedSource(source, undefined, resolver);
    fileAnalysis.set(file, result);
    return result;
  }
  resolver = {
    resolve(declaration) {
      const name = declaration.name?.text;
      if (name == null)
        return { kind: "unsupported" };
      const file = resolvePath(declaration.getSourceFile().fileName);
      let contracts = contractsByFile.get(file);
      if (contracts == null) {
        contracts = new Map;
        contractsByFile.set(file, contracts);
      }
      const cached = contracts.get(name);
      if (cached != null)
        return cached;
      if (analyzing.has(file))
        return { kind: "cycle" };
      if (analyzing.size >= maximumCrossFileDepth)
        return { kind: "unsupported" };
      analyzing.add(file);
      let result;
      try {
        const analyzed = analyzeFile(file);
        result = analyzed == null ? { kind: "unsupported" } : contractFor(name, analyzed);
      } finally {
        analyzing.delete(file);
      }
      contracts.set(name, result);
      return result;
    }
  };
  return resolver;
}
function contractFor(name, analyzed) {
  const index = analyzed.program.functions.findIndex((fn2) => fn2.name === name);
  if (index < 0)
    return { kind: "unsupported" };
  const fn = analyzed.analysis.functions[index];
  if (fn == null || fn.kind !== "analyzed")
    return { kind: "unsupported" };
  const requirements = [];
  for (const precondition of fn.preconditions) {
    if (precondition.kind !== "declaredComparison" && precondition.kind !== "declaredNumberCheck")
      continue;
    const location = siteLocation(analyzed.program, precondition.site);
    requirements.push({
      precondition,
      declarationFile: reportPath(analyzed.program),
      declarationLine: location.line,
      declarationColumn: location.column
    });
  }
  return { kind: "contract", contract: { calleeName: name, requirements } };
}

// src/typescript/check.ts
import { resolve } from "node:path";
import * as ts10 from "typescript";
var fallbackOptions = {
  target: ts10.ScriptTarget.ESNext,
  module: ts10.ModuleKind.ESNext,
  moduleResolution: ts10.ModuleResolutionKind.Bundler,
  moduleDetection: ts10.ModuleDetectionKind.Force,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noEmit: true,
  skipLibCheck: true,
  types: []
};
function checkFile(file) {
  const absoluteFile = resolve(file);
  const program = ts10.createProgram([absoluteFile], fallbackOptions);
  return checkedSource(program, absoluteFile, fallbackOptions);
}
function checkedSource(program, file, options) {
  const diagnostics = ts10.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new TypeScriptDiagnosticsError(diagnostics, options, process.cwd());
  }
  const sourceFile = program.getSourceFile(file);
  if (sourceFile == null)
    throw new Error(`TypeScript did not load ${file}`);
  return { sourceFile, checker: program.getTypeChecker() };
}

// src/typescript/project.ts
import { dirname, isAbsolute, relative as relative2, resolve as resolve2, sep } from "node:path";
import * as ts11 from "typescript";
function findTypeScriptConfig(searchFrom) {
  return ts11.findConfigFile(resolve2(searchFrom), (file) => ts11.sys.fileExists(file), "tsconfig.json") ?? null;
}
function loadTypeScriptProjectGraph(configPath) {
  const loaded = [];
  const byConfigPath = new Map;
  const load = (requestedConfigPath) => {
    const absoluteConfigPath = resolve2(requestedConfigPath);
    const existing = byConfigPath.get(absoluteConfigPath);
    if (existing === null) {
      throw new Error(`Circular TypeScript project reference involving ${absoluteConfigPath}`);
    }
    if (existing !== undefined)
      return existing;
    byConfigPath.set(absoluteConfigPath, null);
    const parsed = parseConfig(absoluteConfigPath);
    requireStrictNullChecks(parsed.options, absoluteConfigPath);
    for (const reference of parsed.projectReferences ?? [])
      load(ts11.resolveProjectReferencePath(reference));
    const program = ts11.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      configFileParsingDiagnostics: parsed.errors,
      ...parsed.projectReferences == null ? {} : { projectReferences: parsed.projectReferences }
    });
    const project = {
      rootDirectory: dirname(absoluteConfigPath),
      parsed,
      program
    };
    byConfigPath.set(absoluteConfigPath, project);
    loaded.push(project);
    return project;
  };
  load(configPath);
  return loaded;
}
function projectSources(projects) {
  const sources = new Map;
  for (const project of projects) {
    for (const sourceFile of project.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(`${sep}node_modules${sep}`))
        continue;
      const absoluteFile = resolve2(sourceFile.fileName);
      const existing = sources.get(absoluteFile);
      const candidate = { project, sourceFile };
      if (existing == null || ownershipScore(project, absoluteFile) > ownershipScore(existing.project, absoluteFile)) {
        sources.set(absoluteFile, candidate);
      }
    }
  }
  return [...sources.values()].sort((left, right) => left.sourceFile.fileName.localeCompare(right.sourceFile.fileName));
}
function parseConfig(configPath) {
  const parsed = ts11.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts11.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new TypeScriptDiagnosticsError([diagnostic], {}, dirname(configPath));
    }
  });
  if (parsed == null)
    throw new Error(`TypeScript could not parse ${configPath}`);
  if (parsed.errors.length > 0) {
    throw new TypeScriptDiagnosticsError(parsed.errors, parsed.options, dirname(configPath));
  }
  return parsed;
}
function requireStrictNullChecks(options, configPath) {
  const enabled = options.strictNullChecks ?? options.strict !== false;
  if (enabled)
    return;
  throw new Error(`freerange requires strictNullChecks. Enable "strict": true or "strictNullChecks": true in ${configPath}.`);
}
function ownershipScore(project, file) {
  const path = relative2(project.rootDirectory, file);
  const inside = path === "" || !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  return inside ? project.rootDirectory.length : -1;
}

// src/project.ts
function runProjectFindings(searchFrom, crossFile = false) {
  const scan = analyzeProject(searchFrom, crossFile);
  const findings = scan.files.flatMap(collectLintFindings).sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column);
  console.log(formatFindings(findings, scan.coverage, scan.pretty));
  return findings.some((finding) => lintLevel(finding) === "error");
}
function runFileFindings(file, crossFile = false) {
  const target = analyzeTargetFile(file, crossFile);
  const findings = collectLintFindings(target.detailed).sort((left, right) => left.line - right.line || left.column - right.column);
  console.log(formatFindings(findings, fileCoverage(target.detailed), target.pretty));
  return findings.some((finding) => lintLevel(finding) === "error");
}
function runProjectAudit(searchFrom, crossFile = false) {
  const scan = analyzeProject(searchFrom, crossFile);
  const audits = scan.files.map(createFileAudit).sort((left, right) => left.file.localeCompare(right.file));
  console.log([
    ...audits.map((audit) => formatFileAuditUnit(audit, scan.pretty)),
    formatCoverage(scan.coverage)
  ].join(`

`));
  return false;
}
function runFileAudit(file, crossFile = false) {
  const target = analyzeTargetFile(file, crossFile);
  console.log(formatFileAuditUnit(createFileAudit(target.detailed), target.pretty));
  return false;
}
function analyzeProject(searchFrom, crossFile) {
  const configPath = findTypeScriptConfig(searchFrom);
  if (configPath == null) {
    throw new Error(`No tsconfig.json found from ${resolve3(searchFrom)} or any parent directory.`);
  }
  const projects = loadTypeScriptProjectGraph(configPath);
  const rootProject = projects.at(-1);
  const sources = projectSources(projects);
  const diagnostics = uniqueDiagnostics(projects.flatMap((project) => ts12.getPreEmitDiagnostics(project.program)));
  requireNoTypeScriptErrors(diagnostics, rootProject.parsed.options);
  const resolver = crossFile ? createCrossFileResolver(crossFileSources(sources)) : undefined;
  const files = [];
  let analyzed = 0;
  let partial = 0;
  let unsupported2 = 0;
  for (const source of sources) {
    const detailed = analyzeProjectSource(source, process.cwd(), resolver);
    files.push(detailed);
    const perFile = fileCoverage(detailed);
    analyzed += perFile.analyzed;
    partial += perFile.partial;
    unsupported2 += perFile.unsupported;
  }
  return {
    files,
    coverage: {
      functions: analyzed + partial + unsupported2,
      analyzed,
      partial,
      unsupported: unsupported2
    },
    pretty: usePrettyOutput(rootProject.parsed.options["pretty"])
  };
}
function crossFileSources(sources) {
  const bySource = new Map;
  for (const source of sources) {
    bySource.set(resolve3(source.sourceFile.fileName), {
      sourceFile: source.sourceFile,
      checker: source.project.program.getTypeChecker()
    });
  }
  return bySource;
}
function collectLintFindings({ program, analysis }) {
  const file = reportPath(program);
  const findings = [];
  const addError = (site, rule, message, related) => {
    const location = siteLocation(program, site);
    findings.push({ kind: "error", file, ...location, rule, message, ...related == null ? {} : { related } });
  };
  const addRequirementFailure = (failure, stopSite, functionName2, calleeName) => {
    if (failure.kind === "elementInBounds") {
      if (calleeName == null) {
        const location = siteLocation(program, stopSite);
        findings.push({ kind: "simple", file, ...location, functionName: functionName2, stop: "outOfBoundsRead" });
      } else {
        const origin = siteLocation(program, failure.site);
        addError(stopSite, "inferred-requirement", `call to ${calleeName} makes an asserted element read definitely out of bounds`, { label: "element read at", ...origin });
      }
      return;
    }
    if (failure.kind === "nonzeroDivisor") {
      if (calleeName == null) {
        addError(stopSite, "inferred-requirement", `${failure.operation} has a divisor that is definitely zero in ${functionName2}`);
      } else {
        const origin = siteLocation(program, failure.site);
        addError(stopSite, "inferred-requirement", `call to ${calleeName} violates its nonzero divisor requirement`, { label: `${failure.operation} at`, ...origin });
      }
      return;
    }
    if (failure.kind === "finiteInput") {
      const origin = siteLocation(program, failure.site);
      addError(stopSite, "inferred-requirement", calleeName == null ? failure.status === "refuted" ? `number input is definitely not finite in ${functionName2}` : `could not verify the number input in ${functionName2}` : failure.status === "refuted" ? `call to ${calleeName} passes a number that is definitely not finite` : `could not verify ${calleeName}'s number input at this call`, { label: "input declared at", ...origin });
      return;
    }
    if (calleeName == null) {
      addError(stopSite, "declared-requirement", failure.status === "refuted" ? `declared console.assert requirement is false in ${functionName2}` : `could not express or prove the declared console.assert requirement in ${functionName2}`);
    } else {
      const origin = siteLocation(program, failure.site);
      addError(stopSite, "declared-requirement", failure.status === "refuted" ? `call to ${calleeName} makes its declared requirement definitely false` : `could not express or prove ${calleeName}'s declared requirement at this call`, { label: "declared at", ...origin });
    }
  };
  const collectStops = (fn) => {
    if (fn.kind !== "partial")
      return;
    for (const stop of fn.stops) {
      const reason = stop.reason;
      switch (reason.kind) {
        case "nonExitingLoop": {
          const location = siteLocation(program, stop.site);
          findings.push({
            kind: "simple",
            file,
            line: location.line,
            column: location.column,
            functionName: fn.lowering.name,
            stop: reason.kind
          });
          break;
        }
        case "requirementFailure": {
          const callee = reason.callee == null ? null : program.functions[reason.callee];
          if (reason.callee != null && callee == null)
            throw new Error(`Unknown function ${reason.callee}`);
          addRequirementFailure(reason.failure, stop.site, fn.lowering.name, callee?.name ?? null);
          break;
        }
        case "recursion":
        case "calleeStopped":
        case "loopLimit":
        case "unsupportedCode":
        case "moduleRead":
        case "kindMismatch":
        case "possiblyMissingElement":
          break;
      }
    }
  };
  const collectAssertions = (fn) => {
    if (fn.kind === "notLowered")
      return;
    for (const assertion of fn.assertions) {
      const message = assertionErrorMessage(fn.lowering.name, assertion);
      if (message != null)
        addError(assertion.site, "console-assert", message);
    }
    if (fn.assertions.length > 0)
      return;
    const requirementSite = firstStaticRequirementSite(fn.lowering);
    if (requirementSite == null)
      return;
    const incomplete = fn.kind === "partial" || fn.boundsAssumptions.length > 0;
    if (!incomplete)
      return;
    const ownRequirementFailure = fn.kind === "partial" && fn.stops.some((stop) => stop.reason.kind === "requirementFailure" && stop.reason.callee == null && stop.reason.failure.kind === "declared");
    if (!ownRequirementFailure) {
      addError(requirementSite, "console-assert", `console.assert requirements in ${fn.lowering.name} were not checked because the function did not finish analysis without site-specific assumptions`);
    }
  };
  collectStops(analysis.initializer);
  collectAssertions(analysis.initializer);
  findings.push(...collectCrossFileFindings(program, analysis.initializer.lowering));
  for (const issue of program.staticAnnotationIssues) {
    addError(issue.site, "console-assert", "console.assert is only supported inside a named top-level function declaration");
  }
  for (const fn of analysis.functions) {
    collectStops(fn);
    collectAssertions(fn);
    if (fn.kind === "notLowered") {
      if (fn.lowering.hasStaticAnnotations) {
        const reason = formatUnsupportedReason(fn.lowering.reason);
        addError(fn.lowering.site, "console-assert", fn.lowering.reason.kind === "staticAssertionForm" ? `${reason} in ${fn.lowering.name}` : `console.assert in ${fn.lowering.name} was not checked because ${reason}`);
      }
    } else {
      findings.push(...collectCrossFileFindings(program, fn.lowering));
    }
  }
  return findings;
}
function collectCrossFileFindings(program, fn) {
  const file = reportPath(program);
  const findings = [];
  const expressionContext = createExpressionContext(fn, fn.parameters.map((_, index) => ({ kind: "parameter", index })));
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      if (instruction.kind !== "crossCall")
        continue;
      const argumentExpressions = instruction.arguments.map((id) => numericExpression(id, expressionContext));
      for (const requirement of instruction.contract.requirements) {
        if (crossFileRequirementStatus(requirement.precondition, argumentExpressions) !== false)
          continue;
        const location = siteLocation(program, instruction.site);
        findings.push({
          kind: "error",
          file,
          line: location.line,
          column: location.column,
          rule: "declared-requirement",
          message: `call to ${instruction.contract.calleeName} makes its declared requirement definitely false`,
          related: {
            label: "declared at",
            file: requirement.declarationFile,
            line: requirement.declarationLine,
            column: requirement.declarationColumn
          }
        });
      }
    }
  }
  return findings;
}
function firstStaticRequirementSite(fn) {
  for (const block of fn.blocks) {
    for (const instruction of block.instructions) {
      if (instruction.kind === "staticRequire" && instruction.purpose !== "finiteInput")
        return instruction.site;
    }
  }
  return null;
}
function assertionErrorMessage(functionName2, assertion) {
  switch (assertion.verdict) {
    case "proven":
      return null;
    case "refuted":
      return `console.assert condition can be false in ${functionName2}: ${assertion.text}`;
    case "unproven":
      return `could not prove console.assert condition in ${functionName2}: ${assertion.text}`;
    case "dead":
      return `console.assert is unreachable in ${functionName2}: ${assertion.text}`;
    case "blocked":
      return `could not check console.assert condition in ${functionName2}; the function did not finish analysis without site-specific assumptions: ${assertion.text}`;
  }
}
function formatFindings(findings, coverage, pretty) {
  const lines = [];
  for (const finding of findings)
    lines.push(formatLintFinding(finding, pretty));
  if (findings.length === 0)
    lines.push("No lint findings.");
  const errors = findings.filter((finding) => lintLevel(finding) === "error").length;
  const warnings = findings.filter((finding) => lintLevel(finding) === "warning").length;
  lines.push("", `${findings.length} finding${findings.length === 1 ? "" : "s"} (${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}).`, formatCoverage(coverage), "Run `fr --audit [file]` for every function's contracts and refactoring suggestions.");
  return lines.join(`
`);
}
function fileCoverage(detailed) {
  const coverage = {
    functions: detailed.analysis.functions.length,
    analyzed: 0,
    partial: 0,
    unsupported: 0
  };
  for (const fn of detailed.analysis.functions) {
    switch (fn.kind) {
      case "analyzed":
        coverage.analyzed++;
        break;
      case "partial":
        coverage.partial++;
        break;
      case "notLowered":
        coverage.unsupported++;
        break;
    }
  }
  return coverage;
}
function formatLintFinding(finding, pretty) {
  switch (finding.kind) {
    case "simple":
      return finding.stop === "outOfBoundsRead" ? `${formatLintPrefix(finding, "out-of-bounds-read", pretty)}asserted element read (arr[i]!) is provably out of bounds in ${finding.functionName}` : `${formatLintPrefix(finding, "non-exiting-loop", pretty)}loop in ${finding.functionName} has no analyzable exit; it may never terminate`;
    case "error": {
      const related = finding.related == null ? "" : ` (${finding.related.label} ${formatDiagnosticLocation({
        file: finding.related.file ?? finding.file,
        line: finding.related.line,
        column: finding.related.column
      }, pretty)})`;
      return `${formatLintPrefix(finding, finding.rule, pretty)}${finding.message}${related}`;
    }
  }
}
function lintLevel(finding) {
  switch (finding.kind) {
    case "simple":
      return finding.stop === "outOfBoundsRead" ? "error" : "warning";
    case "error":
      return "error";
  }
}
function formatLintPrefix(finding, rule, pretty) {
  return formatDiagnosticPrefix(finding, lintLevel(finding), rule, pretty);
}
function formatCoverage(coverage) {
  return `coverage: ${coverage.analyzed}/${coverage.functions} named top-level function declarations fully analyzed; ${coverage.partial} partially supported; ${coverage.unsupported} unsupported.`;
}
function analyzeTargetFile(file, crossFile) {
  const absoluteFile = resolve3(file);
  if (!existsSync(absoluteFile))
    throw new Error(`File not found: ${absoluteFile}`);
  const configPath = findTypeScriptConfig(process.cwd());
  if (configPath == null)
    return analyzeFileAlone(absoluteFile);
  const projects = loadTypeScriptProjectGraph(configPath);
  const rootProject = projects.at(-1);
  const sources = projectSources(projects);
  const targetPath = canonicalFilePath(absoluteFile);
  const source = sources.find((candidate) => canonicalFilePath(candidate.sourceFile.fileName) === targetPath);
  if (source == null) {
    throw new Error(`File is not part of the project resolved from ${configPath}: ${absoluteFile}`);
  }
  const diagnostics = ts12.getPreEmitDiagnostics(source.project.program, source.sourceFile);
  requireNoTypeScriptErrors(diagnostics, rootProject.parsed.options);
  const resolver = crossFile ? createCrossFileResolver(crossFileSources(sources)) : undefined;
  return {
    detailed: analyzeProjectSource(source, process.cwd(), resolver),
    pretty: usePrettyOutput(rootProject.parsed.options["pretty"])
  };
}
function canonicalFilePath(file) {
  const real = realpathSync.native(file);
  return ts12.sys.useCaseSensitiveFileNames ? real : real.toLowerCase();
}
function analyzeFileAlone(absoluteFile) {
  return {
    detailed: analyzeCheckedSource(checkFile(absoluteFile), process.cwd()),
    pretty: usePrettyOutput(undefined)
  };
}
function analyzeProjectSource(source, reportBaseDirectory, crossFile) {
  return analyzeCheckedSource({
    sourceFile: source.sourceFile,
    checker: source.project.program.getTypeChecker()
  }, reportBaseDirectory, crossFile);
}
function uniqueDiagnostics(diagnostics) {
  const seen = new Set;
  return diagnostics.filter((diagnostic) => {
    const message = ts12.flattenDiagnosticMessageText(diagnostic.messageText, `
`);
    const key = `${diagnostic.file?.fileName ?? ""}:${diagnostic.start ?? ""}:${diagnostic.length ?? ""}:${diagnostic.code}:${message}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
function printTypeScriptDiagnostics(diagnostics, options, currentDirectory) {
  if (diagnostics.length === 0)
    return;
  console.error(formatTypeScriptDiagnostics(diagnostics, options, currentDirectory).trimEnd());
}
function requireNoTypeScriptErrors(diagnostics, options) {
  if (hasErrorDiagnostics(diagnostics)) {
    throw new TypeScriptDiagnosticsError(diagnostics, options, process.cwd());
  }
  printTypeScriptDiagnostics(diagnostics, options, process.cwd());
}
function hasErrorDiagnostics(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.category === ts12.DiagnosticCategory.Error);
}

// fr.ts
var rawArguments = process.argv.slice(2);
var crossFile = rawArguments.includes("--cross-file");
var arguments_ = rawArguments.filter((argument) => argument !== "--cross-file");
try {
  let failed;
  if (arguments_[0] === "--audit") {
    if (arguments_.length > 2)
      throw new Error("Usage: fr --audit [file] [--cross-file]");
    failed = arguments_.length === 1 ? runProjectAudit(process.cwd(), crossFile) : runFileAudit(arguments_[1], crossFile);
  } else {
    if (arguments_.length > 1)
      throw new Error("Usage: fr [file] [--cross-file]");
    failed = arguments_.length === 0 ? runProjectFindings(process.cwd(), crossFile) : runFileFindings(arguments_[0], crossFile);
  }
  if (failed)
    process.exitCode = 1;
} catch (error) {
  if (error instanceof TypeScriptDiagnosticsError) {
    console.error(formatTypeScriptDiagnostics(error.diagnostics, error.options, error.currentDirectory).trimEnd());
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
