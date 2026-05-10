const fs = require('fs');
const path = 'D:/Projects/PAMS8/MS/Managers/ContextMenuManager.ts';
let c = fs.readFileSync(path, 'utf8');

// Map of corrupted patterns to correct emojis based on label text
const replacements = [
    ['Line of Sight', '👁️'],
    ['Weapon Engagement Zone', '🎯'],
    ['Projectile Trajectory', '📈'],
    ['Buffer abd Threat Rings', '⭕'],
    ['Corridor Analysis', '🛣️'],
    ['Effect Analysis', '💥'],
    ['Enable Measurements', '📐'],
    ['Disable Measurements', '🔬'],
    ['Enable 3D Slant Range', '⛰️'],
    ['Disable 3D Slant Range', '⛰️'],
    ['Measure This Symbol', '📏'],
    ['Save Symbols', '💾'],
    ['Load Symbols', '📂'],
    ['Save Plan', '💾'],
    ['Load Plan', '📂'],
    ['Stop Continuous Mode', '⏹'],
    ['Save / Load', '📁'],
    ['Analysis', '🔭'],
];

// Replace all icon spans
let fixed = c;
for (const [label, emoji] of replacements) {
    // Find the pattern: icon: '<span...>...corrupted...</span>'
    // where label text is near
    const pattern = new RegExp(`(<span style="font-size:14px">)[^<]*(</span>`);
    fixed = fixed.replace(/<span style="font-size:14px">[^<]*<\/span>/g, (match) => {
        // Check if this span contains replacement character (corruption indicator)
        if (match.includes('\ufffd')) {
            // Check the context (nearby text in the object)
            const beforeContext = c.slice(Math.max(0, c.indexOf(match) - 100), c.indexOf(match));
            for (const [lbl, emojiReplacement] of replacements) {
                if (beforeContext.includes(lbl)) {
                    return `<span style="font-size:14px">${emojiReplacement}</span>`;
                }
            }
        }
        return match;
    });
}

// Write back
fs.writeFileSync(path, fixed, 'utf8');
console.log('Done');