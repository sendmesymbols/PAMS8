// forms.mjs -- checks for own attack, the forms of manoeuvre (GroundGuideIpbForms.ts).  node tools/ipb-test/forms.mjs
import { register } from 'node:module';
register('../movement-test/hooks.mjs', import.meta.url);
const { formsOfManoeuvre } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbForms.ts');
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
const ap = (id, onto, o = {}) => ({ id, onto, goPct: 95, assaultNogoPct: 0, lengthM: 8000, fire: { coveredPct: 20, seenPct: 50 }, ...o });
const open = { nogoPct: 5, obstacle: false, enemyWithinM: null };
const tied = { nogoPct: 60, obstacle: false, enemyWithinM: null };
const base = { apchs: [ap('A', 'left'), ap('B', 'right'), ap('C', 'frontal')], flanks: { left: open, right: open }, ownEch: '16', objEch: '16', mover: 'dismounted', lzBehind: 0, turnLabel: null, mountain: false };
const ids = (r) => r.options.filter((o) => o.feasible).map((o) => o.id).join(' > ');
{
  const r = formsOfManoeuvre(base);
  check('both flanks open, force adequate: double envelopment leads, then envelopment, penetration, frontal last', r.lead === 'double' && ids(r) === 'double > envelopment > penetration > frontal', ids(r));
}
{
  const r = formsOfManoeuvre({ ...base, flanks: { left: open, right: tied } });
  check('one flank open: envelopment onto it (the left), no double', r.lead === 'envelopment' && r.options.find((o) => o.id === 'envelopment').main === 'A' && !r.options.find((o) => o.id === 'double').feasible && !r.flanks.right.assailable, r.flanks.right.why);
}
{
  const r = formsOfManoeuvre({ ...base, flanks: { left: tied, right: { nogoPct: 5, obstacle: false, enemyWithinM: 600 } } });
  check('no assailable flank (NO-GO one side, his locality 600 m off the other): penetration leads, a note says so', r.lead === 'penetration' && r.notes.some((n) => /No assailable flank/.test(n)), ids(r));
}
{
  const r = formsOfManoeuvre({ ...base, apchs: [...base.apchs, ap('T', 'turn')], turnLabel: 'Br on MSR N-5' });
  check('a turning approach to the MSR choke leads (user: choke his MSR)', r.lead === 'turning' && r.options[0].main === 'T' && r.options[0].aux === 'C');
}
{
  const r = formsOfManoeuvre({ ...base, lzBehind: 2, apchs: [ap('A', 'left', { fire: { coveredPct: 10, seenPct: 20 } }), ap('B', 'right'), ap('C', 'frontal')] });
  check('LZs behind him make vertical envelopment feasible; an approach he barely watches makes infiltration feasible on foot', r.options.find((o) => o.id === 'vertical').feasible && r.options.find((o) => o.id === 'infiltration').feasible && r.options.find((o) => o.id === 'infiltration').main === 'A');
  const m = formsOfManoeuvre({ ...base, mover: 'armour', apchs: [ap('A', 'left', { fire: { coveredPct: 10, seenPct: 20 } }), ap('B', 'right'), ap('C', 'frontal')] });
  check('infiltration is on foot only', !m.options.find((o) => o.id === 'infiltration').feasible);
}
{
  const r = formsOfManoeuvre({ ...base, ownEch: '15', objEch: '16' });
  check('a Coy against a Bn: both flanks open but the force is below his echelon: no double envelopment', !r.options.find((o) => o.id === 'double').feasible && r.lead === 'envelopment');
  const w = formsOfManoeuvre({ ...base, apchs: [ap('A', 'left'), ap('B', 'right', { fire: { coveredPct: 70, seenPct: 90 } }), ap('C', 'frontal')], ownEch: '15', objEch: '16' });
  check('with both flanks open the envelopment takes the better flank (less of his fire)', w.options.find((o) => o.id === 'envelopment').main === 'A');
}
{
  const r = formsOfManoeuvre({ ...base, mountain: true });
  check('mountains: a note says frontal only if unavoidable (MW p 79)', r.notes.some((n) => /MW p 79/.test(n)) && r.options.find((o) => o.id === 'envelopment').why.some((w) => /mountains/.test(w)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
