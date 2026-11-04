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

test("any section: pasted points are read whatever the separator", async () => {
  const { parsePoints } = await import("../talus_app/static/engine/project.js");
  assert.deepEqual(parsePoints("10, 2\n0\t1\n5 1.5\nnot a point\n"), [[0, 1], [5, 1.5], [10, 2]]);
});

test("any section: the WP50 drained section gives the same F as the hand-built model", () => {
  const ground = "-15 11.71\n0 11.71\n15 5.71\n19 5.71\n30.42 0\n62 0";
  const r = analyse(complete({ type: "section", seismic: { on: false }, ground, base: -14.9,
    layers: [
      { soil: { preset: "sand", gamma: 21.68, gsat: 21.68, c: 5, phi: 32 } },
      { soil: { preset: "sand", gamma: 22.37, gsat: 22.37, c: 40, phi: 7 }, top: "-15 6.2\n62 6.2" },
      { soil: { preset: "sand", gamma: 21, gsat: 21, c: 2, phi: 34 }, top: "-15 -6.9\n62 -6.9" }],
    water: { mode: "line", line: ground }, load: { q: 10, x1: -14.6, x2: -1 } }));
  // Talus as built by hand for the WP50 comparison: 1.261 (report: 1.271)
  assert.ok(Math.abs(r.cases[0].F - 1.261) < 0.01, `F = ${r.cases[0].F}`);
});

test("su is capped at its maximum", () => {
  const mat = (suMax) => ({ name: "Clay", gamma: 18, gsat: 18, kind: "undrained", su: 20, suGrad: 10, suMax });
  const F = (suMax) => criticalCircle(prepare(slope({ layers: [{ top: null, mat: mat(suMax) }] })), { method: "bishop" }).F;
  assert.ok(F(30) < F(0));
});

test("block search: a weak seam below the toe governs, both ways round", () => {
  const run = (flip, block) => {
    const g = (s) => flip ? s.split("\n").map((l) => { const [x, y] = l.split(" ").map(Number); return `${70 - x} ${y}`; }).join("\n") : s;
    return analyse(complete({ type: "section", seismic: { on: false }, advanced: { block },
      ground: g("0 10\n20 10\n40 0\n70 0"), base: -10,
      layers: [{ soil: { preset: "denseSand" } },
        { soil: { preset: "softClay", c: 0, phi: 12 }, top: "0 -1\n70 -1" },
        { soil: { preset: "denseSand" }, top: "0 -1.6\n70 -1.6" }],
      water: { mode: "none" }, load: { q: 0 } })).cases[0];
  };
  const circle = run(false, false), block = run(false, true), flipped = run(true, true);
  assert.equal(block.surface.kind, "block");
  // a hand grid of two-wedge blocks on the seam gives 1.303 (MP); circles 1.44
  assert.ok(block.F < 1.31 && block.F > 1.2 && block.F < circle.F - 0.1, `block ${block.F}, circle ${circle.F}`);
  assert.ok(Math.abs(flipped.F - block.F) < 0.02, `mirrored ${flipped.F} vs ${block.F}`);
});

test("Word report: a valid zip with the document, styles and images", async () => {
  const { docx, crc32 } = await import("../talus_app/static/js/docx.js");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const blob = docx([{ t: "title", text: "T & <b>" }, { t: "p", text: "**F** = 1.50" }, { t: "table", head: ["a", "b"], rows: [{ group: "G" }, [1, "x"]] }, { t: "img", png, w: 10, h: 5 }, { t: "break" }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  assert.equal(text.slice(0, 4), "PK\u0003\u0004");
  for (const part of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/media/image1.png", "word/_rels/document.xml.rels"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes("T &amp; &lt;b&gt;") && text.includes("<w:b/>"));
  assert.ok(text.includes("PK\u0005\u0006"));
});

test("Hoek-Brown rock: on the critical surface every slice carries the envelope strength", async () => {
  const { hbTangent, hoekBrown } = await import("../talus_app/static/engine/materials.js");
  const c = analyse(complete({ type: "cut", soil: { preset: "rockHB" }, geom: { H: 20, cot: 0.5 }, water: { on: false }, seismic: { on: false }, load: { q: 0 } })).cases[0];
  assert.ok(c.hb && c.hb.gap < 1e-4, "converged");
  const hb = hoekBrown({ GSI: 45, mi: 10, sci: 25, D: 0 });
  for (const s of c.slices.filter((s) => s.Neff > 0)) {
    const tau = hbTangent(hb, Math.max(0, s.Neff / s.l)).tau;
    assert.ok(Math.abs(s.S * c.F / s.l - tau) / tau < 2e-3, `slice τ ${s.S * c.F / s.l} vs ${tau}`);
  }
});

test("reinforcement: a basal geogrid and a pile row make slopes safer", () => {
  const e = { type: "embankment", soil: { preset: "softClay" }, seismic: { on: false }, water: { on: false } };
  const F = (p) => analyse(complete(p)).cases[0].F;
  assert.ok(F({ ...e, grids: { on: true, n: 1, T: 200 } }) > F(e) + 0.2);
  const c = { type: "cut", seismic: { on: false } };
  assert.ok(F({ ...c, piles: { on: true, x: 3, length: 12, Vp: 300, spacing: 2 } }) > F(c) + 0.1);
});

test("probabilistic: a dry frictional slope gives the closed-form lognormal answer", async () => {
  const { probabilistic, normCdf } = await import("../talus_app/static/engine/prob.js");
  // c = 0 and no water: F is proportional to tan φ, so F is lognormal with the COV of tan φ
  const p = { type: "cut", soil: { preset: "looseSand" }, geom: { H: 6, cot: 2 }, water: { on: false }, load: { q: 0 }, seismic: { on: false } };
  const V = 0.15;
  const r = probabilistic(p, { n: 4000, cov: { tanphi: V, gamma: 0 } });
  const s = Math.sqrt(Math.log(1 + V * V));
  const beta = Math.log(r.deterministic / Math.sqrt(1 + V * V)) / s;
  assert.ok(Math.abs(r.mean / r.deterministic - 1) < 0.005, `mean ${r.mean} vs ${r.deterministic}`);
  assert.ok(Math.abs(r.betaLN - beta) < 0.02, `β ${r.betaLN} vs ${beta}`);
  assert.ok(Math.abs(r.pf - normCdf(-beta)) < 3 * r.pfSE + 0.002, `pf ${r.pf} vs ${normCdf(-beta)}`);
  assert.equal(r.sens[0].prop, "tanphi");
});

test("flow net: equal water at both ends gives the hydrostatic water line's F", async () => {
  const { buildCases } = await import("../talus_app/static/engine/project.js");
  const { analyseCase } = await import("../talus_app/static/engine/analyse.js");
  const ground = "0, 10\n20, 10\n40, 0\n70, 0";
  const layers = [{ soil: { preset: "sand" }, top: "" }, { soil: { preset: "firmClay" }, top: "0, -2\n70, -2" }];
  const run = (water) => {
    const b = buildCases({ type: "section", ground, base: -12, layers, water, load: { q: 0 }, seismic: { on: false } });
    return { b, F: analyseCase(b.cases[0], { method: "mp", slices: 40 }).F };
  };
  const line = run({ mode: "line", line: "0, 3\n70, 3" });
  const flow = run({ mode: "flow", left: 3, right: 3 });
  assert.ok(flow.b.geometry.flow.q < 1e-9, `no flow: ${flow.b.geometry.flow.q}`);
  assert.ok(Math.abs(flow.F / line.F - 1) < 2e-3, `flow net ${flow.F} vs line ${line.F}`);
  // a higher level on the left drives seepage towards the face and lowers F
  const wet = run({ mode: "flow", left: 8, right: 0 });
  assert.ok(wet.b.geometry.flow.q > 0 && wet.F < line.F, `seepage F ${wet.F}`);
});

test("flow net: embankment steady seepage and drawdown solve", async () => {
  const { buildCases } = await import("../talus_app/static/engine/project.js");
  const { analyseCase } = await import("../talus_app/static/engine/analyse.js");
  const b = buildCases({ type: "embankment", soil: { preset: "sand" }, water: { on: true, level: 4, low: 0, flow: true }, seismic: { on: false } });
  for (const c of b.cases) {
    const r = analyseCase(c, { method: "mp", slices: 40 });
    assert.ok(Number.isFinite(r.F) && r.F > 0.8 && r.F < 4, `${c.key}: ${r.F}`);
  }
  // water stands on the upstream face and leaves at the downstream toe
  assert.ok(Math.abs(b.geometry.piezo[0][1] - 4) < 1e-6);
  assert.ok(Math.abs(b.geometry.piezo[b.geometry.piezo.length - 1][1]) < 1e-6);
});
