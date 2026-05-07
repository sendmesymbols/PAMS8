export function destinationPoint(lon: any, lat: any, bearingDeg: any, distM: any): {
    longitude: number;
    latitude: number;
};
export function computeTrajectory({ originLon, originLat, launchAltM, bearingDeg, elevDeg, muzzleVelMS, massKg, diameterM, Cd, windSpeedMS, windBearingDeg, dtS, maxTimeS, }: {
    originLon: any;
    originLat: any;
    launchAltM?: number | undefined;
    bearingDeg?: number | undefined;
    elevDeg?: number | undefined;
    muzzleVelMS: any;
    massKg: any;
    diameterM: any;
    Cd: any;
    windSpeedMS?: number | undefined;
    windBearingDeg?: number | undefined;
    dtS?: number | undefined;
    maxTimeS?: number | undefined;
}): {
    waypoints: {
        t: number;
        phase: string;
        east: number;
        north: number;
        up: number;
        speed: number;
        longitude: any;
        latitude: any;
        z: any;
    }[];
    impact: {
        t: number;
        phase: string;
        east: number;
        north: number;
        up: number;
        speed: number;
        longitude: any;
        latitude: any;
        z: any;
    } | undefined;
    apogee: {
        t: number;
        phase: string;
        east: number;
        north: number;
        up: number;
        speed: number;
        longitude: any;
        latitude: any;
        z: any;
    };
    rangeM: number;
    maxAltM: number;
    flightS: number;
};
export function createTrajectoryEngine(deps: any): {
    buildTrajectoryGraphics: ({ waypoints }: {
        waypoints: any;
    }, { color }: {
        color: any;
    }) => any[];
    buildProjectileMarker: ({ color }: {
        color: any;
    }) => any;
    buildKeyMarkers: ({ waypoints, apogee, impact, maxAltM, rangeM }: {
        waypoints: any;
        apogee: any;
        impact: any;
        maxAltM: any;
        rangeM: any;
    }, { color }: {
        color: any;
    }) => any[];
    buildCEPGraphic: ({ impact }: {
        impact: any;
    }, { color, cepm }: {
        color: any;
        cepm: any;
    }) => any;
    createAnimationController: (waypoints: any, markerGraphic: any, animLayer: any) => {
        start(scale?: number): void;
        stop(): void;
        seek(p: any): void;
        setSpeed(s: any): void;
        readonly playing: boolean;
        readonly progress: number;
        readonly currentPt: {
            longitude: any;
            latitude: any;
            z: any;
            speed: any;
        };
    };
};
export namespace PROJECTILE_PRESETS {
    namespace mortar_60mm {
        let label: string;
        let massKg: number;
        let diameterM: number;
        let Cd: number;
        let muzzleVelMS: number;
        let elevMinDeg: number;
        let elevMaxDeg: number;
        let elevDefaultDeg: number;
        let color: number[];
        let cepm: number;
    }
    namespace mortar_81mm {
        let label_1: string;
        export { label_1 as label };
        let massKg_1: number;
        export { massKg_1 as massKg };
        let diameterM_1: number;
        export { diameterM_1 as diameterM };
        let Cd_1: number;
        export { Cd_1 as Cd };
        let muzzleVelMS_1: number;
        export { muzzleVelMS_1 as muzzleVelMS };
        let elevMinDeg_1: number;
        export { elevMinDeg_1 as elevMinDeg };
        let elevMaxDeg_1: number;
        export { elevMaxDeg_1 as elevMaxDeg };
        let elevDefaultDeg_1: number;
        export { elevDefaultDeg_1 as elevDefaultDeg };
        let color_1: number[];
        export { color_1 as color };
        let cepm_1: number;
        export { cepm_1 as cepm };
    }
    namespace artillery_105mm {
        let label_2: string;
        export { label_2 as label };
        let massKg_2: number;
        export { massKg_2 as massKg };
        let diameterM_2: number;
        export { diameterM_2 as diameterM };
        let Cd_2: number;
        export { Cd_2 as Cd };
        let muzzleVelMS_2: number;
        export { muzzleVelMS_2 as muzzleVelMS };
        let elevMinDeg_2: number;
        export { elevMinDeg_2 as elevMinDeg };
        let elevMaxDeg_2: number;
        export { elevMaxDeg_2 as elevMaxDeg };
        let elevDefaultDeg_2: number;
        export { elevDefaultDeg_2 as elevDefaultDeg };
        let color_2: number[];
        export { color_2 as color };
        let cepm_2: number;
        export { cepm_2 as cepm };
    }
    namespace artillery_155mm {
        let label_3: string;
        export { label_3 as label };
        let massKg_3: number;
        export { massKg_3 as massKg };
        let diameterM_3: number;
        export { diameterM_3 as diameterM };
        let Cd_3: number;
        export { Cd_3 as Cd };
        let muzzleVelMS_3: number;
        export { muzzleVelMS_3 as muzzleVelMS };
        let elevMinDeg_3: number;
        export { elevMinDeg_3 as elevMinDeg };
        let elevMaxDeg_3: number;
        export { elevMaxDeg_3 as elevMaxDeg };
        let elevDefaultDeg_3: number;
        export { elevDefaultDeg_3 as elevDefaultDeg };
        let color_3: number[];
        export { color_3 as color };
        let cepm_3: number;
        export { cepm_3 as cepm };
    }
    namespace atgm {
        let label_4: string;
        export { label_4 as label };
        let massKg_4: number;
        export { massKg_4 as massKg };
        let diameterM_4: number;
        export { diameterM_4 as diameterM };
        let Cd_4: number;
        export { Cd_4 as Cd };
        let muzzleVelMS_4: number;
        export { muzzleVelMS_4 as muzzleVelMS };
        let elevMinDeg_4: number;
        export { elevMinDeg_4 as elevMinDeg };
        let elevMaxDeg_4: number;
        export { elevMaxDeg_4 as elevMaxDeg };
        let elevDefaultDeg_4: number;
        export { elevDefaultDeg_4 as elevDefaultDeg };
        let color_4: number[];
        export { color_4 as color };
        let cepm_4: number;
        export { cepm_4 as cepm };
    }
    namespace rpg7 {
        let label_5: string;
        export { label_5 as label };
        let massKg_5: number;
        export { massKg_5 as massKg };
        let diameterM_5: number;
        export { diameterM_5 as diameterM };
        let Cd_5: number;
        export { Cd_5 as Cd };
        let muzzleVelMS_5: number;
        export { muzzleVelMS_5 as muzzleVelMS };
        let elevMinDeg_5: number;
        export { elevMinDeg_5 as elevMinDeg };
        let elevMaxDeg_5: number;
        export { elevMaxDeg_5 as elevMaxDeg };
        let elevDefaultDeg_5: number;
        export { elevDefaultDeg_5 as elevDefaultDeg };
        let color_5: number[];
        export { color_5 as color };
        let cepm_5: number;
        export { cepm_5 as cepm };
    }
    namespace drone {
        let label_6: string;
        export { label_6 as label };
        let massKg_6: number;
        export { massKg_6 as massKg };
        let diameterM_6: number;
        export { diameterM_6 as diameterM };
        let Cd_6: number;
        export { Cd_6 as Cd };
        let muzzleVelMS_6: number;
        export { muzzleVelMS_6 as muzzleVelMS };
        let elevMinDeg_6: number;
        export { elevMinDeg_6 as elevMinDeg };
        let elevMaxDeg_6: number;
        export { elevMaxDeg_6 as elevMaxDeg };
        let elevDefaultDeg_6: number;
        export { elevDefaultDeg_6 as elevDefaultDeg };
        let color_6: number[];
        export { color_6 as color };
        let cepm_6: number;
        export { cepm_6 as cepm };
    }
}
