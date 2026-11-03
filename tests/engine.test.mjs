// Talus engine tests: run with `node --test tests/`.
// The verification set (closed forms and published benchmarks) plus behaviour the
// app relies on: every default project solves, mirrored slopes agree, the methods
// order as theory says, slices balance, seismic and water lower F as they should.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKS, runCheck } from "../talus_app/static/engine/verify.js";
import { analyse, newmark } from "../talus_app/static/engine/analyse.js";
import { complete } from "../talus_app/static/engine/project.js";
import { prepare, buildSlices, factors, sliceForces } from "../talus_app/static/engine/lem.js";
import { criticalCircle } from "../talus_app/static/engine/search.js";
import { mirror } from "../talus_app/static/engine/geometry.js";
import { rockArmour, accropode } from "../talus_app/static/engine/armour.js";

for (const c of CHECKS) {
  test(`verification: ${c.title}`, () => {
    for (const r of runCheck(c)) assert.ok(r.pass, `${r.label}: ${r.value} vs ${r.expected} (${r.message || ""})`);
  });
}

const clay = { name: "Clay", gamma: 18, gsat: 19, c: 10, phi: 25, kind: "drained" };
const slope = (extra = {}) => ({
  ground: [[0, 10], [10, 10], [30, 0], [50, 0]], bottom: -8,
  layers: [{ top: null, mat: clay }], face: { crest: [10, 10], toe: [30, 0] }, ...extra,
});

test("every default project solves with finite factors in every case", () => {
  for (const type of ["cut", "embankment", "revetment"]) {
    const r = analyse(complete({ type }));
    assert.ok(r.cases.length >= 3, type);
    for (const c of r.cases) {
      assert.ok(!c.error, `${type} ${c.name}: ${c.error}`);
      assert.ok(Number.isFinite(c.F) && c.F > 0.3 && c.F < 10, `${type} ${c.name} F=${c.F}`);
    }
  }
});

test("a mirrored slope gives the same factor of safety", () => {
  const a = prepare(slope());
  const m = slope();
  m.ground = mirror(m.ground);
  m.face = { crest: [-10, 10], toe: [-30, 0] };
  const b = prepare(m);
  const ca = criticalCircle(a, { method: "mp" }), cb = criticalCircle(b, { method: "mp" });
  assert.ok(Math.abs(ca.F - cb.F) < 2e-3, `${ca.F} vs ${cb.F}`);
});

test("methods order as theory says on a circle: Ordinary < Bishop ≈ Spencer ≈ M-P", () => {
  const P = prepare(slope({ piezo: [[0, 7], [10, 7], [30, 0], [50, 0]] }));
  const best = criticalCircle(P, { method: "mp" });
  const r = factors(P, best.cut, best.circle);
  const v = (m) => (typeof r[m] === "object" ? r[m].F : r[m]);
  assert.ok(v("ordinary") < v("bishop"));
  assert.ok(Math.abs(v("bishop") - v("mp")) / v("mp") < 0.02);
  assert.ok(Math.abs(v("spencer") - v("mp")) / v("mp") < 0.01);
});

test("slices of a rigorous solution balance: interslice force closes to zero", () => {
  const P = prepare(slope());
  const best = criticalCircle(P, { method: "spencer" });
  const r = factors(P, best.cut, best.circle, ["spencer"]);
  const rows = sliceForces(P, best.cut, best.circle, "spencer", r.spencer.F, r.spencer.lambda);
  const last = rows[rows.length - 1];
  const scale = Math.max(...rows.map((s) => Math.abs(s.Er)));
  assert.ok(Math.abs(last.Er) < 1e-6 * Math.max(1, scale), `E_n = ${last.Er}`);
});

test("water and earthquakes lower the factor of safety", () => {
  const F = (m) => criticalCircle(prepare(m), { method: "mp" }).F;
  const dry = F(slope());
  const wet = F(slope({ piezo: [[0, 8], [10, 8], [30, 0], [50, 0]] }));
  const quake = F(slope({ seismic: { kh: 0.1, kv: 0 } }));
  assert.ok(wet < dry, `${wet} < ${dry}`);
  assert.ok(quake < dry, `${quake} < ${dry}`);
});

test("slices are exact: total weight equals area × unit weight", () => {
  const P = prepare(slope());
  const best = criticalCircle(P, { method: "bishop" });
  const W = best.cut.slices.reduce((a, s) => a + s.W, 0);
  const fine = buildSlices(P, best.cut.slip || best.slip, { n: 400, exact: true });
  const W2 = fine.slices.reduce((a, s) => a + s.W, 0);
  assert.ok(Math.abs(W - W2) / W2 < 1e-9, `${W} vs ${W2}`);
});

test("Newmark: no sliding when ky exceeds the peak acceleration", () => {
  assert.equal(newmark(0.3, 0.2).D, 0);
  assert.ok(newmark(0.05, 0.3).D > newmark(0.1, 0.3).D);
});

test("armour: flatter slopes need lighter rock; bigger waves need heavier units", () => {
  const base = { Hs: 2, Tp: 8, hours: 6, h: 6, rhoR: 2650, rhoW: 1025, P: 0.4, S: 2 };
  const steep = rockArmour({ ...base, cot: 1.5 }), flat = rockArmour({ ...base, cot: 3 });
  assert.ok(flat.M50 < steep.M50);
  const a2 = accropode({ ...base, cot: 4 / 3, rhoC: 2400, type: "accropode2" });
  const a3 = accropode({ ...base, Hs: 3, cot: 4 / 3, rhoC: 2400, type: "accropode2" });
  assert.ok(a3.V > a2.V);
});

test("benches: the face follows each bench and berm, crest down", async () => {
  const { faceOf } = await import("../talus_app/static/engine/project.js");
  const f = faceOf(complete({ type: "cut", geom: { berms: { on: true, rows: [{ h: 6, cot: 2.5, berm: 4 }, { h: 5.71, cot: 2 }] } } }));
  assert.deepEqual(f.pts.map((p) => p.map((v) => +v.toFixed(6))), [[0, 0], [11.42, 5.71], [15.42, 5.71], [30.42, 11.71]]);
  assert.ok(Math.abs(f.H - 11.71) < 1e-9);
});

test("benches: a single bench gives the same answer as the plain slope", () => {
  const plain = analyse(complete({ type: "cut", geom: { H: 6, cot: 2 }, seismic: { on: false } }));
  const one = analyse(complete({ type: "cut", geom: { H: 99, cot: 9, berms: { on: true, rows: [{ h: 6, cot: 2 }] } }, seismic: { on: false } }));
  assert.ok(Math.abs(plain.cases[0].F - one.cases[0].F) < 1e-9);
});

test("benches: a berm makes the same slopes safer", () => {
  const F = (berm) => analyse(complete({ type: "cut", seismic: { on: false },
    geom: { berms: { on: true, rows: [{ h: 4, cot: 1.5, berm }, { h: 4, cot: 1.5 }] } } })).cases[0].F;
  assert.ok(F(5) > F(0.01));
});
