# Progress ledger — Curved Arrows (2026-07-25-curved-arrows.md)

Execution mode: directly on `master`, no worktree, no commits (user's explicit
choice — see conversation). Per-task diffs are snapshot-based
(`git diff --no-index` between a pre-task copy and the post-task file), not
commit-range diffs. Nothing is committed at any point; the working tree
carries all changes cumulatively across tasks.

Tasks:
- Task 1: complete (arrowType field, BriefingTypes.ts) — review clean, no commits (working tree only)
- Task 2: complete (sharp/curved/elbow path builders + buildArrowPath, OverlayFabric.ts) — review clean, no commits
- Task 3: complete (N-point makeArrowGroup + round-trips, OverlayFabric.ts; drag-arrow call site adapted, SlideEditor.ts) — review clean. Implementer found + fixed a necessary out-of-brief consequence: 5 sites in SlideEditor.ts (_applyStyleTo x3, _syncControlsFromSelection x2, actually 4+1) that located an arrow's stroke child via `ch.type === 'line'` now check `ch.type === 'path'` (arrow body child changed from fabric.Line to fabric.Path). Verified complete (no 6th site) and correctly scoped to kind==='arrow' only. No commits.
- Task 4: complete (click-chain multi-point Arrow tool, replacing drag; StyleDefaults.arrowType) — review clean/Approved. Deviation from brief (correct, verified): `type ArrowType` import NOT added to SlideEditor.ts (genuinely unused there under this project's real noUnusedLocals:true) — Task 5 must add it when it first needs the explicit type annotation. Minor findings deferred to final review: (a) SlideEditorUI.ts:113 TOOL_DEFS arrow tooltip still says "Arrow (drag)", now stale; (b) _arrowChain/_arrowPreview lack explicit reset in close()/_loadSlide() (harmless today per reviewer's trace, but asymmetric with _drawing/_lassoPts/_erasing). No commits.
- Task 5: complete (bow-handle segment editing via fabric.Control) — Approved after 3 fix rounds:
  (1) Critical bug found by implementer (verified against real fabric.js 4.5.0 source): brief's per-tick destroy/recreate design would orphan duplicate arrow objects on every drag since fabric pins transform.target for the whole gesture. Redesigned by controller: non-destructive per-tick preview object + one-shot real rebuild on `object:modified`. Verified via multi-tick retrace.
  (2) Important finding from review: mid-drag Delete/Undo could resurrect/duplicate the arrow. Fixed with defensive _bendDrag/_bendPreview clears in _deleteSelection/_restore.
  (3) Reviewer found an undisclosed `styleSelectionControls()` addition (global fabric.Object.prototype restyle) not requested anywhere in this plan; its safety comment falsely claimed the Briefing editor's canvas is the only fabric.Canvas in the app (index.html's #fabricCanvas contradicts this). Reverted, then user confirmed it was their own intentional addition (from a concurrent session — see docs/superpowers/specs/2026-07-25-selection-handle-style-design.md, same-day sibling spec, independently specifying the identical paired restore-on-close design) and asked to keep it. Re-added, scoped: snapshots prototype state on open, restores on close, so the global mutation no longer persists past the editor's own lifetime.
  Also accepted (necessary, disclosed, verified complete): _addOverlays (paste/duplicate) and _restore (undo/redo) gained _attachArrowControls calls — gaps nothing else in the 7-task plan covered.
  No commits.
- Task 6: complete (Sharp/Curved/Elbow panel selector, SlideEditorUI.ts + SlideEditor.ts _onStyleChanged/_applyArrowTypeChange) — Approved. Implementer's self-flagged multi-select-rebuild-ordering concern was investigated by reviewer against real fabric.js 4.5.0 internals and confirmed NOT a real risk (canvas-level remove/add never touches ActiveSelection's own cached transform). One Minor note deferred to final review: arrowType branch doesn't dissolve the ActiveSelection via the existing _withFlatSelection pattern before rebuilding members (not a bug today, latent fragility only if _rebuildArrow ever changes to group-aware removal). No commits.
- Task 7: complete (reopen an existing arrow via Arrow tool while selected, append points, Escape restores original) — Approved. Implementer found + fixed a real data-loss bug beyond the brief: _saveCurrent() read the canvas directly, so navigating/closing-with-save/presenting mid-reopen (without Escape/finish) would silently drop the arrow being edited from the saved slide. Controller identified a 3rd affected call site (_onAction's 'present' case) the implementer's initial report missed; fixed centrally inside _saveCurrent() itself (calls _clearArrowChain() when _arrowChain is set, before reading getObjects()) so all 3 current call sites + any future ones are covered. Verified by reviewer via full-file grep (exactly 3 call sites, none missed). Minor findings deferred to final review: (a) _defaults not restored to pre-reopen values on Escape-cancel of a reopen (only affects next newly-drawn shape's style); (b) one redundant _syncPanelContext repaint per reopen (cosmetic). No commits.

All 7 implementation tasks complete. Proceeding to final whole-branch review + manual browser verification.

## Final whole-branch review (opus) + fix pass

Found 2 Critical, 4 Important, ~9 Minor issues invisible to individual task reviews (cross-task interactions):
- CRITICAL: close()/_loadSlide() never reset _arrowChain/_arrowPreview/_arrowReopenedObj/_bendDrag/_bendPreview -> Cancel button during a reopen leaks state -> next editor open resurrects a stale duplicate arrow with a duplicate overlay id.
- CRITICAL: _restore() (undo/redo) didn't clear the reopen state either -> undo during a reopen could resurrect/duplicate the arrow or silently defeat the undo.
- IMPORTANT: _rebuildArrow / _onArrowReopen didn't account for the arrow group's scale -> switching type or bow-handle-dragging a SCALED arrow visibly shrank/grew its stroke+arrowhead.
- IMPORTANT: _rebuildArrow always remove+add (no z-order preservation) -> switching an arrow's type or inserting a bend silently sent it to the front, undoing manual layering.
- IMPORTANT: Elbow arrows incorrectly got bow handles (spec says they shouldn't) and the handle floated off the actual rendered (orthogonal) path.
- IMPORTANT (descoped, needs a decision, NOT fixed): PptxExporter.ts ignores arrowType on export -- curved exports as sharp (acceptable), elbow exports as a bare diagonal (wrong shape). Out of this plan's declared file scope (BriefingTypes/OverlayFabric/SlideEditor/SlideEditorUI only); flagged to user as a known limitation / follow-up decision.
- Minor (fixed): stale "Arrow (drag)" tooltip; stale "Reused by Task 6" doc-comment artifact.
- Minor (accepted, not fixed): multi-arrow type-change pushes one undo entry per arrow; a 107-char line; arrowSharp icon duplicates the existing arrow icon; ELBOW_FILLET_PX is an unscaled fixed pixel constant.

All Critical/Important items within plan scope were fixed in one pass and independently re-reviewed: Approved, no further issues found.

STATUS: 7/7 tasks complete, final review clean. Remaining open item: PPTX export for curved/elbow arrowType (user decision needed, not part of this plan's file scope). No commits made at any point in this entire implementation -- all changes live directly in the working tree on master, per user's explicit standing preference.
