# OCOKA Terrain Analysis

OCOKA is a military terrain-analysis framework for understanding how physical space affects friendly and enemy operations.

## Factors

- Obstacles: Anything that slows, channels, or stops movement, including walls, fences, barricades, steep terrain, and restricted passages.
- Cover and Concealment: Cover protects from fire; concealment protects from observation.
- Observation and Fields of Fire: The ability to see, monitor, and engage an area while minimizing exposure.
- Key Terrain: Ground or areas that provide a significant tactical advantage to the force that controls them.
- Avenues of Approach: Routes attackers can use to reach an objective, or defenders can use for movement and withdrawal.

## PAMS8 Widget

The OCOKA widget opens from the right-click `More Actions...` palette as `⬡ OCOKA — Avenues of Approach`.

The widget includes two companion panels:

- `OCOKA Config`: Sets the analysis centre, radius, corridor extraction settings, force trafficability, scoring weights, and display layers.
- `⬡ OCOKA — Avenues of Approach`: Shows ranked approach cards with composite scores and OCOKA factor bars.

## Outputs

- Analysis area ring.
- Slope heatmap overlay.
- Corridor centrelines.
- Width polygons.
- Chokepoint markers.
- Ranked Avenues of Approach panel.

## Notes

The widget preserves the colour style from `Features/OCoKA/ocoka.html`. It uses the active ArcGIS view and dedicated OCOKA graphics layers so it can be cleared or destroyed without affecting military symbols.

