"""Serveur de web_defense — aucune dépendance externe (même modèle que les autres jeux).

    python server.py            → http://localhost:8000, et joignable depuis les autres appareils du réseau
    python server.py --port 9000
    python server.py --local    → cet appareil seulement (127.0.0.1)
    python server.py --sans-maj → ne pas chercher de mise à jour au démarrage

Depuis un autre appareil du réseau, la page demande une fois le code d'appairage
affiché dans la console (appairage.py) ; cet appareil-ci n'en a jamais besoin.
La progression est gardée dans le navigateur : le serveur ne fait que servir les fichiers.
"""
from __future__ import annotations

import argparse
import os
import signal
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

import appairage
import mise_a_jour

ROOT = Path(__file__).parent
NOM = "web_defense"


def make_handler(garde: appairage.Garde):
    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".js": "text/javascript", ".mjs": "text/javascript"}

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def parse_request(self):
            # Host contrôlé, et code d'appairage exigé des autres appareils du réseau
            return super().parse_request() and garde.filtrer(self)

        def log_message(self, *a):  # silence
            pass

        def do_GET(self):
            # le jeu est à la racine du dépôt : ne jamais servir .git, le code serveur ni le jeton
            chemin = unquote(self.path.split("?", 1)[0].split("#", 1)[0])
            if "/." in chemin or chemin.endswith(".py"):
                return self.send_error(404)
            return super().do_GET()

        do_HEAD = do_GET

    return Handler


def lan_ip():
    """Adresse IPv4 de cet appareil sur le réseau local (None si introuvable)."""
    # route vers une adresse privée : rien n'est envoyé, on lit juste l'interface choisie
    for cible in ("10.255.255.255", "192.168.255.255", "8.8.8.8"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((cible, 1))
                ip = s.getsockname()[0]
            if not ip.startswith(("127.", "0.")):
                return ip
        except OSError:
            pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return None


PORTS_CANDIDATS = [8000, 8001, 8002, 8080, 8888, 5000]


class JeuServer(ThreadingHTTPServer):
    def server_bind(self):
        # Sous Windows, SO_REUSEADDR permettrait de partager un port déjà pris :
        # on réserve le port en exclusivité pour échouer proprement à la place.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def ouvrir_serveur(host, ports, handler):
    for port in ports:
        try:
            return JeuServer((host, port), handler), port
        except OSError as e:
            print(f"Port {port} indisponible ({e.strerror or e}), essai du suivant…")
    raise SystemExit(f"Aucun port libre parmi {ports}. Essayez --port <numéro>.")


def main():
    p = argparse.ArgumentParser(description=NOM)
    env_port = os.environ.get("PORT")
    p.add_argument("--port", type=int, default=int(env_port) if env_port else None,
                   help=f"port prioritaire (défaut : $PORT, sinon le premier libre parmi {PORTS_CANDIDATS})")
    p.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"),
                   help="adresse d'écoute (défaut : $HOST, sinon 0.0.0.0 = tout le réseau local)")
    p.add_argument("--local", action="store_const", const="127.0.0.1", dest="host",
                   help="n'accepter que cet appareil (équivaut à --host 127.0.0.1)")
    p.add_argument("--sans-navigateur", action="store_true")
    p.add_argument("--sans-maj", action="store_true", help="ne pas chercher de mise à jour au démarrage")
    args = p.parse_args()
    for stream in (sys.stdout, sys.stderr):   # console Windows : ne jamais planter sur un accent ou un emoji
        try:
            stream.reconfigure(errors="replace", line_buffering=True)
        except AttributeError:
            pass

    # mise à jour automatique depuis git, puis redémarrage sur le nouveau code
    # (le code relancé reçoit DEFENSE_MAJ et ne revérifie pas : pas de boucle)
    if not args.sans_maj and not os.environ.get(mise_a_jour.ENV_MAJ):
        resume = mise_a_jour.verifier()
        if resume:
            mise_a_jour.redemarrer(resume)

    ports = PORTS_CANDIDATS if args.port is None else [args.port] + [x for x in PORTS_CANDIDATS if x != args.port]
    garde = appairage.Garde(NOM, actif=args.host not in ("127.0.0.1", "localhost", "::1"))
    srv, port = ouvrir_serveur(args.host, ports, make_handler(garde))
    garde.brancher(srv)   # en mode réseau : HTTPS sur le même port (le jeton ne passe plus en clair)
    url = f"http://localhost:{port}"
    print(f"🏰 {NOM} tourne sur {url}  (Ctrl+C pour quitter)")
    if args.host not in ("127.0.0.1", "localhost"):
        ip = args.host if args.host not in ("0.0.0.0", "", "::") else lan_ip()
        reseau = garde.adresse(ip, port) if ip else f"{garde.schema()}://<adresse IP de ce PC>:{port}"
        print(f"   depuis un autre appareil du réseau : {reseau}")
        print("   (si ça ne répond pas : autorisez Python dans le pare-feu, sur les réseaux privés)")
        print("   l'autre appareil demande une fois le code d'appairage ci-dessous :")
        garde.annoncer()

    # arrêt demandé par un autre programme (launcher, kill…) → même sortie propre que Ctrl+C
    def stop(*_):
        raise KeyboardInterrupt
    for name in ("SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), stop)
    if not args.sans_navigateur:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    print("\nServeur arrêté.")


if __name__ == "__main__":
    main()
