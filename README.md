# web_defense — tower defense à travers les époques

Un tower defense en vue de dessus sur une carte hexagonale : une île de trois cases autour d'un chemin court (11 à 16 cases),
entourée par la mer, pour une vue rapprochée. Les ennemis suivent le chemin jusqu'à la ville ; on bâtit des tours sur les cases
libres pour les arrêter. Les niveaux sont **générés à l'infini** : la difficulté monte à chaque niveau, et l'époque
change **tous les cinq niveaux**, de l'Antiquité à 2035 (quinze époques), puis on reste au futur.

## Jouer

```sh
python3 -m http.server 8000      # à la racine du dépôt
# puis ouvrir http://localhost:8000/
```

Un serveur est nécessaire (modules JS). Le jeu marche hors ligne (tout est dans le dépôt), sur ordinateur et sur tablette.

- **Bâtir :** toucher une case libre (terre ou colline, sans forêt ni rivière) ; une colline donne +15 % de portée.
- **Améliorer ou vendre :** toucher une tour (trois niveaux ; la vente rend 70 % de ce qu'elle a coûté).
- **Les vagues arrivent seules** après un compte à rebours ; « ▶ Vague … » la lance tout de suite, et les secondes gagnées
  sont données en or. Vitesse ×1, ×2, ×3 et pause en haut à droite.
- **Aide « ? » :** les défenseurs (coût, attaque du niveau 1 au niveau 3, cadence, portée, effet) et les attaquants (vie de la
  première à la dernière vague, vies ôtées à la ville, vitesse, armure, butin) de l'époque, chiffrés pour le niveau joué.
- **Fin du niveau :** 20 vies (un chef en coûte 5). Une à trois étoiles selon les vies restantes ; la progression est gardée
  dans le navigateur. `?niveau=N` dans l'adresse lance directement le niveau N.

| Tour | Rôle |
|---|---|
| rapide | tir rapide sur une cible (archers → mousquetaires → mitrailleuse → tourelle → laser) |
| zone | explosion qui touche un groupe (onagre → canon → obusier → lance-roquettes → plasma) |
| lent | ralentit les ennemis touchés (poix → pompe à bras → pompe à vapeur → canon à eau → cryogénie) |
| loin | longue portée, perce les armures (scorpion → couleuvrine → canon long → missiles → canon électrique) |

**Pièges**, posés sur la route en touchant une case du chemin (les volants passent au-dessus) :

| Piège | Rôle |
|---|---|
| pointes | blessent à chaque passage, s'émoussent après 12 passages (chausse-trappes → chevaux de frise → barbelés → herse à clous → champ de lames) |
| boue | ralentit de moitié sur sa case, ne s'use pas (fossé boueux → marais → tranchée inondée → mousse collante → champ de gravité) |
| mine | explose une fois autour d'elle (fosse à feu → fougasse → mine → mine antichar → mine à impulsion) |
| barrage | arrête les ennemis au sol, qui le frappent jusqu'à le détruire (abattis → gabions → hérissons → blocs de béton → mur de force) |

Réarmer un piège usé coûte moins que le poser. Toutes les animations du moteur tournent : arbres au vent, herbes hautes, mer et
vagues, météo et cycle jour-nuit, bêtes dans les prés, cerfs et sangliers en lisière, bateaux au large, oiseaux, paysans aux
champs selon la saison, gens de la ville, lavandières, linge, lucioles, fenêtres allumées la nuit, drapeaux et fumées.

Les tours sont animées (recul au tir, bras de l'onagre, levier des pompes, fumées, drapeaux, radars) et sortent de terre
quand on les bâtit ; les ennemis marchent en troupes (jambes, sabots, roues, hélices) et tombent quand ils sont vaincus.

Ennemis : fantassins, rapides (cavaliers, motos, jeeps, drones), lourds et blindés (armure : 35 % des dégâts arrêtés, sauf par
la tour « loin »), et un chef à la dernière vague (éléphant de guerre, canon de siège, zeppelin, hélicoptère, méca géant).
Chaque nouvelle époque renforce les tours (+25 %), ce qui soulage un peu au début de l'époque.

## Organisation

```
index.html, css/jeu.css
js/jeu.js          la partie : carte dessinée par le moteur, tours, ennemis, tirs, vagues, interface
js/regles.js       les règles, sans affichage : époques, tours, ennemis, vagues, difficulté
js/carte.js        la carte d'un niveau (reproductible) : l'île autour du chemin, relief, lacs, forêts, rivière, ville
tests/             node tests/regles.test.mjs : 120 niveaux générés et vérifiés, difficulté croissante
graphismes/        la bibliothèque graphique de web_engine (partie « defense ») : NE PAS MODIFIER ICI
outils/maj-graphismes.sh
```

## Graphismes

Tous les graphismes viennent de [web_engine](https://github.com/pilou33620/web_engine) (`lib/rendu/defense.js` pour les tours, les
ennemis, les projectiles et les effets ; le plateau, la nature, la météo, les routes et les bâtiments des villes viennent du
moteur commun). Ils se modifient **dans web_engine**, jamais ici :

```sh
bash outils/maj-graphismes.sh            # installe la dernière bibliothèque (main de web_engine)
bash outils/maj-graphismes.sh --verifier # vérifie que graphismes/ n'a pas été modifié (CI)
```

L'action « graphismes » propose chaque lundi une demande de fusion si la bibliothèque a changé.
