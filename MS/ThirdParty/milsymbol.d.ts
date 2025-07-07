declare global {
  interface Window {
    MS: MS;
  }
}

interface MS {
  version: string;
  autoSVG: boolean;
  _STD2525: boolean;
  
  // Core methods
  setStandard(standard: "2525" | "APP6"): boolean;
  buildingBlock(pre: any, post: any, bbox: any): any;
  
  // Dash arrays
  dashArrays: {
    pending: string;
    anticipated: string;
    feintDummy: string;
  };
  setDashArrays(pending: string, anticipated: string, feintDummy: string): any;
  getDashArrays(): any;
  
  // HQ Staff Length
  hqStafLength: number;
  getHqStafLength(): number;
  setHqStafLength(len: number): number;
  
  // Color modes
  getColorMode(mode: string): any;
  setColorMode(mode: string, colorMode: any): any;
  colorMode(civilian: string, friend: string, hostile: string, neutral: string, unknown: string): any;
  
  // Marker parts
  getMarkerParts(): any[];
  setMarkerParts(parts: any[]): void;
  addMarkerParts(parts: any): void;
  
  // Bounding box
  bbox(box?: any): any;
  bboxMax(box1: any, box2: any): any;
  
  // Transformations
  translate(x: number, y: number, instruction: any): any;
  scale(factor: number, instruction: any): any;
  rotate(angle: number, instruction: any): any;
  
  // Symbol generation
  symbol(sidc: string, options?: any): any;
  
  // Symbol prototype methods
  getProperties(): any;
  getColors(): any;
  getMarker(symbolObject: any): any;
  asDOM(): any;
  asImage(): any;
  asSVG(): string;
  asCanvas(): HTMLCanvasElement;
  setOptions(options: any): any;
  
  // Utility methods
  _Path2D(ctx: CanvasRenderingContext2D, d: string): void;
}

export {}; 