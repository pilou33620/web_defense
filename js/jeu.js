// Le jeu : la carte du niveau dessinée par le moteur de web_engine (graphismes/), les tours, les ennemis, les vagues et l'interface.
import { THREE, scene, cam, posCase, surTap, chaqueImage, qualite, reglerQualite } from '../graphismes/rendu/scene.js';
import * as plateau from '../graphismes/rendu/plateau.js';
import { appliquerMeteo } from '../graphismes/rendu/meteo.js';
import { climat, majVie } from '../graphismes/rendu/vie.js';
import { majRoutes } from '../graphismes/rendu/routes.js';
import { etiquette, toutEffacer } from '../graphismes/rendu/etiquettes.js';
import { ERES, STYLES, VOLANTS, PIEGES as ROLES_PIEGES, piege, declencher, oublierVille, tour, tirer, ennemi, avancer, abattre, toucher, projectile, suivreTir, barreVie, anneauPortee, batimentVille, animerVille, explosion, eclaboussure, rayon, chute } from '../graphismes/rendu/defense.js';
import * as R from './regles.js';
import { genererCarte, constructible } from './carte.js';

const $ = id => document.getElementById(id);
const DESC = { rapide: 'Tir rapide, une cible', zone: 'Explosion : touche un groupe', lent: 'Ralentit les ennemis', loin: 'Longue portée, perce les armures' };
const DESC_PIEGE = { pointes: 'Blesse à chaque passage, s’émousse', boue: 'Ralentit de moitié sur la case', mine: 'Explose une fois autour d’elle', barrage: 'Arrête les ennemis, qui le frappent' };

// ------------------------------------------------------------------ progression (dans le navigateur)
const CLE = 'web_defense.progres';
function lireProgres() { try { return JSON.parse(localStorage.getItem(CLE)) || { max: 1, etoiles: {} }; } catch { return { max: 1, etoiles: {} }; } }
function ecrireProgres(p) { try { localStorage.setItem(CLE, JSON.stringify(p)); } catch { /* stockage indisponible : la progression vaut pour cette visite */ } }
let progres = lireProgres();

// ------------------------------------------------------------------ état de la partie
let S = null;
const poses = [];  // tout ce que le jeu a ajouté à la scène (retiré au changement de niveau)
const ajouter = o => { scene.add(o); poses.push(o); return o; };
const retirer = o => { scene.remove(o); const k = poses.indexOf(o); if (k >= 0) poses.splice(k, 1); };

function demarrer(n) {
  for (const o of [...poses]) retirer(o);
  for (const b of S?.villeBat || []) oublierVille(b);
  toutEffacer();
  const carte = genererCarte(n), E = ERES[R.ereDe(n)];
  S = {
    n, E, style: E.style, carte, or: R.orDepart(n), vies: R.VIES, total: R.nbVagues(n), w: 0, file: [], prochain: 0,
    attente: R.ATTENTE_DEBUT, tours: new Map(), pieges: new Map(), villeBat: [], ennemis: [], tirs: [], vitesse: S?.vitesse || 1, pause: false, fini: false, t: 0,
  };
  window.jeu = S; window.essai = { batir, ameliorer, lancerVague, poserPiege };  // pour les essais (console, tests du navigateur)
  // le plateau, son temps et le chemin (une route de l'époque)
  plateau.construire(carte);
  fermerPanneau();
  const neige = carte.saison === 0 ? 0.6 : 0;
  plateau.majSaison(carte.saison, neige);
  plateau.degager(carte.ville);
  const genres = [['soleil', 'nuages', 'neige', 'gel'], ['soleil', 'nuages', 'pluie', 'soleil'], ['soleil', 'soleil', 'nuages', 'orage'], ['soleil', 'nuages', 'pluie', 'soleil']][carte.saison];
  appliquerMeteo({ genre: genres[n % 4], temperature: [-3, 13, 24, 12][carte.saison], vent: 0.3, direction: n, pluie: 0.5, neige_sol: neige }, carte.saison);
  climat.nuages = Math.min(climat.nuages, 3);  // vus de haut, les nuages cacheraient le champ de bataille
  majRoutes(carte.chemin.slice(1).map((c, k) => [carte.chemin[k], c, E.route, 1]));
  // le chemin des ennemis : les centres des cases, et leur longueur cumulée
  S.pts = carte.chemin.map(i => { const p = posCase(i); return { x: p.x, z: p.z, y: plateau.dessus(i), s: 0 }; });
  for (let k = 1; k < S.pts.length; k++) S.pts[k].s = S.pts[k - 1].s + Math.hypot(S.pts[k].x - S.pts[k - 1].x, S.pts[k].z - S.pts[k - 1].z);
  S.longueur = S.pts.at(-1).s;
  // la ville à défendre
  carte.ville.forEach((i, k) => {
    const b = batimentVille(E, k === 0, n * 7 + k, carte.saison), p = posCase(i);
    b.groupe.position.set(p.x, plateau.dessus(i), p.z); ajouter(b.groupe); animerVille(b); S.villeBat.push(b);
  });
  vivre(carte, E, neige);
  const d = posCase(carte.chemin[0]), v = posCase(carte.ville[0]);
  etiquette('entree', '<div class="ban" style="--c:#b8322a">⚔ Entrée</div>', d.x, 0.6, d.z);
  etiquette('ville', `<div class="ban" style="--c:#2f5fa8">${E.an < 0 ? 'Oppidum' : 'Ville'}</div>`, v.x, 1.4, v.z);
  // la caméra : cadrée sur l'île (les cases de terre), pas sur toute la grille
  const terre = carte.terrain.flatMap((t, i) => t ? [posCase(i)] : []), xs = terre.map(p => p.x), zs = terre.map(p => p.z);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1, lx = x1 - x0, lz = z1 - z0;
  // en portrait, un quart de tour : l'entrée en haut, la ville en bas ; champ de 36° : toute l'île en largeur et en profondeur
  const portrait = innerWidth < innerHeight, ratio = innerWidth / innerHeight;
  Object.assign(cam, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, l: Math.sqrt(3) * carte.l, h: 1.5 * carte.h, auto: false, lacet: portrait ? Math.PI / 2 : 0 });
  cam.d = cam.cible = Math.max(10, Math.min(90, Math.max((portrait ? lz : lx) * 1.45 / ratio, (portrait ? lx : lz) * 1.2)));
  $('menu').hidden = true; $('fin').hidden = true; $('b-pause').textContent = '⏸';
  majHud();
}

// la vie du monde (vie.js) : bêtes dans les prés, faune des lisières, bateaux au large, oiseaux, paysans aux champs, gens de la ville,
// lavandières, linge, lucioles, fenêtres la nuit… Elle lit un état de partie au format de web_royaumes : on lui en donne un.
function vivre(carte, E, neige) {
  majVie({
    tour: 1, mois: [0, 3, 6, 9][carte.saison], saison: carte.saison, epoque: { cle: E.bat || (E.style === 'antique' ? 'ancien' : 'industrie') },
    royaumes: [{ id: 0, couleur: '#2f5fa8' }], joueur: { techs: [] }, meteo: { neige_sol: neige },
    villes: [{ id: 0, case: carte.ville[0], proprio: 0, capitale: true, nom: 'Ville', niveau: 3, pop: 4 }],
    batiments: carte.ville.map((c, k) => ({ id: 'ville' + k, cle: k ? 'maison' : 'hotel', case: c, reste: 0, face: 0, ville: 0, proprio: 0 })),
    routes: carte.chemin.slice(1).map((c, k) => [carte.chemin[k], c]),
    cases: { foret: carte.foret, arbres: carte.arbres, proprio: carte.terrain.map(t => t ? 0 : -1) },
  }, null);
}

// ------------------------------------------------------------------ le long du chemin
const _p = { x: 0, y: 0, z: 0, dx: 0, dz: 1 };
function surChemin(s) {
  const P = S.pts; let k = 1;
  while (k < P.length - 1 && P[k].s < s) k++;
  const a = P[k - 1], b = P[k], l = b.s - a.s || 1, u = Math.max(0, Math.min(1, (s - a.s) / l));
  _p.x = a.x + (b.x - a.x) * u; _p.z = a.z + (b.z - a.z) * u; _p.y = a.y + (b.y - a.y) * u; _p.dx = (b.x - a.x) / l; _p.dz = (b.z - a.z) / l;
  return _p;
}
/** La case du chemin (son rang) où se trouve la distance s. */
function rangA(s) {
  const P = S.pts; let k = 1;
  while (k < P.length - 1 && P[k].s < s) k++;
  return (s - P[k - 1].s) / (P[k].s - P[k - 1].s || 1) < 0.5 ? k - 1 : k;
}

// ------------------------------------------------------------------ ennemis
function lacher({ genre, vie }) {
  const m = ennemi(genre, S.E), b = barreVie(), base = R.ENNEMIS[genre];
  ajouter(m.groupe); ajouter(b.objet);
  S.ennemis.push({ genre, vie, vieMax: vie, s: 0, v: base.vitesse * (0.95 + Math.random() * 0.1), lent: 0, lentF: 0, m, b, dec: (Math.random() - 0.5) * 0.3, x: 0, y: 0, z: 0 });
}
function blesser(e, degats, role) {
  if (e.vie <= 0) return;
  e.vie -= R.degatsRecus(e.genre, degats, role);
  e.b.regler(e.vie / e.vieMax);
  if (e.vie > 0) return toucher(e.m);
  S.or += R.ENNEMIS[e.genre].or;
  chute(e.x, e.y, e.z, e.m.roule);
  if (e.m.vol) explosion(e.x, e.y, e.z, 0.5);
  abattre(e.m); e.tombe = true;  // la bibliothèque le fait tomber, puis le retire de la scène
}
function majEnnemis(dt) {
  for (let k = S.ennemis.length - 1; k >= 0; k--) {
    const e = S.ennemis[k];
    if (e.vie <= 0) { if (e.tombe) poses.splice(poses.indexOf(e.m.groupe), 1); else retirer(e.m.groupe); retirer(e.b.objet); e.b.objet.children[1].material.dispose(); S.ennemis.splice(k, 1); continue; }
    if (e.lent > 0) e.lent -= dt;
    const ici = rangA(e.s), sol = !e.m.vol;  // les volants passent au-dessus des pièges
    // une barricade debout sur la case suivante : l'ennemi s'arrête et la frappe
    const devant = rangA(e.s + 0.45), bar = sol && devant !== ici ? S.pieges.get(S.carte.chemin[devant]) : null;
    if (bar?.role === 'barrage' && bar.vie > 0) { frapperBarrage(bar, R.ENNEMIS[e.genre].coup * R.difficulte(S.n) * dt); avancer(e.m, 0, dt); }
    else {
      const boue = sol && S.pieges.get(S.carte.chemin[ici])?.role === 'boue';
      const pas = e.v * (e.lent > 0 ? 1 - e.lentF : 1) * (boue ? 1 - R.PIEGES.boue.ralenti : 1) * dt;
      e.s += pas; avancer(e.m, pas, dt);
    }
    const rang = rangA(e.s);
    if (sol && rang !== e.rang) { e.rang = rang; entrer(e, S.carte.chemin[rang]); }
    if (e.s >= S.longueur) {  // la ville est atteinte
      S.vies = Math.max(0, S.vies - R.ENNEMIS[e.genre].degats); e.vie = 0;
      explosion(e.x, e.y + 0.2, e.z, 0.5); choc();
      continue;
    }
    const p = surChemin(e.s), vol = e.m.vol ? 0.9 : 0;
    e.x = p.x - p.dz * e.dec; e.z = p.z + p.dx * e.dec; e.y = p.y + vol;
    e.m.groupe.position.set(e.x, e.y, e.z);
    e.m.groupe.rotation.y = Math.atan2(p.dx, p.dz);
    e.b.objet.position.set(e.x, e.y + (e.genre === 'chef' ? 1.05 : 0.6), e.z);
  }
}

// ------------------------------------------------------------------ pièges
const piegeable = i => S.carte.chemin.includes(i) && i !== S.carte.chemin[0] && i !== S.carte.ville[0];
function poserPiege(i, role) {
  const st = R.statsPiege(role, R.ereDe(S.n));
  if (S.or < st.cout || S.pieges.has(i) || !piegeable(i)) return;
  S.or -= st.cout;
  const k = S.carte.chemin.indexOf(i), a = S.pts[Math.max(0, k - 1)], b = S.pts[Math.min(S.pts.length - 1, k + 1)], p = S.pts[k];
  const m = piege(role, S.E, { pop: true });
  m.groupe.position.set(p.x, p.y, p.z); m.groupe.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);  // en travers de la route
  ajouter(m.groupe);
  S.pieges.set(i, { i, role, m, st, charges: st.charges, arme: true, vie: st.vie });
  ouvrirPiege(i);
}
/** Un ennemi au sol entre sur une case : son piège se déclenche. */
function entrer(e, i) {
  const p = S.pieges.get(i); if (!p) return;
  if (p.role === 'pointes' && p.charges > 0) { p.charges--; p.m.usure = p.charges / p.st.charges; declencher(p.m); blesser(e, p.st.degats, 'piege'); }
  if (p.role === 'boue') eclaboussure(e.x, plateau.hauteurEn(e.x, e.z), e.z, 0x6a4a28, 0.25);
  if (p.role === 'mine' && p.arme) {
    p.arme = p.m.arme = false;
    const c = posCase(i), y = plateau.dessus(i);
    for (const o of S.ennemis) if (!o.m.vol && (o.x - c.x) ** 2 + (o.z - c.z) ** 2 <= p.st.rayon ** 2) blesser(o, p.st.degats, 'piege');
    explosion(c.x, y, c.z, p.st.rayon * 0.7);
  }
}
function frapperBarrage(p, coup) {
  p.vie -= coup; p.m.vie = Math.max(0, p.vie / p.st.vie);
  if ((p.prochainCoup = (p.prochainCoup ?? 0) - 1) <= 0) { declencher(p.m); p.prochainCoup = 8; }
  if (p.vie <= 0) { const c = posCase(p.i); chute(c.x, plateau.dessus(p.i), c.z, true); }
}
const usePiege = p => p.role === 'pointes' ? p.charges < p.st.charges : p.role === 'mine' ? !p.arme : p.role === 'barrage' ? p.vie < p.st.vie : false;
function rearmer(i) {
  const p = S.pieges.get(i); if (!p || !usePiege(p) || S.or < p.st.rearme) return false;
  S.or -= p.st.rearme; p.charges = p.st.charges; p.arme = p.m.arme = true; p.vie = p.st.vie; Object.assign(p.m, { usure: 1, vie: 1 });
  return true;
}

// ------------------------------------------------------------------ tours et tirs
function batir(i, role) {
  const cout = R.TOURS[role].cout;
  if (S.or < cout || S.tours.has(i) || !constructible(S.carte, i)) return;
  S.or -= cout;
  poserTour(i, role, 1);
  ouvrirTour(i);
}
function poserTour(i, role, niveau) {
  const ancienne = S.tours.get(i); if (ancienne) retirer(ancienne.m.groupe);
  const m = tour(role, S.E, niveau, { pop: true }), p = posCase(i), y = plateau.dessus(i);
  m.groupe.position.set(p.x, y, p.z); ajouter(m.groupe);
  if (ancienne) m.tete.rotation.y = ancienne.m.tete.rotation.y;
  S.tours.set(i, { i, role, niveau, m, x: p.x, z: p.z, recharge: 0.3, stats: R.statsTour(role, niveau, R.ereDe(S.n), S.carte.terrain[i] === 5) });
  plateau.degager([...S.carte.ville, ...S.tours.keys()]);
}
function ameliorer(i) {
  const t = S.tours.get(i), c = R.coutAmelioration(t.role, t.niveau);
  if (c == null || S.or < c) return false;
  S.or -= c; poserTour(i, t.role, t.niveau + 1);
  return true;
}
function viser(t) {
  let meilleur = null; const r2 = t.stats.portee ** 2;
  for (const e of S.ennemis) if (e.vie > 0 && (e.x - t.x) ** 2 + (e.z - t.z) ** 2 <= r2 && (!meilleur || e.s > meilleur.s)) meilleur = e;  // le plus avancé
  return meilleur;
}
const _v = new THREE.Vector3();
function majTours(dt) {
  for (const t of S.tours.values()) {
    t.recharge -= dt;
    const cible = viser(t);
    if (!cible) continue;
    t.m.tete.rotation.y = Math.atan2(cible.x - t.x, cible.z - t.z);
    if (t.recharge > 0) continue;
    t.recharge = t.stats.cadence;
    const depart = tirer(t.m), genre = STYLES[S.style].tours[t.role][1];  // recul, fumée et éclair : la bibliothèque
    if (genre === 'laser') { rayon(depart, new THREE.Vector3(cible.x, cible.y + 0.15, cible.z)); impact({ role: t.role, stats: t.stats, cible, x: cible.x, y: cible.y, z: cible.z }); continue; }
    const st = t.stats, d = Math.hypot(cible.x - depart.x, cible.z - depart.z), duree = Math.max(0.12, d / st.vitesse);
    // la zone vise là où sera la cible à l'arrivée (projectile en cloche) ; les autres la suivent
    let fin = null;
    if (t.role === 'zone') { const p = surChemin(Math.min(S.longueur, cible.s + cible.v * (cible.lent > 0 ? 1 - cible.lentF : 1) * duree)); fin = { x: p.x, y: p.y, z: p.z }; }
    const m = ajouter(projectile(genre)); m.position.copy(depart);
    S.tirs.push({ m, depart, cible, fin, role: t.role, stats: st, genre, t: 0, duree, arc: t.role === 'zone' ? 0.25 * d + 0.3 : 0.08 * d });
  }
}
function majTirs(dt) {
  for (let k = S.tirs.length - 1; k >= 0; k--) {
    const p = S.tirs[k]; p.t += dt;
    const u = Math.min(1, p.t / p.duree), b = p.fin || { x: p.cible.x, y: p.cible.y + 0.15, z: p.cible.z };
    if (!p.fin && p.cible.vie <= 0) p.fin = { ...b };  // cible tombée : le tir finit sa course
    const av = p.m.position.clone();
    p.m.position.set(p.depart.x + (b.x - p.depart.x) * u, p.depart.y + (b.y - p.depart.y) * u + Math.sin(u * Math.PI) * p.arc, p.depart.z + (b.z - p.depart.z) * u);
    if (p.m.position.distanceToSquared(av) > 1e-8) p.m.lookAt(_v.copy(p.m.position).multiplyScalar(2).sub(av));
    suivreTir(p.m);
    if (u < 1) continue;
    retirer(p.m); S.tirs.splice(k, 1);
    impact({ ...p, x: b.x, y: b.y, z: b.z });
  }
}
function impact({ role, stats, cible, x, y, z, genre }) {
  if (role === 'zone' || role === 'lent') {
    for (const e of S.ennemis) if ((e.x - x) ** 2 + (e.z - z) ** 2 <= stats.rayon ** 2) {
      blesser(e, stats.degats, role);
      if (role === 'lent') { const f = stats.ralenti * (e.genre === 'chef' ? 0.5 : 1); e.lentF = e.lent > 0 ? Math.max(e.lentF, f) : f; e.lent = stats.duree; }
    }
    if (role === 'zone') explosion(x, y, z, stats.rayon * 0.6, genre === 'plasma' ? 0xe040ff : 0xffb040);
    else eclaboussure(x, plateau.hauteurEn(x, z), z, { poix: 0x26262a, glace: 0xa8f0ff }[genre] || 0x6ab8ff, stats.rayon);
  } else if (cible) blesser(cible, stats.degats, role);
}

// ------------------------------------------------------------------ vagues
function majVagues(dt) {
  if (S.attente != null) { S.attente -= dt; if (S.attente <= 0) lancerVague(); }
  if (S.file.length) { S.prochain -= dt; if (S.prochain <= 0) { const e = S.file.shift(); lacher(e); S.prochain = S.file[0]?.delai ?? 0; if (!S.file.length) finVague(); } }
}
function lancerVague() {
  if (S.w >= S.total) return;
  S.w++; S.attente = null;
  S.file = R.vague(S.n, S.w); S.prochain = 0;
}
function finVague() {  // la vague est toute sortie : prime, et compte à rebours de la suivante
  S.or += R.primeVague(S.w);
  if (S.w < S.total) S.attente = R.ATTENTE_VAGUE;
}
function verifierFin() {
  if (S.fini) return;
  if (S.vies <= 0) return terminer(false);
  if (S.w === S.total && !S.file.length && !S.ennemis.length) terminer(true);
}
function terminer(gagne) {
  S.fini = true; fermerPanneau();
  const et = gagne ? R.etoiles(S.vies) : 0;
  if (gagne) { progres.max = Math.max(progres.max, S.n + 1); progres.etoiles[S.n] = Math.max(progres.etoiles[S.n] || 0, et); ecrireProgres(progres); }
  const suivante = ERES[R.ereDe(S.n + 1)];
  $('fin-titre').textContent = gagne ? `Victoire ! ${'★'.repeat(et)}${'☆'.repeat(3 - et)}` : 'La ville est tombée';
  $('fin-texte').textContent = gagne
    ? `Niveau ${S.n} gagné avec ${S.vies} vies sur ${R.VIES}.` + (suivante !== S.E ? ` Prochaine époque : ${suivante.nom} !` : '')
    : `Les ennemis ont franchi les défenses à la vague ${S.w} sur ${S.total}.`;
  $('b-suivant').hidden = !gagne;
  $('fin').hidden = false;
}

// ------------------------------------------------------------------ boucle
chaqueImage(dt => {
  if (!S || S.pause || S.fini) return;
  let reste = dt * S.vitesse;
  while (reste > 0) {  // pas de 50 ms au plus : à vitesse ×3, les tirs restent justes
    const h = Math.min(0.05, reste); reste -= h; S.t += h;
    majVagues(h); majEnnemis(h); majTours(h); majTirs(h);
  }
  verifierFin();
  majHud();
});

// ------------------------------------------------------------------ interface
let panneau = null, anneau = null;
function majHud() {
  $('hud-niveau').textContent = `Niveau ${S.n} · ${S.E.nom}`;
  $('hud-vies').textContent = S.vies;
  $('hud-or').textContent = S.or;
  $('hud-vague').textContent = `Vague ${S.w}/${S.total}`;
  const b = $('b-lancer');
  b.hidden = S.attente == null;
  if (S.attente != null) b.textContent = `▶ Vague ${S.w + 1} dans ${Math.ceil(S.attente)} s`;
  if (panneau) majPanneau();
}
function choc() { const h = $('hud'); h.classList.remove('choc'); void h.offsetWidth; h.classList.add('choc'); setTimeout(() => h.classList.remove('choc'), 400); }
function montrerAnneau(i, portee) {
  if (anneau) { scene.remove(anneau); anneau.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); anneau = null; }
  if (i == null) return;
  const p = posCase(i); anneau = anneauPortee(portee); anneau.position.set(p.x, plateau.dessus(i) + 0.03, p.z); scene.add(anneau);
}
function fermerPanneau() { panneau = null; $('panneau').hidden = true; plateau.selection(-1); montrerAnneau(null); }

function ouvrirConstruction(i) {
  panneau = { genre: 'construire', i }; plateau.selection(i, 0xffd34d);
  const T = STYLES[S.style].tours, colline = S.carte.terrain[i] === 5;
  $('panneau').innerHTML = `<h2>Bâtir une tour${colline ? ' <small>(colline : +15 % de portée)</small>' : ''} <button type="button" data-fermer aria-label="Fermer">✕</button></h2>
    <div class="choix">${Object.keys(R.TOURS).map(r => `<button type="button" data-role="${r}"><span class="nom">${T[r][0]}</span><span class="prix">🪙 ${R.TOURS[r].cout}</span><span class="desc">${DESC[r]}</span></button>`).join('')}</div>`;
  $('panneau').hidden = false;
  for (const b of $('panneau').querySelectorAll('[data-role]')) {
    const voir = () => montrerAnneau(i, R.statsTour(b.dataset.role, 1, R.ereDe(S.n), colline).portee);
    b.addEventListener('pointerenter', voir); b.addEventListener('focus', voir);
    b.addEventListener('click', () => batir(i, b.dataset.role));
  }
  montrerAnneau(i, R.statsTour('rapide', 1, R.ereDe(S.n), colline).portee);
  majPanneau();
}
function ouvrirTour(i) {
  const t = S.tours.get(i);
  panneau = { genre: 'tour', i, cle: '' }; plateau.selection(i, 0xffffff);
  montrerAnneau(i, t.stats.portee);
  $('panneau').hidden = false;
  majPanneau();
}
function ouvrirPosePiege(i) {
  panneau = { genre: 'poser', i }; plateau.selection(i, 0xffd34d); montrerAnneau(null);
  const noms = STYLES[S.style].pieges;
  $('panneau').innerHTML = `<h2>Poser un piège sur la route <button type="button" data-fermer aria-label="Fermer">✕</button></h2>
    <div class="choix">${ROLES_PIEGES.map((r, k) => `<button type="button" data-piege="${r}"><span class="nom">${noms[k]}</span><span class="prix">🪙 ${R.PIEGES[r].cout}</span><span class="desc">${DESC_PIEGE[r]}</span></button>`).join('')}</div>`;
  $('panneau').hidden = false;
  for (const b of $('panneau').querySelectorAll('[data-piege]')) b.addEventListener('click', () => poserPiege(i, b.dataset.piege));
  majPanneau();
}
function ouvrirPiege(i) { panneau = { genre: 'piege', i, cle: '' }; plateau.selection(i, 0xffffff); montrerAnneau(null); $('panneau').hidden = false; majPanneau(); }
function etatPiege(p) {
  if (p.role === 'pointes') return `${p.charges} passages sur ${p.st.charges} · ${Math.round(p.st.degats)} dégâts`;
  if (p.role === 'mine') return p.arme ? `Armée · ${Math.round(p.st.degats)} dégâts autour d’elle` : 'Elle a sauté : à réarmer';
  if (p.role === 'barrage') return p.vie > 0 ? `Solidité ${Math.ceil(p.vie)} sur ${Math.round(p.st.vie)}` : 'Détruite : à relever';
  return `Ralentit de ${Math.round(p.st.ralenti * 100)} %, ne s’use pas`;
}
function majPanneau() {
  const el = $('panneau');
  if (panneau.genre === 'construire') { for (const b of el.querySelectorAll('[data-role]')) b.disabled = S.or < R.TOURS[b.dataset.role].cout; return; }
  if (panneau.genre === 'poser') { for (const b of el.querySelectorAll('[data-piege]')) b.disabled = S.or < R.PIEGES[b.dataset.piege].cout; return; }
  if (panneau.genre === 'piege') {
    const p = S.pieges.get(panneau.i), us = usePiege(p), cle = `${etatPiege(p)}|${us && S.or >= p.st.rearme}`;
    if (cle === panneau.cle) return;
    panneau.cle = cle;
    el.innerHTML = `<h2>${STYLES[S.style].pieges[ROLES_PIEGES.indexOf(p.role)]} <button type="button" data-fermer aria-label="Fermer">✕</button></h2>
      <div class="stats"><span>${etatPiege(p)}</span><span>${DESC_PIEGE[p.role]}</span></div>
      <div class="actions">${p.st.rearme ? `<button type="button" data-rearmer ${!us || S.or < p.st.rearme ? 'disabled' : ''}>Réarmer <span class="prix">🪙 ${p.st.rearme}</span></button>` : ''}
        <button type="button" data-vendre>Vendre <span class="prix">+${R.ventePiege(p.role)}</span></button></div>`;
    el.querySelector('[data-rearmer]')?.addEventListener('click', () => { if (rearmer(p.i)) { panneau.cle = ''; majPanneau(); } });
    el.querySelector('[data-vendre]').addEventListener('click', () => { S.or += R.ventePiege(p.role); retirer(p.m.groupe); S.pieges.delete(p.i); fermerPanneau(); });
    return;
  }
  const t = S.tours.get(panneau.i), up = R.coutAmelioration(t.role, t.niveau), cle = `${t.niveau}|${up != null && S.or >= up}`;
  if (cle === panneau.cle) return;
  panneau.cle = cle;
  const st = t.stats, suiv = up != null ? R.statsTour(t.role, t.niveau + 1, R.ereDe(S.n), S.carte.terrain[t.i] === 5) : null;
  el.innerHTML = `<h2>${STYLES[S.style].tours[t.role][0]} · niveau ${t.niveau}/${R.NIVEAU_MAX} <button type="button" data-fermer aria-label="Fermer">✕</button></h2>
    <div class="stats"><span>Dégâts ${Math.round(st.degats)}${suiv ? ` → ${Math.round(suiv.degats)}` : ''}</span><span>${(1 / st.cadence).toFixed(1)} tirs/s</span><span>Portée ${st.portee.toFixed(1)}</span><span>${DESC[t.role]}</span></div>
    <div class="actions">
      <button type="button" data-ameliorer ${up == null || S.or < up ? 'disabled' : ''}>${up == null ? 'Niveau maximal' : `Améliorer <span class="prix">🪙 ${up}</span>`}</button>
      <button type="button" data-vendre>Vendre <span class="prix">+${R.prixVente(t.role, t.niveau)}</span></button>
    </div>`;
  el.querySelector('[data-ameliorer]').addEventListener('click', () => { if (ameliorer(t.i)) ouvrirTour(t.i); });
  el.querySelector('[data-vendre]').addEventListener('click', () => {
    S.or += R.prixVente(t.role, t.niveau); retirer(t.m.groupe); S.tours.delete(t.i);
    plateau.degager([...S.carte.ville, ...S.tours.keys()]); fermerPanneau();
  });
}
$('panneau').addEventListener('click', e => { if (e.target.closest('[data-fermer]')) fermerPanneau(); });

surTap(i => {
  if (!S || S.fini || !$('menu').hidden) return;
  if (S.tours.has(i)) return ouvrirTour(i);
  if (S.pieges.has(i)) return ouvrirPiege(i);
  if (constructible(S.carte, i)) return ouvrirConstruction(i);
  if (piegeable(i)) return ouvrirPosePiege(i);
  fermerPanneau();
});

$('b-lancer').addEventListener('click', () => { if (S.attente != null) { S.or += Math.ceil(S.attente); lancerVague(); } });
$('b-vitesse').addEventListener('click', e => { S.vitesse = S.vitesse % 3 + 1; e.currentTarget.textContent = `×${S.vitesse}`; });
$('b-pause').addEventListener('click', e => { S.pause = !S.pause; e.currentTarget.textContent = S.pause ? '▶' : '⏸'; });
// l'aide : les défenseurs et les attaquants de l'époque, avec leurs chiffres au niveau joué (le jeu est en pause pendant la lecture)
let pauseAvantAide = false;
function ouvrirAide() {
  pauseAvantAide = S.pause; S.pause = true;
  const ere = R.ereDe(S.n), T = STYLES[S.style], d = R.difficulte(S.n), dmax = d * (1 + 0.08 * (S.total - 1));
  $('aide-titre').textContent = `${S.E.nom} · niveau ${S.n}`;
  $('aide-sous').textContent = `Chiffres de ce niveau. Les ennemis gagnent 8 % de vie à chaque vague (${S.total} vagues).`;
  $('aide-tables').innerHTML = `<h2>Défenseurs</h2><div class="defile"><table>
      <thead><tr><th>Tour</th><th>Coût</th><th>Attaque (niv. 1 → 3)</th><th>Tirs/s</th><th>Portée</th><th>Effet</th></tr></thead><tbody>
      ${Object.keys(R.TOURS).map(r => { const a = R.statsTour(r, 1, ere), b = R.statsTour(r, R.NIVEAU_MAX, ere);
        return `<tr><td>${T.tours[r][0]}</td><td class="n">🪙 ${R.TOURS[r].cout}</td><td class="n">${Math.round(a.degats)} → ${Math.round(b.degats)}</td><td class="n">${(1 / a.cadence).toFixed(1)}</td><td class="n">${a.portee.toFixed(1)}</td><td>${DESC[r]}${r === 'lent' ? ` (−${Math.round(R.TOURS.lent.ralenti * 100)} % pendant ${R.TOURS.lent.duree} s)` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>
    <p class="note">Les tours n'ont pas de points de vie : les ennemis ne les attaquent pas, ils marchent sur la ville. Sur une colline, +15 % de portée.</p>
    <h2>Pièges <small>(sur la route ; les volants passent au-dessus)</small></h2><div class="defile"><table>
      <thead><tr><th>Piège</th><th>Coût</th><th>Attaque</th><th>Vie</th><th>Réarmer</th><th>Effet</th></tr></thead><tbody>
      ${ROLES_PIEGES.map((r, k) => { const p = R.statsPiege(r, ere);
        return `<tr><td>${T.pieges[k]}</td><td class="n">🪙 ${p.cout}</td><td class="n">${p.degats ? Math.round(p.degats) + (r === 'pointes' ? ` × ${p.charges} passages` : ' autour') : r === 'boue' ? `−${Math.round(p.ralenti * 100)} % de vitesse` : '—'}</td><td class="n">${p.vie ? Math.round(p.vie) : '—'}</td><td class="n">${p.rearme ? '🪙 ' + p.rearme : '—'}</td><td>${DESC_PIEGE[r]}</td></tr>`; }).join('')}
      </tbody></table></div>
    <h2>Attaquants</h2><div class="defile"><table>
      <thead><tr><th>Ennemi</th><th>Vie (vague 1 → ${S.total})</th><th>Attaque sur la ville</th><th>Coups sur barricade</th><th>Vitesse</th><th>Armure</th><th>Butin</th></tr></thead><tbody>
      ${Object.entries(R.ENNEMIS).map(([g, e]) => `<tr><td>${T.ennemis[g]}${VOLANTS.has(S.style + ':' + g) ? ' (vole)' : ''}</td><td class="n">${Math.round(e.vie * d)} → ${Math.round(e.vie * dmax)}</td><td class="n">−${e.degats} ${e.degats > 1 ? 'vies' : 'vie'}</td><td class="n">${VOLANTS.has(S.style + ':' + g) ? 'vole au-dessus' : Math.round(e.coup * d) + ' par s'}</td><td class="n">${e.vitesse.toFixed(2)}</td><td class="n">${e.armure ? Math.round(e.armure * 100) + ' %' : '—'}</td><td class="n">🪙 ${e.or}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="note">L'armure arrête une part des dégâts, sauf ceux de la tour « ${T.tours.loin[0]} », qui perce. Vitesse en cases par seconde. La ville a ${R.VIES} vies.</p>`;
  $('aide').hidden = false;
}
$('b-aide').addEventListener('click', ouvrirAide);
$('b-aide-fermer').addEventListener('click', () => { $('aide').hidden = true; S.pause = pauseAvantAide; $('b-pause').textContent = S.pause ? '▶' : '⏸'; });
$('b-menu').addEventListener('click', () => { S.pause = true; $('b-pause').textContent = '▶'; ouvrirMenu(); });
$('b-suivant').addEventListener('click', () => demarrer(S.n + 1));
$('b-rejouer').addEventListener('click', () => demarrer(S.n));
$('b-fin-menu').addEventListener('click', ouvrirMenu);
$('qualite').value = qualite.niveau;
$('qualite').addEventListener('change', e => reglerQualite(e.target.value));

function ouvrirMenu() {
  $('fin').hidden = true;
  $('b-reprendre').hidden = !S || S.fini || (S.w === 0 && S.attente === R.ATTENTE_DEBUT);
  $('b-reprendre').textContent = `Reprendre le niveau ${S?.n}`;
  $('b-continuer').textContent = `Jouer le niveau ${progres.max} · ${ERES[R.ereDe(progres.max)].nom}`;
  const parEre = new Map();
  for (let n = 1; n <= progres.max; n++) { const e = R.ereDe(n); if (!parEre.has(e)) parEre.set(e, []); parEre.get(e).push(n); }
  $('niveaux').innerHTML = [...parEre].map(([e, ns]) => `<h3>${ERES[e].an < 0 ? 'Antiquité' : ERES[e].an} · ${ERES[e].nom}</h3><div class="ligne">${ns.map(n => {
    const et = progres.etoiles[n] || 0;
    return `<button type="button" data-niveau="${n}">${n}<small>${'★'.repeat(et)}${'☆'.repeat(3 - et)}</small></button>`;
  }).join('')}</div>`).join('');
  $('menu').hidden = false;
}
$('niveaux').addEventListener('click', e => { const b = e.target.closest('[data-niveau]'); if (b) demarrer(+b.dataset.niveau); });
$('b-continuer').addEventListener('click', () => demarrer(progres.max));
$('b-reprendre').addEventListener('click', () => { $('menu').hidden = true; S.pause = false; $('b-pause').textContent = '⏸'; });

// ?niveau=N : commence directement à ce niveau (essais)
const direct = +new URLSearchParams(location.search).get('niveau');
if (direct > 0) demarrer(direct);
else { demarrer(progres.max); S.pause = true; ouvrirMenu(); }
