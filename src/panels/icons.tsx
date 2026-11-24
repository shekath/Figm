// Small original stroke icon set (16px grid).
import React from 'react';

const I = (d: React.ReactNode) =>
  function Icon({ size = 16 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        {d}
      </svg>
    );
  };

export const Icons = {
  move: I(<path d="M3 2 L12 8 L8 9 L6 13 Z" fill="currentColor" stroke="none" />),
  frame: I(<path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13" />),
  section: I(<><rect x="2" y="4" width="12" height="10" rx="1.5" /><path d="M2 4V2.5h6V4" /></>),
  rect: I(<rect x="2.5" y="2.5" width="11" height="11" rx="1" />),
  ellipse: I(<circle cx="8" cy="8" r="5.5" />),
  polygon: I(<path d="M8 2.5 L14 13 H2 Z" />),
  star: I(<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" />),
  line: I(<path d="M3 13 L13 3" />),
  arrow: I(<><path d="M3 13 L13 3" /><path d="M7 3h6v6" /></>),
  pen: I(<><path d="M8 1.8 L12.5 9 L8 14.2 L3.5 9 Z" /><circle cx="8" cy="9" r="1.2" /></>),
  pencil: I(<path d="M2.5 13.5 L3.2 10.6 L11 2.8 L13.2 5 L5.4 12.8 Z" />),
  text: I(<path d="M3 3.5h10M8 3.5v10M6 13.5h4" />),
  image: I(<><rect x="2" y="3" width="12" height="10" rx="1" /><circle cx="6" cy="6.5" r="1.2" /><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" /></>),
  hand: I(<path d="M5 8V3.5a1 1 0 0 1 2 0V7m0-4.5a1 1 0 0 1 2 0V7m0-3.5a1 1 0 0 1 2 0V8m0-2a1 1 0 0 1 2 0v4a4 4 0 0 1-4 4H8a4 4 0 0 1-3.5-2L3 9.5a1 1 0 0 1 1.7-1L5 9" />),
  comment: I(<path d="M2.5 13.5V4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v6A1.5 1.5 0 0 1 12 11.5H5Z" />),
  component: I(<path d="M8 1.5l2.5 2.5L8 6.5 5.5 4Zm0 8l2.5 2.5L8 14.5 5.5 12ZM4 5.5 6.5 8 4 10.5 1.5 8Zm8 0L14.5 8 12 10.5 9.5 8Z" />),
  instance: I(<path d="M8 2l6 6-6 6-6-6Z" />),
  group: I(<><rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="2 2" /></>),
  vector: I(<><path d="M3 12c2-8 8-8 10 0" /><circle cx="3" cy="12" r="1" /><circle cx="13" cy="12" r="1" /></>),
  eye: I(<><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></>),
  eyeOff: I(<><path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M4.2 5.3C2.6 6.5 1.5 8 1.5 8S4 12.5 8 12.5c1 0 2-.3 2.8-.7" /></>),
  lock: I(<><rect x="3.5" y="7" width="9" height="7" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>),
  unlock: I(<><rect x="3.5" y="7" width="9" height="7" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0" /></>),
  plus: I(<path d="M8 3v10M3 8h10" />),
  minus: I(<path d="M3 8h10" />),
  trash: I(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />),
  chevron: I(<path d="M6 4l4 4-4 4" />),
  chevronDown: I(<path d="M4 6l4 4 4-4" />),
  play: I(<path d="M5 3l8 5-8 5Z" fill="currentColor" />),
  menu: I(<path d="M2.5 4h11M2.5 8h11M2.5 12h11" />),
  alignLeft: I(<><path d="M2 2v12" /><rect x="4" y="4" width="8" height="3" /><rect x="4" y="9" width="5" height="3" /></>),
  alignHCenter: I(<><path d="M8 2v12" /><rect x="3" y="4" width="10" height="3" /><rect x="5" y="9" width="6" height="3" /></>),
  alignRight: I(<><path d="M14 2v12" /><rect x="4" y="4" width="8" height="3" /><rect x="7" y="9" width="5" height="3" /></>),
  alignTop: I(<><path d="M2 2h12" /><rect x="4" y="4" width="3" height="8" /><rect x="9" y="4" width="3" height="5" /></>),
  alignVCenter: I(<><path d="M2 8h12" /><rect x="4" y="3" width="3" height="10" /><rect x="9" y="5" width="3" height="6" /></>),
  alignBottom: I(<><path d="M2 14h12" /><rect x="4" y="4" width="3" height="8" /><rect x="9" y="7" width="3" height="5" /></>),
  distH: I(<><path d="M2 2v12M14 2v12" /><rect x="6" y="5" width="4" height="6" /></>),
  distV: I(<><path d="M2 2h12M2 14h12" /><rect x="5" y="6" width="6" height="4" /></>),
  flipH: I(<path d="M8 2v12M6 4L2 12h4ZM10 4l4 8h-4Z" />),
  flipV: I(<path d="M2 8h12M4 6l8-4v4ZM4 10l8 4v-4Z" />),
  autoH: I(<><rect x="2" y="5" width="3" height="6" /><rect x="6.5" y="5" width="3" height="6" /><rect x="11" y="5" width="3" height="6" /></>),
  autoV: I(<><rect x="5" y="2" width="6" height="3" /><rect x="5" y="6.5" width="6" height="3" /><rect x="5" y="11" width="6" height="3" /></>),
  link: I(<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />),
  code: I(<path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4" />),
  undo: I(<path d="M5 3L2 6l3 3M2 6h7a4 4 0 0 1 0 8H6" />),
  redo: I(<path d="M11 3l3 3-3 3M14 6H7a4 4 0 0 0 0 8h3" />),
  download: I(<path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />),
  home: I(<path d="M2.5 7.5L8 2.5l5.5 5V14h-4v-4h-3v4h-4Z" />),
  boolean: I(<><rect x="2" y="2" width="8" height="8" /><rect x="6" y="6" width="8" height="8" /></>),
  mask: I(<><circle cx="6" cy="8" r="4.5" /><circle cx="10" cy="8" r="4.5" /></>),
  clip: I(<><path d="M4 1.5v10.5h10.5" /><path d="M1.5 4H12v10.5" /></>),
  grid: I(<path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" />),
  sun: I(<><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></>),
  moon: I(<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z" />),
  close: I(<path d="M4 4l8 8M12 4l-8 8" />),
  page: I(<><path d="M4 1.5h5.5L12.5 4.5V14.5H4Z" /><path d="M9.5 1.5v3h3" /></>),
  style: I(<><circle cx="5" cy="5" r="2.5" /><circle cx="11" cy="5" r="2.5" /><circle cx="8" cy="11" r="2.5" /></>),
  variable: I(<path d="M4 3c-2 3-2 7 0 10M12 3c2 3 2 7 0 10M6 6l4 4M10 6l-4 4" />),
  history: I(<><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7" /><path d="M2.5 2.5v3.2h3.2M8 5v3l2 1.5" /></>),
  search: I(<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>),
  settings: I(<><path d="M3 4.5h10M3 11.5h10" /><circle cx="6" cy="4.5" r="1.6" /><circle cx="10" cy="11.5" r="1.6" /></>),
  padSides: I(<><rect x="3" y="3" width="10" height="10" rx="1" /><path d="M3 6h10M3 10h10M6 3v10M10 3v10" opacity=".5" /></>),
  plugins: I(<><circle cx="4.5" cy="4.5" r="2.2" /><circle cx="11.5" cy="4.5" r="2.2" /><circle cx="4.5" cy="11.5" r="2.2" /><path d="M11.5 9v5M9 11.5h5" /></>),
  brush: I(<><path d="M10.5 2.5l3 3-5 5-3-3z" /><path d="M5.5 8.5c-2 0-3 1.5-3 3.5 0 .8-.5 1.5-1 1.5 2 1 5 .5 5.5-2z" /></>),
  drawMode: I(<path d="M2.5 11c2-5 3.5-7 5-7s-1 6 1 6 2.5-4 3.5-4-.5 4 1.5 4" />),
  designMode: I(<><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M6 6.5l4.5 1.6-1.9.6-.6 1.9z" /></>),
  motion: I(<><path d="M8 2.5 13.5 8 8 13.5 2.5 8Z" /><path d="M8 5.5 10.5 8 8 10.5 5.5 8Z" /></>),
  textPath: I(<><path d="M4 3h8M8 3v7" /><path d="M2.5 13.5c3-2.4 8-2.4 11 0" /></>),
};

export type IconName = keyof typeof Icons;
export function Icon({ name, size }: { name: IconName; size?: number }) {
  const C = Icons[name];
  return <C size={size} />;
}

export const typeIcon = (t: string): IconName =>
  (({ frame: 'frame', group: 'group', rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star', line: 'line', path: 'vector', text: 'text', image: 'image', component: 'component', instance: 'instance' }) as Record<string, IconName>)[t] ?? 'rect';
