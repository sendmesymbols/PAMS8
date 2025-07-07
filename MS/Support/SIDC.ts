import Color from "@arcgis/core/Color";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import Settings from "../Data/Settings.json";

/**
 * Interface for standard identity configuration
 */
interface StandardIdentityConfig {
    Style: string;
    Color: Color;
}

/**
 * Interface for standard identity from settings
 */
interface StandardIdentitySetting {
    [key: string]: string;
    Name: string;
}

/**
 * SIDC (Symbol Identification Coding Scheme) class for military symbology
 * Handles SIDC parsing, validation, and symbol generation
 */
export class SIDC {
    private _sidc: string;
    public symbolThickness: number = 0;

    // Standard identities configuration
    public standardIdentities: StandardIdentityConfig[][] = [
        [{"Style": "dash", "Color": new Color([255, 255, 0])}], // 00 - Pending
        [{"Style": "solid", "Color": new Color([255, 255, 0])}], // 01 - Unknown
        [{"Style": "dash", "Color": new Color([0, 51, 204])}], // 02 - Assumed Friend
        [{"Style": "solid", "Color": new Color([0, 51, 204])}], // 03 - Friend
        [{"Style": "solid", "Color": new Color([0, 226, 0])}], // 04 - Neutral
        [{"Style": "dash", "Color": new Color([255, 48, 49])}], // 05 - Suspect Joker
        [{"Style": "solid", "Color": new Color([255, 48, 49])}], // 06 - Hostile Faker
        [{"Style": "solid", "Color": new Color([255, 0, 0])}], // 07 - Red
        [{"Style": "solid", "Color": new Color([34, 139, 34])}], // 08 - Green
        [{"Style": "solid", "Color": new Color([0, 0, 255])}], // 09 - Blue
        [{"Style": "solid", "Color": new Color([0, 0, 0])}], // 10 - Black
        [{"Style": "solid", "Color": new Color([128, 0, 128])}], // 11 - Purple
        [{"Style": "solid", "Color": new Color([255, 255, 0])}], // 12 - Yellow
        [{"Style": "solid", "Color": new Color([255, 0, 255])}], // 13 - Magenta
        [{"Style": "solid", "Color": new Color([165, 42, 42])}], // 14 - Light Brown
        [{"Style": "solid", "Color": new Color([0, 226, 0])}], // 15 - Olive Green
        [{"Style": "solid", "Color": new Color([255, 69, 0])}], // 16 - Orange
        [{"Style": "solid", "Color": new Color([128, 128, 128])}], // 17 - Gray
        [{"Style": "solid", "Color": new Color([128, 128, 0])}], // 18 - Olive
        [{"Style": "solid", "Color": new Color([0, 0, 128])}], // 19 - Navy
        [{"Style": "solid", "Color": new Color([0, 255, 0])}], // 20 - Lime
        [{"Style": "solid", "Color": new Color([0, 255, 255])}], // 21 - Cyan
        [{"Style": "solid", "Color": new Color([255, 228, 196])}], // 22 - Bisque
        [{"Style": "solid", "Color": new Color([139, 69, 19])}], // 23 - Dark Brown
        [{"Style": "solid", "Color": new Color([0, 206, 209])}], // 24 - Turquoise
        [{"Style": "solid", "Color": new Color([148, 0, 211])}] // 25 - Dark Violet
    ];

    constructor(sidc: string) {
        this._sidc = sidc;
    }

    /**
     * Validate SIDC format
     * @param sidc The SIDC string to validate
     * @returns True if SIDC is valid (20 characters)
     */
    public validateSIDC(sidc: string): boolean {
        return sidc.length === 20;
    }

    /**
     * Get the SID (Symbol Identification) part of the SIDC
     * @returns SID substring (positions 10-16)
     */
    public getSID(): string {
        return this._sidc.substring(10, 16);
    }

    /**
     * Get the identity part of the SIDC
     * @returns Identity substring (positions 2-4)
     */
    public getIdentity(): string {
        return this._sidc.substring(2, 4);
    }

    /**
     * Get the status from the SIDC
     * @returns Status character (position 6)
     */
    public getStatus(): string {
        return this.getSIDC()[6];
    }

    /**
     * Get the complete SIDC string
     * @returns The full SIDC string
     */
    public getSIDC(): string {
        return this._sidc;
    }

    /**
     * Get the height setting
     * @returns Height value from settings
     */
    public getHeight(): number {
        return Settings.size || 25;
    }

    /**
     * Get the width setting
     * @returns Width value from settings
     */
    public getWidth(): number {
        return Settings.size || 25;
    }

    /**
     * Generate a marker symbol based on SIDC and parameters
     * @param symGeometricType The geometric type (Point, Line, Area)
     * @param isObs Whether this is an obstacle (optional)
     * @param fill Whether to fill the symbol (optional)
     * @returns The generated symbol
     */
    public getMarker(symGeometricType: string, isObs?: string, fill?: string): SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol {
        let style: string;
        
        // Determine style based on status
        if (this.getStatus() === '1') {
            style = this.standardIdentities[0][0].Style;
        } else {
            const identityIndex = Number(this.getIdentity());
            style = this.standardIdentities[identityIndex][0].Style;
        }

        // Handle Area or Line symbols
        if (symGeometricType === "Area" || symGeometricType === "Line") {
            let color: Color;
            
            if (isObs !== undefined && isObs === "1") {
                // Obstacle color (neutral)
                color = new Color(JSON.parse(Settings.standardIdentities[4]['04'] || "[64, 135, 64]"));
            } else {
                // Standard identity color
                const identityIndex = Number(this.getIdentity());
                const identityKey = this.getIdentity();
                const colorString = Settings.standardIdentities[identityIndex]?.[identityKey] || "[0, 51, 204]";
                color = new Color(JSON.parse(colorString));
            }

            return new SimpleLineSymbol({
                style: style as any,
                color: color,
                width: Settings.lineWidth
            });
        } 
        // Handle Point symbols
        else if (symGeometricType === "Point") {
            const identityIndex = Number(this.getIdentity());
            const identityKey = this.getIdentity();
            const colorString = Settings.standardIdentities[identityIndex]?.[identityKey] || "[0, 51, 204]";
            const color = new Color(JSON.parse(colorString));
            
            // Create outline
            const outline = new SimpleLineSymbol({
                style: style as any,
                color: color,
                width: Settings.PtlineWidth
            });

            // Create marker symbol
            const markerSymbol = new SimpleMarkerSymbol({
                size: Settings.size,
                outline: outline
            });

            // Apply fill if specified
            if (fill !== undefined && fill === "1") {
                markerSymbol.color = color;
            }

            return markerSymbol;
        }

        // Default fallback
        return new SimpleMarkerSymbol();
    }

    /**
     * Set a new SIDC value
     * @param sidc The new SIDC string
     */
    public setSIDC(sidc: string): void {
        this._sidc = sidc;
    }

    /**
     * Get the identity index as a number
     * @returns The identity index
     */
    public getIdentityIndex(): number {
        return Number(this.getIdentity());
    }

    /**
     * Check if the SIDC represents a pending status
     * @returns True if status is pending
     */
    public isPending(): boolean {
        return this.getStatus() === '1';
    }

    /**
     * Get the color for the current identity
     * @returns The color for the current identity
     */
    public getIdentityColor(): Color {
        const identityIndex = this.getIdentityIndex();
        return this.standardIdentities[identityIndex][0].Color;
    }
}

export default SIDC; 