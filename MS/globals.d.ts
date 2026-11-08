// Globals provided by <script> tags in the host page (not ES modules).
// - window.MS: the customised milsymbol.js v0.5.6 fork (legacy `MS.symbol` API) —
//   untyped on purpose; the modern milsymbol .d.ts does not describe the fork.
// - window.TweenMax / window.Linear: GSAP-style tween globals used by FreehandDottedArrow.
export {};

declare global {
    interface Window {
        MS: any;
        TweenMax: any;
        Linear: any;
    }
}
