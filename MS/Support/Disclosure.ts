/**
 * Disclosure.ts
 * Shared behaviour for the `.ms-disclosure` collapsible group that analysis
 * widget panels use to keep their default view minimal (see MS/Styles/Widgets.css).
 *
 * The markup carries its own initial state — `hidden` on the body plus
 * `aria-expanded="false"` on the head — so a group renders collapsed with no JS
 * involved. This module only wires the toggle.
 *
 * Expected structure:
 *
 *   <div class="ms-disclosure" data-open="false">
 *     <button class="ms-disclosure-head" type="button"
 *             aria-expanded="false" aria-controls="my-adv-body">
 *       <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
 *       <span class="ms-disclosure-title">Advanced</span>
 *       <span class="ms-disclosure-meta">What is inside</span>
 *     </button>
 *     <div class="ms-disclosure-body" id="my-adv-body" hidden>…</div>
 *   </div>
 */

/**
 * Wire every `.ms-disclosure` under `root`. The head button toggles its body and
 * keeps `data-open` (the styling hook) and `aria-expanded` (assistive tech) in
 * step with each other.
 *
 * Idempotent: each head is marked once, so calling this again after a panel adds
 * markup will only wire the new groups. Safe to call with a null root or one that
 * contains no disclosures.
 */
export function bindDisclosures(root: HTMLElement | null | undefined): void {
  root?.querySelectorAll<HTMLElement>('.ms-disclosure').forEach((group) => {
    const head = group.querySelector<HTMLButtonElement>('.ms-disclosure-head');
    const body = group.querySelector<HTMLElement>('.ms-disclosure-body');
    if (!head || !body || head.dataset.msDisclosureBound === '1') return;
    head.dataset.msDisclosureBound = '1';

    head.addEventListener('click', () => {
      const open = group.dataset.open !== 'true';
      group.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      // Panel bodies are height-capped and a disclosure usually sits near the
      // bottom, so freshly revealed controls would otherwise open below the fold.
      if (open) window.setTimeout(() => body.scrollIntoView({ block: 'nearest' }), 0);
    });
  });
}

export default bindDisclosures;
