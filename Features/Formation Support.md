The template data model
Each formation is a named list of unit slots. Every slot is a 2D offset from the anchor in "formation space" — lateral (left/right) and longitudinal (forward/rear). The anchor is always slot [0]. Offsets are in grid units, not pixels or meters. The spacing setting multiplies those grid units into real-world meters at commit time. Store the template as a plain object: name, description, the slots array, and optionally which slot index is the anchor (defaults to 0).
You want this to be declarative so you can add custom templates later without touching placement code. The template registry is just a Map<string, FormationTemplate> that you can push user-defined entries into.

Three-phase placement flow
Placement happens in three explicit phases, each with its own cursor state.
Phase 1 — anchor point selection. The user clicks once on the map to set where the anchor unit goes. The ProximityEngine should be active here so the anchor snaps to existing geometry — a road junction, a phase line vertex, an existing unit's position. Only the anchor participates in snapping. The other slots do not.
Phase 2 — bearing picker. After the anchor is committed, the cursor controls bearing only. A live preview of all units renders at their computed positions as the cursor moves. The bearing is computed as the azimuth from the anchor point to the current cursor position — not a raw angle, but a proper geodesic bearing using the map's spatial reference. The units rotate and reposition in real time. The preview should render as semi-transparent ghost graphics, not real committed graphics. The user clicks a second time to commit the bearing.
Phase 3 — optional spacing confirmation. If you want to allow spacing adjustment before committing, show a small HUD overlay near the anchor with a slider or +/- buttons. Otherwise skip this and commit with the default spacing. Most planners prefer the default and adjust afterwards if needed.

The bearing rotation math
In formation space, x is lateral (positive = right of direction of travel) and y is longitudinal (positive = forward). To convert a slot offset (lat, fwd) to a screen or map offset given bearing b in radians:
mapEast  = lat × cos(b) + fwd × sin(b)
mapNorth = -lat × sin(b) + fwd × cos(b)
This is a standard 2D rotation. The result is a north/east offset in meters (once multiplied by spacing), which you then convert to map coordinates using the view's spatial reference. On a projected coordinate system (Web Mercator) this is just addition. On a geographic coordinate system you need to offset using geodesicUtils.pointFromDistance.
The anchor point never moves during phase 2. Only the computed positions of the non-anchor slots change as bearing changes.

How units get grouped
When all slots are committed, create a FormationGroup object that holds the IDs of all placed graphics and the template name and bearing at time of placement. Store this group in a separate registry (not on the graphics themselves — ArcGIS graphics don't support arbitrary parent/child relationships natively).
Each graphic gets a single attribute like formationGroupId set to the group's UUID. This lets you query "all units in this formation" by filtering the layer's graphics on that attribute.
The group enables four downstream behaviours: selecting all units by clicking any one of them, moving the formation as a unit (translate all by the same delta), rotating the formation around the anchor (recompute all positions from new bearing), and dissolving the group without deleting the individual units (just clear the formationGroupId attribute).

Spacing in real-world units
The spacing value is stored in meters. At commit time, convert it to map units using the view's spatial reference's metersPerUnit factor. Do not store spacing in pixels — that makes the formation zoom-dependent, which is wrong. A 400m formation should look 400m wide at any zoom level.
The four preset spacing levels (100m, 200m, 400m, 600m) correspond roughly to platoon, company, battalion, and brigade separation standards. Expose these as named presets in the UI rather than a raw number input — most planners think in echelon terms, not meters.

Integrating with ProximityEngine
During phase 1, activate the ProximityEngine normally. Add all committed formation graphics to its exclusion list immediately after they are placed, so subsequent formations don't snap to the ghost graphics of the one just committed.
During phase 2 (bearing picker), deactivate ProximityEngine entirely. Bearing-picking is a directional gesture — snapping to nearby geometry during this phase would fight the cursor and make bearing control erratic.
After final commit, call refreshCandidates() on the engine (the method from the earlier analysis) so the newly placed units are immediately available as snap targets for the next operation.

Custom template support
Let planners save their own formations. When a user selects an existing formation group and chooses "save as template", capture the current slot offsets by reverse-engineering the positions back into formation space: subtract the anchor map coordinate, rotate by the negative of the recorded bearing, and divide by the recorded spacing. That gives you the original (lat, fwd) grid offsets which you store as a new template. This round-trips perfectly because the forward math is just the inverse of the backward math.
Custom templates live in localStorage (or on a planning server for shared plans) and are loaded into the template registry at startup alongside the built-in six.