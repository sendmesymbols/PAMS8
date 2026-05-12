Dead ground mapper
ElevationSampler + inverse viewshed
Inverse of LOS — paints every square metre the observer CANNOT see or engage. Run from a single enemy position to find your hidden approach. Run from your own position to find your blind spots.
Decision supported: Which route keeps you unseen the longest. Where to place an ambush that the enemy cannot see forming.



The core algorithm — why it works
The viewshed dome computes what you can see. This is the inversion. For every ground cell in the analysis area, the algorithm asks: how far below the observer's line of sight does this terrain sit? That vertical gap in metres is the dead ground depth.
The mechanism is a horizon sweep per azimuth. Walking outward along each bearing from the observer, you track the running maximum slope angle — the highest angle to terrain seen so far. That running maximum is the "skyline" for that ray. Any ground cell whose slope angle falls below that skyline is invisible — and the difference between the LOS elevation at that range and the actual terrain elevation is the depth number. Shallow dead ground (2–5 m below LOS) gives concealment from view but not cover from fire. Deep dead ground (20 m+) gives both.
Why MediaLayer for the 2D heatmap instead of individual polygon graphics
At 35 m cell size over a 3 km radius you have roughly 29,000 cells. Rendering 29,000 polygon graphics in a GraphicsLayer would take seconds and make the renderer crawl. Instead, the entire grid is painted onto a single offscreen <canvas> element pixel by pixel — one pixel per cell — and wrapped as a georeferenced ImageElement inside a MediaLayer. The layer places that image over the exact analysis extent. The result looks identical to a server-rendered raster but is computed and rendered entirely in the browser in under 200 ms. Changing opacity on the layer updates instantly with no recomputation.
Why depth contours matter more than the heatmap alone
The heatmap tells you where dead ground is. The contours tell you how much — and they give you a briefable product. A commander looking at the map needs to say "there is a re-entrant at grid 4512 with 30+ metres of dead ground, sufficient to conceal a platoon in vehicles." The contour lines are the tool that supports that statement. They are extracted using a stripped-down marching squares edge detection — for each grid cell quad, check whether adjacent cells cross each depth threshold, interpolate the crossing point, and connect the segments.
The 3D mesh and colorMixMode: 'replace'
The 3D mesh sits 0.5 m above the terrain surface (absolute height elevation info) and is coloured per vertex by depth using the same palette as the 2D heatmap. colorMixMode: 'replace' bypasses the SceneView lighting engine so the depth colour is rendered exactly as specified — no shadow darkening or sun brightening that would make dark-coloured shallow cells invisible. This is the same decision as the viewshed dome. Tilt the camera and the dead ground paint wraps over the actual hills — you can read exactly which side of every ridge is blind.
The horizon cache — the performance key
Without caching, every one of the 29,000 cells would cast a full ray outward (e.g. 60 steps at 50 m = 1,740,000 elevation queries total). With the cache, all cells on the same bearing share a pre-computed horizon angle. At 1° resolution there are 360 unique bearings, each walked once: 360 × 60 = 21,600 queries — two orders of magnitude fewer. The cache hit rate for a dense grid is ~99%. This is what makes 35 m resolution practical in the browser without a server.
What the depth number means operationally

0–5 m — marginal concealment. Prone infantry may hide but standing figures are skylined. No cover from direct fire.
5–15 m — useful concealment. Vehicles can move without being observed. Light cover from flat-trajectory fire.
15–40 m — substantial dead ground. Assembly areas, FUPs, reserve positions. Protected from most direct fire from the observer.
40 m+ — deep dead ground. The re-entrants and valley floors where you can concentrate force without any LOS from that observer. The most dangerous ground for a defender.

The yellow cells on the heatmap are operationally significant — those are the locations an enemy will exploit because they cannot be engaged from your position. The first thing a defender should do after running this analysis is check whether those yellow zones are covered by another position elsewhere in the defensive layout.
