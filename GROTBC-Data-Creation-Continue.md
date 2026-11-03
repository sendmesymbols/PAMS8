Verified soil values in the live bundle at cities
Everything you asked for is now in the live bundle, and the soil gap is fixed. All the layers have passed validation except the soil re-cut, which I checked only at a few places.

Soil fix: I checked the live soil tiles at five places. Lahore reads Clay loam, Sukkur Sandy loam, Rawalpindi Silt loam, Karachi Loam and Skardu Loam. The Arabian Sea point has no tile, as it should. Only the soil layer was re-cut, so I did not re-run the full validation.

What is in the bundle

Roads, rail and MSR (R): MSR is tightened to class 50 and above. There is a new routes.json with from–to, length, load range and closures for 7,061 roads (1,572 MSR) and 706 railways. Road features also carry recorded closures, condition and landslide sites.
GROTBC letters: remapped to your meaning (G Ground, R Roads/tracks/rail, O Obstacles, T Terrain, B Built-up, C Cover).
Terrain type (T): Plain, Hilly, Solid, Marshy, Wet and Desert, plus Mountainous, Built-up and Snow/ice.
Soil (G): texture class from SoilGrids with a dry and wet going table. It is a modelled surface, and the fill under cities carries nearby soil up to about 6 km.
Climate (T): monthly temperature, rainfall and wind normals on a 9 km grid.
Built-up (B): a hut-density layer as a proxy for mud houses.
Cover and concealment (C): cover and concealment split four ways in rules.json.
Named detail: mosques, graves, telecom, post offices, lakes, glaciers and river reaches, and a population estimate on places.
Still to do or decide

No schools or government buildings: the Survey of Pakistan data has none, and its 77 markets are unnamed.
Bund and river-bank changes: the two small changes I suggested (bund concealment, a river-bank strip) are not made yet. Say yes and I’ll do them.
Routing: GROTBC-Roads.md holds the routing requirement and the decisions it needs from you.
The card: the Placement Advisor does not read the new layers yet.
Not opened in the app: I have not opened the bundle in the app.
Nothing is committed: several tracked files changed and the scripts terrain.py, climate.py and fetch_soil.py are new. Say if you want me to commit.
Delete out/ copies: these are still yours to delete. From tools/terrain-pipeline:
Licences to confirm: WorldClim’s terms and SoilGrids’ CC BY 4.0 licence, as noted earlier.