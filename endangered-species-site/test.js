/* test.js — thorough tests for Endangered Earth (boss QA after each round) */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error("  ✗ FAIL:", m); } };

const HERE = __dirname;
const read = (f) => fs.readFileSync(path.join(HERE, f), "utf8");

// ---------- 1. Data integrity ----------
const { ANIMALS, PLANTS, JIMMY_FACTS } = require("./data.js");
const VALID_STATUS = ["Extinct in the Wild", "Critically Endangered", "Endangered", "Vulnerable"];

ok(ANIMALS.length >= 5, "at least 5 animals");
ok(PLANTS.length >= 3, "at least 3 plants");
ok(JIMMY_FACTS.length >= 3, "Jimmy has facts");

const ids = new Set();
ANIMALS.forEach((a) => {
  ok(a.id && !ids.has(a.id), `unique animal id: ${a.id}`); ids.add(a.id);
  ok(!!a.name && !!a.sci && !!a.emoji, `${a.id} has name/sci/emoji`);
  ok(VALID_STATUS.includes(a.status), `${a.id} valid status (${a.status})`);
  ok(["predator", "prey"].includes(a.role), `${a.id} valid role`);
  ok(typeof a.population === "number" && a.population >= 0, `${a.id} numeric population`);
  ok(Array.isArray(a.tree) && a.tree.length >= 2, `${a.id} has family tree`);
  a.tree.forEach((n) => ok(n.clade && n.when && n.note, `${a.id} tree node complete`));
});
const pids = new Set();
PLANTS.forEach((p) => {
  ok(p.id && !pids.has(p.id), `unique plant id: ${p.id}`); pids.add(p.id);
  ok(VALID_STATUS.includes(p.status), `${p.id} valid status`);
  ok(!("population" in p), `${p.id} has no contradictory population field`);
  ok(!!p.note, `${p.id} has note`);
});

// ---------- 2. DOM render + interaction ----------
const html = read("index.html");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

// canvas getContext shim (jsdom has no canvas backend)
window.HTMLCanvasElement.prototype.getContext = function () {
  return { clearRect() {}, fillRect() {}, set fillStyle(v) {}, get fillStyle() { return ""; } };
};
window.scrollInto5 = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};

// inject data + app into the window context
window.eval(read("data.js") + "\n" + read("app.js"));

const select = document.getElementById("animal-select");
ok(select.options.length === ANIMALS.length, "dropdown has every animal");

const detail = document.getElementById("detail");
ok(/family tree/i.test(detail.textContent), "first animal auto-rendered with family tree");
ok(detail.querySelector(".learn-more"), "detail has IUCN learn-more link");
ok(detail.querySelectorAll(".tree-node").length === ANIMALS[0].tree.length, "all tree nodes rendered");

// change dropdown to a Critically Endangered, high-population species
const cr = ANIMALS.find((a) => a.status === "Critically Endangered" && a.population > 1000);
if (cr) {
  select.value = cr.id;
  select.dispatchEvent(new window.Event("change"));
  const num = detail.querySelector(".pop-num");
  ok(num.classList.contains("crit"), `CR species ${cr.id} shown as crit regardless of high population`);
}
// an Endangered (not CR) species should NOT be crit even if population < 1000
const lowEnd = ANIMALS.find((a) => a.status === "Endangered" && a.population < 1000);
if (lowEnd) {
  select.value = lowEnd.id;
  select.dispatchEvent(new window.Event("change"));
  ok(!detail.querySelector(".pop-num").classList.contains("crit"),
     `low-pop Endangered ${lowEnd.id} NOT falsely flagged crit`);
}

// grids
ok(document.getElementById("animal-grid").children.length === ANIMALS.length, "animal grid full");
ok(document.getElementById("plant-grid").children.length === PLANTS.length, "plant grid full");

// card click loads detail
const firstCard = document.getElementById("animal-grid").children[1];
firstCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(detail.textContent.length > 0, "clicking a card populates detail");

// Jimmy interaction
const jimmyWrap = document.getElementById("jimmy-wrap");
const bubble = document.getElementById("jimmy-bubble");
ok(bubble.classList.contains("hidden"), "Jimmy bubble starts hidden");
jimmyWrap.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(!bubble.classList.contains("hidden"), "clicking Jimmy shows bubble");
ok(JIMMY_FACTS.includes(bubble.textContent), "Jimmy shows a real fact");

// ---------- 2b. Accessibility (Round 2) ----------
ok(jimmyWrap.getAttribute("role") === "button", "Jimmy has button role");
ok(jimmyWrap.tabIndex === 0, "Jimmy is keyboard-focusable");
ok(jimmyWrap.getAttribute("aria-expanded") === "true", "Jimmy aria-expanded true after activation");
// keyboard activation
bubble.classList.add("hidden");
jimmyWrap.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
ok(!bubble.classList.contains("hidden"), "Jimmy responds to Enter key");
ok(document.querySelector("#jimmy").getAttribute("aria-hidden") === "true", "Jimmy canvas aria-hidden");
ok([...document.querySelectorAll(".c-emoji")].every((e) => e.getAttribute("aria-hidden") === "true"),
   "all card emojis aria-hidden");
ok([...document.querySelectorAll("#plant-grid .card")].every((c) => c.classList.contains("card--static")),
   "plant cards marked non-interactive");
ok(detail.querySelector(".learn-more").getAttribute("aria-label").includes("new tab"),
   "learn-more warns about new tab");

// ---------- 3. Static sanity ----------
ok(read("index.html").includes('src="data.js"') && read("index.html").includes('src="app.js"'),
   "scripts linked in correct order");
ok(read("app.js").includes('"use strict"'), "app uses strict mode");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
