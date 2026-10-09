/**
 * Maths that gives the same answer in every browser. Online, every player's browser runs the
 * game and the copies must stay identical, but Math.exp, Math.cos, Math.pow and Math.hypot may
 * differ in the last digit between JavaScript engines (Chrome, Safari, Firefox). These use only
 * +, -, *, / and Math.sqrt, which IEEE 754 defines exactly. Use them in the simulation.
 */

/** Distance between two points. */
export const dist = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);

const LN2 = 0.6931471805599453;

/** e^x. */
export function exp(x: number): number {
  if (x === 0) return 1;
  if (!Number.isFinite(x)) return x > 0 ? Infinity : 0;
  // x = k ln2 + r with |r| <= ln2 / 2, then e^r by its series and 2^k by doubling
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1, sum = 1;
  for (let i = 1; i < 20; i++) { term = (term * r) / i; sum += term; }
  let p = 1;
  const two = k >= 0 ? 2 : 0.5;
  for (let i = 0; i < Math.abs(k); i++) p *= two;
  return sum * p;
}

/** cos(x), x in radians. */
export function cos(x: number): number {
  const TAU = 6.283185307179586;
  let r = x - Math.round(x / TAU) * TAU; // -pi..pi
  r *= r;
  let term = 1, sum = 1;
  for (let i = 1; i < 14; i++) { term = (-term * r) / ((2 * i - 1) * (2 * i)); sum += term; }
  return sum;
}

/** x^0.75 (for x >= 0). */
export const pow075 = (x: number) => Math.sqrt(x) * Math.sqrt(Math.sqrt(x));
