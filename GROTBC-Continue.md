what is in the data related to roads and tracks, Main Supply Routes? what type of roads and tracks are available in the data D:\Projects\Web\PAMS8\MS\Data\terrain-bundle
is this what is included in data bundle?

GROTBC:
G: Ground
R: Roads and Tracks, Railway Network
O: Obstacles (Natural, Manmade, temporary, seasonal)
T: Trafficability
B: Built Up Area
C: Camouflage and Concealment

(Updated 2026-11-04: T is Trafficability, the going for each mode (on foot, wheeled, tracked, air, others) and each
movement type (cross-country, tracks, roads, MSR). Terrain type and vegetation moved under G. See GROTBC.md section 4.)



G: Ground
->Relief of the ground
->Terrian firm or muddy, does it allowing X-country movememnt of troops/ equipment/ vehicles
R: Roads and Tracks, Railway Network
classification of roads and their trafficability and load bearing, name of roads if possbile, from - to, including classification and distance
O: Obstacles (Natural, Manmade, temporary, seasonal)

T: Trafficability
-->Going for each mode: on foot, wheeled, tracked, air, others
-->Going by movement type: cross-country, tracks, roads, Main Supply Routes
-->Area types: desert, sandy, marshy, boggy, open, grasslands, fields, hilly; dry and after rain
B: Built Up Area
Villages, Muddy Houses, Cities, (names if possible)
C: Cover/ Camouflage and Concealment
-->Cover from direct fire in the form of
-->Cover from indirect fire is aval in the form of
-->Cover from gr observation is available in the form of
-->Cover from aerial observation is available in the form of


What did you understand by GROTBC?
Were data made keeping this mind? Do we need to create data again?

Source Data: D:\Projects\Web\PAMS8\tools\terrain-pipeline
Destination Data: D:\Projects\Web\PAMS8\MS\Data\terrain-bundle

@"D:\Projects\Web\PAMS8\GROTBC.md" -- Here is the detailed version of GROTBC

I’ll look at what’s in the bundle and the pipeline that built it.

Finished a background task, ran 5 commands, read 6 files, searched code (2 failed)
I’ve confirmed the road, track and rail data in the feature tiles. Next I’m checking the raster route layer and the settlement and cover coverage, so I can map all six GROTBC letters.

Ran a command, searched code
The route raster uses 255 as no-data, which I counted as a route type (it shows as “31” with tier 3 and MSR set). I’ll redo the histogram without it.

Recalled a memory, saved 2 memories, ran a command, searched code
Roads, tracks and MSR: what the bundle holds
You do not need to recreate the data from scratch. The bundle (rulesVersion 2026.11-grotbc-v2) already has roads, tracks, rail, MSR flags, crossings, obstacles, settlements and cover. It cannot yet answer everything in your GROTBC.md. The gaps are mostly new data, and the exceptions are the letter tags and the MSR rule below.

Roads, tracks, rail and MSR
Counts come from the features/ tiles, so a road crossing several tiles counts once per tile. Percentages come from a 300-tile random sample of the route raster.

Item	In the bundle
Road types	Motorway, highway, main road, metalled, local metalled, street, shingled, unmetalled, road tunnel (types 14–22 in the route codebook).
Tracks	Cart track, pack track, footpath, track along a riverbed, glacier track, ford, ropeway. Together these are about 59% of route pixels.
Railway	Broad gauge single or double, other gauge, tramway, tunnel and under-construction lines. Also 1,093 stations (689 named) and 4 tunnels.
Names and numbers	Named road fragments: 76,198 of 118,283. They cover 7,742 distinct names and 39 road numbers (N-5, N-35, N-40, M-1, M-2, M-9 and others).
Load class	Read from codes like 40A1 and 70A2, then grouped into tiers: not recorded (83% of route pixels), below 50 (11.5%), 50–59 (1%) and 60+ tankable (4%). Road width is on about 34.6k fragments.
MSR flag	A rule, not an official list: motorway, highway or main road, any defence road, any metalled road of class 40 or more, and broad-gauge rail (rules.yaml).
Bridges and crossings	129k bridges, 71k culverts, 792 ferries, 233 fords, 2.7k foot bridges, plus level crossings. Bridge load class is derived from the road that crosses it.
Other transport	186 airports, 117 airfields, 53 air bases, 266 helipads, 104 landing strips, 191 runways.
GROTBC coverage
Letter	Covered	Missing or weak
G	Elevation, slope bands, landform, flood-prone and waterlogged ground, 14 mobility profiles (wheeled, tracked and so on)	Soil type and bearing strength, snow or monsoon by season
R	See the table above	Road from–to (only names like “Quetta - Taftan”), road condition, seasonal trafficability, bus terminals, rail yards
O	Water, canals, drains, embankments, bunds, cuttings, cliffs, walls, power lines, dams	Temporary obstacles (landslides, closures) and seasonal ones beyond flood zones
T (Trafficability)	14 mobility profiles (going per mode), land cover, slope bands, flood-prone and waterlogged ground, road load class and MSR flag	Soil bearing dry and after rain, going by season, cross-country speed
B	Names for about 218k villages, towns and cities, 225 district HQs, province, district and tehsil boundaries, hospitals, clinics, police stations	Population on only about 2.7k of them, building type (mud or brick), schools, markets, government buildings
C	One 0–3 cover scale and one 0–3 concealment scale	Your four-way split: direct fire, indirect fire, ground observation, aerial observation
Things to know
Letter mismatch. The pipeline expands the letters differently from your GROTBC.md: its R is Relief and its T is Tactical features. Roads and rail are tagged T there, and spot heights are tagged R. Only a type comment in GroundGuideTypes.ts uses the letters, so relabelling is metadata-only.
MSR is generous. 40A1 is the most common load class (about 39.7k fragments), so most metalled roads count as MSR. That is 63% of road fragments in the feature tiles and about 16% of route pixels. If you have an official MSR list, it should replace the rule.
Roads outside Pakistan are included. MSR names such as “Amritsar - Bhatinda” and “Srinagar - Kargil” show up, because the data extent is the map-sheet rectangle (59.5–80.5°E, 20.5–37.5°N).
Licence. The manifest marks the bundle as restricted, because it is built from NCGDB.
Do we need to create data again?
No rebuild: relabel the letters, and change the MSR rule (make rebuild-rules reruns the later steps).
New data needed: soil and bearing strength, road from–to and condition, seasonal and temporary obstacles, building construction type, a four-way cover split, and weather. Each needs a new source, or a rule built on data we already hold, such as deriving cover against aerial observation from tree canopy.
I did not check whether make rebuild-rules still runs, and I did not open the bundle in the app.

The bundle already holds a lot of roads, rail and MSR data, built from the Survey of Pakistan geodatabase (NCGDB). The gaps against your GROTBC are mostly new data (soil, road from-to, seasons), not a rebuild. Nothing was changed in the repo; I only read files and ran counts.

Relabel the pipeline's GROTBC letters to your meaning and tighten the MSR rule?