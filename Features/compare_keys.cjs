const fs = require('fs');

const sample = JSON.parse(fs.readFileSync('./Features/sample.json', 'utf8'));
const pams8 = JSON.parse(fs.readFileSync('./Features/pams8_plan_1778217403997.json', 'utf8'));

function getKeys(overlay) {
  const symbols = overlay.plnOrdrSymbolSet;
  const allKeys = new Set();
  for (const sym of symbols) {
    try {
      const de = JSON.parse(sym.drawEss);
      Object.keys(de).forEach(k => allKeys.add(k));
    } catch (e) {}
  }
  return [...allKeys].sort();
}

const sampleKeys = getKeys(sample.poObj.plnOrdrOverlay[0]);
const pams8Keys = getKeys(pams8.poObj.plnOrdrOverlay[0]);

console.log('=== SAMPLE.JSON drawEss keys ===');
console.log(sampleKeys.join(', '));
console.log('\n=== PAMS8_PLAN drawEss keys ===');
console.log(pams8Keys.join(', '));

console.log('\n=== Keys in SAMPLE but NOT in PAMS8 ===');
console.log(sampleKeys.filter(k => !pams8Keys.includes(k)).join(', '));

console.log('\n=== Keys in PAMS8 but NOT in SAMPLE ===');
console.log(pams8Keys.filter(k => !sampleKeys.includes(k)).join(', '));

// Show data type differences for common keys
console.log('\n=== Data type comparison for common keys ===');
const sym1 = JSON.parse(sample.poObj.plnOrdrOverlay[0].plnOrdrSymbolSet[0].drawEss);
const sym2 = JSON.parse(pams8.poObj.plnOrdrOverlay[0].plnOrdrSymbolSet[0].drawEss);
const common = sampleKeys.filter(k => pams8Keys.includes(k));
for (const k of common) {
  const t1 = typeof sym1[k];
  const t2 = typeof sym2[k];
  if (t1 !== t2) console.log(`${k}: sample=${t1}, pams8=${t2}`);
}