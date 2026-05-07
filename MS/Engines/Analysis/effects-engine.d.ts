export function computeEffects(munition: any, structureFactor?: string, detonationHeightOverride?: null): {
    munition: any;
    structureFactor: any;
    detonationHeightM: any;
    rings: {
        id: string;
        label: string;
        radiusM: number;
        colorKey: string;
        opacity: number;
    }[];
};
export function destinationPoint(lon: any, lat: any, bearingDeg: any, distM: any): {
    longitude: number;
    latitude: number;
};
export function createEffectsEngine({ Graphic, Point, Polygon, Mesh, geometryEngine }: {
    Graphic: any;
    Point: any;
    Polygon: any;
    Mesh: any;
    geometryEngine: any;
}): {
    buildRingGraphics: (impactPoint: any, result: any, { asDonut, showLabels }?: {
        asDonut?: boolean | undefined;
        showLabels?: boolean | undefined;
    }) => any[];
    buildImpactMarker: (impactPoint: any, result: any) => any[];
    buildBlastSphereMesh: (impactPoint: any, radiusM: any, color: any, alpha: any) => any;
    createBlastWaveAnimation: (impactPoint: any, maxRadiusM: any, color: any, animLayer: any, durationMs?: number) => {
        start(): void;
        stop(): void;
        readonly playing: boolean;
    };
    buildUnionFootprint: (impactPoints: any, results: any) => any;
};
export namespace MUNITION_PRESETS {
    namespace mortar_60mm {
        let label: string;
        let tntEquivKg: number;
        let fragmentVelocityMS: number;
        let casingMassRatio: number;
        let detonationHeightM: number;
        let color: number[];
        let icon: string;
    }
    namespace mortar_81mm {
        let label_1: string;
        export { label_1 as label };
        let tntEquivKg_1: number;
        export { tntEquivKg_1 as tntEquivKg };
        let fragmentVelocityMS_1: number;
        export { fragmentVelocityMS_1 as fragmentVelocityMS };
        let casingMassRatio_1: number;
        export { casingMassRatio_1 as casingMassRatio };
        let detonationHeightM_1: number;
        export { detonationHeightM_1 as detonationHeightM };
        let color_1: number[];
        export { color_1 as color };
        let icon_1: string;
        export { icon_1 as icon };
    }
    namespace artillery_105mm {
        let label_2: string;
        export { label_2 as label };
        let tntEquivKg_2: number;
        export { tntEquivKg_2 as tntEquivKg };
        let fragmentVelocityMS_2: number;
        export { fragmentVelocityMS_2 as fragmentVelocityMS };
        let casingMassRatio_2: number;
        export { casingMassRatio_2 as casingMassRatio };
        let detonationHeightM_2: number;
        export { detonationHeightM_2 as detonationHeightM };
        let color_2: number[];
        export { color_2 as color };
        let icon_2: string;
        export { icon_2 as icon };
    }
    namespace artillery_155mm {
        let label_3: string;
        export { label_3 as label };
        let tntEquivKg_3: number;
        export { tntEquivKg_3 as tntEquivKg };
        let fragmentVelocityMS_3: number;
        export { fragmentVelocityMS_3 as fragmentVelocityMS };
        let casingMassRatio_3: number;
        export { casingMassRatio_3 as casingMassRatio };
        let detonationHeightM_3: number;
        export { detonationHeightM_3 as detonationHeightM };
        let color_3: number[];
        export { color_3 as color };
        let icon_3: string;
        export { icon_3 as icon };
    }
    namespace ied_10kg {
        let label_4: string;
        export { label_4 as label };
        let tntEquivKg_4: number;
        export { tntEquivKg_4 as tntEquivKg };
        let fragmentVelocityMS_4: number;
        export { fragmentVelocityMS_4 as fragmentVelocityMS };
        let casingMassRatio_4: number;
        export { casingMassRatio_4 as casingMassRatio };
        let detonationHeightM_4: number;
        export { detonationHeightM_4 as detonationHeightM };
        let color_4: number[];
        export { color_4 as color };
        let icon_4: string;
        export { icon_4 as icon };
    }
    namespace vbied_100kg {
        let label_5: string;
        export { label_5 as label };
        let tntEquivKg_5: number;
        export { tntEquivKg_5 as tntEquivKg };
        let fragmentVelocityMS_5: number;
        export { fragmentVelocityMS_5 as fragmentVelocityMS };
        let casingMassRatio_5: number;
        export { casingMassRatio_5 as casingMassRatio };
        let detonationHeightM_5: number;
        export { detonationHeightM_5 as detonationHeightM };
        let color_5: number[];
        export { color_5 as color };
        let icon_5: string;
        export { icon_5 as icon };
    }
    namespace gbbu_500lb {
        let label_6: string;
        export { label_6 as label };
        let tntEquivKg_6: number;
        export { tntEquivKg_6 as tntEquivKg };
        let fragmentVelocityMS_6: number;
        export { fragmentVelocityMS_6 as fragmentVelocityMS };
        let casingMassRatio_6: number;
        export { casingMassRatio_6 as casingMassRatio };
        let detonationHeightM_6: number;
        export { detonationHeightM_6 as detonationHeightM };
        let color_6: number[];
        export { color_6 as color };
        let icon_6: string;
        export { icon_6 as icon };
    }
    namespace thermobaric {
        let label_7: string;
        export { label_7 as label };
        let tntEquivKg_7: number;
        export { tntEquivKg_7 as tntEquivKg };
        let fragmentVelocityMS_7: number;
        export { fragmentVelocityMS_7 as fragmentVelocityMS };
        let casingMassRatio_7: number;
        export { casingMassRatio_7 as casingMassRatio };
        let detonationHeightM_7: number;
        export { detonationHeightM_7 as detonationHeightM };
        let color_7: number[];
        export { color_7 as color };
        let icon_7: string;
        export { icon_7 as icon };
    }
}
export namespace STRUCTURE_FACTORS {
    namespace open_area {
        let label_8: string;
        export { label_8 as label };
        export let blastMult: number;
        export let fragMult: number;
    }
    namespace light_urban {
        let label_9: string;
        export { label_9 as label };
        let blastMult_1: number;
        export { blastMult_1 as blastMult };
        let fragMult_1: number;
        export { fragMult_1 as fragMult };
    }
    namespace masonry {
        let label_10: string;
        export { label_10 as label };
        let blastMult_2: number;
        export { blastMult_2 as blastMult };
        let fragMult_2: number;
        export { fragMult_2 as fragMult };
    }
    namespace reinforced_concrete {
        let label_11: string;
        export { label_11 as label };
        let blastMult_3: number;
        export { blastMult_3 as blastMult };
        let fragMult_3: number;
        export { fragMult_3 as fragMult };
    }
    namespace reenforced_shelter {
        let label_12: string;
        export { label_12 as label };
        let blastMult_4: number;
        export { blastMult_4 as blastMult };
        let fragMult_4: number;
        export { fragMult_4 as fragMult };
    }
}
export namespace EFFECTS_COLORS {
    namespace lethal {
        let fill: number[];
        let outline: number[];
    }
    namespace warning {
        let fill_1: number[];
        export { fill_1 as fill };
        let outline_1: number[];
        export { outline_1 as outline };
    }
    namespace thermal {
        let fill_2: number[];
        export { fill_2 as fill };
        let outline_2: number[];
        export { outline_2 as outline };
    }
    namespace safe {
        let fill_3: number[];
        export { fill_3 as fill };
        let outline_3: number[];
        export { outline_3 as outline };
    }
    namespace qd {
        let fill_4: number[];
        export { fill_4 as fill };
        let outline_4: number[];
        export { outline_4 as outline };
    }
}
