declare namespace ms {
    interface SymbolOptions {
        sidc?: string;
        size?: number;
        color?: string;
        frame?: boolean;
        fill?: boolean;
        strokeWidth?: number;
        [key: string]: any;
    }

    interface SymbolSize {
        width: number;
        height: number;
    }

    interface Symbol {
        asCanvas(): HTMLCanvasElement;
        asSVG(): string;
        getSize(): SymbolSize;
        getAnchor(): { x: number; y: number };
    }

    function Symbol(sidc: string, options?: SymbolOptions): Symbol;
    
    // Additional utility functions
    function getSymbolParts(sidc: string): any;
    function getSymbolMetadata(sidc: string): any;
}

declare const ms: typeof ms; 