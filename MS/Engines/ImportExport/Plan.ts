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
  public poObj: PlanObject;

  constructor(data?: Partial<PlanObject>) {
    const base = Plan.createDefaultObject();
    this.poObj = {
      ...base,
      ...data,
      plns: data?.plns ?? base.plns,
      ordrs: data?.ordrs ?? base.ordrs,
      plnOrdrHdrCntnts: data?.plnOrdrHdrCntnts ?? base.plnOrdrHdrCntnts,
      orgPoas: data?.orgPoas ?? base.orgPoas,
      plnOrdrOverlay: data?.plnOrdrOverlay ?? base.plnOrdrOverlay,
    };
  }

  public toJSON(): PlanDocument {
    return { poObj: this.poObj };
  }

  public setOverlays(overlays: PlanOverlay[]): void {
    this.poObj.plnOrdrOverlay = overlays;
  }

  public addOverlay(overlay: PlanOverlay): void {
    this.poObj.plnOrdrOverlay.push(overlay);
  }

  public static isPlanDocument(data: unknown): data is PlanDocument {
    const doc = data as PlanDocument;
    return !!doc?.poObj && Array.isArray(doc.poObj.plnOrdrOverlay);
  }

  public static createOverlay(
    planId: number,
    overlayId: string,
    name: string,
    seqOrdr: number,
    symbols: PlanSymbol[],
    creatorId = 10900,
  ): PlanOverlay {
    return {
      plnOrdrOverlayPK: {
        plnOrdrId: planId,
        plnOrdrOverlayId: overlayId,
      },
      nameTxt: name,
      typeTxt: name,
      seqOrdr,
      hierarchyType: 'Simple Overlay',
      isDelete: 'N',
      isShared: 'N',
      creatorId,
      updateSeqnr: 1,
      plnOrdrSymbolSet: symbols,
    };
  }

  public static createSymbol(
    planId: number,
    overlayId: string,
    symbolId: string,
    drawEss: string,
    creatorId = 10900,
  ): PlanSymbol {
    return {
      plnOrdrSymbolPK: {
        plnOrdrId: planId,
        plnOrdrSymbolId: symbolId,
        plnOrdrOverlayId: overlayId,
      },
      isDelete: 'N',
      isShared: 'N',
      creatorId,
      updateSeqnr: 1,
      drawEss,
    };
  }

  public static createDefaultObject(planId?: number): PlanObject {
    const resolvedPlanId = planId ?? Date.now();
    const now = new Date();
    const pad = (n: number, l = 2) => `${n}`.padStart(l, '0');
    const dttm =
      `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
      `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}000 `;

    return {
      plnOrdrId: resolvedPlanId,
      catCode: 'PLAN',
      creatorId: 10900,
      updateSeqnr: 1,
      plns: [
        {
          plnId: resolvedPlanId,
          catCode: 'OPLAN',
          subCatCode: 'Def',
          creatorId: 10900,
          updateSeqnr: 1,
          plnStats: [
            {
              id: {
                plnId: resolvedPlanId,
                plnStatIx: 1,
              },
              dvlpmStatCode: 'NCOMPL',
              stateCode: 'DRAFT',
              dttm,
              creatorId: 10900,
              updateSeqnr: 1,
            },
          ],
        },
      ],
      ordrs: [],
      plnOrdrHdrCntnts: [
        {
          id: {
            plnOrdrId: resolvedPlanId,
            plnOrdrHdrCntntIx: 1,
          },
          nameTxt: 'Sample Name',
          nicknameTxt: 'Plan',
          serialNoTxt: '11-00',
          sponsorTypeTxt: 'SPO',
          timeZoneCode: 'Z',
          dttm,
          creatorId: 10900,
          updateSeqnr: 1,
          placeOfIssueTxt: 'Office',
        },
      ],
      orgPoas: [],
      plnOrdrOverlay: [],
    };
  }
}
