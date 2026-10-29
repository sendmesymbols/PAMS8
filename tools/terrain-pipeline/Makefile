# Terrain-bundle pipeline for the PAMS8 Placement Advisor.
#   make bundle            full run: fetch grid derive classify profiles tile validate package
#   make rebuild-rules     after editing rules.yaml / classes.yaml: steps 5-8 only
#   make synth-check       validate the synthetic dev bundle (no data needed)
# Every step writes work/<step>/ and leaves work/<step>/.done; delete the stamp
# (or `make clean-<step>`) to force a re-run.

PY       ?= python3
AOI      ?= 60.8,23.6,77.9,37.1      # west,south,east,north (WGS84) — Pakistan
RES_M    ?= 30                       # target ground resolution; grid warns if ZMAX is coarser
ZMIN     ?= 8
ZMAX     ?= 12
OUT_DIR  ?= out/terrain-bundle
WORKERS  ?= 4
BLOCK    ?= 2048                     # processing block (px); lower it on small RAM
BOUNDARY ?=                          # optional GeoJSON clip polygon (default: OSM admin_level=2)
SYNTH    ?= ../../public/terrain-bundle

S  = scripts
W  = work
BOUNDARY_ARG = $(if $(strip $(BOUNDARY)),--boundary $(strip $(BOUNDARY)),)

.PHONY: bundle fetch grid derive classify profiles tile validate package rebuild-rules \
        synth-check clean clean-out clean-work $(addprefix clean-,fetch grid derive classify profiles tile)

bundle: package

# 1 ---------------------------------------------------------------- network (only here)
fetch: $(W)/raw/.done
$(W)/raw/.done: sources.lock
	$(PY) $(S)/fetch.py --lock sources.lock --out $(W)/raw --record
	@touch $@

# 2 ---------------------------------------------------------------- grid + warps
grid: $(W)/grid/.done
$(W)/grid/.done: $(W)/raw/.done
	$(PY) $(S)/grid.py --aoi "$(strip $(AOI))" --zmin $(strip $(ZMIN)) --zmax $(strip $(ZMAX)) \
	    --target-res-m $(strip $(RES_M)) --raw $(W)/raw --out $(W)/grid $(BOUNDARY_ARG)
	@touch $@

# 3 ---------------------------------------------------------------- slope, JRC, OSM masks
derive: $(W)/derive/.done
$(W)/derive/.done: $(W)/grid/.done classes.yaml
	$(PY) $(S)/derive.py --grid $(W)/grid --raw $(W)/raw --out $(W)/derive --classes classes.yaml --block $(strip $(BLOCK))
	@touch $@

# 4 ---------------------------------------------------------------- class.tif
classify: $(W)/classify/.done
$(W)/classify/.done: $(W)/derive/.done classes.yaml
	$(PY) $(S)/classify.py --grid $(W)/grid --derive $(W)/derive --out $(W)/classify --classes classes.yaml --block $(strip $(BLOCK))
	@touch $@

# 5 ---------------------------------------------------------------- rules.json + dist_*.tif
profiles: $(W)/profiles/.done
$(W)/profiles/.done: $(W)/classify/.done rules.yaml classes.yaml
	$(PY) $(S)/profiles.py --rules rules.yaml --classes classes.yaml --grid $(W)/grid \
	    --class-tif $(W)/classify/class.tif --out $(W)/profiles --block $(strip $(BLOCK))
	@touch $@

# 6 ---------------------------------------------------------------- XYZ PNG tiles
tile: $(W)/tile/.done
$(W)/tile/.done: $(W)/profiles/.done
	rm -rf $(OUT_DIR)
	$(PY) $(S)/tile.py --grid $(W)/grid --class-tif $(W)/classify/class.tif \
	    --profiles $(W)/profiles --out $(OUT_DIR) --workers $(strip $(WORKERS))
	@mkdir -p $(W)/tile && touch $@

# 7 ---------------------------------------------------------------- checks
validate: $(W)/tile/.done
	$(PY) $(S)/validate.py --bundle $(OUT_DIR) --golden golden_points.yaml

# 8 ---------------------------------------------------------------- manifest + zip
package: validate
	$(PY) $(S)/package.py --bundle $(OUT_DIR) --grid $(W)/grid/grid.json \
	    --rules-json $(W)/profiles/rules.json --rules rules.yaml --lock sources.lock \
	    --checksums $(W)/raw/checksums.json --zip out/terrain-bundle.zip

# steps 5-8 only (rules/classes changed; class.tif unchanged)
rebuild-rules: clean-profiles clean-tile package

# validate the synthetic bundle written by `node tools/terrain-synth.mjs`
synth-check:
	@test -d $(SYNTH) || { echo "no synthetic bundle at $(SYNTH); run: node tools/terrain-synth.mjs"; exit 1; }
	$(PY) $(S)/validate.py --bundle $(SYNTH) --no-golden

# ---------------------------------------------------------------- housekeeping
clean-fetch:    ; rm -f $(W)/raw/.done            # keeps downloads; `rm -rf work/raw` to drop them
clean-grid:     ; rm -rf $(W)/grid
clean-derive:   ; rm -rf $(W)/derive
clean-classify: ; rm -rf $(W)/classify
clean-profiles: ; rm -rf $(W)/profiles
clean-tile:     ; rm -rf $(W)/tile $(OUT_DIR)
clean-out:      ; rm -rf out
clean-work:     ; rm -rf $(W)/grid $(W)/derive $(W)/classify $(W)/profiles $(W)/tile
clean: clean-work clean-out
