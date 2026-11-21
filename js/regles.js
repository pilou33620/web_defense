// Les règles du jeu, sans affichage (testées par tests/regles.test.mjs) : époques, tours, ennemis, vagues, difficulté.

export const NB_ERES = 15;              // ERES de graphismes/rendu/defense.js
export const NIVEAUX_PAR_ERE = 5;
export const VIES = 20;

/** L'époque (0 à 14) d'un niveau (1, 2, …) : une tous les cinq niveaux, puis on reste au futur. */
export const ereDe = n => Math.min(NB_ERES - 1, Math.floor((n - 1) / NIVEAUX_PAR_ERE));
/** La force des ennemis : elle monte à chaque niveau, sans fin. */
export const difficulte = n => 1 + 0.1 * (n - 1);
/** Le progrès des armes à chaque époque : un soulagement au début de chaque nouvelle époque. */
export const technique = ere => 1 + 0.25 * ere;

// ------------------------------------------------------------------ tours (portées en unités du plateau : deux cases voisines sont à 1,73)
export const TOURS = {
  rapide: { cout: 50, degats: 6, cadence: 0.55, portee: 2.4, vitesse: 10 },
  zone: { cout: 90, degats: 16, cadence: 1.9, portee: 2.7, vitesse: 5, rayon: 0.95 },
  lent: { cout: 70, degats: 3, cadence: 1.2, portee: 2.3, vitesse: 7, rayon: 0.6, ralenti: 0.45, duree: 2.2 },
  loin: { cout: 120, degats: 48, cadence: 2.6, portee: 4.3, vitesse: 14 },
};
export const NIVEAU_MAX = 3;
/** Ce que coûte le passage au niveau suivant (null au niveau maximal). */
export const coutAmelioration = (role, niveau) => niveau >= NIVEAU_MAX ? null : Math.round(TOURS[role].cout * (niveau === 1 ? 0.8 : 1.3));
/** Ce que rend la vente : 70 % de tout ce qui a été payé. */
export function prixVente(role, niveau) {
  let total = TOURS[role].cout;
  for (let k = 1; k < niveau; k++) total += coutAmelioration(role, k);
  return Math.floor(total * 0.7);
}
/** Les caractéristiques d'une tour à son niveau et à son époque ; colline : +15 % de portée. */
export function statsTour(role, niveau, ere, colline = false) {
  const b = TOURS[role], k = niveau - 1;
  return { ...b, degats: b.degats * technique(ere) * 1.6 ** k, cadence: b.cadence * 0.88 ** k, portee: b.portee * (1 + 0.1 * k) * (colline ? 1.15 : 1) };
}

// ------------------------------------------------------------------ ennemis
// vitesse en unités du plateau par seconde ; armure : part des dégâts arrêtée (sauf tirs de la tour « loin », qui percent)
export const ENNEMIS = {
  fantassin: { vie: 32, vitesse: 0.75, armure: 0, or: 4, degats: 1 },
  rapide: { vie: 20, vitesse: 1.3, armure: 0, or: 3, degats: 1 },
  lourd: { vie: 95, vitesse: 0.48, armure: 0.35, or: 9, degats: 2 },
  chef: { vie: 420, vitesse: 0.4, armure: 0.25, or: 50, degats: 5 },
};
/** Les dégâts reçus par un ennemi, après son armure. */
export const degatsRecus = (genre, degats, role) => degats * (role === 'loin' ? 1 : 1 - ENNEMIS[genre].armure);

// ------------------------------------------------------------------ vagues
export const nbVagues = n => Math.min(15, 6 + Math.floor((n - 1) / 3));
/** Le prélude avant la première vague, puis l'attente entre deux vagues (secondes). */
export const ATTENTE_DEBUT = 25, ATTENTE_VAGUE = 14;
/** Or de départ et prime de fin de vague. */
export const orDepart = n => 220 + 10 * Math.min(30, n - 1);
export const primeVague = w => 15 + 5 * w;

/** Hasard reproductible (mulberry32) : un même niveau donne toujours la même carte et les mêmes vagues. */
export function hasard(graine) {
  let a = graine >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** La vague w (1 à nbVagues) du niveau n : la liste ordonnée des ennemis { genre, vie, delai (secondes depuis le précédent) }. */
export function vague(n, w) {
  const rnd = hasard(n * 1000 + w), total = nbVagues(n), liste = [];
  const nombre = 6 + 2 * w + Math.floor(n / 5), d = difficulte(n) * (1 + 0.08 * (w - 1));
  for (let k = 0; k < nombre; k++) {
    const r = rnd();
    const genre = w >= 3 && r < 0.12 + 0.02 * Math.min(10, n) ? 'lourd' : w >= 2 && r < 0.45 ? 'rapide' : 'fantassin';
    liste.push({ genre, vie: Math.round(ENNEMIS[genre].vie * d), delai: genre === 'rapide' ? 0.45 : genre === 'lourd' ? 1.1 : 0.75 });
  }
  if (w === total || (w > 3 && w % 5 === 0)) for (let k = 0; k < 1 + Math.floor(n / 10); k++) liste.push({ genre: 'chef', vie: Math.round(ENNEMIS.chef.vie * d), delai: 2.5 });
  return liste;
}

/** Étoiles gagnées selon les vies restantes. */
export const etoiles = vies => vies >= VIES - 2 ? 3 : vies >= VIES / 2 ? 2 : 1;
