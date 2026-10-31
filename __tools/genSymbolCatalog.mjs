// Generates MS/Docs/13-symbol-catalog.md from MS/Data/Symbols.json.
// Run: npm run docs:catalog   (also part of `npm run docs:build`)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(root, 'MS/Data/Symbols.json'), 'utf8'));
const esc = (s) => String(s ?? '').replace(/\|/g, '\|').replace(/\r?\n/g, ' ').trim();
const keys = Object.keys(data);

const byType = {};
const byClass = {};
for (const k of keys) {
    const s = data[k];
    (byType[s.SymGeoType] ??= []).push(k);
    (byClass[s.Class] ??= []).push(k);
}

const out = [];
out.push('# Symbol Catalog', '');
out.push('> Generated from `MS/Data/Symbols.json` by `tools/genSymbolCatalog.mjs`. Do not edit by hand; run `npm run docs:catalog`.', '');
out.push(`The catalog holds **${keys.length}** entries. The key is what you pass to the engine to pick a symbol.`, '');
out.push('## Geometry types', '', '| SymGeoType | Meaning | Entries |', '| --- | --- | --- |');
const meaning = {
    FPoint: 'Framed point symbol drawn from a SIDC (units, equipment, installations); uses `options`',
    Point: 'Tactical point symbol placed with one click; uses amplifier + drawEssentials',
    Line: 'Tactical line graphic (polyline)',
    Area: 'Tactical area graphic (polygon)',
};
for (const t of Object.keys(byType)) out.push(`| \`${t}\` | ${meaning[t] ?? ''} | ${byType[t].length} |`);
out.push('', '## Implementation classes', '', '| Class | Entries |', '| --- | --- |');
for (const c of Object.keys(byClass).sort((a, b) => byClass[b].length - byClass[a].length))
    out.push(`| \`${c}\` | ${byClass[c].length} |`);
out.push('', '## Field reference', '',
    '| Field | Meaning |', '| --- | --- |',
    '| `Class` | Implementation class name resolved by `Mapper.ts` |',
    '| `Name` | Display name |',
    '| `SymGeoType` | Geometry type (see above) |',
    '| `Cat` | Category tags (e.g. `log`) |',
    '| `Grp` | Group path used by the symbol browser |',
    '| `Parameters` | Draw-time parameters (`Name`, `default`, `description`, `value`) |',
    '| `isFreeHand`, `isObstacle`, `isAutoShape`, `Offset`, `Fill` | Optional behaviour flags where present |', '');

for (const t of Object.keys(byType)) {
    out.push(`## ${t} symbols`, '', '| Key | Name | Class | Group | Parameters |', '| --- | --- | --- | --- | --- |');
    for (const k of byType[t]) {
        const s = data[k];
        const params = (s.Parameters ?? []).map((p) => p.value ?? p.Name).join(', ');
        out.push(`| \`${esc(k)}\` | ${esc(s.Name)} | \`${esc(s.Class)}\` | ${esc((s.Grp ?? []).join(' / '))} | ${esc(params)} |`);
    }
    out.push('');
}
writeFileSync(resolve(root, 'MS/Docs/13-symbol-catalog.md'), out.join('\n'));
console.log(`Wrote MS/Docs/13-symbol-catalog.md (${keys.length} entries)`);
