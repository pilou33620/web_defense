// Le jeu : la carte du niveau dessinée par le moteur de web_engine (graphismes/), les tours, les ennemis, les vagues et l'interface.
import { THREE, scene, cam, posCase, surTap, chaqueImage, qualite, reglerQualite } from '../graphismes/rendu/scene.js';
import * as plateau from '../graphismes/rendu/plateau.js';
import { appliquerMeteo } from '../graphismes/rendu/meteo.js';
import { climat } from '../graphismes/rendu/vie.js';
import { majRoutes } from '../graphismes/rendu/routes.js';
import { etiquette, toutEffacer } from '../graphismes/rendu/etiquettes.js';
import { ERES, STYLES, tour, tirer, ennemi, avancer, abattre, toucher, projectile, suivreTir, barreVie, anneauPortee, batimentVille, animerVille, explosion, eclaboussure, rayon, chute } from '../graphismes/rendu/defense.js';
import * as R from './regles.js';
import { genererCarte, constructible } from './carte.js';

const $ = id => document.getElementById(id);
const DESC = { rapide: 'Tir rapide, une cible', zone: 'Explosion : touche un groupe', lent: 'Ralentit les ennemis', loin: 'Longue portée, perce les armures' };

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
  toutEffacer();
  const carte = genererCarte(n), E = ERES[R.ereDe(n)];
  S = {
    n, E, style: E.style, carte, or: R.orDepart(n), vies: R.VIES, total: R.nbVagues(n), w: 0, file: [], prochain: 0,
    attente: R.ATTENTE_DEBUT, tours: new Map(), ennemis: [], tirs: [], vitesse: S?.vitesse || 1, pause: false, fini: false, t: 0,
  };
  window.jeu = S; window.essai = { batir, ameliorer, lancerVague };  // pour les essais (console, tests du navigateur)
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
    b.groupe.position.set(p.x, plateau.dessus(i), p.z); ajouter(b.groupe); animerVille(b);
  });
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

// ------------------------------------------------------------------ le long du chemin
const _p = { x: 0, y: 0, z: 0, dx: 0, dz: 1 };
function surChemin(s) {
  const P = S.pts; let k = 1;
  while (k < P.length - 1 && P[k].s < s) k++;
  const a = P[k - 1], b = P[k], l = b.s - a.s || 1, u = Math.max(0, Math.min(1, (s - a.s) / l));
  _p.x = a.x + (b.x - a.x) * u; _p.z = a.z + (b.z - a.z) * u; _p.y = a.y + (b.y - a.y) * u; _p.dx = (b.x - a.x) / l; _p.dz = (b.z - a.z) / l;
  return _p;
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
    const pas = e.v * (e.lent > 0 ? 1 - e.lentF : 1) * dt;
    e.s += pas; avancer(e.m, pas, dt);
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
function majPanneau() {
  const el = $('panneau');
  if (panneau.genre === 'construire') { for (const b of el.querySelectorAll('[data-role]')) b.disabled = S.or < R.TOURS[b.dataset.role].cout; return; }
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
  if (constructible(S.carte, i)) return ouvrirConstruction(i);
  fermerPanneau();
});

$('b-lancer').addEventListener('click', () => { if (S.attente != null) { S.or += Math.ceil(S.attente); lancerVague(); } });
$('b-vitesse').addEventListener('click', e => { S.vitesse = S.vitesse % 3 + 1; e.currentTarget.textContent = `×${S.vitesse}`; });
$('b-pause').addEventListener('click', e => { S.pause = !S.pause; e.currentTarget.textContent = S.pause ? '▶' : '⏸'; });
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
