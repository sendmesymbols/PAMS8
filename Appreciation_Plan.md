# Aprc Export: the appreciation as a document and as slides

Status: **Phases 1 to 3 built, 22 Nov 2026** as `MS/Engines/GroundAppreciation/` (see `MS/Docs/22-ground-appreciation.md`
and section 12 below for what differs from this plan). Mockup: `ground-appreciation-export-options.html` (synthetic ground,
invented figures). Related: `15-ground-guide.md` (Gr Scope AOR scale), `IPB_Plan.md`, `PlanBuilder_Plan.md`,
`Briefing_animation_export.md`, `claude_rules.md` (terrain bundle optional).

**Handling.** The specimen, `Material/AprDf.pdf`, is marked SECRET. This plan and the mockup use its headings and
numbering only, never its text. The same goes for anything the feature ships.

---

## 1. Goal

The appreciation of the situation is the planner's own document and the basis of the decision. Today the Ground Guide
already works out most of its *Gr and Weather* factor, and the Intelligent Deployment tab most of its *Courses* and
*Plan*, but the only way out is Copy as Text. This plan makes the appreciation a thing of its own:

- one **model** of the document, filled from whatever is on the map (one symbol is enough to start);
- a **sheet** in the app where the planner reads, overwrites and completes it;
- a **formatted document** (Word and PDF) laid out as service writing;
- a **deck** in the Briefing module, made from the same model;
- smaller cuts of it (approach sheets, the trace, the confirm list, the tables).

### What it is not

- **Not the decision.** The tool drafts facts and lays out proposals. Deductions, the enemy's intention, the course
  adopted and the mission are the planner's. A proposal is always marked as one.
- **Not a replacement for recce.** Every export carries the Confirm on Gr list.
- **No enemy data of its own.** The enemy is what the user marks; until then he is assumed one level up and the
  document says so.

---

## 2. The specimen

`AprDf.pdf` is a Bn defence appreciation, 15 pages. Its outline, which the model follows:

| Part | Paras | Content |
| --- | --- | --- |
| Review of Sit | 1 to 3 | En forces, own forces, air sit |
| Aim | 4 | Aim and limitations |
| Factors: Gr and Weather | 5 to 11 | Gen description; approaches (Lt, Cen, Rt under twelve heads); ITGs (effs if lost, significance); obs; cover; met; deductions (pri of approaches, combinations, lines of def, Def Possibilities, common deductions) |
| Factors: En Sit | 12 to 15 | Composn and disposn; his expectations; options with phases and timings, advs / disadvs; deductions |
| Factors: Own Sit | 16 to 20 | Composn; disposns; relative strength table; tps to tasks table; deductions (allotment) |
| Factors: Time and Space | next 3 | Time data; time required table; deductions (essential timings, priority of work) |
| Courses | next 5 | Course A; en reactions against own counter actions; analysis; Course B; course adopted |
| Plan | last 4 | Msn; exec (gen outline, grouping and tasks per coy, coord instrs); adm and log; comd and sig |

Two points about the specimen:

- Several paragraphs say only "Ref to whites" (5, 8, 9, 10, 12, 13, 16, 17). **User, 22 Nov 2026: omit it.** The phrase
  is never printed; those paragraphs are drafted from the terrain data, or ruled for the planner.
- Its paragraph numbers restart after 19. The model numbers by structure (stable ids), and prints the numbers the
  layout gives; it does not copy the specimen's numbering slip.

---

## 3. What can be written, and from where

States: **Gr** = drafted from the ground reading; **Map** = read from symbols or a built plan; **Judge** = the facts are
given and a line proposed, the planner confirms; **Yours** = left for the planner (ruled line, with the heads to
consider). The four columns are what is on the map: one symbol / Bdys and a threat / enemy marked / plan built.

| Para | Heading | 1 sym | Bdys | En | Plan | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | En Forces | Yours | Yours | Judge | Judge | En symbols (`readSymbols`, side `enemy`) with ORBAT (`enUnitFor`); intention is the user's |
| 2 | Own Forces | Yours | Yours | Judge | Map | Own symbols, Bdy symbols, `pbMeta.unit` |
| 3 | Air Sit | Yours | Yours | Yours | Yours | none |
| 4 | Aim | Yours | Judge | Judge | Judge | VG symbol (place), Bdy symbols ("within given bdrys") |
| 5 | Gen Description | Gr | Gr | Gr | Gr | `AorReading.country`, `.going`, `.map.water`; `sectionsAround` ground; `roadDensityAround`. **New writer** |
| 6 | Apchs | Gr | Gr | Gr | Gr | `aorSheetRows` (built: 11 of 12 heads). **Obsn is null today**: fill from the Extended View sight reading along the approach |
| 7 | ITGs | Judge | Judge | Judge | Judge | MITG, BUAs astride the lines (built in `aorText`); candidates from `rankKeyGround`; IG / VG symbols first. Effs if lost: facts as prompts |
| 8 | Obs | Gr | Gr | Map | Map | `AorApproach.obstacles`, `.going.nogoOut`, `ObstaclesReading` (width, depth, banks), bridges and class; obstacle symbols drawn on the map |
| 9 | Cover | Gr | Gr | Gr | Gr | `AorApproach.band`, `coverAround`, crop by month (`GroundGuideOcoka.crop`) |
| 10 | Met Conditions | Gr | Gr | Gr | Gr | `WeatherReading` (month), `IpbWxView` (Annex A rows), `GroundGuideOcoka.light`. First / last light and moon: **new**, worked out from date and place, no data needed |
| 11a | Pri of apchs, combinations, lines of def | Judge | Judge | Judge | Judge | `AorApproach.rank` and `score`, `laterals`, `AorDefLine` (built in `aorText`) |
| 11b | Def Possibilities | Judge | Judge | Judge | Map | `AorDefLine.role`, `frontLimit`; killing areas `IpbFireView.killing`; OPs from the OP ranker; with a plan, `CheckReport.posns` |
| 11c | Common Deductions | Yours | Yours | Yours | Yours | heads only |
| 12 | En Composn and Disposn | Yours | Yours | Map | Map | En symbols, ORBAT; `IpbTemplateView.elements` |
| 13 | En Expectations | Yours | Yours | Yours | Yours | none |
| 14 | Options Aval to the En | Judge | Judge | Judge | Judge | `IpbApchView.aas`, `IpbDecisionView.profiles` (time along each avenue), `template.phases`, `enFup`; advs / disadvs from `IpbProformaView` signs |
| 15 | Deductions | Yours | Yours | Judge | Judge | Candidates: his Assy A (finder run from his side), `IpbAirView.lzs`, Movement Guide infiltration lanes |
| 16 | Composn of Own Forces | Yours | Yours | Judge | Map | `unitForPlan`, `brief`, `subUnitsOf`; attachments in `pbMeta` |
| 17 | Own Disposns | Yours | Yours | Judge | Map | `PosnRead` (kind, label, ech), `PlanItem.role` |
| 18 | Relative Str | Judge | Judge | Map | Map | `forceFromOrbat` (own and en strength), `atgmPairs`, `tankSqnOf`, `EngrType`. **Needs numbers out**: `forceRow` gives the ratio only inside its sentence |
| 19 | Assessment of Tasks | Yours | Judge | Judge | Map | Localities on each line (`AorDefLine.buas`) at doctrine size; with a plan, `SlotResult` and `PosnRead.units` |
| 20 | Deductions (allotment) | Yours | Yours | Judge | Map | Shortfall of 19 against 16 |
| T1 | Time Data | Yours | Yours | Yours | Yours | none |
| T2 | Time Req | Yours | Judge | Judge | Map | `minesByEngr`, Move Planner road engine for the move in, `WhatIfResult` routes |
| T3 | Deductions | Yours | Yours | Judge | Judge | Timings worked back from "def to be ready by" |
| C1 | Course A, Course B | Yours | Yours | Judge | Map | `FittedLayout` for each layout compared (`rankFits`); two built plans by `pbPlanId` |
| C2 | En Reactions and Own Ctr Actions | Yours | Yours | Judge | Map | `WhatIfResult.triggers` (his time, own time, verdict); NAIs and DPs from `IpbDecisionView` |
| C3 | Analysis | Yours | Yours | Judge | Map | `CheckReport.rows`: Pass is an adv, Fail a disadv, each with its `why` |
| C4 | Course Adopted | Yours | Yours | Yours | Yours | the two side by side; the choice is the user's |
| P1 | Msn | Yours | Yours | Yours | Yours | none |
| P2 | Exec | Yours | Yours | Yours | Map | `PlanItem` by role (gen outline); "from incl … to incl …" from each posn's extent and the named places at its ends; grouping from `pbMeta` (atGroup, engr, arty, defTanks); be-prepared tasks from `WhatIfResult.cpen` and `sups` |
| P3 | Adm and Log | Yours | Yours | Yours | Judge | Admin Area finder sites, when run |
| P4 | Comd and Sig | Yours | Yours | Yours | Map | HQ items in the plan |

Already built and reused as they are: `readAor`, `aorWords`, `aorSheetRows`, `aorText`, `aorMapSvg`
(`GroundGuideAor.ts`, `GroundGuideScopeAor.ts`); `ipbApproachesAround` (works with F off); `checkPlan`, `planText`,
`checkText`; `SerializationEngine.planDocument()`.

### One symbol is enough

With one land-unit symbol the AOR is the echelon frame round it, the threat side is the symbol's front, and the enemy
is assumed one level up. That gives paras 5 to 10 in full and 7, 11, 14, 18 as proposals. Each thing then marked
upgrades part of the document:

| Marked | What changes |
| --- | --- |
| Bdy symbols | The AOR is the real one: frontages are tested, tps to tasks can be laid |
| VG symbol | The MITG is named by the user, not taken from the symbol |
| Threat marker | Approach starts are no longer "assumed" |
| En symbols | Paras 1, 12, 18 read from the map; options use his real start and type |
| Obstacle symbols | Para 8 lists them; DCB and ditches, which the bundle does not hold, enter this way |
| A built or drawn plan | Own Sit, Courses and the Plan are written from it |

Every "assumed" is said in the paragraph and listed again under Confirm on Gr.

---

## 4. The model

One result shape, pure data, no DOM:

```ts
interface AprcDoc {
  kind: 'def' | 'attk';
  head: { marking: string; copyNo: string; unit: string; place: string; ref: string; date: string; refs: string[] };
  frame: { anchor; aorSource; threat; month; season; mover; echelon; stamp };   // what the reading was taken with
  parts: AprcPart[];                // Review, Aim, Factors (four groups), Courses, Plan
  figures: AprcFigure[];            // trace, approach strips, live map shots
  tables: AprcTable[];              // relative str, tps to tasks, time req, reactions
  confirm: AprcConfirm[];           // text + place + the paragraphs it touches
  sources: AprcSource[];            // data layer, date, licence; rule, book, page
}
interface AprcPara {
  id: string;                       // stable: 'gr.apch.lt.capacity', never the printed number
  head: string | null;
  draft: string | null;             // what the tool wrote (null = cannot know)
  state: 'gr' | 'map' | 'judge' | 'yours';
  mine?: { text: string; draftHash: string; at: string };   // the planner's words
  basis: AprcBasis[];               // data | rule (book, page) | input | calc
  prompts?: string[];               // heads or facts to consider when it is the planner's
  restsOn?: string[];               // ids of the paragraphs a deduction is drawn from
  figure?: string; table?: string; children?: AprcPara[];
}
```

Rules:

1. **A paragraph the planner touches is his.** `mine` wins over `draft` everywhere. Reading again never overwrites it.
2. **Stale, not replaced.** If `draft` changes after `mine` was written (the hash differs), the sheet shows a mark and
   offers both texts side by side.
3. **Proposals are marked.** `judge` paragraphs print in the fair copy only once the planner accepts or rewrites them.
   Open decision 2 in section 11 settles what the fair copy does with those not yet accepted.
4. **Nothing invented.** Where the data cannot know, `draft` is null and the line is ruled, as `aorSheetRows` does now.
5. **Everything backed.** Each drafted line carries its data (layer, date) and its rule (book, page), as in
   `SiteScan.dataCatalog` and the doctrine `refs`. No "NCGDB" in any output: "1:50k map".
6. **Saved with the plan.** The model goes into the plan document beside `PB`, and can be saved and opened alone.

---

## 5. Where it lives

A module of its own, since it reads three engines: `MS/Engines/Appreciation/`.

| File | Kind | Job |
| --- | --- | --- |
| `AprcModel.ts` | pure | Types, the outline for `def`, numbering, merge of a new reading into a kept document |
| `AprcCollect.ts` | glue | Calls the public APIs of the Ground Guide, the Plan engines, ORBAT; returns plain inputs |
| `AprcWrite.ts` | pure | Inputs to paragraphs, in the service short forms already used (Gr, Rd, Obs, Obsn, BUA) |
| `AprcFigures.ts` | view | `aorMapSvg` to SVG / PNG; live map shot with a timeout |
| `AprcHtml.ts` | pure | Model to the print layout (also the sheet's page) |
| `AprcDocx.ts` | pure | Model to a .docx blob |
| `AprcDeck.ts` | pure | Model to a `BriefingDocument` fragment |
| `AprcSheet.ts` | view | The window: outline, page, basis pane |
| `AppreciationEngine.ts` | engine | Lifecycle, settings, events, public API |

Public API (headless, for hosts): `symbolEngine.appreciation.read(opts) → AprcDoc`, `setText(id, text)`,
`accept(id)`, `toText()`, `toHtml(copy)`, `toDocx(copy) → Blob`, `toDeck(kind) → BriefingDocument`, `open()`,
`destroy()`.

Settings: `features.appreciation` (off by default), `appreciation.*` (marking, copy, figure kind, deck kind). Top bar
button and Ctrl+K widget; keep `index.html` and `src/main.ts` in step.

Terrain bundle rule: the engine reads the bundle only through the Ground Guide. Bundle off or missing: the Gr
paragraphs come as "needs terrain data" and the document still opens, takes the planner's words and exports. Nothing
is fetched while the feature is off.

Tests: `node tools/aprc-test/run.mjs` on the pure files (outline complete, numbering, merge keeps `mine`, every drafted
line has a basis, no "NCGDB" in output, fair copy holds no unaccepted proposal).

---

## 6. The document

Layout as service writing: marking at head and foot of every page, page number at the head, copy number and address
block, underlined group and paragraph headings, paragraph indents a. / (1) / (a) / i., tables ruled, figures numbered,
annexes (Anx P the trace).

- **Fair copy**: what goes up. No marks.
- **Draft copy**: the same pages with a mark on each paragraph (GR / MAP / YOU JUDGE / YOURS), numbered notes for the
  basis, and two more annexes: the sources with dates, and Confirm on Gr.

Formats:

| Format | How | Note |
| --- | --- | --- |
| PDF | `AprcHtml` in a print window, A4 page rules | No library. First to build |
| Word (.docx) | WordprocessingML written by `AprcDocx`, zipped | The document is the planner's to finish, so Word matters most. The PowerPoint bundle carries JSZip; whether it is reachable from outside the bundle is **not checked yet**. If not, bundle the `docx` library offline, loaded on first export as PptxGenJS is |
| Text | `aorText` extended to the whole outline | For signals and chat |
| JSON | the model | Reopen later |

Figures: the vector trace from `aorMapSvg` (sharp at any size, no basemap, works offline) is the default. A shot of the
live map with the symbols is the alternative. Word gets a PNG at twice the print size, since older Word does not take
SVG.

---

## 7. Slides through the Briefing module

What the Briefing module gives (read 22 Nov): a deck is plain JSON (`BriefingDocument`: slides with `overlays` of kind
text, table, chart, image, milsym and shapes; `section`; `notes`; `comments`; `chrome` with the classification banner).
Tables and charts export to PowerPoint as native objects. A slide with a `backgroundDataUrl` and no extent is
"screen-only" and needs no map; a captured slide keeps the map extent and layer switches and plays on the live map.

So the appreciation maps onto it directly:

| Appreciation | Slide |
| --- | --- |
| Part (Review, Gr and Weather, …) | `section` |
| Paragraph in full | `notes` (speaker notes), so the slide stays short |
| Heads of an approach, relative str, tps to tasks, time req, reactions | `table` overlay (native, editable; 30 rows × 15 columns, `autoPage`) |
| Relative str, time available against required, month's weather | `chart` overlay (`ChartSpec`: bar, barHorizontal, line) |
| Trace, approach strip | `image` overlay from `aorMapSvg` |
| Gen description, ITGs, en disposn, gen outline | captured live-map slide at the AOR extent |
| Confirm on Gr item | `SlideComment` of kind `task` on the slide it belongs to |
| Assumed threat, assumed strength | `SlideComment` of kind `assumption` |
| Marking | `DeckChrome.classification`, typed once in the sheet |
| Paragraph id | kept on the slide, for refresh |

Three decks from one model:

- **Full brief** (about 24 slides): a slide or more for each paragraph with content.
- **Decision brief** (about 10): what the ground gives, his options, relative strength, the courses, the choice, the
  plan, what to confirm.
- **Sand model**: the orientation order of the CO's model (gen description, approaches, ITGs, lines of def), on live
  map slides.

What the Briefing module needs added (small, all public and headless):

1. `addSlidesFromData(slides: Partial<Slide>[], opts?: { after?: ref; section?: string })`. Today `importBriefing`
   replaces the whole deck and the layout function `addSlideFromLayout` is private.
2. A `sourceRef?: string` field on `Slide` (the paragraph id) and an `edited` flag set by the slide editor. Refresh
   then rewrites untouched slides and flags edited ones.
3. Capture at a given extent without moving the user's view (or move and restore), with the existing timeout.

Honest limits: builds (`BuildStep`) reveal map graphics by id, so the phase-by-phase reveal on an enemy option slide
works only after Create on Map has written the phases as symbols; otherwise the slide is one static picture. Slides
live in memory and are not in the plan save, so the deck is rebuilt from the saved appreciation or saved as its own
briefing file. Captured slides need a live view; the screen-only slides do not.

---

## 8. Other exports from the same model

Gr and Weather alone (paras 5 to 11 with the trace); approach sheets (one page each: strip map, twelve heads, a
cross-section from `SiteLine.profileLine`, crossings with class); the trace as PDF / PNG and as symbols (Create on Map
for lines of def and the DP, as the IPB overlay does); the Confirm on Gr list sorted by place; the enemy options
matrix; relative strength and tps to tasks (also CSV); the time and space chart; courses compared; the Plan extract
(para P2, the skeleton of the op order); the basis annex.

---

## 9. Gaps to close in the existing engines

| Gap | Where | Work |
| --- | --- | --- |
| Obsn head of an approach is null | `aorSheetRows` | Sample the Extended View sight reading along the approach: median clear distance, what cuts it |
| Gen Description has no writer | new, `AprcWrite` | Compose from `AorReading` and the sections |
| Cover and Met as paragraphs | new, `AprcWrite` | From `band`, `coverAround`, `WeatherReading`, `IpbWxView` |
| First / last light, moon | new, pure | Astronomy from date and place; basis M (method) |
| Lines of def fixed at W X Y Z | `readAor` | The specimen has five (V to Z). Let the count follow the ground; letter from the rear |
| Force ratio as a sentence only | `PlanContext.forceRow` | Return the two strengths and the ratio beside the sentence |
| Relative str by arm | new | Per arm from ORBAT: Inf coys, Armr sqns, ATGM, Engrs; "?" where the en unit is not known |
| No event matrix type | `IpbDecisionView` | Use the NAI rows; a matrix view of them for the document |
| IPB avenues carry no name | `IpbApchAa` | The AOR's Lt / Cen / Rt stay the backbone; IPB avenues attach by nearest path |
| "From incl … to incl …" | new | Named places at the two ends of a posn's frontage |
| Deck from data | Briefing | Section 7, items 1 to 3 |

---

## 10. Extensions worth considering

1. **Deduction trail.** Each deduction lists the paragraphs it rests on (`restsOn`); the draft copy prints them, the
   slide shows them in the notes. A reader can follow why.
2. **Check my appreciation.** Like Check my plan: the planner writes his priority of approaches and lines; the tool
   says where its reading differs and why. A second opinion, never a mark.
3. **Dry and after rain side by side.** The same document read for both; only the paragraphs that change are shown
   (Tfc, Obs, going, time required).
4. **Copies and changes.** Each export is stamped; a later copy can list what changed since the last.
5. **Recce tasking.** Confirm on Gr items become points on the map, and a recce plan through them (the recce recipe
   in the Intelligent Deployment tab).
6. **Attack appreciation.** A second outline (`kind: 'attk'`) on the same model: forms of manoeuvre, FUP, SL, BOF, Assy
   A, H-hr from `PlanAttack`. Needs a specimen to follow.
7. **One level up.** A Bde sheet that takes its Bns' appreciations as inputs to its own Own Sit.
8. **Synchronisation table.** En reactions against own counter actions on one time axis, as a slide and an annex.

---

## 11. Phases

| Phase | Content | Works from |
| --- | --- | --- |
| 0 | Mockup agreed; decisions below taken | — |
| 1 | Model, collectors and writer for Gr and Weather (5 to 11); the sheet; text; gaps 1 to 5 of section 9; tests | one symbol |
| 2 | Document: PDF by print, then Word; trace figure; fair and draft copies; basis annex | one symbol |
| 3 | Slides: Briefing additions, the three decks, refresh | one symbol |
| 4 | En Sit and Own Sit: symbols, ORBAT, relative strength, tps to tasks | en symbols |
| 5 | Time and Space, Courses, Plan from the Intelligent Deployment tab | a plan |
| 6 | Extensions chosen from section 10 | — |

Phases 1 to 3 give a usable product on their own: the ground part of the appreciation, formatted, with slides.

### Decisions wanted (asked 22 Nov 2026; answered the same day, see section 12)

1. "Whites": is my reading right (section 2)?
2. Ownership rule and proposals (section 4, rules 1 to 3): agreed? Should the fair copy leave out an unaccepted
   proposal, or print a ruled line?
3. Word first or PDF first; and may the `docx` library be bundled if JSZip is not reachable?
4. Figure by default: vector trace, live map shot, or both.
5. Marking, copy number and address block: any fixed house wording.
6. Default deck: full brief, decision brief or sand model.
7. A specimen for the attack appreciation.

---

## 12. Decisions taken and what was built (user, 22 Nov 2026)

| Decision | Answer | In the build |
| --- | --- | --- |
| "Ref to whites" | Omit it | Never printed; those paragraphs are drafted from the data or ruled |
| Whose document | As proposed | `mine` wins; stale-marked, never replaced |
| Deductions | As proposed | Proposals (`judge`); the fair copy prints one only once accepted |
| Blanks in the fair copy | Print a ruled line | `shown()` returns null → a ruled line in page, Word and text |
| Figures | Both | `groundAppreciation.figures: both` (trace under Apchs, the map shot as an annex) |
| Word or PDF first | Word, if no new dependency | Word built: JSZip comes with the PowerPoint bundle (`window.JSZip`), nothing added. PDF by print also built |
| Marking, copy no, address block | Only titles and ruled lines | The address block prints titles and ruled lines. The marking is a ruled line at head and foot of every page (user, same day): no marking text is held or typed |
| Default deck | Let users choose | A deck picker in the sheet and `groundAppreciation.deck` |
| Attack specimen | Not yet; make room | `AprcKind` has `attk`; `registerOutline()` adds its outline; the kind picker shows it as "no outline yet" |

Name: the module is `GroundAppreciation` (user). The plan's `MS/Engines/Appreciation/` and `AprcCollect.ts` /
`AprcFigures.ts` / `AprcSheet.ts` became one engine file, `GroundAppreciation.ts`.

Built: phases 1 to 3 (model, Gr and Weather writer, the sheet, text, PDF, Word, slides), and the cheap parts of 4 and 5
(en and own from symbols, the relative strength table counted by echelon, own disposns / course / advs and disadvs /
reactions from the last Check my plan).

Differences from the plan:

- Briefing got no new method. The engine merges its slides into `getSlides()` and hands the whole list to
  `importBriefing` (keeping the deck's chrome); `Slide` gained optional `sourceRef` and `sourceHash`. "Edited" is told
  by comparing a slide's content with its hash, so the slide editor needed no change.
- Every slide is screen-only. Live-map slides (gen description, ITGs) are not made yet.
- The Ground Guide gained `aorAround()` (the AOR reading on demand) and `bundleManifest`; the rail's `_aorRender` was
  split into `_aorPrepare` + render, behaviour unchanged.
- The document is kept in the browser and as its own file, not yet inside the plan file.

Added later the same day (user: "continue"): en options with timings from the IPB reading (`ipbApproachesAround` got
`extras`), the reactions table from its TAIs and DPs, the Annex A weather in Met Conditions, a DP 1 tasks table and what
it needs, typed table cells in the sheet. 118 checks.

Finished the same day (user: "commit and finish Still not built"): relative strength and own composition from the
ORBAT with the Pls held against DP 1; Time Req (move in, posn preparation, the protective minefield by the engineers);
his phases at each line of def with clock times from H; Coy grouping and tasks from Check my plan; the appreciation
saved inside the plan file (`SerializationEngine.registerPlanExtra`, `pamsExtras.aprc`). 141 checks.

Still open from section 9 (see section 13 for what was built since): the Obsn head was read at one point per approach; lines of def stay
W to Z; force ratio numbers; "from incl … to incl …". Built: first / last light, the IPB weather values, and the event
matrix as the reactions table.

## 13. Review fixes and additions (23 Nov 2026, user: "lets do it all")

Built:

- **A reading is never lost.** Drafts carry their reading (`src`); a Read that cannot read the ground, the IPB, the ORBAT
  or the timings keeps what the sheet held from them, with its frame, data, figures and Confirm items, and says so
  (`keepUnread`). A Read writes nothing until it is done; Cancel stops it; the header shows the step and seconds.
- **H** re-times only what carries a time (`retime`); a reactions table a plan check settled stays; his words over a
  re-timed paragraph are marked "H changed since you wrote this". A sheet from an earlier session asks before reading.
- **Kind** follows an opened file or plan, and the kept sheet on start; a kind set in the settings goes through the same
  ask-and-clear as the sheet's select (asked in the sheet, not `window.confirm`).
- **Typed cells by row** (`rowKeys`): a re-read that moves rows leaves his figures on their rows; a row gone keeps them as
  an added row and asks to be looked at again. Old "row,col" cells re-keyed on open.
- Unique ids for posns and ITGs of one name; `normalizeDoc` for files; guards on a partial IPB decision; print marking
  from a repeating table head / foot (no margin boxes needed), the print title the file name, the print frame gone on
  `afterprint`; destroy clears timers, listeners and the style.
- Undo (Clear, give back, open, kind change), words given back kept to put back; what each Read changed (Changed filter,
  "Before this Read"); message history; Last Read summary and Confirm on Gr kept in view; keys Shift+A, F, X, C, M,
  Ctrl+Z, Enter / Tab in cells, Tab kept in the sheet; the minimized bar at the right with a state dot and Read; Save to a
  file without pictures by default; stale marks say what changed; accepted proposals counted as accepted; the 3 : 1 advice
  a proposal of its own (`own.ded.addl`).
- First / last light and the read time in the place's zone (`groundAppreciation.utcOffsetH`, default 5, PKT).
- New drafts: the Threat marker as the en's direction and in the frame; DP 1 Killing Areas / DF / Surv / Obs from the IPB
  fire reading; his LZs / DZs from the IPB air reading; Most Probable from the main avenue; DP 2 stepped back to the depth
  line; Time Data from H and the Time Req; the attack's Time Calc from H (and the plan's H-hour sum when the check has it);
  Comd and Sig from HQ symbols; Adm and Log from the Admin Area finder; lines of def as many as the reading gives; Obsn
  sampled at three points along each apch. 244 checks.

Still open: `GroundGuideAor` picks at most three lines plus Z; `ipbApproachesAround` extras carry no fire / air for a host
(the sheet uses the live Extended View reading when it is at the place); Check my plan's report has no H-hour sum;
SymbolEngine does not pass `adminArea` to Aprc; force ratio numbers; the move in by road.
