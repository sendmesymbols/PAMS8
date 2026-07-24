/**
 * PptxExportCommands.ts
 *
 * Self-registration for the PowerPoint deck exporter. The exporter is
 * dynamically imported on first use (keeping pptxgenjs out of the main
 * bundle), so this module only registers Ctrl+K actions and a global helper
 * (`window.exportPptxDeck`) that the top-bar / API-panel buttons call.
 *
 * Side-effect import from SymbolEngine.ts makes it discoverable on load.
 */

import { CommandPalette } from '../Support/CommandPalette';
import type { PptxExportOptions } from './ImportExport/PptxExporter';

export async function exportPptxDeck(options?: PptxExportOptions): Promise<void> {
  const { default: PptxExporter } = await import('./ImportExport/PptxExporter');
  return PptxExporter.getInstance().exportDeck(options);
}

if (typeof window !== 'undefined') {
  (window as any).exportPptxDeck = exportPptxDeck;
}

CommandPalette.registerActions([
  {
    id: 'export.pptx',
    label: 'Export PowerPoint deck (.pptx)',
    hint: 'One slide per briefing slide (or the current view) — flat screenshots',
    keywords: ['pptx', 'powerpoint', 'export', 'deck', 'briefing', 'slides', 'presentation'],
    run: () => {
      void exportPptxDeck().catch((err) => console.error('[PptxExporter]', err));
    },
  },
  {
    id: 'export.pptx.builds',
    label: 'Export PowerPoint deck — explode builds',
    hint: 'One slide per staged-reveal build step',
    keywords: ['pptx', 'powerpoint', 'export', 'builds', 'staged', 'reveal', 'explode'],
    run: () => {
      void exportPptxDeck({ explodeBuilds: true }).catch((err) =>
        console.error('[PptxExporter]', err),
      );
    },
  },
  {
    id: 'export.pptx.editable',
    label: 'Export PowerPoint deck — editable shapes (Mode B)',
    hint: 'Lines / areas / text become selectable PowerPoint objects over the map raster — exact in 2D, approximate in 3D',
    keywords: ['pptx', 'powerpoint', 'export', 'editable', 'shapes', 'native', 'vector', 'mode b'],
    run: () => {
      void exportPptxDeck({ mode: 'editable' }).catch((err) =>
        console.error('[PptxExporter]', err),
      );
    },
  },
  {
    id: 'import.pptx',
    label: 'Import PowerPoint deck (.pptx) into Briefing',
    hint: 'Text, shapes, pictures, tables and notes become editable briefing slides (appended)',
    keywords: ['pptx', 'powerpoint', 'import', 'open', 'deck', 'briefing', 'slides'],
    run: () => {
      const be = (window as any).briefingEngine;
      if (be?.importPptxFromFile) {
        be.importPptxFromFile();
      } else {
        console.warn('[PptxImporter] Briefing engine not ready — enable features.briefing in Settings');
      }
    },
  },
]);

export default exportPptxDeck;
