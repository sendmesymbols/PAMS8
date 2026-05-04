MeasurementEngine Visual Upgrades

Label Readability
- Callout boxes / halos behind text labels so they read against any background
- Dynamic label positioning — detect overlap between segment label, area label, total label and offset them
- Scale-adaptive font size (label shrinks/grows with zoom level)
- Leader lines from midpoint labels to their segment when angle makes placement ambiguous

Animated Feedback
- Fade-in on label creation, fade-out on removal instead of instant pop/disappear
- Segment label updates with a brief color flash (white → configured color) so the user sees new data arrived
- "Complete" pulse animation on the final total label when drawing ends

Data Quality
- MGRS coordinate display alongside bearing for military context
- Cumulative progress: if total is 10 km and segment is 2.4 km, show a mini progress bar ████░░░░ 24%
- Auto-format large/small values: switch from 0.0 mi → 52 ft rather than showing 0.0 mi

  ---
ProximityEngine Visual Upgrades

Snap Indicator
- Pulsing ring at the snap target (CSS-keyframe-style animated radius) to clearly distinguish it from static graphics
- Approach color gradient: line transitions red → yellow → green as cursor gets closer to snap threshold
- Show direction arrow on the dashed line, not just the line itself
- "Lock" icon or symbol glyph at the snap point when within snap radius, so user knows a click will land exactly there

Multi-target Awareness
- Show the 2–3 nearest candidates simultaneously with faded secondary lines, so user can choose intentionally
- Sector arc showing the angular spread of nearby symbols (situational awareness)

  ---
New Feature Suggestions (Prioritized)

High Impact / Low Effort

1. Cursor MGRS/UTM coordinate HUD — floating label at cursor position, always visible during draw mode. Military users
   think in MGRS, not lat/lon.
2. Angle lock (Shift key) — constrain drawing to 0°/45°/90° increments. Hugely helpful for phase lines and
   grid-aligned boundaries.
3. Range rings on selection — when a symbol is selected, toggle concentric circles at configurable intervals (e.g.
   weapon range, comms range). Already have geometry engine, just buffer rendering.
4. Rubber-band line with live bearing — show a dashed preview line from the last placed point to the cursor with a
   bearing label, before the user clicks. The measurement engine shows labels on committed segments; this shows the next
   segment in real time.

Medium Impact

5. Draw-mode coordinate entry — let user type an MGRS or lat/lon value to place a point precisely, instead of only
   clicking.
6. Symbol density/overlap warning — if two symbols of the same type are placed within X meters of each other, show a
   subtle amber border or badge.
7. Mini progress dashboard — small persistent HUD tile showing: symbols drawn this session, total area covered,
   longest line.
8. Phase-aware color theming — let users assign a "phase" (Phase I, II, III…) to a drawing session; all symbols drawn
   in that phase get a configurable tint on their selection ring.

Lower Priority / Larger Scope

9. MGRS grid overlay layer — toggleable grid that snaps to standard grid zone designators.
10. Template quick-draw — right-click → "Draw from template" to replay a saved symbol at a new location/scale.
11. Draw history trail — breadcrumb dots showing where the cursor has been, useful for retracing complex routes.

  ---
Which ones are worth doing first?

The three highest-ROI changes given your existing architecture:

1. Callout halos on MeasurementEngine labels — one haloColor/haloSize property on TextSymbol, two-line change,
   dramatic readability gain.
2. Rubber-band preview line — one additional Graphic in the draw-progress handler, gives users the next segment
   measurement before they commit.
3. Pulsing snap ring in ProximityEngine — replace the static dot SimpleMarkerSymbol with two alternating-radius
   graphics (or a brief animated sequence), makes snap points unmistakable.