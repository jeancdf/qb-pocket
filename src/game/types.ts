export type Side = 'offense' | 'defense';

export type Pos =
  | 'QB'
  | 'RB'
  | 'TE'
  | 'WR'
  | 'OL'
  | 'DL'
  | 'LB'
  | 'CB'
  | 'S';

export interface Vec2 {
  x: number;
  z: number;
}

export interface RoutePoint extends Vec2 {
  speed?: number;
  wait?: number;
}

export interface PlayerDef {
  id: string;
  label: string;
  number: number;
  pos: Pos;
  side: Side;
  start: Vec2;
  heading: number;
  route?: RoutePoint[];
  eligible?: boolean;
  key?: string;
  routeName?: string;
}

export type Phase =
  | 'presnap'
  | 'play'
  | 'throw'
  | 'complete'
  | 'incomplete'
  | 'sack';

export type CoverGrade = 'idle' | 'open' | 'window' | 'covered';
