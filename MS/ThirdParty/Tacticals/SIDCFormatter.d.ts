import type { SIDC, SymbolOptions } from './types';
export declare class SIDCFormatter {
    /**
     * Parameterizes a SIDC by replacing variable parts with asterisks
     * E.g. 'GFGPOAO----****' (15) => 'G*G*OAO---' (10)
     */
    static parameterize(sidc: string): string | null;
    static getSchemaCode(sidc: string): string | null;
    static getBattleDimensionCode(sidc: string): string | null;
    static getIdentityCode(sidc: string): string;
    static getStatusCode(sidc: string): string;
    static getFunctionIdCode(sidc: string): string | null;
    static getModifierCode(sidc: string): string;
    static getEchelonCode(sidc: string): string;
    static getMobilityCode(sidc: string): string;
    static parseSIDC(sidc: string): SIDC;
    static format(sidc: string, options: Partial<SymbolOptions>): string;
}
