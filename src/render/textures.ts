import * as THREE from 'three';

/**
 * ============================================================================
 * GENERACIÓN DE TEXTURAS PROCEDURALES EN CANVAS HTML5
 * ============================================================================
 */
export function createStripedGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const stripes = 16;
  const stripeW = canvas.width / stripes;

  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1e7e34' : '#248f3c';
    ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
  }

  // Granulado sutil de briznas de césped
  ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function createSoccerBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base blanca perlada
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Costuras grises y paneles negros clásicos
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;

  const spots = [
    { x: 64, y: 64, r: 28 },
    { x: 192, y: 64, r: 28 },
    { x: 320, y: 64, r: 28 },
    { x: 448, y: 64, r: 28 },
    { x: 128, y: 128, r: 30 },
    { x: 256, y: 128, r: 30 },
    { x: 384, y: 128, r: 30 },
    { x: 64, y: 192, r: 28 },
    { x: 192, y: 192, r: 28 },
    { x: 320, y: 192, r: 28 },
    { x: 448, y: 192, r: 28 }
  ];

  spots.forEach(s => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
      const px = s.x + Math.cos(angle) * s.r;
      const py = s.y + Math.sin(angle) * s.r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  // Líneas de unión decorativas
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
