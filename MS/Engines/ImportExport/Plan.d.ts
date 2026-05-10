export interface PlanPoint {
    type: 'point';
    x: number;
    y: number;
    sp: string;
}
export interface PlanSymbolPK {
    plnOrdrId: number;
    plnOrdrSymbolId: string;
    plnOrdrOverlayId: string;
}
export interface PlanSymbol {
    plnOrdrSymbolPK: PlanSymbolPK;
    isDelete: 'N' | 'Y';
    isShared: 'N' | 'Y';
    creatorId: number;
    updateSeqnr: number;
    drawEss: string;
}
export interface PlanOverlayPK {
    plnOrdrId: number;
    plnOrdrOverlayId: string;
}
export interface PlanOverlay {
    plnOrdrOverlayPK: PlanOverlayPK;
    nameTxt: string;
    typeTxt: string;
    seqOrdr: number;
    hierarchyType: string;
    isDelete: 'N' | 'Y';
    isShared: 'N' | 'Y';
    creatorId: number;
    updateSeqnr: number;
    plnOrdrSymbolSet: PlanSymbol[];
}
export interface PlanHeaderContent {
    id: {
        plnOrdrId: number;
        plnOrdrHdrCntntIx: number;
    };
    nameTxt: string;
    nicknameTxt: string;
    serialNoTxt: string;
    sponsorTypeTxt: string;
    timeZoneCode: string;
    dttm: string;
    creatorId: number;
    updateSeqnr: number;
    placeOfIssueTxt: string;
}
export interface PlanStatus {
    id: {
        plnId: number;
        plnStatIx: number;
    };
    dvlpmStatCode: string;
    stateCode: string;
    dttm: string;
    creatorId: number;
    updateSeqnr: number;
}
export interface PlanEntry {
    plnId: number;
    catCode: string;
    subCatCode: string;
    creatorId: number;
    updateSeqnr: number;
    plnStats: PlanStatus[];
}
export interface PlanObject {
    plnOrdrId: number;
    catCode: string;
    creatorId: number;
    updateSeqnr: number;
    plns: PlanEntry[];
    ordrs: unknown[];
    plnOrdrHdrCntnts: PlanHeaderContent[];
    orgPoas: unknown[];
    plnOrdrOverlay: PlanOverlay[];
}
export interface PlanDocument {
    poObj: PlanObject;
}
export default class Plan {
    private static readonly LEGACY_LABEL_OPTIONS_DEFAULT;
    private static readonly LEGACY_AMPLIFIER_DEFAULT;
    private static readonly LEGACY_EXTRA_SETTINGS_DEFAULT;
    poObj: PlanObject;
    constructor(data?: Partial<PlanObject>);
    toJSON(): PlanDocument;
    setOverlays(overlays: PlanOverlay[]): void;
    addOverlay(overlay: PlanOverlay): void;
    static isPlanDocument(data: unknown): data is PlanDocument;
    static createOverlay(planId: number, overlayId: string, name: string, seqOrdr: number, symbols: PlanSymbol[], creatorId?: number): PlanOverlay;
    static createSymbol(planId: number, overlayId: string, symbolId: string, drawEss: string | Record<string, unknown>, creatorId?: number): PlanSymbol;
    static createDefaultObject(planId?: number): PlanObject;
    private static _toNumber;
    private static _toStringNumber;
    private static _clone;
    private static _ensureObject;
    private static _toPlanPointForExport;
    private static _normalizeLabelOptionsForExport;
    private static _normalizeAmplifierForExport;
    static normalizeDrawEssForLegacyExport(rawDrawEss: unknown): Record<string, unknown>;
    static normalizeDrawEssForRuntime(rawDrawEss: unknown): Record<string, unknown>;
}
