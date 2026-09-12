// Self-contained: consumers run the submodule's Node CLI without installing npm packages.
// SemVer 2.0.0 precedence; bounded input and safe core integers match the npm oracle.
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const numeric = value => /^[0-9]+$/.test(value);

export function parseVersion(value) {
  if (typeof value !== "string" || value.length > 128 || value.trim() !== value) return null;
  const match = VERSION.exec(value);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  if (core.some(value => !Number.isSafeInteger(value))) return null;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some(value => numeric(value) && value.length > 1 && value[0] === "0")) return null;
  return { core, prerelease };
}

export function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  if (!a || !b) throw new TypeError("Invalid semantic version");
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]; const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = numeric(x); const yn = numeric(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
