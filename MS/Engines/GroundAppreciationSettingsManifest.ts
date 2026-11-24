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
      { value: 'attk', label: 'Attack' },
      { value: 'wdr', label: 'Withdrawal' },
    ],
    help: 'The outline the document follows: the defence from the specimen AprDf, the attack from "Mechs of Aprc (Attk)", the withdrawal from OoW Vol III (its main decisions and factors). Changing it with words written asks first in the sheet; the sheet starts again (Undo brings it back) and is read again if it was read.',
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
  { path: ['groundAppreciation', 'obsn'], label: 'Read Obsn along each apch', group: 'Reading', type: 'boolean', help: 'The sight reading at three points along the home side of each approach, for its Obsn head (the mean, the spread and the worst place). A few seconds more on Read.' },
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
  { path: ['groundAppreciation', 'dDay'], label: 'D Day (date)', group: 'Reading', type: 'string', help: 'D Day as YYYY-MM-DD: first and last light and the moon (for an attack, Timing of Attk and the dark hours) are worked out for it. Empty takes today.' },
  { path: ['groundAppreciation', 'timeNow'], label: 'Time now (D-time)', group: 'Reading', type: 'string', help: 'Time now as a D-time (D-1 1000): the time available, the essential timings and more / less time run from it. Empty leaves them out.' },
  { path: ['groundAppreciation', 'utcOffsetH'], label: 'Time zone (hours from UTC)', group: 'Reading', type: 'number', min: -12, max: 14, step: 0.5, help: "First and last light and the read time are given in this zone: the place's, never the computer's. 5 is Pakistan Standard Time (PKT)." },
  { path: ['groundAppreciation', 'orbatUrl'], label: 'ORBAT url', group: 'Data', type: 'string', advanced: true, help: "Where the ORBAT is served: relative strength, the Pls held against the tasks, the engineers' mine laying. Missing: the strength is counted from the symbols." },
  { path: ['groundAppreciation', 'keep'], label: 'Keep in the browser', group: 'Document', type: 'boolean', advanced: true, help: 'Keep the document between sessions so your written paragraphs are not lost on a reload. Pictures are made again on Read.' },
];
