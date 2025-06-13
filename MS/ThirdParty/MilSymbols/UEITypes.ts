// --- Constants ---
export const StandardIdentities: Record<string, string> = {
  "0": "Pending",
  "1": "Unknown",
  "2": "Assumed Friend",
  "3": "Friend",
  "4": "Neutral",
  "5": "Suspect",
  "6": "Hostile",
  "7": "Joker",
  "8": "Faker"
};

export const SymbolSets: Record<string, string> = {
  "00": "Unknown",
  "01": "Air",
  "02": "Air Missile",
  "05": "Space",
  "06": "Space Missile",
  "10": "Land Unit",
  "11": "Land Civilian Unit/Organization",
  "15": "Land Equipment",
  "20": "Land Installation",
  "25": "Control Measure",
  "30": "Sea Surface",
  "35": "Sea Subsurface",
  "36": "Mine Warfare",
  "40": "Activities",
  "45": "Atmospheric",
  "46": "Oceanographic",
  "47": "Meteorological Space",
  "50": "SIGINT – Space",
  "51": "SIGINT – Air",
  "52": "SIGINT – Land",
  "53": "SIGINT – Surface",
  "54": "SIGINT – Subsurface",
  "60": "Cyberspace",
  "99": "Version Extension"
};

export const StatusCodes: Record<string, string> = {
  "0": "Present",
  "1": "Planned/Anticipated/Suspect",
  "2": "Present/Fully Capable",
  "3": "Present/Damaged",
  "4": "Present/Destroyed",
  "5": "Present/Full to Capacity"
};

export const HQTFDummyIndicators: Record<string, string> = {
  "0": "Unknown",
  "1": "Feint/Dummy",
  "2": "Headquarters",
  "3": "Feint/Dummy Headquarters",
  "4": "Task Force",
  "5": "Feint/Dummy Task Force",
  "6": "Task Force Headquarters",
  "7": "Feint/Dummy Task Force Headquarters"
};

export const EchelonMobilityAmplifiers: Record<string, string> = {
  "00": "Unknown",
  "11": "Team/Crew",
  "12": "Squad",
  "13": "Section",
  "14": "Platoon/Detachment",
  "15": "Company/Battery/Troop",
  "16": "Battalion/Squadron",
  "17": "Regiment/Group",
  "18": "Brigade",
  "21": "Division",
  "22": "Corps/MEF",
  "23": "Army",
  "24": "Army Group/Front",
  "25": "Region/Theater",
  "26": "Command",
  "31": "Wheeled, limited cross country",
  "32": "Wheeled, cross country",
  "33": "Tracked",
  "34": "Wheeled and Tracked Combination"
};

// --- Types ---
type ColorMode = {
  Civilian: string;
  Friend: string;
  Hostile: string;
  Neutral: string;
  Unknown: string;
  Suspect: string;
};

export type SymbolOptions = {
  additionalInformation?: string;
  alternateMedal?: boolean;
  altitudeDepth?: string;
  auxiliaryEquipmentIndicator?: string;
  civilianColor?: boolean;
  colorMode?: ColorMode | string;
  combatEffectiveness?: string;
  commonIdentifier?: string;
  country?: string;
  direction?: string;
  dtg?: string;
  engagementBar?: string;
  engagementType?: string;
  equipmentTeardownTime?: string;
  evaluationRating?: string;
  fill?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  fontfamily?: string;
  frame?: boolean;
  frameColor?: ColorMode;
  guardedUnit?: string;
  headquartersElement?: string;
  higherFormation?: string;
  hostile?: string;
  hqStaffLength?: number;
  icon?: boolean;
  iconColor?: ColorMode | string;
  iffSif?: string;
  infoBackground?: ColorMode | string;
  infoBackgroundFrame?: ColorMode | string;
  infoColor?: ColorMode | string;
  infoFields?: boolean;
  infoOutlineColor?: string;
  infoOutlineWidth?: number;
  infoSize?: number;
  installationComposition?: string;
  location?: string;
  monoColor?: string;
  outlineColor?: ColorMode | string;
  outlineWidth?: number;
  padding?: number;
  platformType?: string;
  quantity?: string;
  reinforcedReduced?: string;
  sidc?: string;
  sigint?: string;
  signatureEquipment?: string;
  simpleStatusModifier?: boolean;
  size?: number;
  specialDesignator?: string;
  specialHeadquarters?: string;
  speed?: string;
  speedLeader?: number;
  square?: boolean;
  staffComments?: string;
  standard?: string;
  strokeWidth?: number;
  type?: string;
  uniqueDesignation?: string;
};

type BaseAffiliation = "" | "Hostile" | "Friend" | "Neutral" | "Unknown";
type Affiliation = "undefined" | BaseAffiliation;
type Context = "Reality" | "Exercise" | "Simulation";
type BaseDimension = "" | "Air" | "Ground" | "Sea" | "Subsurface";
type Dimension = "undefined" | "LandDismountedIndividual" | BaseDimension;
type Condition = "" | "Present" | "Planned" | "FullyCapable" | "Damaged" | "Destroyed" | "FullToCapacity";
type Echelon = "" | "Team/Crew" | "Squad" | "Section" | "Platoon/detachment" | "Company/battery/troop" | "Battalion/squadron" | "Regiment/group" | "Brigade" | "Division" | "Corps/MEF" | "Army" | "Army Group/front" | "Region/Theater" | "Command";
type Mobility = "" | "Wheeled limited cross country" | "Wheeled cross country" | "Tracked" | "Wheeled and tracked combination" | "Towed" | "Rail" | "Pack animals" | "Over snow (prime mover)" | "Sled" | "Barge" | "Amphibious" | "Short towed array" | "Long towed Array";
type Leadership = "Leader Individual" | "Deputy Individual";

type SymbolMetadata = {
  activity: boolean;
  affiliation: Affiliation;
  baseAffilation: BaseAffiliation;
  baseDimension: BaseDimension;
  baseGeometry: Object;
  civilian: boolean;
  condition: Condition;
  context: Context;
  dimension: Dimension;
  dimensionUnknown: boolean;
  dismounted?: boolean;
  echelon: Echelon;
  faker: boolean;
  fenintDummy: boolean;
  fill: boolean;
  frame: boolean;
  functionid: string;
  headquarters: boolean;
  installation: boolean;
  joker: boolean;
  leadership?: Leadership;
  mobility?: Mobility;
  notpresent: string;
  numberSIDC: boolean;
  space: boolean;
  suspect: boolean;
  taskForce: boolean;
  unit: boolean;
};

type SymbolColors = {
  black: ColorMode;
  fillColor: ColorMode;
  frameColor: ColorMode;
  iconColor: ColorMode;
  iconFillColor: ColorMode;
  none: ColorMode;
  white: ColorMode;
};

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface BBoxObject extends Box {
  width(): number;
  height(): number;
  merge(box: Box): this;
}

interface DashObject {
  pending: string;
  anticipated: string;
  feintDummy: string;
}

// --- Classes and Functions ---
export class Symbol {
  constructor(code: string | SymbolOptions, ...options: SymbolOptions[]) {
    console.log(code);
    console.log(options);
  }

  asCanvas(factor?: number): HTMLCanvasElement {
    console.log(factor);
    return new HTMLCanvasElement();
  }
  asDOM(): Element { return new Element(); }
  asOffscreenCanvas(factor?: number): OffscreenCanvas {
    console.log(factor);
    return new OffscreenCanvas(0, 0);
  }
  asSVG(): string { return ""; }
  getAnchor(): { x: number; y: number } { return { x: 0, y: 0 }; }
  getColors(): SymbolColors { return {} as SymbolColors; }
  getOctagonAnchor(): { x: number; y: number } { return { x: 0, y: 0 }; }
  getOptions(includeStyle?: boolean): SymbolOptions {
    console.log(includeStyle);
    return {};
  }
  getMetadata(): SymbolMetadata { return {} as SymbolMetadata; }
  getSize(): { width: number; height: number } { return { width: 0, height: 0 }; }
  getStyle(): SymbolOptions { return {}; }
  isValid(extended?: boolean): boolean | Object {
    console.log(extended);
    return false;
  }
  setOptions(opts: SymbolOptions): Symbol {
    console.log(opts);
    return this;
  }
  toDataURL(): string { return ""; }
}

export function BBox(box?: Partial<Box>): BBoxObject {
  console.log(box);
  return {} as BBoxObject;
}

export function ColorMode(civilian: string, friend: string, hostile: string, neutral: string, unknown: string, suspect: string): ColorMode {
  console.log(civilian);
  console.log(friend);
  console.log(hostile);
  console.log(neutral);
  console.log(unknown);
  console.log(suspect);
  return {} as ColorMode;
}

export function getColorMode(mode: string): ColorMode {
  console.log(mode);
  return {} as ColorMode;
}

export function setColorMode(name: string, colormode: ColorMode): ColorMode {
  console.log(name);
  return colormode;
}

export function getHqStaffLength(): number {
  return 0;
}

export function setHqStaffLength(staff_length: number): number {
  return staff_length;
}

export function getDashArrays(): DashObject {
  return {} as DashObject;
}

export function setDashArrays(pending: string, anticipated: string, feintDummy: string): DashObject {
  console.log(pending);
  console.log(anticipated);
  console.log(feintDummy);
  return {} as DashObject;
}

export function getVersion(): string {
  return "1.0.0";
}

export function setStandard(standard: "2525" | "APP6"): boolean {
  console.log(standard);
  return true;
}

// Export all functions and constants as a default object
export default {
  Symbol,
  BBox,
  ColorMode,
  getColorMode,
  setColorMode,
  getHqStaffLength,
  setHqStaffLength,
  getDashArrays,
  setDashArrays,
  getVersion,
  setStandard,
  StandardIdentities,
  SymbolSets,
  StatusCodes,
  HQTFDummyIndicators,
  EchelonMobilityAmplifiers
};
