"""Sert le jeu sur le réseau local : python3 serveur.py --port 8801 (lancé par web_launcher)."""
import argparse, functools, http.server, os

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
args, _ = ap.parse_known_args()  # options du launcher (--sans-navigateur…) ignorées
gestion = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(os.path.abspath(__file__)))
gestion.func.extensions_map[".js"] = gestion.func.extensions_map[".mjs"] = "text/javascript"
print("web_defense : http://0.0.0.0:%d/" % args.port, flush=True)
http.server.ThreadingHTTPServer(("0.0.0.0", args.port), gestion).serve_forever()
