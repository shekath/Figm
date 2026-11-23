export type NodeType =
  | 'frame'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'path'
  | 'text'
  | 'image'
  | 'component'
  | 'instance';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}

export interface Paint {
  id: string;
  kind: 'solid' | 'linear' | 'radial' | 'image';
  color: string; // solid colour (hex)
  opacity: number; // 0..1
  visible: boolean;
  stops?: GradientStop[];
  angle?: number; // linear gradient angle in degrees
  src?: string; // image paint data URL
}

export interface Stroke {
  color: string;
  width: number;
  opacity: number;
  align: 'center' | 'inside' | 'outside';
  dash: number; // 0 = solid
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  visible: boolean;
}

export interface Effect {
  id: string;
  kind: 'drop-shadow' | 'inner-shadow' | 'layer-blur' | 'background-blur';
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  visible: boolean;
}

export interface AutoLayout {
  direction: 'horizontal' | 'vertical';
  gap: number;
  padding: { t: number; r: number; b: number; l: number };
  align: 'start' | 'center' | 'end'; // cross-axis
  justify: 'start' | 'center' | 'end' | 'space-between'; // main axis
  hugW: boolean; // hug contents horizontally
  hugH: boolean;
  wrap: boolean;
}

export interface Constraints {
  h: 'left' | 'right' | 'left-right' | 'center' | 'scale';
  v: 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  lineHeight: number; // multiplier
  letterSpacing: number; // px
  align: 'left' | 'center' | 'right' | 'justify';
  vAlign: 'top' | 'middle' | 'bottom';
  autoResize: 'width' | 'height' | 'fixed';
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
}

export interface PathPoint {
  x: number; // relative to node box (0..w), (0..h)
  y: number;
  // optional cubic handles (absolute in node-local coords)
  cin?: { x: number; y: number };
  cout?: { x: number; y: number };
}

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'ease-in-back' | 'ease-out-back' | 'spring' | 'gentle' | 'bouncy';
export type Animation =
  | 'instant'
  | 'dissolve'
  | 'smart-animate'
  | 'move-in'
  | 'move-out'
  | 'push'
  | 'slide-in'
  | 'slide-out'
  // legacy aliases (kept for older files)
  | 'slide-left'
  | 'slide-right'
  | 'slide-up';

export interface PrototypeLink {
  trigger: 'click' | 'hover' | 'press' | 'mouse-enter' | 'mouse-leave' | 'after-delay' | 'key';
  action?: 'navigate' | 'back' | 'overlay' | 'swap-overlay' | 'close-overlay' | 'scroll-to' | 'url' | 'change-to';
  targetId: string; // frame / node id, variant component id for 'change-to', or 'back'
  animation: Animation;
  direction?: 'left' | 'right' | 'up' | 'down';
  easing?: Easing;
  delay?: number;
  duration: number;
  key?: string; // for key trigger
  url?: string;
  overlay?: { position: 'center' | 'top' | 'bottom' | 'left' | 'right'; closeOnOutside: boolean; background: string };
}

export interface ExportSetting {
  id: string;
  format: 'png' | 'jpg' | 'svg' | 'pdf';
  scale: number;
  suffix: string;
}

export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null; // null => page root
  children: string[];
  x: number; // absolute canvas coordinates
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
  fills: Paint[];
  strokes: Stroke[];
  effects: Effect[];
  radius: number;
  radii?: [number, number, number, number] | null; // independent corners
  clip?: boolean; // frames clip content
  autoLayout?: AutoLayout | null;
  constraints?: Constraints;
  text?: TextStyle;
  points?: PathPoint[];
  closed?: boolean;
  sides?: number; // polygon / star
  innerRatio?: number; // star
  src?: string; // image
  componentId?: string; // instance -> component
  overrides?: Record<string, Partial<SceneNode>>; // instance overrides keyed by component child id
  prototype?: PrototypeLink[];
  exports?: ExportSetting[];
  description?: string;
  isMask?: boolean;
  styleRefs?: { fill?: string; text?: string; effect?: string };
  /** boolean / flattened vector geometry: closed rings in node-local coords (evenodd) */
  rings?: { x: number; y: number }[][];
  /** variable bindings: property -> variable id */
  bindings?: Partial<Record<BindableProp, string>>;
  /** per-frame variable mode overrides: collection id -> mode id */
  modeOverrides?: Record<string, string>;
  /** prototype scrolling for frames */
  overflow?: 'none' | 'vertical' | 'horizontal' | 'both';
  /** stays fixed while the parent frame scrolls (prototype) */
  fixed?: boolean;
  /** frame that groups variant components (a component set) */
  isComponentSet?: boolean;
  /** variant property values of a component inside a set, e.g. { State: 'Hover', Size: 'L' } */
  variantProps?: Record<string, string>;
  /** boolean / text component properties (on a standalone component or on a component set) */
  componentProps?: ComponentProp[];
  /** instance values for component properties, keyed by property id */
  propValues?: Record<string, string | boolean>;
}

export interface ComponentProp {
  id: string;
  name: string;
  type: 'boolean' | 'text';
  default: string | boolean;
  /** target layer as a name path relative to the component, e.g. "Icon" or "Row/Label" (works across variants) */
  layer: string;
}

export type BindableProp = 'fill' | 'stroke' | 'radius' | 'opacity' | 'gap' | 'padding' | 'width' | 'height' | 'text' | 'fontSize' | 'visible' | 'strokeWidth';

export interface Page {
  id: string;
  name: string;
  children: string[];
  background: string;
  startFrameId?: string;
}

export interface Comment {
  id: string;
  pageId: string;
  x: number;
  y: number;
  author: string;
  text: string;
  createdAt: number;
  resolved: boolean;
  replies: { id: string; author: string; text: string; createdAt: number }[];
}

export interface ColorStyle {
  id: string;
  name: string;
  paint: Paint;
}

export interface TextStyleDef {
  id: string;
  name: string;
  style: Partial<TextStyle>;
}

export interface EffectStyle {
  id: string;
  name: string;
  effects: Effect[];
}

export interface Variable {
  id: string;
  name: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  values: Record<string, string | number | boolean>; // modeId -> value
  description?: string;
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: { id: string; name: string }[];
  variables: Variable[];
}

export interface Version {
  id: string;
  name: string;
  createdAt: number;
  snapshot: string; // JSON of DocumentData without versions
}

export interface DocumentData {
  format: 'figmy';
  version: 1;
  name: string;
  pages: Page[];
  nodes: Record<string, SceneNode>;
  comments: Comment[];
  colorStyles: ColorStyle[];
  textStyles: TextStyleDef[];
  effectStyles: EffectStyle[];
  variables: VariableCollection[];
  /** active mode per variable collection (collection id -> mode id) */
  activeModes?: Record<string, string>;
  versions: Version[];
}

export type Tool =
  | 'move'
  | 'scale'
  | 'frame'
  | 'section'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'hand'
  | 'comment'
  | 'image';

export type Mode = 'design' | 'prototype' | 'dev';
