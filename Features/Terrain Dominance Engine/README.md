# Terrain Dominance Engine

A tactical terrain analysis prototype built using ArcGIS API for JavaScript.

Supports:
- 2D analysis
- 3D terrain visualization
- dominant terrain detection
- movement corridor extraction
- reverse slope visualization
- terrain control estimation

---

# Purpose

This engine is NOT a generic GIS heatmap.

It attempts to answer operational questions:

- Which terrain dominates the AO?
- Which ground controls observation?
- Where will movement naturally funnel?
- Which slopes are protected from direct observation?
- Which terrain is advantageous for defence?
- Which routes are likely avenues of approach?

The system is intended as a terrain reasoning layer for:
- military planning
- defence analysis
- assault planning
- OP placement
- route analysis
- OCOKA workflows

---

# Core Workflow

## 1. Select Area of Tactical Interest

User clicks terrain.

The engine creates:
- analysis center point
- circular AOI

---

## 2. Terrain Sampling

The AOI is divided into a terrain grid.

Each cell becomes:
- a sample point
- queried against ArcGIS elevation service

This creates:
- terrain elevation matrix

---

## 3. Elevation Query

Uses:

ElevationLayer.queryElevation()

Source:
WorldElevation3D Terrain Service

Returns:
- longitude
- latitude
- elevation

for every terrain sample.

---

# Terrain Dominance Logic

Dominance is relative, NOT absolute.

A 200m hill may dominate flat desert.

A 200m hill may be irrelevant in mountains.

So dominance is calculated using:

dominance =
(current elevation - mean elevation)
/
(max elevation - min elevation)

This normalizes terrain importance.

---

# Terrain Classification

## Dominant Terrain

Condition:

dominance > 0.35

Displayed:
RED

Meaning:
- controls observation
- controls fires
- controls movement
- likely key terrain

---

## Intermediate Terrain

Condition:

0 < dominance <= 0.35

Displayed:
ORANGE

Meaning:
- useful but not controlling
- secondary observation
- maneuver support terrain

---

## Low Ground

Condition:

dominance <= 0

Displayed:
BLUE

Meaning:
- natural movement corridors
- valleys
- concealed movement
- canalized approach routes

---

# Movement Corridors

The engine assumes:

forces naturally prefer:
- lower terrain
- valleys
- reduced silhouette exposure

Algorithm:
- sort terrain cells by lowest elevation
- select lowest N cells
- create corridor overlays

Current version is simplified.

Future versions should include:
- slope resistance
- terrain roughness
- hydrology
- vegetation
- road preference
- enemy observation weighting

---

# Reverse Slope Detection

Reverse slopes are terrain faces hidden from direct observation/fire.

Current prototype:
- uses offsets behind dominant terrain

Purpose:
- identify masked positions
- identify protected staging areas
- identify hull-down regions

Future version:
- should use true aspect analysis
- should use enemy direction
- should use LOS inversion

---

# Observation Peaks

Highest terrain cells are marked as peaks.

These indicate:
- likely OP positions
- likely radar sites
- likely overwatch terrain
- likely artillery observation points

Future scoring should include:
- visibility radius
- skyline exposure
- dead ground
- mutual support

---

# Operational Assessment Scores

## Terrain Control

Measures:
difference between max elevation and average terrain.

Large difference:
- dominant terrain exists

---

## Observation

Measures:
number of dominant peaks.

More peaks:
- stronger observation network

---

## Movement

Measures:
degree of terrain canalization.

Large low-ground network:
- movement becomes predictable

---

## Defensibility

Measures:
availability of dominant terrain and reverse slopes.

High dominant terrain:
- stronger defensive posture

---

# What This Engine Is NOT

This is NOT:
- a full military simulation
- true mobility analysis
- LOS engine
- ballistic solver
- hydrology engine
- AI planner

It is:
- terrain reasoning foundation

---

# Recommended Next Modules

## Critical

- True LOS / viewshed
- Dead ground mapper
- Slope analysis
- Trafficability
- Hull-down analysis
- Terrain roughness
- Ridge extraction
- Contour extraction

---

## High Value

- Engagement area designer
- OP ranker
- Route comparison
- Assault lane analysis
- Mutual support mesh
- Sensor coverage domes

---

# Performance Notes

Large densities:
- increase terrain samples
- increase polygons
- reduce FPS

Recommended:
20–40 density.

Future optimization:
- raster overlays
- WebGL layers
- GPU rendering
- tiled terrain analysis

---

# Tactical Reality

Terrain analysis is not about elevation alone.

The real battlefield value comes from:
- visibility
- movement
- masking
- exposure
- fire support
- terrain continuity
- defensibility
- access routes

This engine is the foundation layer for those systems.