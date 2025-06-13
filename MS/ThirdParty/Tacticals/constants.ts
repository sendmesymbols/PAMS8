export const SIDC_POSITIONS = {
    SCHEMA: 0,
    IDENTITY: 1,
    BATTLE_DIMENSION: 2,
    STATUS: 3,
    FUNCTION_ID: 4,
    MODIFIER: 10,
    MOBILITY: 10,
    INSTALLATION: 10,
    ECHELON: 11
} as const;

export const MODIFIERS = {
    aa: 'specialHeadquarters',
    ad: 'platformType',
    ae: 'equipmentTeardownTime',
    af: 'commonIdentifier',
    ah: 'headquartersElement',
    ao: 'engagementBar',
    ap: 'targetNumber',
    aq: 'guardedUnit',
    ar: 'specialDesignator',
    c: 'quantity',
    f: 'reinforcedReduced',
    j: 'evaluationRating',
    k: 'combatEffectiveness',
    g: 'staffComments',
    h: 'additionalInformation',
    m: 'higherFormation',
    n: 'hostile',
    p: 'iffSif',
    q: 'direction',
    r: 'quantity',
    t: 'uniqueDesignation',
    v: 'type',
    x: 'altitudeDepth',
    y: 'location',
    z: 'speed',
    w: 'dtg'
} as const;

export const LAYER_NAMES = {
    FORCE: 'force-layer',
    MILSYMBOLS: 'milsymbols-layer',
    TACTICAL: 'tactical-layer'
} as const;
