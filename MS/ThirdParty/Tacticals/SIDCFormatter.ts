import { SIDC_POSITIONS } from './constants';
import type { SIDC, SymbolOptions } from './types';

export class SIDCFormatter {
    /**
     * Parameterizes a SIDC by replacing variable parts with asterisks
     * E.g. 'GFGPOAO----****' (15) => 'G*G*OAO---' (10)
     */
    static parameterize(sidc: string): string | null {
        if (!sidc) return null;
        return `${sidc[0]}*${sidc[2]}*${sidc.substring(4, 10)}`;
    }

    static getSchemaCode(sidc: string): string | null {
        if (!sidc) return null;
        return sidc[SIDC_POSITIONS.SCHEMA];
    }

    static getBattleDimensionCode(sidc: string): string | null {
        if (!sidc) return null;
        return sidc[SIDC_POSITIONS.BATTLE_DIMENSION];
    }

    static getIdentityCode(sidc: string): string {
        if (!sidc) return 'U';
        return sidc[SIDC_POSITIONS.IDENTITY];
    }

    static getStatusCode(sidc: string): string {
        if (!sidc) return 'P';
        return sidc[SIDC_POSITIONS.STATUS];
    }

    static getFunctionIdCode(sidc: string): string | null {
        if (!sidc) return null;
        return sidc.substring(SIDC_POSITIONS.FUNCTION_ID, SIDC_POSITIONS.FUNCTION_ID + 6);
    }

    static getModifierCode(sidc: string): string {
        if (!sidc) return '-';
        return sidc[SIDC_POSITIONS.MODIFIER];
    }

    static getEchelonCode(sidc: string): string {
        if (!sidc) return '-';
        return sidc[SIDC_POSITIONS.ECHELON];
    }

    static getMobilityCode(sidc: string): string {
        if (!sidc) return '--';
        return sidc[SIDC_POSITIONS.MOBILITY] + sidc[SIDC_POSITIONS.MOBILITY + 1];
    }

    static parseSIDC(sidc: string): SIDC {
        return {
            schema: this.getSchemaCode(sidc) || '',
            identity: this.getIdentityCode(sidc),
            battleDimension: this.getBattleDimensionCode(sidc) || '',
            status: this.getStatusCode(sidc),
            functionId: this.getFunctionIdCode(sidc) || '',
            modifier: this.getModifierCode(sidc),
            echelon: this.getEchelonCode(sidc),
            mobility: this.getMobilityCode(sidc)
        };
    }

    static format(sidc: string, options: Partial<SymbolOptions>): string {
        if (!sidc) return '';

        let formatted = sidc;
        if (options.schema) {
            formatted = options.schema + formatted.substring(SIDC_POSITIONS.SCHEMA + 1);
        }
        if (options.identity) {
            formatted = formatted.substring(0, SIDC_POSITIONS.IDENTITY) + 
                       options.identity + 
                       formatted.substring(SIDC_POSITIONS.IDENTITY + 1);
        }
        if (options.battleDimension) {
            formatted = formatted.substring(0, SIDC_POSITIONS.BATTLE_DIMENSION) + 
                       options.battleDimension + 
                       formatted.substring(SIDC_POSITIONS.BATTLE_DIMENSION + 1);
        }
        if (options.status) {
            formatted = formatted.substring(0, SIDC_POSITIONS.STATUS) + 
                       options.status + 
                       formatted.substring(SIDC_POSITIONS.STATUS + 1);
        }
        if (options.modifier) {
            formatted = formatted.substring(0, SIDC_POSITIONS.MODIFIER) + 
                       options.modifier + 
                       formatted.substring(SIDC_POSITIONS.MODIFIER + 1);
        }
        if (options.echelon) {
            formatted = formatted.substring(0, SIDC_POSITIONS.ECHELON) + 
                       options.echelon + 
                       formatted.substring(SIDC_POSITIONS.ECHELON + 1);
        }
        if (options.mobility) {
            formatted = formatted.substring(0, SIDC_POSITIONS.MOBILITY) + 
                       options.mobility + 
                       formatted.substring(SIDC_POSITIONS.MOBILITY + 2);
        }
        return formatted;
    }
}
