GROTBC – Military Terrain Analysis Framework
1. G – GROUND (Ground Conditions and Relief)
   Assessment of the physical characteristics, surface conditions and general nature of the ground.

- Relief and Elevation

General nature of the ground: flat, undulating, rolling, broken or mountainous.

Elevation and height variations.

General slope characteristics.

Valleys, ridgelines, depressions and escarpments.

General drainage patterns.

- Ground Composition

Soil type: sandy, clayey, rocky, loamy or alluvial.

Surface condition: firm, soft, loose, compact or unstable.

Ground bearing characteristics.

Presence of marshy, waterlogged or muddy ground.

Seasonal variations affecting ground conditions.

- Terrain Type (moved here from T on 2026-11-04)

Plain terrain.

Desert terrain: rocky, gravel or sandy.

Hilly terrain.

Mountainous terrain.

Solid terrain: rock, scree and stony riverbeds.

Forested terrain.

Riverine terrain.

Marshland, bog and wetland terrain.

Urban and semi-urban terrain.

Snow and ice.

- Vegetation

Type and density of vegetation.

Forests, orchards, plantations and scrubland.

Grasslands and agricultural fields.

Seasonal vegetation changes.

(How well each mode can move over this ground is assessed under T – Trafficability.)

- Hydrological Features

Rivers, streams, canals and natural watercourses.

Lakes, ponds and reservoirs.

Floodplains and drainage channels.

Seasonal water accumulation.

- Important Tactical Ground (ITG) and Most Important Tactical Ground (MITG) (added 2026-11-04)

ITG and MITG are part of G, not a separate heading. Ground is not important because it is high, built on or near a
road; it is important because of what it gives over the ground and routes around it. The data keeps these apart:

| Concept | What it is | Where it is held |
| --- | --- | --- |
| Terrain feature | What is on the ground: peak, hill, knoll, ridge, saddle / pass, plateau, depression, road junction, bridge, ford | Terrain bundle, `features/` (kinds 160-166, ridgelines 204, and the existing crossings and passes) |
| Characteristics | What describes it: elevation, relative relief, dominance radius, view over 5 km, MSR in view, slope, land cover, cover, nearest MSR and road, surveyed height | Attributes on each feature |
| ITG candidate | A feature that passes an objective test (below) | `ig` (reason letters) and `it` (1 candidate, 2 strong candidate) |
| ITG / MITG | The commander's designation for a task, axis and enemy | The app, saved with the plan; never in the terrain bundle |

ITG candidate tests (`rules.yaml itg.reasons`, a starting proposal):

| Letter | Test |
| --- | --- |
| H | Highest ground within 3 km |
| O | Sees 30 % or more of the ground within 5 km |
| R | A main supply route in view within 4 km |
| P | A saddle or pass crossed by a road or track (not a footpath) |
| C | A chokepoint on a main supply route: a bridge over a river, canal or stream; a ford, ferry, tunnel, pass, barrage or dam |
| J | A junction of main roads on a main supply route |

A strong candidate (check it as MITG for the task) passes three tests, or H with R (dominates an MSR), or P with C
(a pass on an MSR), or is a junction where motorways or national highways leave three or more ways.

On the map, the user designates ITG with an **Imp Gr** area (marked "IG"; a PAMS8 symbol, because MIL-STD-2525D has
none) and MITG with a **Vital Gr** area (marked "VG", 2525D). Both are drawn from the symbol catalog or from a
candidate (`symbolEngine.designateGround(candidate, 'ITG' | 'MITG')`), and both are saved with the plan.

The inventory is also written for GIS as `work/ground/ground_inventory.gpkg` with the fields Feature_ID,
Feature_Name, Feature_Type, Feature_Subtype, Elevation, Surveyed_Height, Relative_Relief, Depth, Area_Km2, Length_Km,
Slope_Deg, Dominance_Km, View_Pct, MSR_In_View_Km, Nearest_MSR_Km, Nearest_Road_Km, Land_Cover_Code, Cover_Code,
ITG_Status, ITG_Reasons, Data_Source, Observation_Date, Verification and Remarks.

No new data source was needed: the DEM, the NCGDB, GeoNames and the OSM road graph already in the bundle cover it.
The DEM is a surface model on a ~100 m grid, so every DEM feature is "Unverified (modelled)" until checked on a map
or on the ground.

2. R – ROADS, TRACKS AND RAILWAY NETWORK
   Assessment of transportation infrastructure and its general condition.

- Road Network

Classification of roads: motorways, highways, primary roads, secondary roads and rural roads.

Road names and identification numbers, where available.

Road surface: metalled, asphalt, concrete, gravel, dirt or unpaved.

General road condition and maintenance.

Width, gradient and surface condition.

Bridges, culverts and underpasses.

Seasonal trafficability and weather-related deterioration.

- Road Connectivity

General connectivity between settlements and major population centres.

Availability of alternative transport infrastructure.

Road network density.

General condition of connecting routes.

- Railway Network

Railway lines and their general classification.

Railway stations, terminals and yards.

Railway bridges and tunnels.

Passenger and freight infrastructure.

General condition and continuity of the railway network.

- Transport Infrastructure

Airports and airstrips.

Bus terminals and transport hubs.

Inland waterways and associated facilities.

Major logistical and commercial infrastructure.

3. O – OBSTACLES (Natural, Manmade, Temporary and Seasonal)
   Assessment of physical features that may restrict or prevent movement.

- Natural Obstacles

Rivers and water bodies.

Steep slopes and escarpments.

Mountains and rocky outcrops.

Marshes and swamps.

Dense vegetation and forests.

Ravines, gullies and deep depressions.

- Manmade Obstacles

Walls, fences and boundary structures.

Embankments and retaining walls.

Buildings and industrial structures.

Canals and artificial waterways.

Railway infrastructure.

Dams and other major engineering structures.

- Temporary Obstacles

Flooded areas.

Landslides and rockfalls.

Collapsed infrastructure.

Road closures and construction works.

Temporary barriers.

- Seasonal Obstacles

Snow accumulation.

Seasonal flooding.

Muddy and waterlogged areas.

Seasonal river-level variations.

Vegetation growth and seasonal changes.

4. T – TRAFFICABILITY (Going by Movement Type and Mode)
   Assessment of whether the ground and the route network will carry each type of movement, how fast,
   and at what time of year. Each answer is for one mode (foot, wheeled, tracked, air or other) and one
   movement type (cross-country, tracks, roads, MSR), rated GO / SLOW-GO / NO-GO.

(Changed 2026-11-04: T was "Terrain". Terrain type and vegetation now sit under G – Ground, and T
uses them, with slope, soil, wetness and season, to give the going.)

- Ratings

| Rating | Meaning | On the card |
| --- | --- | --- |
| GO | The mode moves freely; little or no delay. | Suitable |
| SLOW-GO | The mode can move, but slowly, with care, or only on part of the ground. | SLOW-GO (Marginal near NO-GO) |
| NO-GO | The mode cannot move without engineer work, a crossing or a change of mode. | NO-GO |

- Movement Types

| Movement type | What is assessed | Main data |
| --- | --- | --- |
| Cross-country | Going off roads and tracks: area type, slope, soil bearing dry and after rain, wetness, vegetation density, gaps (canals, nullahs, bunds, embankments) | Land cover class, slope, soil texture, wet layer, vegetation, obstacles |
| Tracks | Cart track, pack track, footpath, unmetalled road: mostly fair-weather; surface, width, gradient | Route types (track, unmetalled), load code `F` |
| Roads | Metalled roads: load class against the vehicle's class, all- or fair-weather, lanes, width, surface, condition, bridges and culverts on the road, gradient, tunnels | Route layer, load code (e.g. 40A1, 70A2), `routes.json` |
| Main Supply Routes (MSR) | Designated or qualifying routes: capacity (class 50 and over, double lane), chokepoints (bridges, passes, tunnels, ferries), alternatives, closures by season | MSR flag, `routes.json`, closures, landslide sites |
| Rail | Rail-bound movement: gauge, single or double line, stations, level crossings, rail bridges and tunnels | Railway lines and stations |
| Air | In flight a unit is not terrain-bound; trafficability applies where it lands or drops: firm and level ground, approach clear of wires and trees | Helicopter Landing Site rules, airfields, helipads, landing strips |
| Water | Surface vessels and amphibious crossing: navigable water, entry and exit banks, fords and ferries | Water classes, banks, ford / ferry points |

- Mobility Classes (who is moving)

| Class | Modes in the terrain bundle | What limits it most |
| --- | --- | --- |
| On foot | Dismounted Force; Mountain / Pack Transport | Permanent water, main canals, snow and ice; slowed by steep slopes, dunes, marsh, rock |
| Wheeled | Wheeled Vehicle; Road-Bound Wheeled | Soft or wet soil, sand and dunes, marsh, every watercourse, embankments over 2 m, slopes over 15° (SLOW-GO) and over 30° (NO-GO), road and bridge class |
| Tracked | Tracked Vehicle; Over-Snow | Wetland, canals, slopes over 30°, cliffs, bridges below class 60 (Al-Khalid, T-80UD, T-80) or class 50 (Al-Zarrar) |
| Air | Helicopter Landing Site; Not Terrain-Bound | Slope over 7°, loose sand (brown-out), trees, built-up, power lines within 100 m |
| Others | Amphibious, Surface Vessel, Rail-Bound, Gun Position, Air Defence Site, Signals / EW Site, Gr Based | Each has its own rules: water and banks, rail only, or siting needs (level ground, access road, open arcs) |

- Area Types and Their Going (dry season)

Taken from the bundle's mode tables (`tools/terrain-pipeline/rules.yaml`). These are a starting
proposal for the rule owner to correct, not doctrine.

| Area type | Includes | On foot | Wheeled | Tracked | What changes it |
| --- | --- | --- | --- | --- | --- |
| Open ground | Open land, barren ground, shrubland | GO | GO | GO | Silt and clay soils soften after rain |
| Grassland | Natural grassland, pasture | GO | GO | GO | As open ground |
| Fields (dry or rain-fed) | Cropland | GO | GO | GO | Standing crops slow movement; soil after rain |
| Irrigated fields | Canal-irrigated cropland, watercourses every few hundred metres | GO | SLOW-GO | GO | Fields under water at watering time; rice paddy in season goes as marsh |
| Orchards | Orchard; walled orchard | GO; SLOW-GO walled | SLOW-GO; NO-GO walled | GO; SLOW-GO walled | Walls and water channels |
| Desert (rocky or gravel) | Bare desert, stony plains | GO | GO | GO | Flash floods in nullahs |
| Sandy | Sand sheets, loose sand | GO | SLOW-GO | GO | Wheels sink in dry sand; damp sand is firmer |
| Sand dunes | Dunes | SLOW-GO | NO-GO | SLOW-GO | Dune height and orientation |
| Rocky / solid | Rock, scree, stony waste | SLOW-GO | SLOW-GO | SLOW-GO | Boulder size |
| Dry riverbed | Stony or sandy bed of a seasonal river | GO | SLOW-GO | GO | NO-GO when in spate |
| Marshy | Wetland, marsh, mangrove | SLOW-GO | NO-GO | NO-GO | Worst in the monsoon; may firm up in a dry winter |
| Boggy / waterlogged | Waterlogged ground, seepage near canals | SLOW-GO | NO-GO | NO-GO | Mapped as marshy in the bundle (wet layer) |
| Salt pan | Salt flats, kallar | SLOW-GO | SLOW-GO | SLOW-GO | The crust breaks when wet |
| Seasonal water | Flood zone, seasonal lake | SLOW-GO | NO-GO | SLOW-GO | Season and flood level |
| Gentle to sloping ground | 3° to 15° | GO | GO | GO | Wet clay on a slope |
| Hilly | 15° to 30° | GO | SLOW-GO | SLOW-GO | Terraces, gullies |
| Mountainous / steep | Over 30°, cliffs and escarpments | SLOW-GO (cliff NO-GO) | NO-GO | NO-GO | Tracks and passes only |
| Forest | Tree cover; dense forest | GO | SLOW-GO; NO-GO dense | GO; SLOW-GO dense | Tree spacing and trunk size |
| Built-up | Villages, towns, cities | GO | SLOW-GO | SLOW-GO | Street width; movement is channelled |
| Snow and ice | Snowfields, glaciers | NO-GO | NO-GO | NO-GO | GO for Over-Snow; SLOW-GO for Pack Transport |
| Permanent water and main canals | Rivers, lakes, lined canals | NO-GO | NO-GO | NO-GO | Bridge, ford, ferry or boats; swimming for Amphibious |

- Factors that Decide the Going (data elements to hold)

| Factor | Data element | In the bundle | Still missing |
| --- | --- | --- | --- |
| Slope | Slope in degrees and in bands (Level, Gentle, Sloping, Moderate, Steep) | Yes, from Copernicus DEM | Surface model reads tree lines and towns a little steep |
| Area type | Land cover class (51 codes) and terrain type (9 codes) | Yes | Rice paddy as its own class |
| Soil | Texture class; bearing dry and after rain | Yes, SoilGrids, modelled at 250 m | Measured bearing strength (cone index), soil depth |
| Wetness | Flood-prone and waterlogged ground | Yes (wet layer) | Live soil moisture; depth to water table |
| Vegetation | Tree cover, forest, orchard, density | Partly | Trunk size and spacing; crop height by month |
| Surface | Sand, gravel, rock, scree, salt crust | Partly (classes) | Boulder fields; gully density |
| Water gaps | Canal, distributary, drain, stream, nullah | Yes (class and names) | Width, depth, bank height, flow speed, bed material |
| Man-made gaps | Bund, embankment over 2 m, cutting, wall, railway | Yes | Bund and embankment heights |
| Crossings | Bridges by class, culverts, fords, ferries, foot bridges | Yes (bridge class taken from its road) | Ford depth and bottom; ferry capacity |
| Season | Monthly rain, monsoon share, frost and hot months | Yes, WorldClim normals on a 9 km grid | Snow depth and duration; flood calendar |
| Road use | Load class, all- or fair-weather, lanes, width, surface, condition, closures, landslides | Partly (class on 31 % of segments, condition on 4 %) | Gradient, bends, overhead clearance, culvert class |
| Built-up | Density, building size and height | Yes (buildings, huts) | Street width |
| Speed | Cross-country speed by mode and ground | No (planned) | Speed tables by mode |

- Season and Weather Effects on Going

Dry season: most going at its best; dust and brown-out on sand.

After rain: silt and clay soils soften (see the soil bearing table); unmetalled roads and tracks turn to mud.

Monsoon (July to September in the plains): irrigated fields, marsh and flood zones get worse; seasonal water fills.

Winter in the north: snow closes passes and high roads; frost hardens wet ground in the early morning.

Floods and landslides: temporary NO-GO on roads and low ground (recorded under O – Obstacles).

- Roads, Tracks and MSR: what decides if a road carries the mode

Load class at or above the vehicle's class: class 60 and over for every main tank, 50 to 59 for Al-Zarrar only, class 70 for a tank on a transporter (HET).

All-weather (A) or fair-weather (F) surface, and single (1) or double (2) lane, read from the load code.

Width: under 3.5 m is never tankable.

The weakest bridge or culvert on the stretch.

Gradient, hairpin bends, tunnels and overhead clearance.

Seasonal closures, landslide sites and recorded condition.

Chokepoints and alternative routes; for an MSR, a second route between the same places.

- Recommended Trafficability Data Model

Keep the source themes separate and compute the going from them, rather than storing one fixed going map:

```text
TRAFFICABILITY_DATABASE
├── TERRAIN            DEM, slope, slope bands, landform, ruggedness
├── LAND_COVER         area type (open, grassland, fields, irrigated, orchard, desert, sandy, dunes,
│                      rocky, marshy, boggy, salt pan, forest, built-up, snow and ice)
├── SOIL               texture, drainage, bearing dry and after rain
├── HYDROLOGY          rivers, canals, nullahs, lakes, wetland, flood-prone and waterlogged ground
├── VEGETATION         tree cover, density, crop calendar
├── TRANSPORT          roads, tracks, MSR, bridges, culverts, fords, ferries, tunnels, railways
├── AVIATION           airfields, landing strips, helipads, candidate landing sites
├── ENVIRONMENT        monthly rain and temperature, snow, frost
├── RESTRICTIONS       closures, landslides, construction, restricted areas
├── GOING_RULES        going per mode for each area type, slope band and soil, dry and wet
└── METADATA           source, date, resolution, accuracy, confidence, verified or not
```

Area polygons (or raster cells) should carry:

| Field | Type | Example |
| --- | --- | --- |
| Feature_ID | Integer | 1001 |
| Area_Type | Text | Sandy |
| Area_Subtype | Text | Sand sheet |
| Surface | Text | Loose sand |
| Soil_Texture | Text | Loamy sand |
| Drainage | Text | Good / Poor |
| Water_Presence | Text | None / Seasonal / Perennial |
| Vegetation_Density | Text | Sparse / Medium / Dense |
| Slope_Deg | Float | 4.5 |
| Going_Foot / Going_Wheeled / Going_Tracked | Text | GO / SLOW-GO / NO-GO (dry) |
| Going_Wet_Foot / Going_Wet_Wheeled / Going_Wet_Tracked | Text | After rain or in the monsoon |
| Season_Note | Text | NO-GO for wheels Jul to Sep |
| Data_Source | Text | NCGDB / ESA WorldCover / SoilGrids |
| Observation_Date | Date | 2026-11-04 |
| Confidence | Text | Modelled / Recorded / Verified |

Road and MSR lines should carry:

| Field | Type | Example |
| --- | --- | --- |
| Route_ID | Text | N-5 |
| Route_Name | Text | GT Road |
| From / To | Text | Lahore / Kasur |
| Length_km | Float | 53 |
| Road_Type | Text | Highway / Metalled / Unmetalled / Track |
| Load_Class | Integer | 70 |
| Weather | Text | All-weather (A) / Fair-weather (F) |
| Lanes | Integer | 2 |
| Width_m | Float | 7.3 |
| Surface | Text | Asphalt / Concrete / Gravel / Earth |
| Condition / Condition_Date | Text / Date | Good, 2026-05 |
| MSR | Yes / No | Yes |
| Closure_Months | Text | Dec to Jan |
| Chokepoints | Text | Canal bridge (class 40) |
| Data_Source / Verified | Text | NCGDB / Unverified |

- Data Sources

| Source | Gives | URL | In the bundle |
| --- | --- | --- | --- |
| NCGDB Ver-6 (Survey of Pakistan) | Roads, load class, tracks, rail, bridges, canals, land use, settlements | Owner-supplied geodatabase | Yes |
| Copernicus DEM GLO-30 | Elevation, slope | https://registry.opendata.aws/copernicus-dem/ | Yes |
| ESA WorldCover 2021 | Land cover: cropland, grassland, shrubland, bare, wetland, built-up | https://esa-worldcover.org/en/data-access | Yes |
| JRC Global Surface Water | Permanent and seasonal water | https://global-surface-water.appspot.com/download | Yes |
| ISRIC SoilGrids 2.0 | Soil texture (sand, clay) | https://www.isric.org/explore/soilgrids | Yes |
| WorldClim 2.1 | Monthly rain, temperature, wind | https://www.worldclim.org/data/worldclim21.html | Yes |
| OpenStreetMap (Geofabrik) | Roads, tracks, bridges, railways | https://download.geofabrik.de/asia/pakistan.html | Yes |
| Google Open Buildings v3 | Building footprints | https://sites.research.google/open-buildings/ | Yes |
| GHSL (built-up height, degree of urbanisation) | Built-up density | https://human-settlement.emergency.copernicus.eu/download.php | Yes |
| Sentinel-2 (Copernicus Data Space) | Current land cover, crops, flooding, bare soil | https://dataspace.copernicus.eu/ | No |
| HydroSHEDS | Rivers and drainage network | https://www.hydrosheds.org/ | No |
| NASA POWER | Daily rain and temperature | https://power.larc.nasa.gov/ | No |
| USGS EarthExplorer | Landsat imagery, SRTM elevation | https://earthexplorer.usgs.gov/ | No |

5. B – BUILT-UP AREAS (Settlements and Infrastructure)
   Assessment of human settlements and manmade infrastructure.

- Types of Settlements

Villages and hamlets.

Small towns.

Large towns and cities.

Metropolitan areas.

Industrial and commercial zones.

Scattered settlements.

- Identification of Settlements

Names of villages, towns and cities.

General geographical distribution.

Population characteristics at an appropriate aggregate level.

Settlement density.

Rural-to-urban distribution.

- Construction Characteristics

Traditional mud houses.

Brick and concrete structures.

Multi-storey buildings.

Industrial buildings and warehouses.

Temporary and semi-permanent structures.

- Public Infrastructure

Schools and educational institutions.

Hospitals and healthcare facilities.

Government buildings.

Markets and commercial centres.

Water supply and sanitation facilities.

Electricity and communication infrastructure.

- Urban Characteristics

Residential areas.

Commercial areas.

Industrial areas.

Open spaces and parks.

General urban development patterns.

6. C – COVER, CAMOUFLAGE AND CONCEALMENT
   Assessment of the general availability and characteristics of natural and artificial protection.

- Natural Cover

Forests and dense vegetation.

Hills and natural depressions.

Rocky formations.

Natural embankments.

Existing geographical features.

- Artificial Cover

Buildings and permanent structures.

Walls and boundary structures.

Bridges and other civil engineering structures.

Underground and enclosed infrastructure.

- General Concealment Characteristics

Vegetation cover.

Tree density and canopy.

Built-up density.

Natural screening features.

General visibility conditions.

For a formal military terrain appreciation, the following distinctions are important:

Term

Military meaning

Cover

Physical protection against weapons effects.

Concealment

Reduction of visibility or observation.

Camouflage

Measures used to blend with the surrounding environment.

Masking

Intervening features that obstruct observation.

Defilade

Protection afforded by intervening terrain.

Additional Military Considerations
For a more comprehensive Army terrain appreciation, I recommend adding the following supplementary headings.

7. WEATHER AND CLIMATE (W)
   Temperature and seasonal variations.

Rainfall and precipitation.

Fog, mist and visibility.

Wind and prevailing weather patterns.

Snowfall and frost.

Seasonal effects on the physical environment.

8. WATER RESOURCES (H)
   Rivers and streams.

Canals and irrigation networks.

Lakes and reservoirs.

Groundwater availability.

Water supply infrastructure.

Flood-prone areas.

9. INFRASTRUCTURE AND SERVICES (I)
   Electricity distribution network.

Telecommunications infrastructure.

Gas and fuel infrastructure.

Water supply systems.

Healthcare facilities.

Emergency and public services.

10. HUMAN AND CIVIL ENVIRONMENT (H)
    Population distribution.

Settlement patterns.

Economic activities.

Agricultural activities.

Major commercial centres.

Public institutions and community infrastructure.

Recommended Final Army Terrain Appreciation Format
For a professional military staff paper, I would arrange the headings as follows:

Ser

Heading

Coverage

1

G – Ground

Relief, terrain type, soil, vegetation, drainage and ground conditions

2

R – Roads and Railways

Transportation infrastructure

3

O – Obstacles

Natural, manmade, temporary and seasonal

4

T – Trafficability

Going by movement type (cross-country, tracks, roads, MSR, air) and mode (foot, wheeled, tracked, air, others), dry and after rain

5

B – Built-up Areas

Villages, towns, cities and infrastructure

6

C – Cover and Concealment

Natural and artificial protection and visibility

7

W – Weather

Climate and seasonal conditions

8

H – Hydrology

Water resources and drainage

9

I – Infrastructure

Essential services and utilities

10

H – Human Environment

Population and socioeconomic characteristics

One important military distinction: GROTBC is best treated as a terrain description and appreciation framework. In a formal Army appreciation, it should also be related to the standard military terrain-analysis concepts of OAKOC:

Observation and Fields of Fire

Avenues of Approach (built on T – Trafficability)

Key Terrain

Obstacles

Cover and Concealment