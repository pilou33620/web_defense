// La carte d'un niveau, tirée au hasard (reproductible : la graine est le numéro du niveau) au format de carte du moteur
// (plateau.construire) : relief, lacs, forêts, rivière, le chemin des ennemis et la ville à défendre. Sans affichage (testée).
import { hasard } from './regles.js';

export const LARGEUR = 18, HAUTEUR = 12;
// voisins d'une case en lignes décalées (comme graphismes/rendu/scene.js) : lignes paires, lignes impaires
const DP = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]], DI = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
export function voisins(i, l = LARGEUR, h = HAUTEUR) {
  const c = i % l, r = (i / l) | 0, v = [];
  for (const [dc, dr] of (r & 1) ? DI : DP) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < l && rr < h) v.push(rr * l + cc); }
  return v;
}
// coordonnées cubiques (lignes impaires décalées) : pour tracer une ligne droite de cases et mesurer une distance
const cube = (i, l) => { const c = i % l, r = (i / l) | 0, q = c - (r - (r & 1)) / 2; return [q, r, -q - r]; };
const deCube = ([q, r], l) => r * l + q + (r - (r & 1)) / 2;
export const distance = (a, b, l = LARGEUR) => { const A = cube(a, l), B = cube(b, l); return Math.max(...A.map((v, k) => Math.abs(v - B[k]))); };
function arrondi([x, y, z]) {
  let q = Math.round(x), r = Math.round(y), s = Math.round(z);
  const dq = Math.abs(q - x), dr = Math.abs(r - y), ds = Math.abs(s - z);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return [q, r];
}
/** Les cases d'une ligne droite de a à b (bornes comprises), chacune voisine de la précédente. */
function ligne(a, b, l) {
  const A = cube(a, l), B = cube(b, l), n = distance(a, b, l), out = [];
  for (let k = 0; k <= n; k++) { const t = n ? k / n : 0; out.push(deCube(arrondi(A.map((v, j) => v + (B[j] - v) * t + 1e-6 * (j + 1))), l)); }
  return out;
}

/** La carte du niveau n : { l, h, terrain, riviere, fertile, poissons, gisement, arbres, foret, rivieres, biome } pour le moteur,
 *  plus chemin (cases, de l'entrée à la ville), ville (la case du cœur puis celles des maisons), saison (0 hiver … 3 automne). */
export function genererCarte(n) {
  const l = LARGEUR, h = HAUTEUR, N = l * h;
  for (let essai = 0; ; essai++) {
    const rnd = hasard(n * 7919 + essai * 104729 + 13);
    const chemin = tracerChemin(rnd, l, h);
    if (chemin) return habiller(rnd, chemin, l, h, N);
  }
}

function tracerChemin(rnd, l, h) {
  // des points de passage de plus en plus à l'est, reliés en lignes droites
  const k = 3 + Math.floor(rnd() * 3), pts = [];
  for (let j = 0; j <= k + 1; j++) {
    const c = j === 0 ? 0 : j === k + 1 ? l - 3 : Math.round(j * (l - 3) / (k + 1) + (rnd() - 0.5) * 2);
    const r = 1 + Math.floor(rnd() * (h - 2));
    pts.push(r * l + Math.max(0, Math.min(l - 3, c)));
  }
  const chemin = [pts[0]];
  for (let j = 1; j < pts.length; j++) for (const i of ligne(pts[j - 1], pts[j], l).slice(1)) if (i !== chemin.at(-1)) chemin.push(i);
  // refusé s'il repasse sur lui-même, se colle à lui-même (deux tronçons voisins sans place pour une tour) ou est trop court
  if (new Set(chemin).size !== chemin.length || chemin.length < l + 4) return null;
  const rang = new Map(chemin.map((i, k) => [i, k]));
  for (const [i, k] of rang) for (const v of voisins(i, l, h)) if (rang.has(v) && Math.abs(rang.get(v) - k) > 1) return null;
  return chemin;
}

function habiller(rnd, chemin, l, h, N) {
  const terrain = new Array(N).fill(4), foret = new Array(N).fill(0), arbres = new Array(N).fill(0), riviere = new Array(N).fill(0);
  const sur = new Set(chemin), coeur = chemin.at(-1);
  const ville = [coeur, ...voisins(coeur, l, h).filter(v => !sur.has(v)).slice(0, 3)], enVille = new Set(ville);
  const tache = (r0, r1, f) => { const c = Math.floor(rnd() * N), r = r0 + Math.floor(rnd() * (r1 - r0 + 1)); for (let i = 0; i < N; i++) { const d = distance(c, i, l); if (d <= r) f(i, d, r); } };
  // montagnes (entourées de collines), lacs, forêts, bosquets
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) tache(1, 2, (i, d, r) => { terrain[i] = d < r ? 6 : Math.max(terrain[i], 5); });
  for (let k = 0; k < 2; k++) tache(1, 2, (i, d) => { if (d === 0 || rnd() < 0.5) terrain[i] = Math.max(terrain[i], 5); });
  for (let k = 0; k < 1 + Math.floor(rnd() * 2); k++) tache(0, 1, i => { terrain[i] = 2; });
  for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) tache(1, 2, (i, d) => { if (d < 2 || rnd() < 0.6) foret[i] = 1; });
  for (let i = 0; i < N; i++) arbres[i] = foret[i] ? 4 + Math.floor(rnd() * 3) : rnd() < 0.12 ? 1 + Math.floor(rnd() * 2) : 0;  // le moteur dessine autant d'arbres
  // une rivière du haut en bas de la carte (une fois sur deux), loin de la ville
  const rivieres = [];
  if (rnd() < 0.5) {
    const lit = []; let i = 4 + Math.floor(rnd() * (l - 9));
    for (let r = 0; r < h; r++) {
      lit.push(i);
      const bas = voisins(i, l, h).filter(v => ((v / l) | 0) === r + 1 && !enVille.has(v));
      if (!bas.length) break;
      i = bas[Math.floor(rnd() * bas.length)];
    }
    if (lit.length === h) { rivieres.push(lit); for (const j of lit) { riviere[j] = 1; if (terrain[j] !== 4) terrain[j] = 4; } }
  }
  // le chemin, la ville et leurs abords : du terrain plat et dégagé, pour que les tours trouvent leur place
  for (const i of [...sur, ...enVille]) { terrain[i] = 4; foret[i] = 0; arbres[i] = 0; }
  for (const i of sur) for (const v of voisins(i, l, h)) {
    if (terrain[v] === 6 || terrain[v] === 2) terrain[v] = rnd() < 0.4 ? 5 : 4;
    if (foret[v] && rnd() < 0.75) { foret[v] = 0; arbres[v] = 0; }
  }
  for (const i of enVille) riviere[i] = 0;
  const z = () => new Array(N).fill(0);
  return {
    l, h, version: 1, terrain, riviere, foret, arbres, rivieres, fertile: z(), poissons: z(), gisement: new Array(N).fill(null), biome: new Array(N).fill(null),
    chemin, ville, saison: Math.floor(rnd() * 4),
  };
}

/** Peut-on bâtir une tour sur cette case ? (terre plate ou colline, sans forêt ni rivière, hors du chemin et de la ville) */
export function constructible(carte, i) {
  const t = carte.terrain[i];
  return (t === 4 || t === 5) && !carte.foret[i] && !carte.riviere[i] && !carte.chemin.includes(i) && !carte.ville.includes(i);
}
