import * as THREE from 'three';
import { COLORS } from './constants';
import type { Side } from './types';

export interface TeamMats {
  jersey: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  helmet: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  stripe: THREE.MeshStandardMaterial;
}

export function makeTeamMats(): Record<Side, TeamMats> {
  return {
    offense: kit(COLORS.navy, COLORS.silver, COLORS.helmetOff),
    defense: kit(COLORS.white, COLORS.navy, COLORS.helmetDef)
  };
}

function kit(
  jersey: number,
  pants: number,
  helmet: number
): TeamMats {
  return {
    jersey: std(jersey, 0.72, 0.08),
    pants: std(pants, 0.7, 0.05),
    helmet: std(helmet, 0.28, 0.45),
    skin: std(COLORS.skin, 0.62, 0),
    dark: std(0x111111, 0.5, 0.1),
    stripe: std(COLORS.gold, 0.45, 0.2)
  };
}

function std(
  color: number,
  roughness: number,
  metalness: number
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness
  });
}

export function numberTexture(
  n: number,
  bg: string,
  fg: string
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = fg;
    ctx.font = 'bold 36px Barlow Condensed, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
