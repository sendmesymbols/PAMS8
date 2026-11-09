# Terrain-bundle pipeline for the PAMS8 Ground Guide.
#   make bundle            full run: fetch grid derive grotbc classify profiles tile validate package
#   make rebuild-rules     after editing rules.yaml / classes.yaml: steps 5-8 only
#   make synth-check       validate the synthetic dev bundle (no data needed)
# Every step writes work/<step>/ and leaves work/<step>/.done; delete the stamp
# (or `make clean-<step>`) to force a re-run.

PY       ?= python3
AOI      ?=                          # west,south,east,north (WGS84); empty = taken from the boundary polygon
RES_M    ?= 30                       # target ground resolution; grid warns if ZMAX is coarser
ZMIN     ?= 8
ZMAX     ?= 12
# Finished bundle: lives in the library data folder, where the host serves it from.
OUT_DIR  ?= ../../MS/Data/terrain-bundle
WORKERS  ?= 4
BLOCK    ?= 2048                     # processing block (px); lower it on small RAM
BOUNDARY ?=                          # optional GeoJSON clip polygon (default: OSM admin_level=2)
NCGDB    ?=                          # NCGDB .gdb for the hybrid build; "none" = open data only (default: classes.yaml / $$NCGDB_PATH)
SYNTH    ?= ../../public/terrain-bundle

S  = scripts
W  = work
NCGDB_ARG    = $(if $(strip $(NCGDB)),--ncgdb "$(strip $(NCGDB))",)
AOI_ARG      = $(if $(strip $(AOI)),--aoi "$(strip $(AOI))",)
# Boundary: BOUNDARY=<geojson> wins; otherwise the OFFICIAL boundary (all of Jammu & Kashmir, built from the
# NCGDB by make_boundary.py) when it could be built; otherwise OSM's (stops at the Line of Control).
OFFICIAL     = $(W)/boundary/pakistan_official.geojson
BOUNDARY_ARG = $(if $(strip $(BOUNDARY)),--boundary $(strip $(BOUNDARY)) --boundary-source custom,$(if $(wildcard $(OFFICIAL)),--boundary $(OFFICIAL) --boundary-source official,--boundary-source osm))

.PHONY: bundle fetch boundary grid derive grotbc classify ground profiles tile validate package rebuild-rules \
        synth-check clean clean-out clean-work $(addprefix clean-,fetch boundary grid derive grotbc classify ground kmz profiles tile)

bundle: package

# 1 ---------------------------------------------------------------- network (only here)
fetch: $(W)/raw/.done
$(W)/raw/.done: sources.lock
	$(PY) $(S)/fetch.py --lock sources.lock --out $(W)/raw --record
	@touch $@

# 2 ---------------------------------------------------------------- grid + warps
# 2a --------------------------------------------------------------- official boundary (needs the NCGDB)
boundary: $(W)/boundary/.done
$(W)/boundary/.done:
	$(PY) $(S)/make_boundary.py --out $(W)/boundary $(NCGDB_ARG)
	@mkdir -p $(W)/boundary && touch $@

grid: $(W)/grid/.done
$(W)/grid/.done: $(W)/raw/.done $(W)/boundary/.done
	$(PY) $(S)/grid.py $(AOI_ARG) --zmin $(strip $(ZMIN)) --zmax $(strip $(ZMAX)) \
	    --target-res-m $(strip $(RES_M)) --raw $(W)/raw --out $(W)/grid $(BOUNDARY_ARG)
	@touch $@

# 3 ---------------------------------------------------------------- slope, JRC, OSM masks
derive: $(W)/derive/.done
$(W)/derive/.done: $(W)/grid/.done classes.yaml
	$(PY) $(S)/derive.py --grid $(W)/grid --raw $(W)/raw --out $(W)/derive --classes classes.yaml --block $(strip $(BLOCK)) \
	    --workers $(strip $(WORKERS)) $(NCGDB_ARG)
	@touch $@

# 3b --------------------------------------------------------------- GROTBC (v2): NCGDB lines / points, relief
grotbc: $(W)/grotbc/.done
$(W)/grotbc/.done: $(W)/derive/.done classes.yaml rules.yaml
	$(PY) $(S)/grotbc.py --grid $(W)/grid --derive $(W)/derive --out $(W)/grotbc --classes classes.yaml --rules rules.yaml \
	    --block $(strip $(BLOCK)) --workers $(strip $(WORKERS)) $(NCGDB_ARG)
	@touch $@

# 4 ---------------------------------------------------------------- class.tif (+ cc.tif, wet.tif)
classify: $(W)/classify/.done
$(W)/classify/.done: $(W)/grotbc/.done classes.yaml
	$(PY) $(S)/classify.py --grid $(W)/grid --derive $(W)/derive --grotbc $(W)/grotbc --out $(W)/classify --classes classes.yaml --block $(strip $(BLOCK))
	@touch $@

# 4b --------------------------------------------------------------- terrain type, soil, hut density, climate (GROTBC G / T / B)
terrain: $(W)/terrain/.done
$(W)/terrain/.done: $(W)/classify/.done rules.yaml
	$(PY) $(S)/fetch_soil.py --out $(W)/raw
	$(PY) $(S)/terrain.py --grid $(W)/grid --classify $(W)/classify --grotbc $(W)/grotbc --raw $(W)/raw --out $(W)/terrain 	    --block $(strip $(BLOCK)) $(NCGDB_ARG)
	@touch $@

# 4c --------------------------------------------------------------- road graph, buildings, settlements (GROTBC R / B)
NETWORK ?= D:/Imagery/Routing/Network.gdb
network: $(W)/network/.done
$(W)/network/.done: $(W)/grotbc/.done $(W)/classify/.done
	$(PY) $(S)/network.py --network "$(NETWORK)" --out $(W)/network
	@touch $@

buildings: $(W)/buildings/.done
$(W)/buildings/.done: $(W)/classify/.done
	$(PY) $(S)/fetch.py --lock sources.lock --out $(W)/raw --only openbuildings ghsl_height ghsl_smod --record
	$(PY) $(S)/buildings.py --out $(W)/buildings
	@touch $@

settlements: $(W)/settlements/.done
$(W)/settlements/.done: $(W)/buildings/.done $(W)/grotbc/.done
	$(PY) $(S)/settlements.py --out $(W)/settlements
	@touch $@

# 4d --------------------------------------------------------------- G: terrain feature inventory + ITG candidates
# Merges its kinds into work/grotbc/vector/features (strips its own first, so it re-runs cleanly); a re-run of
# grotbc's features drops them, so this step follows grotbc. Also writes work/ground/ground_inventory.gpkg.
ground: $(W)/ground/.done
$(W)/ground/.done: $(W)/grotbc/.done $(W)/classify/.done $(W)/network/.done rules.yaml
	$(PY) $(S)/ground.py --grid $(W)/grid --grotbc $(W)/grotbc --classify $(W)/classify --network $(W)/network \
	    --out $(W)/ground --workers $(strip $(WORKERS))
	@touch $@

# 4e --------------------------------------------------------------- formation overlay KMZs (optional, RESTRICTED)
# KMZ = "D:/Imagery/KMZs/1006.kmz D:/Imagery/KMZs/xyz.kmz", KMZ_IDS = the matching sources.lock ids. Merges routes /
# tracks, the border fence, perimeter walls, posts, named BUAs and services (src = kmz) into the features after
# ground.py (strips its own first). Empty KMZ = the step does nothing.
KMZ     ?=
KMZ_IDS ?=
kmz: $(W)/kmz/.done
$(W)/kmz/.done: $(W)/ground/.done $(KMZ)
	$(if $(strip $(KMZ)),$(PY) $(S)/kmz.py --kmz $(KMZ) $(if $(strip $(KMZ_IDS)),--ids $(KMZ_IDS)) --features $(W)/grotbc/vector/features --out $(W)/kmz,@echo "kmz: no KMZ given, skipped")
	@mkdir -p $(W)/kmz && touch $@

climate: $(W)/climate/.done
$(W)/climate/.done: $(W)/raw/.done
	$(PY) $(S)/climate.py --grid $(W)/grid/grid.json --raw $(W)/raw --out $(W)/climate
	@touch $@

population: $(W)/population/.done
$(W)/population/.done: $(W)/raw/.done
	$(PY) $(S)/population.py --raw $(W)/raw --lock sources.lock --out $(W)/population
	@touch $@

# 5 ---------------------------------------------------------------- rules.json + dist_*.tif
profiles: $(W)/profiles/.done
$(W)/profiles/.done: $(W)/classify/.done rules.yaml classes.yaml
	$(PY) $(S)/profiles.py --rules rules.yaml --classes classes.yaml --grid $(W)/grid \
	    --class-tif $(W)/classify/class.tif --out $(W)/profiles --block $(strip $(BLOCK))
	@touch $@

# 6 ---------------------------------------------------------------- XYZ PNG tiles
tile: $(W)/tile/.done
$(W)/tile/.done: $(W)/profiles/.done $(W)/terrain/.done $(W)/climate/.done $(W)/population/.done $(W)/buildings/.done $(W)/network/.done $(W)/settlements/.done $(W)/ground/.done $(W)/kmz/.done
	rm -rf $(OUT_DIR)
	$(PY) $(S)/tile.py --grid $(W)/grid --class-tif $(W)/classify/class.tif \
	    --profiles $(W)/profiles --grotbc $(W)/grotbc --terrain $(W)/terrain --buildings $(W)/buildings --out $(OUT_DIR) --workers $(strip $(WORKERS))
	@mkdir -p $(W)/tile && touch $@

# 7 ---------------------------------------------------------------- checks
validate: $(W)/tile/.done
	$(PY) $(S)/validate.py --bundle $(OUT_DIR) --golden golden_points.yaml

# 8 ---------------------------------------------------------------- manifest + zip
package: validate
	$(PY) $(S)/package.py --bundle $(OUT_DIR) --grid $(W)/grid/grid.json \
	    --rules-json $(W)/profiles/rules.json --rules rules.yaml --lock sources.lock \
	    --checksums $(W)/raw/checksums.json --grotbc-vector $(W)/grotbc/vector --climate $(W)/climate --population $(W)/population --network $(W)/network --settlements $(W)/settlements --zip out/terrain-bundle.zip

# steps 5-8 only (rules/classes changed; class.tif unchanged)
rebuild-rules: clean-profiles clean-tile package

# validate the synthetic bundle written by `node tools/terrain-synth.mjs`
synth-check:
	@test -d $(SYNTH) || { echo "no synthetic bundle at $(SYNTH); run: node tools/terrain-synth.mjs"; exit 1; }
	$(PY) $(S)/validate.py --bundle $(SYNTH) --no-golden

# ---------------------------------------------------------------- housekeeping
clean-fetch:    ; rm -f $(W)/raw/.done            # keeps downloads; `rm -rf work/raw` to drop them
clean-boundary: ; rm -rf $(W)/boundary
clean-grid:     ; rm -rf $(W)/grid
clean-derive:   ; rm -rf $(W)/derive
clean-grotbc:   ; rm -rf $(W)/grotbc
clean-classify: ; rm -rf $(W)/classify
clean-terrain:  ; rm -rf $(W)/terrain
clean-climate:  ; rm -rf $(W)/climate
clean-population: ; rm -rf $(W)/population
clean-network:  ; rm -rf $(W)/network
clean-buildings: ; rm -rf $(W)/buildings
clean-settlements: ; rm -rf $(W)/settlements
clean-ground:   ; rm -rf $(W)/ground
clean-kmz:      ; rm -rf $(W)/kmz
clean-profiles: ; rm -rf $(W)/profiles
clean-tile:     ; rm -rf $(W)/tile $(OUT_DIR)
clean-out:      ; rm -rf out $(OUT_DIR)
clean-work:     ; rm -rf $(W)/grid $(W)/derive $(W)/grotbc $(W)/classify $(W)/profiles $(W)/tile
clean: clean-work clean-out
