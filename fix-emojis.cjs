const fs = require('fs');
const path1 = 'D:/Projects/PAMS8/MS/Managers/ContextMenuManager.ts';
const path2 = 'D:/Projects/PAMS8/MS/Engines/SymbolEngine.ts';

function fixFile(path) {
    let c = fs.readFileSync(path, 'utf8');
    const before = c;

    const replacements = [
        ['Line of Sight', '👁️'],
        ['Weapon Engagement Zone', '🎯'],
        ['Projectile Trajectory', '📈'],
        ['Buffer abd Threat Rings', '⭕'],
        ['Corridor Analysis', '🛣️'],
        ['Effect Analysis', '💥'],
        ['Enable Measurements', '📐'],
        ['Disable Measurements', '🔬'],
        ['3D Slant Range', '⛰️'],
        ['Measure This Symbol', '📏'],
        ['Save Symbols', '💾'],
        ['Load Symbols', '📂'],
        ['Save Plan', '💾'],
        ['Load Plan', '📂'],
        ['Stop Continuous Mode', '⏹'],
        ['Save / Load', '📁'],
        ['Analysis', '🔭'],
    ];

    for (const [label, emoji] of replacements) {
        const emojiBytes = Buffer.from(emoji, 'utf8').toString('hex');
        const corruptSequence = 'efbfbd';
        const labelIdx = c.indexOf(label);
        if (labelIdx < 0) continue;

        const nearSpan = c.slice(Math.max(0, labelIdx - 200), labelIdx + label.length + 100);
        const spanMatch = nearSpan.match(/<span style="font-size:14px">([^<]*)<\/span>/);
        if (spanMatch && spanMatch[0].includes('\ufffd')) {
            c = c.replace(spanMatch[0], `<span style="font-size:14px">${emoji}</span>`);
        }
    }

    if (c !== before) {
        fs.writeFileSync(path, c, 'utf8');
        console.log('Fixed:', path);
    } else {
        console.log('No changes:', path);
    }
}

fixFile(path1);
fixFile(path2);