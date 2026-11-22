/**
 * GroundAppreciationSettingsManifest.ts
 *
 * Aprc: the appreciation of the situation drafted from the map and written out as Word, PDF and slides
 * (MS/Engines/GroundAppreciation). Off by default; it reads the terrain bundle only through the Ground Guide, on Read.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const groundAppreciationSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'groundAppreciation'],
    label: 'Aprc',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch. When on, the Aprc sheet drafts the appreciation of the situation from the ground (through the Ground Guide), the symbols on the map and the last Check my plan. What you write is yours and is never overwritten; proposals print only once accepted. Exports Word, PDF, text and Briefing slides.',
    keywords: ['aprc', 'appreciation', 'ground appreciation', 'gr and weather', 'apchs', 'deductions', 'export', 'word', 'docx', 'pdf', 'slides'],
  },
  {
    path: ['groundAppreciation', 'kind'],
    label: 'Kind',
    group: 'Document',
    type: 'enum',
    options: [
      { value: 'def', label: 'Defence' },
      { value: 'attk', label: 'Attack (no outline yet)' },
    ],
    help: 'The outline the document follows. The attack has its place but no outline until its specimen is added; it falls back to the defence.',
  },
  {
    path: ['groundAppreciation', 'copy'],
    label: 'Copy',
    group: 'Document',
    type: 'enum',
    options: [
      { value: 'fair', label: 'Fair copy' },
      { value: 'draft', label: 'Draft copy' },
    ],
    help: 'Fair: what goes up; a paragraph not written and a proposal not accepted print a ruled line. Draft: with a mark on each paragraph, proposals shown, and the basis, data and Confirm on Gr annexes.',
  },
  {
    path: ['groundAppreciation', 'figures'],
    label: 'Figures',
    group: 'Document',
    type: 'enum',
    options: [
      { value: 'both', label: 'Trace and map shot' },
      { value: 'trace', label: 'Trace only' },
      { value: 'map', label: 'Map shot only' },
    ],
    help: 'The trace is drawn from the reading (sharp at any size, no basemap). The map shot is the map as on screen when read, with the symbols.',
  },
  {
    path: ['groundAppreciation', 'deck'],
    label: 'Deck',
    group: 'Slides',
    type: 'enum',
    options: [
      { value: 'full', label: 'Full brief' },
      { value: 'decision', label: 'Decision brief' },
      { value: 'sand', label: 'Sand model' },
    ],
    help: 'Which slides Make slides writes into the Briefing module. Slides you edited are kept on a refresh.',
  },
  { path: ['groundAppreciation', 'obsn'], label: 'Read Obsn along each apch', group: 'Reading', type: 'boolean', help: 'The sight reading at one point on each approach, for its Obsn head. A few seconds more on Read.' },
  {
    path: ['groundAppreciation', 'echelon'],
    label: 'Echelon',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'auto', label: 'From the symbol' },
      { value: 'coy', label: 'Coy' },
      { value: 'bn', label: 'Bn' },
      { value: 'bde', label: 'Bde' },
    ],
    help: 'The size of the AOR frame and of the corridor taken for the threat when no Bdy symbols are drawn.',
  },
  {
    path: ['groundAppreciation', 'mover'],
    label: 'Mover',
    group: 'Reading',
    type: 'enum',
    options: [
      { value: 'auto', label: 'As the Gr Scope AOR' },
      { value: 'tracked', label: 'Tracked' },
      { value: 'wheeled', label: 'Wheeled' },
      { value: 'dismounted', label: 'Dismounted' },
    ],
    help: 'The going is read for this mover.',
  },
  { path: ['groundAppreciation', 'hHour'], label: 'H on D Day (HH:MM)', group: 'Reading', type: 'string', help: "H as a clock time: the en's times in his options and the reactions table get clock times beside H+ (0740 hrs D Day). Empty takes the Ground Guide's IPB H, else H+ only." },
  { path: ['groundAppreciation', 'orbatUrl'], label: 'ORBAT url', group: 'Data', type: 'string', advanced: true, help: "Where the ORBAT is served: relative strength, the Pls held against the tasks, the engineers' mine laying. Missing: the strength is counted from the symbols." },
  { path: ['groundAppreciation', 'keep'], label: 'Keep in the browser', group: 'Document', type: 'boolean', advanced: true, help: 'Keep the document between sessions so your written paragraphs are not lost on a reload. Pictures are made again on Read.' },
];
