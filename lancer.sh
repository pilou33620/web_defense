#!/bin/sh
# web_defense (Linux, macOS, Raspberry Pi) : obtient l'exécutable du jeu (binaires.sh) puis le lance.
#   ./lancer.sh [--port 8801] [--host ADRESSE | --local] [--sans-navigateur] [--sans-pause] [--sans-maj]
cd "$(dirname "$0")" || exit 1
. ./binaires.sh
# Le jeu sort avec le code 75 quand il vient de se mettre à jour (git pull) :
# on reprend l'exécutable de la nouvelle version, puis on le relance.
export DEFENSE_RELANCEUR=1
while :; do
  obtenir_binaires && bin/defense "$@"
  code=$?
  [ "$code" -eq 75 ] || break
done
exit "$code"
