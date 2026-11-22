//! Le serveur local de web_defense : sert le jeu (index.html, css/, js/, graphismes/, à la racine du
//! dépôt). Le jeu tourne dans le navigateur et y garde sa progression : le serveur ne fait que servir
//! les fichiers.
//!
//! Lancement :  defense                (puis ouvrir http://localhost:8801)
//! Options   :  --port 8801  --host ADRESSE  --local  --sans-navigateur  --sans-pause  --sans-maj
//! Depuis un autre appareil du réseau, la page demande une fois le code d'appairage affiché dans le
//! terminal (web_tools_commun) ; ce poste-ci n'en a jamais besoin.

use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::serveur::{decoder_chemin, Reponse, Requete, Serveur};

pub const NOM: &str = "web_defense";
pub const PORT: u16 = 8801;

/// La racine du jeu : le dossier courant s'il contient le jeu, sinon le premier dossier au-dessus de
/// l'exécutable qui le contient.
pub fn racine() -> &'static Path {
    static R: OnceLock<PathBuf> = OnceLock::new();
    R.get_or_init(|| {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let jeu = |d: &Path| d.join("index.html").is_file() && d.join("js").join("jeu.js").is_file();
        if jeu(&cwd) {
            return cwd;
        }
        let exe = std::env::current_exe().ok().and_then(|e| std::fs::canonicalize(e).ok());
        exe.and_then(|e| e.ancestors().find(|d| jeu(d)).map(Path::to_path_buf)).unwrap_or(cwd)
    })
}

// ---------------------------------------------------------------------- fichiers du jeu

/// Les seuls dossiers servis, en plus de index.html : le jeu est à la racine du dépôt, à côté de
/// .git, du code du serveur et de Cargo.toml, qui ne doivent jamais sortir.
const DOSSIERS: [&str; 3] = ["css", "js", "graphismes"];

fn type_mime(p: &Path) -> Option<&'static str> {
    Some(match p.extension().and_then(|x| x.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => return None,
    })
}

/// Un fichier du jeu (liste blanche : dossier, composants sans point, extension connue) ; 404 sinon.
fn fichier(chemin: &str) -> Reponse {
    let introuvable = || Reponse::texte(404, "introuvable");
    let rel = decoder_chemin(if chemin == "/" { "index.html" } else { chemin.trim_start_matches('/') });
    let p = Path::new(&rel);
    let sur = p.components().all(|c| matches!(c, Component::Normal(s) if !s.to_string_lossy().starts_with('.')));
    let permis = rel == "index.html" || p.iter().next().is_some_and(|c| DOSSIERS.iter().any(|d| c == *d));
    let Some(mime) = type_mime(p) else { return introuvable() };
    if !sur || !permis {
        return introuvable();
    }
    match std::fs::read(racine().join(p)) {
        Ok(o) => Reponse::new(200, mime, o),
        Err(_) => introuvable(),
    }
}

static GARDE: OnceLock<Garde> = OnceLock::new();

fn servir(r: &mut Requete) -> Reponse {
    // Host, Internet, TLS, jeton : avant tout le reste
    if let Some(rep) = GARDE.get().expect("garde non initialisée").filtrer(r) {
        return rep;
    }
    if !r.lecture() {
        // comme http.server de Python : le jeu n'a aucune route qui écrit
        return Reponse::texte(501, "méthode non prise en charge");
    }
    fichier(r.chemin())
}

/// Toute réponse, refus compris : pas d'affichage dans le cadre d'un autre site, pas de type deviné
/// (X-Frame-Options: SAMEORIGIN est déjà posé par la caisse commune).
fn repondre(r: &mut Requete) -> Reponse {
    servir(r)
        .entete("Content-Security-Policy", "frame-ancestors 'self'")
        .entete("X-Content-Type-Options", "nosniff")
}

// ---------------------------------------------------------------------- mise à jour

/// Une commande git, avec un délai : elle ne bloque jamais le démarrage.
fn commande_git(dossier: &Path, args: &[&str], delai: u64) -> Result<String, String> {
    let mut enfant = Command::new("git")
        .args(args)
        .current_dir(dossier)
        .env("GIT_TERMINAL_PROMPT", "0") // jamais de demande de mot de passe bloquante
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let fin = Instant::now() + Duration::from_secs(delai);
    loop {
        match enfant.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < fin => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = enfant.kill();
                let _ = enfant.wait();
                return Err(format!("délai de {delai} s dépassé"));
            }
        }
    }
    let o = enfant.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(raison(&String::from_utf8_lossy(&o.stderr)))
    }
}

/// La ligne utile d'un message d'erreur git (« fatal: … »), sans son préfixe.
fn raison(err: &str) -> String {
    let lignes: Vec<&str> = err.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let utile = |l: &&str| l.starts_with("fatal:") || l.starts_with("error:");
    match lignes.iter().copied().find(utile).or(lignes.first().copied()) {
        Some(l) if utile(&l) => l.split_once(':').map(|(_, r)| r.trim()).unwrap_or(l).to_string(),
        Some(l) => l.to_string(),
        None => "erreur inconnue".into(),
    }
}

/// Cherche et installe une mise à jour, en avance rapide seulement et jamais par-dessus des fichiers
/// modifiés ou des commits locaux. Rend (le code a changé, message pour le terminal).
pub fn mise_a_jour(dossier: &Path) -> (bool, String) {
    let git = |args: &[&str], delai: u64| commande_git(dossier, args, delai);
    let rien = |m: String| (false, m);
    if git(&["rev-parse", "--is-inside-work-tree"], 5).as_deref() != Ok("true") {
        return rien("Mises à jour : le jeu n'est pas dans un dépôt git, vérification ignorée.".into());
    }
    let Ok(amont) = git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 5) else {
        return rien("Mises à jour : aucune branche distante suivie, vérification ignorée.".into());
    };
    println!("Recherche de mises à jour…");
    if let Err(e) = git(&["fetch", "--quiet"], 10) {
        return rien(format!("Mises à jour : dépôt injoignable ({e}). On joue avec la version actuelle."));
    }
    let version = || git(&["rev-parse", "--short", "HEAD"], 5).unwrap_or_default();
    let compte = git(&["rev-list", "--left-right", "--count", &format!("HEAD...{amont}")], 20).unwrap_or_default();
    let n: Vec<u64> = compte.split_whitespace().filter_map(|x| x.parse().ok()).collect();
    let [avance, retard] = n[..] else {
        return rien("Mises à jour : vérification impossible. On joue avec la version actuelle.".into());
    };
    if retard == 0 {
        return rien(format!("Le jeu est à jour (version {}).", version()));
    }
    if avance > 0 {
        return rien(format!(
            "Mises à jour : {retard} disponible(s), mais {avance} commit(s) local(aux) non publié(s). \
             Fusionnez à la main (git pull) : rien n'a été modifié."
        ));
    }
    if !git(&["status", "--porcelain", "--untracked-files=no"], 20).unwrap_or_default().is_empty() {
        return rien(format!(
            "Mises à jour : {retard} disponible(s), mais des fichiers du jeu ont été modifiés sur ce poste. \
             Mise à jour ignorée pour ne rien écraser."
        ));
    }
    let titres = git(&["log", "-n", "5", "--format=%s", &format!("HEAD..{amont}")], 20).unwrap_or_default();
    let avant = version();
    if let Err(e) = git(&["merge", "--ff-only", &amont], 120) {
        return rien(format!("Mises à jour : installation impossible ({e}). On joue avec la version actuelle."));
    }
    let mut m = format!("Mise à jour installée : {avant} → {} ({retard} nouveauté(s)).", version());
    for t in titres.lines().filter(|t| !t.trim().is_empty()) {
        m += &format!("\n  • {t}");
    }
    (true, m)
}

// ---------------------------------------------------------------------- lancement

#[derive(Debug, Default, PartialEq)]
pub struct Args {
    pub port: u16,
    pub host: String,
    pub local: bool,
    pub sans_navigateur: bool,
    pub sans_maj: bool,
    pub aide: bool,
}

pub const USAGE: &str =
    "usage: defense [--port 8801] [--host ADRESSE | --local] [--sans-navigateur] [--sans-pause] [--sans-maj]";

/// Ce que server.py faisait de --host : 127.0.0.1 (ou localhost, ::1) = ce poste seulement.
fn hote_local(h: &str) -> bool {
    matches!(h, "127.0.0.1" | "localhost" | "::1")
}

/// Les options de server.py, plus --sans-pause (standard des web tools). Défauts : $PORT et $HOST,
/// comme server.py.
pub fn lire_args(argv: &[String], port_env: Option<&str>, hote_env: Option<&str>) -> Result<Args, String> {
    let port = match port_env {
        Some(v) => v.trim().parse().map_err(|_| format!("$PORT invalide : {v}"))?,
        None => PORT,
    };
    // HOST de l'environnement : zsh et tcsh y mettent le nom du poste ; ce qui n'est pas une IP est ignoré
    let hote_env = hote_env.filter(|h| {
        let ip = h.is_empty() || *h == "localhost" || h.parse::<IpAddr>().is_ok();
        if !ip {
            eprintln!("(variable HOST={h} ignorée : ce n'est pas une adresse IP)");
        }
        ip
    });
    let mut a = Args { port, host: hote_env.unwrap_or("").to_string(), local: hote_env.is_some_and(hote_local), ..Default::default() };
    let mut i = 0;
    while i < argv.len() {
        let x = argv[i].as_str();
        let (cle, val) = match x.split_once('=') {
            Some((k, v)) => (k, Some(v.to_string())),
            None => (x, None),
        };
        let mut valeur = |val: Option<String>| -> Result<String, String> {
            match val {
                Some(v) => Ok(v),
                None => {
                    i += 1;
                    argv.get(i).cloned().ok_or(format!("{cle} attend une valeur"))
                }
            }
        };
        match cle {
            "--port" => {
                let v = valeur(val)?;
                a.port = v.parse().map_err(|_| format!("port invalide : {v}"))?;
            }
            "--host" => {
                a.host = valeur(val)?;
                a.local = hote_local(&a.host);
            }
            "--local" if val.is_none() => a.local = true,
            "--sans-navigateur" if val.is_none() => a.sans_navigateur = true,
            "--sans-pause" if val.is_none() => {} // rien à attendre : le serveur ne pose jamais de question
            "--sans-maj" if val.is_none() => a.sans_maj = true,
            "-h" | "--help" if val.is_none() => a.aide = true,
            _ => return Err(format!("option inconnue : {x}")),
        }
        i += 1;
    }
    Ok(a)
}

/// Où écouter : Some(ip) pour une seule adresse du poste (--host 192.168.1.20), None pour la boucle
/// locale ou tout le réseau (0.0.0.0, ::, ou rien). Rend aussi le mode réseau de la Garde : vrai dès
/// que l'adresse n'est pas une boucle locale (sinon le réseau entrerait sans code d'appairage).
pub fn ecoute(a: &Args) -> Result<(Option<IpAddr>, bool), String> {
    if a.local || a.host == "localhost" {
        return Ok((None, false));
    }
    if a.host.is_empty() {
        return Ok((None, true));
    }
    let ip = a.host.parse::<IpAddr>().map_err(|_| format!("--host attend une adresse IP : {}", a.host))?.to_canonical();
    if ip.is_loopback() {
        Ok((None, false))
    } else if ip.is_unspecified() {
        Ok((None, true))
    } else {
        Ok((Some(ip), !ip.is_loopback()))
    }
}

fn ouvrir_navigateur(url: &str) {
    let r = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    if r.is_err() {
        println!("Ouvrez {url} dans votre navigateur.");
    }
}

pub fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let (port_env, hote_env) = (std::env::var("PORT").ok(), std::env::var("HOST").ok());
    let args = match lire_args(&argv, port_env.as_deref(), hote_env.as_deref()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{USAGE}\ndefense: {e}");
            std::process::exit(2);
        }
    };
    if args.aide {
        println!("{USAGE}");
        return;
    }
    let _ = std::env::set_current_dir(racine());

    // mise à jour depuis git ; lancer.sh reprend alors l'exécutable de la nouvelle version (code 75)
    if !args.sans_maj {
        let (change, message) = mise_a_jour(racine());
        println!("{message}");
        if change {
            if std::env::var_os("DEFENSE_RELANCEUR").is_some() {
                println!("Redémarrage du jeu sur la nouvelle version…\n");
                std::process::exit(75);
            }
            println!("Relancez le jeu pour en profiter.");
        }
    }

    let (ip, reseau) = match ecoute(&args) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{USAGE}\ndefense: {e}");
            std::process::exit(2);
        }
    };
    let ouvert = match ip {
        Some(ip) => Serveur::ouvrir_sur(ip, args.port, 10),
        None => Serveur::ouvrir(args.port, reseau, 10),
    };
    let srv = match ouvert {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::AddrNotAvailable => {
            println!("L'adresse {} n'est pas une adresse de ce poste (--host).", args.host);
            std::process::exit(1);
        }
        Err(e) => {
            println!("Aucun port libre ({e}). Essayez --port <numéro>.");
            std::process::exit(1);
        }
    };
    let port = srv.port();
    if port != args.port {
        println!("(le port {} était occupé)", args.port);
    }
    let garde = GARDE.get_or_init(|| Garde::new(NOM, reseau, None, None));
    garde.brancher(&srv); // en mode réseau : HTTPS sur le même port (le jeton ne passe plus en clair)
    // une seule adresse du poste : localhost n'y répond pas, le navigateur ouvre cette adresse
    let url = match ip {
        Some(ip) => garde.adresse(&ip.to_string(), port),
        None => format!("http://localhost:{port}"),
    };
    println!("🏰 {NOM} tourne sur {url}  (Ctrl+C pour quitter)");
    if reseau {
        println!("   depuis un autre appareil du réseau :");
        let adresses = match ip {
            Some(ip) => vec![ip.to_string()],
            None => appairage::adresses_poste(),
        };
        for ip in &adresses {
            println!("      {}", garde.adresse(ip, port));
        }
        if adresses.is_empty() {
            println!("      {}://<adresse IP de ce PC>:{port}/", garde.schema());
        }
        println!("   (si ça ne répond pas : autorisez le jeu dans le pare-feu, sur les réseaux privés)");
        println!("   l'autre appareil demande une fois le code d'appairage ci-dessous :");
        garde.annoncer();
    }
    if !args.sans_navigateur {
        let u = url.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            ouvrir_navigateur(&u);
        });
    }
    srv.servir(Arc::new(|r: &mut Requete| repondre(r)));
}

#[cfg(test)]
mod essais {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn a(l: &[&str]) -> Vec<String> {
        l.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn ligne_de_commande() {
        // la commande du catalogue de web_launcher, et --sans-pause de lancer.sh
        let x = lire_args(&a(&["--port", "8801", "--sans-navigateur", "--sans-maj", "--sans-pause"]), None, None).unwrap();
        assert_eq!(x, Args { port: 8801, sans_navigateur: true, sans_maj: true, ..Default::default() });
        assert_eq!(lire_args(&[], None, None).unwrap(), Args { port: PORT, ..Default::default() });
        assert_eq!(lire_args(&a(&["--port=9000"]), None, None).unwrap().port, 9000);
        assert!(lire_args(&a(&["--local"]), None, None).unwrap().local);
        assert!(lire_args(&a(&["--host", "127.0.0.1"]), None, None).unwrap().local);
        assert!(!lire_args(&a(&["--host=0.0.0.0"]), None, None).unwrap().local);
        assert!(!lire_args(&a(&["--local", "--host", "0.0.0.0"]), None, None).unwrap().local);
        // $PORT et $HOST donnent les défauts, les options gagnent
        let x = lire_args(&[], Some("9100"), Some("localhost")).unwrap();
        assert!(x.port == 9100 && x.local);
        assert_eq!(lire_args(&a(&["--port", "9200"]), Some("9100"), None).unwrap().port, 9200);
        assert!(lire_args(&a(&["-h"]), None, None).unwrap().aide);
        for faux in [&["--port"][..], &["--port", "x"], &["--inconnu"], &["--local=1"], &["--host"]] {
            assert!(lire_args(&a(faux), None, None).is_err(), "{faux:?}");
        }
        assert!(lire_args(&[], Some("abc"), None).is_err());
    }

    #[test]
    fn adresse_d_ecoute() {
        let e = |l: &[&str], hote: Option<&str>| ecoute(&lire_args(&a(l), None, hote).unwrap());
        // tout le réseau (défaut) ou la boucle locale : Serveur::ouvrir
        assert_eq!(e(&[], None), Ok((None, true)));
        assert_eq!(e(&["--host=0.0.0.0"], None), Ok((None, true)));
        assert_eq!(e(&["--host", "::"], None), Ok((None, true)));
        assert_eq!(e(&["--local", "--host", "0.0.0.0"], None), Ok((None, true)));
        for local in [&["--local"][..], &["--host", "127.0.0.1"], &["--host=localhost"], &["--host", "::1"], &["--host", "::ffff:127.0.0.1"], &["--host", "192.168.1.20", "--local"]] {
            assert_eq!(e(local, None), Ok((None, false)), "{local:?}");
        }
        assert_eq!(e(&[], Some("127.0.0.1")), Ok((None, false)));
        // une seule adresse du poste : Serveur::ouvrir_sur, et la Garde en mode réseau (code d'appairage)
        let ip: IpAddr = "192.168.1.20".parse().unwrap();
        assert_eq!(e(&["--host", "192.168.1.20"], None), Ok((Some(ip), true)));
        assert_eq!(e(&["--local", "--host", "::ffff:192.168.1.20"], None), Ok((Some(ip), true)));
        assert_eq!(e(&[], Some("192.168.1.20")), Ok((Some(ip), true)));
        let v6: IpAddr = "fd7a:115c:a1e0::1".parse().unwrap();
        assert_eq!(e(&["--host", "fd7a:115c:a1e0::1"], None), Ok((Some(v6), true)));
        assert!(e(&["--host", "monpc.local"], None).is_err());
        // HOST de l'environnement qui n'est pas une IP (nom du poste) : ignorée, défaut tout le réseau ;
        // la même valeur passée en option reste une erreur (code 2)
        assert_eq!(e(&[], Some("monpc")), Ok((None, true)));
        assert_eq!(e(&["--host", "192.168.1.20"], Some("monpc")), Ok((Some(ip), true)));
        assert!(e(&["--host", "monpc"], None).is_err());
    }

    fn demander(port: u16, methode: &str, chemin: &str, hote: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "{methode} {chemin} HTTP/1.1\r\nHost: {hote}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").unwrap();
        let mut brut = Vec::new();
        s.read_to_end(&mut brut).unwrap();
        let rep = String::from_utf8_lossy(&brut).to_string();
        (rep.get(9..12).and_then(|c| c.parse().ok()).unwrap_or(0), rep)
    }

    #[test]
    fn fichiers_servis_et_refus() {
        GARDE.get_or_init(|| Garde::new(NOM, false, None, None));
        let srv = Serveur::ouvrir(0, false, 1).unwrap();
        srv.servir_en_fond(Arc::new(|r: &mut Requete| repondre(r)));
        let p = srv.port();
        let h = format!("127.0.0.1:{p}");
        let code = |m: &str, c: &str| demander(p, m, c, &h).0;

        let (c, page) = demander(p, "GET", "/", &h);
        assert!(c == 200 && page.contains("<canvas id=\"carte\""), "{c}");
        assert!(page.contains("X-Frame-Options: SAMEORIGIN") && page.contains("X-Content-Type-Options: nosniff"));
        assert!(page.contains("Content-Security-Policy: frame-ancestors 'self'"));
        let js = demander(p, "GET", "/js/jeu.js", &h).1;
        assert!(js.contains("Content-Type: text/javascript"), "les modules exigent ce type");
        for ok in ["/index.html", "/css/jeu.css", "/js/regles.js?v=2", "/graphismes/rendu/scene.js", "/graphismes/VERSION.json"] {
            assert_eq!(code("GET", ok), 200, "{ok}");
        }
        assert_eq!(code("HEAD", "/index.html"), 200);
        for non in [
            "/.git/config", "/.gitignore", "/server.py", "/Cargo.toml", "/Cargo.lock", "/rust/defense/src/serveur.rs",
            "/README.md", "/../Cargo.toml", "/js/../Cargo.toml", "/%2e%2e/Cargo.toml", "/js/%2e%2e/index.html",
            "/graphismes/README.md", "/js/", "/js/.cache.js", "/tests/regles.test.mjs", "/js/absent.js",
        ] {
            assert_eq!(code("GET", non), 404, "{non}");
        }
        assert_eq!(code("POST", "/"), 501);
        assert_eq!(demander(p, "GET", "/", "piege.example").0, 403);
        srv.arreter();
    }

    /// Un faux dépôt : « origine » (nu) et « jeu », son clone, que l'on met à jour.
    #[test]
    fn mise_a_jour_par_git() {
        let base = std::env::temp_dir().join(format!("defense-maj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let g = |d: &Path, args: &[&str]| {
            let o = Command::new("git")
                .args(["-c", "user.name=essai", "-c", "user.email=essai@exemple.fr", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"])
                .args(args)
                .current_dir(d)
                .output()
                .unwrap();
            assert!(o.status.success(), "git {args:?} : {}", String::from_utf8_lossy(&o.stderr));
        };
        let (auteur, jeu) = (base.join("auteur"), base.join("jeu"));
        g(&base, &["init", "auteur"]);
        std::fs::write(auteur.join("index.html"), "v1").unwrap();
        g(&auteur, &["add", "."]);
        g(&auteur, &["commit", "-m", "premier"]);
        g(&base, &["clone", "--bare", "auteur", "origine.git"]);
        g(&base, &["clone", "origine.git", "jeu"]);
        g(&auteur, &["remote", "add", "origin", "../origine.git"]);
        let publier = |texte: &str, titre: &str| {
            std::fs::write(auteur.join("index.html"), texte).unwrap();
            g(&auteur, &["commit", "-am", titre]);
            g(&auteur, &["push", "-q", "origin", "main"]);
        };

        assert!(!mise_a_jour(&jeu).0);
        publier("v2", "deuxième");
        let (change, m) = mise_a_jour(&jeu);
        assert!(change && m.contains("deuxième"), "{m}");
        assert_eq!(std::fs::read_to_string(jeu.join("index.html")).unwrap(), "v2");
        assert!(!mise_a_jour(&jeu).0);

        // un fichier modifié sur ce poste : rien n'est écrasé
        publier("v3", "troisième");
        std::fs::write(jeu.join("index.html"), "à moi").unwrap();
        let (change, m) = mise_a_jour(&jeu);
        assert!(!change && m.contains("modifiés"), "{m}");
        assert_eq!(std::fs::read_to_string(jeu.join("index.html")).unwrap(), "à moi");

        // hors d'un dépôt : rien
        assert!(!mise_a_jour(&std::env::temp_dir().join("defense-sans-depot-inexistant")).0);
        let _ = std::fs::remove_dir_all(&base);
    }
}
