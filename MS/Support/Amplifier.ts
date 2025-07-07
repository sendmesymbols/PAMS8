/**
 * Amplifier class for military symbology
 * Handles symbol amplification and additional information display
 */
export class Amplifier {
    // Symbol identification
    public SYMBOL_ICON: string = "";
    public ECHELON: string = "";
    public QUANTITY: string = "";
    public HOSTILE: string = "";
    
    // Point-specific indicators
    public DIR_OF_MOV_INDICATOR: string = ""; // ONLY FOR PTS
    public OFFSET_LOC_INDICATOR: string = ""; // ONLY FOR PTS
    
    // Designation and type
    public UNIQUE_DESIG: string = "";
    public TYPE: string = "";
    
    // Date-time information
    public DTG: string = "";
    public EDTG: string = "";
    public SIZE?: number = undefined;

    
    /**
     * An alphanumeric designator for displaying a date-time group (DDHHMMSSZMONYYYY) 
     * or "O/O" for on order. The date-time group is composed of a group of six numeric 
     * digits with a time zone suffix and the standardized three-letter abbreviation for 
     * the month followed by four digits. The first pair of digits represents the day, 
     * the second pair, the hour, the third pair, the minutes. The last four digits after 
     * the month are the year. For automated systems, two digits may be added before the 
     * time zone suffix and after the minutes to designate seconds.
     */
    public ALTITUDE_DEPTH: string = "";
    public SIDC : string = "";
    // Location and positioning
    public LOC: string = "";
    public DISTANCE: string = "";
    public AZIMUTH: string = "";
    
    // Target and organizational information
    public TARGET_DESIGNATOR: string = "";
    public COUNTRY: string = "";
    public HIGHER_FORM: string = "";
    
    // Additional information
    public STAFF_COM: string = "";
    public ADDL_INFO: string = "";

    constructor(sidc?: string, options?: Partial<Amplifier>) {
        if (options) {
            Object.assign(this, options);
        }
    }

    /**
     * Reset all properties to default values
     */
    public reset(): void {
        this.SYMBOL_ICON = "";
        this.ECHELON = "";
        this.QUANTITY = "";
        this.HOSTILE = "";
        this.DIR_OF_MOV_INDICATOR = "";
        this.OFFSET_LOC_INDICATOR = "";
        this.UNIQUE_DESIG = "";
        this.TYPE = "";
        this.DTG = "";
        this.EDTG = "";
        this.ALTITUDE_DEPTH = "";
        this.LOC = "";
        this.DISTANCE = "";
        this.AZIMUTH = "";
        this.TARGET_DESIGNATOR = "";
        this.COUNTRY = "";
        this.HIGHER_FORM = "";
        this.STAFF_COM = "";
        this.ADDL_INFO = "";
        this.SIZE = undefined;
        this.SIDC = "";
    }

    /**
     * Clone the current Amplifier instance
     */
    public clone(): Amplifier {
        return new Amplifier(undefined, {
            SYMBOL_ICON: this.SYMBOL_ICON,
            ECHELON: this.ECHELON,
            QUANTITY: this.QUANTITY,
            HOSTILE: this.HOSTILE,
            DIR_OF_MOV_INDICATOR: this.DIR_OF_MOV_INDICATOR,
            OFFSET_LOC_INDICATOR: this.OFFSET_LOC_INDICATOR,
            UNIQUE_DESIG: this.UNIQUE_DESIG,
            TYPE: this.TYPE,
            DTG: this.DTG,
            EDTG: this.EDTG,
            ALTITUDE_DEPTH: this.ALTITUDE_DEPTH,
            LOC: this.LOC,
            DISTANCE: this.DISTANCE,
            AZIMUTH: this.AZIMUTH,
            TARGET_DESIGNATOR: this.TARGET_DESIGNATOR,
            COUNTRY: this.COUNTRY,
            HIGHER_FORM: this.HIGHER_FORM,
            STAFF_COM: this.STAFF_COM,
            ADDL_INFO: this.ADDL_INFO,
            SIZE: this.SIZE,
            SIDC: this.SIDC,
        });
    }

    /**
     * Check if the amplifier has any meaningful data
     */
    public hasData(): boolean {
        return !!(this.SYMBOL_ICON || this.ECHELON || this.QUANTITY || this.HOSTILE ||
                 this.DIR_OF_MOV_INDICATOR || this.OFFSET_LOC_INDICATOR || this.UNIQUE_DESIG ||
                 this.TYPE || this.DTG || this.EDTG || this.ALTITUDE_DEPTH || this.LOC ||
                 this.DISTANCE || this.AZIMUTH || this.TARGET_DESIGNATOR || this.COUNTRY ||
                 this.HIGHER_FORM || this.STAFF_COM || this.ADDL_INFO || this.SIZE || this.SIDC);
    }

    /**
     * Get all non-empty properties as an object
     */
    public getNonEmptyProperties(): Record<string, string> {
        const result: Record<string, string> = {};
        
        Object.entries(this).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim() !== '') {
                result[key] = value;
            }
        });
        
        return result;
    }

    /**
     * Set multiple properties at once
     */
    public setProperties(properties: Partial<Amplifier>): void {
        Object.assign(this, properties);
    }

    public getEchelon(sidc: string): string {
        if (sidc != undefined) {
            return sidc.substr(8, 2);
        } else {
            throw "SIDC not found";
        }
    }

    /**
     * Get a formatted string representation of the amplifier data
     */
    public toString(): string {
        const nonEmptyProps = this.getNonEmptyProperties();
        return Object.entries(nonEmptyProps)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
    }
}

export default Amplifier; 