// node tests/regles.test.mjs : les cartes et les vagues de nombreux niveaux restent jouables.
import assert from 'node:assert/strict';
import { genererCarte, voisins, constructible, LARGEUR } from '../js/carte.js';
import { ereDe, vague, nbVagues, statsTour, prixVente, coutAmelioration, degatsRecus, etoiles, VIES } from '../js/regles.js';

for (let n = 1; n <= 120; n++) {
  const c = genererCarte(n), N = c.l * c.h;
  assert.equal(c.chemin[0] % LARGEUR, 0, `niveau ${n} : le chemin entre par le bord ouest`);
  assert.equal(new Set(c.chemin).size, c.chemin.length, `niveau ${n} : le chemin ne repasse pas sur lui-même`);
  for (let k = 1; k < c.chemin.length; k++) assert.ok(voisins(c.chemin[k - 1]).includes(c.chemin[k]), `niveau ${n} : chemin continu`);
  for (const i of c.chemin) assert.ok(c.terrain[i] === 4 && !c.foret[i], `niveau ${n} : chemin praticable`);
  assert.equal(c.ville[0], c.chemin.at(-1), `niveau ${n} : la ville est au bout du chemin`);
  const places = [...Array(N).keys()].filter(i => constructible(c, i) && voisins(i).some(v => c.chemin.includes(v)));
  assert.ok(places.length >= 15, `niveau ${n} : ${places.length} places de tour au bord du chemin`);
  assert.deepEqual(genererCarte(n).chemin, c.chemin, `niveau ${n} : carte reproductible`);
  for (let w = 1; w <= nbVagues(n); w++) assert.ok(vague(n, w).length > 0);
  assert.ok(vague(n, nbVagues(n)).some(e => e.genre === 'chef'), `niveau ${n} : un chef à la dernière vague`);
}
assert.deepEqual([1, 5, 6, 75, 76, 500].map(ereDe), [0, 0, 1, 14, 14, 14]);
// la difficulté monte d'un niveau à l'autre au sein d'une époque, et la vie totale des vagues croît sans fin
const vieTotale = n => Array.from({ length: nbVagues(n) }, (_, w) => vague(n, w + 1)).flat().reduce((s, e) => s + e.vie, 0);
for (let n = 1; n < 100; n++) assert.ok(vieTotale(n + 1) > vieTotale(n) * 0.95, `niveau ${n + 1} pas plus facile que ${n}`);
assert.ok(vieTotale(80) > vieTotale(20) * 2);
// tours : améliorer renforce, vendre rend 70 %
assert.ok(statsTour('rapide', 3, 0).degats > statsTour('rapide', 1, 0).degats);
assert.ok(statsTour('loin', 1, 0, true).portee > statsTour('loin', 1, 0).portee);
assert.equal(coutAmelioration('zone', 3), null);
assert.equal(prixVente('rapide', 1), 35);
assert.equal(degatsRecus('lourd', 10, 'loin'), 10);
assert.ok(degatsRecus('lourd', 10, 'rapide') < 10);
assert.deepEqual([VIES, 12, 3].map(etoiles), [3, 2, 1]);
console.log('règles : ok');
