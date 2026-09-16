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
  metal: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
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
    stripe: std(COLORS.gold, 0.45, 0.2),
    metal: std(0x9aa4b0, 0.26, 0.84),
    glove: std(0x1b1b1b, 0.74, 0.04),
    visor: visorMat()
  };
}

function visorMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x081018,
    roughness: 0.14,
    metalness: 0.68,
    transparent: true,
    opacity: 0.5
  });
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
    if (bg !== 'none') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 64, 64);
    } else {
      ctx.clearRect(0, 0, 64, 64);
    }
    ctx.font = 'bold 36px Barlow Condensed, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (bg === 'none') {
      ctx.lineWidth = 6;
      ctx.strokeStyle = fg === '#e8c547' ? '#081828' : '#f4f7fa';
      ctx.strokeText(String(n), 32, 34);
    }
    ctx.fillStyle = fg;
    ctx.fillText(String(n), 32, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
