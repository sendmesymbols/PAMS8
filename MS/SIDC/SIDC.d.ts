import { SymbolOptions } from "../ThirdParty/MilSymbols/UEITypes.ts";
export interface SIDCSetA {
    version: string;
    standardIdentity: string;
    standardIdentityLabel?: string;
    symbolSet: string;
    symbolSetLabel?: string;
    status: string;
    statusLabel?: string;
    hqTaskForceDummy: string;
    hqTaskForceDummyLabel?: string;
    echelonMobility: string;
    echelonMobilityLabel?: string;
    entity: string;
}
export interface SIDCSetB {
    entityType: string;
    entitySubType: string;
    modifier1: string;
    modifier2: string;
    countryCode: string;
}
export interface SIDCSetC {
    symbologyOriginatorId: string;
    originatorSymbolSet: string;
    originatorExtension: string;
}
export interface ParsedSIDC {
    raw: string;
    setA: SIDCSetA;
    setB: SIDCSetB;
    setC?: SIDCSetC;
}
export declare function parseSIDC(sidc: string): ParsedSIDC;
export declare function enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
    parsedSIDC?: ParsedSIDC;
    label?: string;
    text?: string;
};
