// Checks the ORBAT data in MS/Data/Orbat/PK (SO's Handbook 2019 extraction).
//   node tools/orbat-test/run.mjs          (add --quiet to print only failures and the summary; a country code, e.g. PK, for another folder)
// Fails on: bad JSON, duplicate ids, a child pointing at a unit that does not exist, a bad echelon code,
// a child of a higher echelon than its parent, a unit or box weapon whose `weapon` id is not in weapons.json,
// a weapons.json symbol key that is not in Symbols.json, a chartStrength that is not a whole number,
// a weapon / equipment / vehicle item without a name, a child without a role.
// Warns on items or children with no count (fine where the book prints none), when printed strength parts do not
// add up to the total, and when the boxes under a chart box do not add up to the figure printed in it (the book
// often disagrees with itself: a note saying so silences the warning).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// the ORBAT lives in a folder per country (MS/Data/Orbat/PK); `node tools/orbat-test/run.mjs XX` checks another
const country = process.argv.slice(2).find((a) => /^[A-Z]{2}$/.test(a)) ?? 'PK';
const dir = path.join(root, 'MS/Data/Orbat', country);
const quiet = process.argv.includes('--quiet');
const ECH = new Set(['11', '12', '13', '14', '15', '16', '17', '18', '21', '22', '23']);
let fails = 0, warns = 0, checks = 0;
const fail = (m) => { fails++; console.log('FAIL', m); };
const warn = (m) => { warns++; if (!quiet) console.log('warn', m); };
const ok = (c, m) => { checks++; if (!c) fail(m); };
const explains = (o) => !!o && (o.uncertain || /uncertain|misprint|not add|printed|disagree|differ|implies|imply/i.test(
  `${o.strengthNote ?? ''} ${o.note ?? ''} ${(Array.isArray(o.notes) ? o.notes : []).join(' ')}`));

const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const symbols = JSON.parse(fs.readFileSync(path.join(root, 'MS/Data/Symbols.json'), 'utf8'));
const weaponsDoc = JSON.parse(fs.readFileSync(path.join(dir, 'weapons.json'), 'utf8'));
const weaponIds = new Set();
for (const w of weaponsDoc.weapons) {
  ok(!weaponIds.has(w.id), `weapons.json: duplicate weapon id ${w.id}`);
  weaponIds.add(w.id);
  for (const k of w.symbolKeys ?? []) ok(!!symbols[k], `weapons.json: ${w.id} symbol key ${k} not in Symbols.json`);
}

// Every JSON file in the folder should be listed in index.json (a new section file is easy to forget).
const listed = new Set([...index.files.map((f) => f.file), index.weapons.file, 'index.json']);
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) if (!listed.has(f)) warn(`${f} is in MS/Data/Orbat but not in index.json (its units are not checked)`);

const units = new Map();
for (const f of index.files) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f.file), 'utf8'));
  ok(Array.isArray(doc.units), `${f.file}: units[] missing`);
  if (doc.units.length !== f.units) warn(`index.json says ${f.file} has ${f.units} units, it has ${doc.units.length}`);
  for (const u of doc.units) {
    ok(!units.has(u.id), `duplicate unit id ${u.id} (${f.file})`);
    units.set(u.id, { ...u, _file: f.file });
  }
}

const isWhole = (n) => Number.isInteger(n) && n >= 0;
function checkItems(where, kind, list) {
  if (list == null) return;
  ok(Array.isArray(list), `${where}: ${kind} is not a list`);
  if (!Array.isArray(list)) return;
  for (const it of list) {
    ok(typeof it?.name === 'string' && it.name.length > 0, `${where}: a ${kind} item has no name`);
    if (it?.count == null && it?.qty == null) warn(`${where}: ${kind} "${it?.name}" has neither count nor qty (fine if the book prints none)`);
    if (kind === 'weapons' && it?.weapon) ok(weaponIds.has(it.weapon), `${where}: weapon ${it.weapon} not in weapons.json`);
  }
}
function checkStrength(where, node) {
  const s = node.strength;
  if (s && s.total != null) {
    // every printed category (offr, jco, sldr, sw, att, ncu, nce, tdn, civ ...) except the total itself
    const parts = Object.entries(s).filter(([k, v]) => k !== 'total' && typeof v === 'number').reduce((a, [, v]) => a + v, 0);
    const known = ['offr', 'jco', 'sldr', 'or'].some((k) => s[k] != null);
    if (known && parts !== Number(s.total) && !explains(node)) warn(`${where}: strength parts ${parts} ≠ printed total ${s.total} (p ${node.page ?? '?'}), no note says why`);
  }
  if (node.chartStrength != null) ok(isWhole(node.chartStrength), `${where}: chartStrength ${JSON.stringify(node.chartStrength)} is not a whole number`);
}
// Box figure of a child: its own chartStrength, else the linked unit's, else a strength total.
function boxFigure(c) {
  if (c.chartStrength != null) return c.chartStrength;
  const u = c.unit && units.get(c.unit);
  if (u?.chartStrength != null) return u.chartStrength;
  return null;
}
function checkChildren(where, node, echelon) {
  const kids = node.children ?? [];
  for (const c of kids) {
    const at = `${where} › ${c.role ?? '?'}`;
    ok(typeof c.role === 'string' && c.role.length > 0, `${where}: a child has no role`);
    if (c.count == null) warn(`${at}: child has no count (fine if the book prints none)`);
    if (c.unit) {
      const child = units.get(c.unit);
      ok(!!child, `${where}: child ${c.unit} not defined`);
      if (child && echelon && child.echelon) ok(Number(child.echelon) <= Number(echelon), `${where} (${echelon}) has child ${c.unit} of higher echelon ${child.echelon}`);
    }
    checkStrength(at, c);
    for (const k of ['weapons', 'equipment', 'vehicles']) checkItems(at, k, c[k]);
    checkChildren(at, c, c.echelon ?? echelon);
  }
  // Do the boxes under this box add up to the figure printed in it? Only when every box under it prints one
  // (attached elms marked relation "att" are left out: charts usually print them outside the parent's figure).
  const own = node.chartStrength;
  const counted = kids.filter((c) => c.relation !== 'att');
  if (own != null && counted.length) {
    const figs = counted.map((c) => [boxFigure(c), Number(c.count) || 0]);
    if (figs.every(([f]) => f != null)) {
      const sum = figs.reduce((a, [f, n]) => a + f * n, 0);
      if (sum !== own && !explains(node)) warn(`${where}: boxes under it add up to ${sum}, the box prints ${own} (p ${node.page ?? '?'})`);
    }
  }
}

let boxes = 0, boxesWithFigure = 0;
const countBoxes = (n) => { for (const c of n.children ?? []) { boxes++; if (boxFigure(c) != null || c.strength?.total != null || units.get(c.unit)?.strength?.total != null) boxesWithFigure++; countBoxes(c); } };
for (const u of units.values()) {
  if (u.echelon != null) ok(ECH.has(String(u.echelon)), `${u.id}: echelon ${u.echelon} not a 2525D code`);
  checkStrength(u.id, u);
  for (const k of ['weapons', 'equipment', 'vehicles']) checkItems(u.id, k, u[k]);
  checkChildren(u.id, u, u.echelon);
  countBoxes(u);
}
console.log(`\n${units.size} units, ${weaponIds.size} weapons, ${boxes} chart boxes (${boxesWithFigure} with a pers figure), ${checks} checks, ${fails} failed, ${warns} warnings`);
process.exit(fails ? 1 : 0);
