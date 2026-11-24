---
title: 'Construire un SIEM auto-hébergé avec la Stack Elastic (ELK + Fleet)'
date: 2026-11-24
summary: "Comment j’ai remplacé Splunk par une Stack Elastic mono-nœud pendant mon alternance : TLS de bout en bout, agents gérés par Fleet, supervision de disponibilité, alertes par e-mail avec la licence gratuite, rôles Ansible, et tous les problèmes rencontrés en chemin."
category: blue-team
tags: [elk, siem, fleet, kibana, ansible, tls]
---

> Un guide pratique pour déployer une Stack Elastic mono-nœud comme alternative open source à Splunk : centralisation des logs, métriques, supervision de disponibilité et alertes de sécurité, le tout sécurisé par TLS de bout en bout.

## Valeurs à remplacer dans ce guide

Remplacez-les par vos propres valeurs avant d’exécuter quoi que ce soit :

| Valeur | Signification |
|---|---|
| `<ELK_SERVER_IP>` | IP privée du serveur ELK (Elasticsearch + Kibana + Fleet Server) |
| `<PROXY_PRIVATE_IP>` | IP privée du reverse proxy Apache |
| `kibana.example.com` | FQDN public utilisé pour accéder à Kibana (et à Fleet, via le proxy) |
| `es.int.local` / `fleet.int.local` | Noms d’hôte internes d’Elasticsearch et de Fleet Server (doivent figurer dans les SAN des certificats) |
| `<ELASTIC_PASSWORD>` | Mot de passe du superutilisateur intégré `elastic` |
| `<FLEET_SERVICE_TOKEN>` | Jeton de service généré pour Fleet Server |
| `<ENROLLMENT_TOKEN>` | Jeton d’enrôlement Fleet pour les agents clients |
| `<SMTP_*>` / `alerts@example.com` | Paramètres SMTP et destinataire des e-mails d’alerte |

---

## 1. Introduction

### 1.1 Objectifs

L’objectif de ce projet était d’évaluer la **stack ELK (Elasticsearch, Logstash, Kibana)** comme alternative open source à **Splunk** pour la **centralisation**, l’**analyse** et la **visualisation** des logs et des métriques système.

Plus précisément :

- Explorer les fonctionnalités de la Stack Elastic gratuite par rapport aux offres payantes (Platinum / Enterprise).
- Évaluer un déploiement centralisé d’ELK sur un **seul serveur**.
- Déployer des agents de collecte de logs et de métriques (**Filebeat**, **Metricbeat**, puis **Elastic Agent** géré par **Fleet**).
- Visualiser les données dans **Kibana** : CPU, RAM, connexions SSH, scans ClamAV, expiration des certificats SSL, etc.
- Évaluer les performances de la stack et ses capacités de visualisation.

### 1.2 Contexte

La supervision d’infrastructure repose de plus en plus sur la **collecte centralisée des logs** et l’**analyse des événements en temps réel**. Des outils comme Splunk sont très répandus, mais leur **coût élevé** et leur **licence propriétaire** poussent de nombreuses équipes à chercher des alternatives open source.

La Stack Elastic est une candidate sérieuse. Elle est gratuite dans sa version de base, largement adoptée, et permet de :

- Centraliser les logs de nombreux serveurs.
- Analyser et corréler les données système, réseau et sécurité.
- Construire des tableaux de bord dynamiques pour la supervision et les alertes.

Ce guide couvre un déploiement conçu pour superviser un parc de plusieurs centaines de serveurs Linux, à des fins de **supervision, de traçabilité et de sécurité**.

---

## 2. Architecture

![Vue d’ensemble de l’architecture](/images/elk/architecture.png)

*Les agents envoient les données directement à Elasticsearch, tandis que Fleet Server se contente de les gérer (enrôlement, politiques, check-in). Les analystes accèdent à Kibana via le reverse proxy Apache, et les alertes partent par e-mail grâce au service d’envoi.*

### 2.1 Composants

| Composant | Rôle |
|---|---|
| **Elastic Agent** | Agent unifié qui **collecte logs, métriques, traces et événements** (observabilité et sécurité). Il applique une **politique** définie dans **Fleet** et envoie les données **directement à Elasticsearch**. Il peut aussi assurer la **protection des postes** (Elastic Security). |
| **Fleet Server** | **Gestion centralisée** des Elastic Agents. Il distribue les **politiques**, gère l’**enrôlement** des agents et coordonne les mises à jour. Il lit et écrit son état dans les **index Fleet** stockés dans Elasticsearch. |
| **Elasticsearch** | **Moteur de stockage, d’indexation et de recherche** distribué. Il stocke les données reçues (depuis Elastic Agent ou Logstash), les indexe et permet la **recherche et l’analyse en temps réel**. |
| **Kibana** | **Interface web** de visualisation et d’administration : **tableaux de bord**, **politiques Fleet**, état du cluster, alertes, et applications de sécurité et d’observabilité. |

### 2.2 Fonctionnement de Fleet Server

1. Lorsqu’une nouvelle politique est créée, l’interface Fleet l’enregistre dans un index Fleet d’Elasticsearch.
2. Pour s’enrôler dans une politique, les Elastic Agents envoient une requête à Fleet Server, en s’authentifiant avec une **clé d’enrôlement**.
3. Fleet Server surveille les index Fleet, récupère la nouvelle politique d’agent dans Elasticsearch et l’envoie à chaque agent enrôlé.
   - *Fleet Server peut aussi réécrire des politiques mises à jour dans l’index Fleet pour coordonner les agents.*
4. Elastic Agent utilise la configuration de la politique pour collecter les données et les envoyer à Elasticsearch.
5. Elastic Agent interroge Fleet Server pour récupérer les mises à jour, en gardant une connexion longue durée ouverte.
6. Quand une politique est modifiée, Fleet Server récupère la nouvelle version et la pousse vers les agents connectés.
7. Fleet Server écrit l’état des agents et l’avancement du déploiement des politiques dans les index Fleet.

### 2.3 Les flux de données en bref

- **Elastic Agent** : collecte et envoie les données à **Elasticsearch**.
- **Fleet Server** : pilote et supervise les Elastic Agents.
- **Elasticsearch** : stocke et indexe l’ensemble.
- **Kibana** : explore et visualise les données, et administre la stack.

---

## 3. Prérequis

Ce guide décrit une installation standard et sécurisée d’une Stack Elastic (Elasticsearch, Kibana, Fleet) derrière un **reverse proxy Apache**, avec des certificats **Let’s Encrypt** pour le point d’accès public et une autorité de certification interne pour le back-end.

- Un serveur dédié ou une VM **Ubuntu/Debian** hébergeant :
  - Elasticsearch
  - Fleet Server
  - Kibana
- Un **enregistrement DNS public** pour le reverse proxy et Let’s Encrypt.
- Les ports réseau suivants ouverts :
  - **9200** : API REST d’Elasticsearch
  - **5601** : Kibana
  - **8220** : Fleet Server (communication avec les Elastic Agents)
- Un stockage dédié aux **snapshots**.
- Un utilisateur disposant des droits **sudo**.

Installer les dépendances système :

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install openjdk-11-jdk -y   # optional: Elasticsearch 8.x ships its own JDK
java -version
sudo apt install certbot unzip jq -y
```

---

## 4. Installation d’Elasticsearch et Kibana

### 4.1 Ajouter le dépôt officiel Elastic

```bash
curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elastic.gpg
echo "deb [signed-by=/usr/share/keyrings/elastic.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/elastic-8.x.list
sudo apt update
```

### 4.2 Installer Elasticsearch et Kibana

```bash
sudo apt install elasticsearch kibana -y
```

### 4.3 Activer et démarrer les services

```bash
sudo systemctl enable --now elasticsearch
sudo systemctl enable --now kibana
```

### 4.4 Vérifier les services

```bash
sudo systemctl status elasticsearch
sudo systemctl status kibana
```

---

## 5. Sécuriser Elasticsearch et gérer les utilisateurs

### 5.1 Mots de passe et jetons obligatoires (8.x et plus)

> **Attention :** les mots de passe et jetons générés ici **ne peuvent pas être récupérés plus tard**. Stockez-les immédiatement dans un gestionnaire de mots de passe (KeePass, Bitwarden, Vault…).

```bash
# Reset / set the password of the built-in 'elastic' superuser
sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic

# Create an enrollment token for Kibana
sudo /usr/share/elasticsearch/bin/elasticsearch-create-enrollment-token -s kibana

# Get the Kibana verification code (asked during first Kibana setup)
sudo /usr/share/kibana/bin/kibana-verification-code
```

### 5.2 Accès réseau

Kibana (port 5601) ne doit **pas** être exposé directement. Seul le reverse proxy est autorisé à le joindre. Dans mon cas, le serveur tournait sur Azure : il s’agissait donc d’une règle NSG autorisant le **TCP 5601** uniquement depuis l’IP privée du proxy vers le serveur ELK :

![Règle de pare-feu : autoriser le proxy vers Kibana sur le port 5601](/images/elk/nsg-rule-kibana-5601.png)

N’importe quel groupe de sécurité cloud ou pare-feu local fonctionne de la même façon. Avec `ufw` :

```bash
sudo ufw allow from <PROXY_PRIVATE_IP> to any port 5601 proto tcp
```

### 5.3 Créer des utilisateurs

Évitez d’utiliser `elastic` au quotidien. Créez plutôt des utilisateurs nominatifs :

```bash
curl -u elastic -X POST "https://<ELK_SERVER_IP>:9200/_security/user/user-admin" \
  --cacert /etc/elasticsearch/certs/elasticsearch.crt \
  -H 'Content-Type: application/json' -d'
{
  "password"  : "<STRONG_PASSWORD>",
  "roles"     : [ "superuser" ],
  "full_name" : "Administrator",
  "email"     : "admin@example.com"
}'
```

J’ai aussi écrit un petit script Bash interactif (`create_user_elk.sh`) qui encapsule cet appel d’API. Exemple de session :

```text
$ ./create_user_elk.sh
Password for Elasticsearch user 'elastic':
Checking connection to Elasticsearch...
✅ Connected to Elasticsearch.
Username to create: user-admin
Password for user-admin:
Full name: User Admin
Email: user.admin@example.com
Choose a role:
1) superuser
2) viewer
3) custom
#? 1
Creating user 'user-admin' with roles ["superuser"]...
✅ User 'user-admin' created successfully.
```

**Ou depuis l’interface Kibana :** *Management > Stack Management > Security > Users > Create user*.

---

## 6. TLS partout : certificats et reverse proxy

La stack comporte **trois sauts TLS**, chacun traité séparément :

```
Browser ──(Let's Encrypt)──▶ Apache proxy ──(internal CA)──▶ Kibana ──(internal CA)──▶ Elasticsearch
```

### 6.1 Couche HTTP d’Elasticsearch (autorité de certification interne)

#### 6.1.1 Créer une autorité de certification HTTP au format PEM

```bash
sudo install -d -m 755 /etc/elasticsearch/certs/{ca,http}
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil ca --pem \
  -out /etc/elasticsearch/certs/ca/elasticsearch-http.zip
sudo unzip -o /etc/elasticsearch/certs/ca/elasticsearch-http.zip -d /etc/elasticsearch/certs/ca/

sudo mv /etc/elasticsearch/certs/ca/ca/ca.crt /etc/elasticsearch/certs/elasticsearch.crt
sudo mv /etc/elasticsearch/certs/ca/ca/ca.key /etc/elasticsearch/certs/elasticsearch.key
sudo chmod 600 /etc/elasticsearch/certs/elasticsearch.key
sudo chmod 644 /etc/elasticsearch/certs/elasticsearch.crt
```

> Dans la suite de ce guide, `elasticsearch.crt` / `elasticsearch.key` sont le certificat et la clé de l’**autorité de certification**.

#### 6.1.2 Générer le certificat HTTPS d’Elasticsearch

Le SAN **doit** contenir chaque nom et chaque IP que les clients utiliseront (voir [Dépannage 14.3](#143-incohérence-de-nom-dhôte-tls-avec-les-noms-internes)).

```bash
cd /etc/elasticsearch/certs/
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert --pem \
  --ca-cert /etc/elasticsearch/certs/elasticsearch.crt \
  --ca-key  /etc/elasticsearch/certs/elasticsearch.key \
  --name es-http --dns es.int.local --ip <ELK_SERVER_IP> \
  --out /etc/elasticsearch/certs/elasticsearch-http.zip

sudo unzip -o elasticsearch-http.zip -d /etc/elasticsearch/certs/http/
sudo mv /etc/elasticsearch/certs/http/es-http/es-http.crt /etc/elasticsearch/certs/elasticsearch-http.crt
sudo mv /etc/elasticsearch/certs/http/es-http/es-http.key /etc/elasticsearch/certs/elasticsearch-http.key
sudo rm -rf /etc/elasticsearch/certs/http/es-http /etc/elasticsearch/certs/elasticsearch-http.zip

sudo chown root:elasticsearch /etc/elasticsearch/certs/elasticsearch-http.key
sudo chmod 640 /etc/elasticsearch/certs/elasticsearch-http.key
sudo chmod 644 /etc/elasticsearch/certs/elasticsearch-http.crt
```

#### 6.1.3 Configurer Elasticsearch : `/etc/elasticsearch/elasticsearch.yml`

```yaml
xpack.security.http.ssl:
  enabled: true
  certificate_authorities: ["/etc/elasticsearch/certs/elasticsearch.crt"]
  key: /etc/elasticsearch/certs/elasticsearch-http.key
  certificate: /etc/elasticsearch/certs/elasticsearch-http.crt
```

```bash
sudo systemctl restart elasticsearch
```

#### 6.1.4 Configurer Kibana pour faire confiance à Elasticsearch : `/etc/kibana/kibana.yml`

```yaml
elasticsearch.hosts: ["https://<ELK_SERVER_IP>:9200"]
elasticsearch.ssl.certificateAuthorities: ["/etc/kibana/certs/elasticsearch-ca.crt"]
```

```bash
sudo systemctl restart kibana
```

#### 6.1.5 Vérifier (TLS + authentification)

```bash
curl --cacert /etc/kibana/certs/elasticsearch-ca.crt -u elastic https://<ELK_SERVER_IP>:9200/
```

### 6.2 Kibana et Apache (saut interne du reverse proxy)

#### 6.2.1 Générer le certificat serveur de Kibana (sur le serveur ELK)

```bash
sudo install -d -m 755 /etc/kibana/certs
sudo install -m 644 /etc/elasticsearch/certs/elasticsearch.crt /etc/kibana/certs/elasticsearch-ca.crt

sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert --pem \
  --ca-cert /etc/elasticsearch/certs/elasticsearch.crt \
  --ca-key  /etc/elasticsearch/certs/elasticsearch.key \
  --name kibana-server --dns kibana.example.com --ip <ELK_SERVER_IP> \
  --out /etc/kibana/certs/kibana-server.zip

sudo unzip -o /etc/kibana/certs/kibana-server.zip -d /etc/kibana/certs/
sudo mv /etc/kibana/certs/kibana-server/kibana-server.crt /etc/kibana/certs/
sudo mv /etc/kibana/certs/kibana-server/kibana-server.key /etc/kibana/certs/
sudo rm -rf /etc/kibana/certs/kibana-server /etc/kibana/certs/kibana-server.zip

sudo chown kibana:kibana /etc/kibana/certs/kibana-server.*
sudo chmod 640 /etc/kibana/certs/kibana-server.key
sudo chmod 644 /etc/kibana/certs/kibana-server.crt
```

#### 6.2.2 Activer HTTPS sur Kibana : `/etc/kibana/kibana.yml`

```yaml
server.host: 0.0.0.0
server.port: 5601
server.ssl.enabled: true
server.ssl.certificate: /etc/kibana/certs/kibana-server.crt
server.ssl.key:         /etc/kibana/certs/kibana-server.key
server.publicBaseUrl: https://kibana.example.com
```

```bash
sudo systemctl restart kibana
sudo journalctl -u kibana -n 80 --no-pager
```

#### 6.2.3 Sur le proxy Apache : faire confiance à l’autorité de certification de Kibana

Copiez l’autorité de certification (`/etc/elasticsearch/certs/elasticsearch.crt`) du serveur ELK vers le proxy sous le nom `/etc/ssl/certs/kibana-backend-ca.crt`, puis :

```bash
sudo chmod 644 /etc/ssl/certs/kibana-backend-ca.crt
# Resolve the public name to the backend's private IP from the proxy
echo "<ELK_SERVER_IP> kibana.example.com" | sudo tee -a /etc/hosts
```

#### 6.2.4 Proxy TLS strict dans le vhost 443

```apache
# --- Strict TLS proxy to Kibana ---
SSLProxyEngine on
SSLProxyVerify require
SSLProxyCheckPeerName on
SSLProxyCheckPeerExpire on
SSLProxyCACertificateFile /etc/ssl/certs/kibana-backend-ca.crt

# IMPORTANT: target the FQDN that appears in the Kibana cert SAN
ProxyPass        / https://kibana.example.com:5601/
ProxyPassReverse / https://kibana.example.com:5601/
```

```bash
sudo a2enmod ssl proxy proxy_http proxy_wstunnel headers rewrite
sudo a2ensite kibana.example.com.conf kibana.example.com-le-ssl.conf
sudo apachectl -t && sudo systemctl reload apache2
```

#### 6.2.5 Vérifier

Depuis le proxy, vérifiez le certificat et le nom de Kibana :

```bash
openssl s_client -connect kibana.example.com:5601 \
  -servername kibana.example.com \
  -verify_hostname kibana.example.com \
  -CAfile /etc/ssl/certs/kibana-backend-ca.crt -verify_return_error </dev/null \
  | grep -E 'subject=|issuer=|Verify return code'
```

Via le vhost local d’Apache :

```bash
curl -I --resolve kibana.example.com:443:127.0.0.1 https://kibana.example.com
```

*Résultat attendu : `200` ou `302`. `--resolve` teste le vhost local sans dépendre du DNS public.*
*Un `502` signale un problème TLS entre Apache et Kibana (certificat invalide ou SAN incohérent).*

### 6.3 Apache et le navigateur (certificat public)

> **Attention :** **avant** de demander les certificats Let’s Encrypt, créez l’enregistrement DNS chez votre fournisseur :
> `kibana.example.com` pointant vers l’IP publique du proxy Apache.
> Sans lui, la validation Let’s Encrypt échoue et les navigateurs ne peuvent pas résoudre le nom.

```bash
dig +short kibana.example.com
nc -vz kibana.example.com 443
```

#### 6.3.1 Redirection HTTP vers HTTPS

`/etc/apache2/sites-available/kibana.example.com.conf` :

```apache
<VirtualHost *:80>
  ServerName kibana.example.com
  RewriteEngine On
  RewriteRule ^/(.*)$ https://kibana.example.com/$1 [R=301,L]
</VirtualHost>
```

```bash
sudo a2ensite kibana.example.com.conf
sudo apachectl -t && sudo systemctl reload apache2
```

#### 6.3.2 Certificat Let’s Encrypt + vhost HTTPS

```bash
sudo certbot --apache -d kibana.example.com
```

`--apache` **obtient** et **installe** le certificat dans Apache (`/etc/letsencrypt/live/kibana.example.com/{fullchain.pem,privkey.pem}`) et planifie son renouvellement automatique.

`/etc/apache2/sites-available/kibana.example.com-le-ssl.conf` :

```apache
SSLCertificateFile    /etc/letsencrypt/live/kibana.example.com/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/kibana.example.com/privkey.pem
```

```bash
sudo a2ensite kibana.example.com-le-ssl.conf
sudo apachectl -t && sudo systemctl reload apache2
```

#### 6.3.3 Vérifier la redirection

```bash
curl -I http://kibana.example.com
# HTTP/1.1 301 Moved Permanently → https://kibana.example.com/
```

---

## 7. Fleet Server

### 7.1 Installer Elastic Agent

```bash
sudo apt install elastic-agent -y
which elastic-agent
elastic-agent version
```

### 7.2 Configurer Fleet Server

**Générer un certificat TLS pour Fleet Server**, signé par la même autorité de certification interne :

```bash
sudo install -d -m 755 /etc/fleet/certs
sudo /usr/share/elasticsearch/bin/elasticsearch-certutil cert --pem \
  --ca-cert /etc/elasticsearch/certs/elasticsearch.crt \
  --ca-key  /etc/elasticsearch/certs/elasticsearch.key \
  --name fleet-server \
  --dns fleet.int.local \
  --ip <ELK_SERVER_IP> \
  --out /etc/fleet/certs/fleet-server.zip

sudo unzip -o /etc/fleet/certs/fleet-server.zip -d /etc/fleet/certs/
sudo mv /etc/fleet/certs/fleet-server/fleet-server.* /etc/fleet/certs/
sudo cp /etc/elasticsearch/certs/elasticsearch.crt /etc/fleet/certs/ca.crt
sudo chmod 600 /etc/fleet/certs/fleet-server.key
sudo chmod 644 /etc/fleet/certs/fleet-server.crt /etc/fleet/certs/ca.crt
```

**Vérifier les sorties Fleet** (la sortie par défaut doit pointer vers `https://<ELK_SERVER_IP>:9200` ou `https://es.int.local:9200` avec la bonne autorité de certification) :

```bash
curl -u elastic:"$PASS" https://kibana.example.com/api/fleet/outputs | jq .
```

**Créer un jeton de service** pour le compte de service `elastic/fleet-server` :

```bash
curl -u elastic:"$PASS" --cacert /etc/elasticsearch/certs/elasticsearch.crt -X POST \
  https://<ELK_SERVER_IP>:9200/_security/service/elastic/fleet-server/credential/token
```

**Enrôler Fleet Server :**

```bash
sudo elastic-agent enroll \
  --fleet-server-es=https://es.int.local:9200 \
  --fleet-server-es-ca=/etc/elasticsearch/certs/elasticsearch.crt \
  --fleet-server-service-token=<FLEET_SERVICE_TOKEN> \
  --fleet-server-policy="fleet-server-policy" \
  --fleet-server-cert=/etc/fleet/certs/fleet-server.crt \
  --fleet-server-cert-key=/etc/fleet/certs/fleet-server.key \
  --url=https://fleet.int.local:8220
```

Ajoutez ensuite l’autorité de certification au magasin de confiance du système pour que l’agent lui fasse confiance :

```bash
sudo cp /etc/elasticsearch/certs/elasticsearch.crt /usr/local/share/ca-certificates/es-ca.crt
sudo update-ca-certificates
```

### 7.3 Vérifier

```bash
# Elastic Agent service
systemctl status elastic-agent

# Fleet Server is listening
ss -lntp | grep 8220

# TLS connectivity
openssl s_client -connect <ELK_SERVER_IP>:8220 -CAfile /usr/local/share/ca-certificates/es-ca.crt </dev/null

# Agent logs
tail -f /var/log/elastic-agent/elastic-agent-$(date +%Y%m%d).ndjson

# Fleet outputs and enrolled agents
curl -u elastic:"$PASS" https://kibana.example.com/api/fleet/outputs | jq .
curl -u elastic:"$PASS" https://kibana.example.com/api/fleet/agents  | jq .

# Fleet indices exist
curl -u elastic:"$PASS" --cacert /etc/elasticsearch/certs/elasticsearch.crt \
  "https://<ELK_SERVER_IP>:9200/_cat/indices/.fleet*?v"
```

---

## 8. Enrôler les Elastic Agents sur les machines clientes

```bash
# Elastic GPG key + APT repo
curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elastic.gpg
echo "deb [signed-by=/usr/share/keyrings/elastic.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/elastic-8.x.list

# Trust the internal CA (paste the CA certificate content)
sudo vim /usr/local/share/ca-certificates/es-ca.crt
#   -----BEGIN CERTIFICATE-----
#   ...
#   -----END CERTIFICATE-----
sudo update-ca-certificates

# Install the agent
sudo apt-get update
sudo apt-get install elastic-agent -y

# Enroll in Fleet (through the reverse proxy path /fleet)
sudo elastic-agent enroll \
  --url=https://kibana.example.com/fleet \
  --enrollment-token=<ENROLLMENT_TOKEN> \
  --force

# Enable and start
sudo systemctl enable --now elastic-agent

# Check status and live logs
systemctl status elastic-agent
journalctl -u elastic-agent -f
```

> Le jeton d’enrôlement se trouve dans Kibana sous **Fleet > Enrollment tokens**, un par politique.

---

## 9. Politiques et intégrations Fleet

### 9.1 Qu’est-ce qu’une politique ?

Une **politique** Fleet est une configuration centralisée appliquée à un groupe d’Elastic Agents. Elle regroupe une ou plusieurs **intégrations** (modules prêts à l’emploi) et définit ce que les agents collectent et où ils l’envoient.

- **Politique** = le conteneur.
- **Intégration** = ce qu’il faut collecter (logs, métriques, événements de sécurité…).
- **Agent** = exécute la politique localement.

### 9.2 Pourquoi c’est utile

- **Centralisation** : on configure une fois dans Kibana et chaque agent l’applique.
- **Flexibilité** : chaque groupe d’agents a sa propre politique (clients, serveurs, Fleet…).
- **Passage à l’échelle** : ajouter une intégration la déploie automatiquement sur tous les agents de la politique.
- **Cohérence** : les mêmes tableaux de bord et pipelines d’ingestion partout.

### 9.3 D’autres intégrations à connaître

- **NGINX / Apache HTTPD** : logs et métriques des serveurs web et reverse proxies.
- **MySQL / PostgreSQL** : logs et métriques des bases de données.
- **Kubernetes** : logs des pods, des nœuds et des conteneurs.
- **Elastic Defend (Endpoint Security)** : EDR natif.
- **AWS / GCP / Azure** : logs et métriques cloud.

Ajoutez-les via **Fleet > Agent policies > Add integration**, et elles se déploient automatiquement sur les agents.

### 9.4 Politique de Fleet Server

Dédiée à l’hôte Fleet Server :

- **fleet_server** : active le rôle Fleet Server (gestion et orchestration des agents).
- **System** : logs et métriques de l’hôte Fleet lui-même.

Fleet Server **se supervise donc lui-même** tout en gérant les autres agents.

### 9.5 Politique des clients

Appliquée aux serveurs supervisés (environ 50 agents dans ce déploiement) :

- **System** : syslog et `auth.log`, ainsi que les métriques CPU, mémoire et disque.
- **Osquery Manager** : requêtes de type SQL sur les hôtes (inventaire, sécurité, forensique).
- **Logs ClamAV** : logs antivirus collectés via une entrée Filestream.

Cette politique couvre **l’antivirus, l’état de santé du système et les requêtes Osquery avancées** sur tous les hôtes clients.

> *Prochaine étape : envoyer les logs personnalisés de la section 11 via des intégrations Fleet natives plutôt que via des scripts.*

---

## 10. Supervision de disponibilité avec Heartbeat

Heartbeat vérifie la **disponibilité des sites web, services et applications**. Ici, il lance des vérifications HTTP/HTTPS périodiques sur tous les points d’accès web, mesure les temps de réponse et détecte les interruptions. Les résultats sont envoyés dans Elasticsearch et apparaissent dans l’application Uptime / Synthetics de Kibana, qui sert aussi de base aux alertes (voir [13.1.4](#1314-domaine-hors-production-indisponible)).

**Installation :**

```bash
sudo apt-get install heartbeat-elastic
```

**Configuration** de `/etc/heartbeat/heartbeat.yml` :

```yaml
# ======================= Elasticsearch template setting =======================
setup.template.settings:
  index.number_of_shards: 1
  index.codec: best_compression

setup.kibana:
  #host: "localhost:5601"

# ---------------------------- Elasticsearch Output ----------------------------
output.elasticsearch:
  hosts: ["https://<ELK_SERVER_IP>:9200"]
  preset: balanced
  username: "elastic"
  password: "${output.elasticsearch.password}"   # stored in the Heartbeat keystore (see 11.2)

# ================================= Processors =================================
processors:
  - add_observer_metadata:

heartbeat.monitors:
  - type: http
    id: non-prod
    name: All non-prod Endpoints
    schedule: '@every 1m'
    urls:
      - https://dev.example.com
      - https://staging.example.com
      - https://preprod.example.com
      # ...
    check.response:
      status: [200, 301, 302, 401, 403]

  - type: http
    id: prod
    name: Production Websites
    schedule: '@every 1m'
    urls:
      - https://example.com
      - https://app.example.com
      - https://kibana.example.com
      # ...
    check.response:
      status: [200, 301, 302, 401, 403]
```

**Remarques :**

- Séparer **prod** et **hors prod** dans des moniteurs distincts permet de régler la sensibilité des alertes différemment pour chacun.
- `schedule` définit l’intervalle de vérification (toutes les minutes ici).
- `401`/`403` comptent comme « disponible ». Le service répond, il est simplement protégé par une authentification.

**Vérification :**

```bash
sudo heartbeat test config      # fix YAML syntax if this fails
sudo systemctl enable --now heartbeat-elastic
sudo heartbeat test output
journalctl -u heartbeat-elastic -f
```

---

## 11. Scripts de collecte de logs personnalisés

Avant Fleet (et en parallèle), j’ai écrit quelques scripts pour transformer des logs bruts en données structurées que Filebeat peut envoyer vers des pipelines d’ingestion dédiés.

### 11.1 `system.yml` (module system de Filebeat)

```yaml
- module: system
  syslog:
    enabled: true
  auth:
    enabled: true
```

### 11.2 `keystore-create.sh` : protéger le mot de passe `elastic` dans chaque Beat

Stocke le mot de passe Elasticsearch dans le keystore de chaque Beat, pour qu’il n’apparaisse jamais en clair dans les fichiers de configuration YAML.

```bash
#!/bin/bash
# Password to insert into the keystores
ELASTIC_PASSWORD="<ELASTIC_PASSWORD>"

# Beats to process
BEATS=("filebeat" "metricbeat" "heartbeat" "auditbeat")

for BEAT in "${BEATS[@]}"; do
    echo "Processing $BEAT..."

    # Skip if the beat is not installed
    if ! command -v "$BEAT" &> /dev/null; then
        echo "  $BEAT not found. Skipping."
        continue
    fi

    # Create keystore if it doesn't exist
    if [ ! -f "/etc/$BEAT/$BEAT.keystore" ]; then
        echo "  Creating keystore..."
        sudo "$BEAT" keystore create
    else
        echo "  Keystore already exists."
    fi

    # Add or update the password entry
    if sudo "$BEAT" keystore list | grep -q "output.elasticsearch.password"; then
        echo "  Updating existing password..."
        sudo "$BEAT" keystore remove output.elasticsearch.password
    fi
    echo "$ELASTIC_PASSWORD" | sudo "$BEAT" keystore add output.elasticsearch.password --stdin
    echo "  Password added to $BEAT keystore."
    echo
done

echo "All keystores processed."
```

### 11.3 `login-ssh.sh` : événements de connexion SSH structurés

Ce script :

1. Crée un script de transformation qui extrait les tentatives de connexion SSH (succès, échec, utilisateur invalide) de `auth.log` (ou `secure` sur RHEL), les met au format CSV et les ajoute à `/var/log/login_data.log`. Un **fichier de point de reprise** garantit que seules les nouvelles lignes sont traitées.
2. Ajoute une **tâche cron** pour l’exécuter toutes les minutes.
3. Ajoute une entrée Filebeat pour le nouveau fichier de log et redémarre Filebeat.

```bash
#!/bin/bash

# --- Create transformation script ---
TRANSFORM_SCRIPT="/usr/local/bin/login_transform.sh"

cat << 'EOF' > "$TRANSFORM_SCRIPT"
#!/bin/bash
HOSTNAME=$(hostname)
AUTH_LOG="/var/log/auth.log"
OUTPUT_FILE="/var/log/login_data.log"
CHECKPOINT_FILE="/var/log/login_data_checkpoint"

[ ! -f "$AUTH_LOG" ] && AUTH_LOG="/var/log/secure"

touch "$OUTPUT_FILE"
chown root:root "$OUTPUT_FILE"
chmod 644 "$OUTPUT_FILE"

[ ! -f "$CHECKPOINT_FILE" ] && echo 0 > "$CHECKPOINT_FILE"
LAST_READ_LINE=$(cat "$CHECKPOINT_FILE")
[[ ! "$LAST_READ_LINE" =~ ^[0-9]+$ ]] && LAST_READ_LINE=0

TOTAL_LINES=$(wc -l < "$AUTH_LOG")

# Log was rotated: start over
if [ "$LAST_READ_LINE" -gt "$TOTAL_LINES" ]; then
    echo 0 > "$CHECKPOINT_FILE"
    LAST_READ_LINE=0
fi

if [ "$LAST_READ_LINE" -lt "$TOTAL_LINES" ]; then
    sed -n "$((LAST_READ_LINE + 1)),${TOTAL_LINES}p" "$AUTH_LOG" | \
    grep -E "sshd.*(Accepted|Failed password|Invalid user)" | \
    while read -r line; do
        DATE=$(echo "$line" | awk '{print $1, $2, $3}')

        if echo "$line" | grep -q "Invalid user"; then
            USER=$(echo "$line" | grep -oP "Invalid user \K\S+")
            STATUS="auth_invalid"
        elif echo "$line" | grep -q "Failed password"; then
            USER=$(echo "$line" | grep -oP "for \K\S+")
            STATUS="auth_failed"
        elif echo "$line" | grep -q "Accepted"; then
            USER=$(echo "$line" | grep -oP "for \K\S+")
            STATUS="auth_success"
        fi

        IP=$(echo "$line" | grep -oP "from \K\S+")
        PORT=$(echo "$line" | grep -oP "port \K\S+")

        # Skip entries with missing key fields
        if [[ -n "$IP" && -n "$PORT" ]]; then
            echo "$DATE, $HOSTNAME, $USER, $IP, $PORT, $STATUS" >> "$OUTPUT_FILE"
        fi
    done
    echo "$TOTAL_LINES" > "$CHECKPOINT_FILE"
fi
EOF

chmod +x "$TRANSFORM_SCRIPT"
echo "Transformation script created at: $TRANSFORM_SCRIPT"

# --- Add cron job ---
CRON_JOB="* * * * * $TRANSFORM_SCRIPT"
if ! crontab -l 2>/dev/null | grep -q "$TRANSFORM_SCRIPT"; then
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "Cron job added to crontab."
else
    echo "Cron job already exists."
fi

# --- Append Filebeat config ---
FILEBEAT_CONFIG="/etc/filebeat/filebeat.yml"
CONFIG_SNIPPET=$(cat << EOF

# === LOGIN DATA MONITORING ===
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/login_data.log
    fields:
      log_type: auth_log
    fields_under_root: true
    pipeline: auth_log_pipeline
EOF
)

if grep -q "/var/log/login_data.log" "$FILEBEAT_CONFIG"; then
    echo "Filebeat already configured for login_data.log"
else
    echo "$CONFIG_SNIPPET" >> "$FILEBEAT_CONFIG"
    echo "Filebeat config updated: $FILEBEAT_CONFIG"
fi

# --- Test and restart Filebeat ---
echo "Testing Filebeat config..."
if filebeat test config -c "$FILEBEAT_CONFIG"; then
    echo "Filebeat config OK. Restarting..."
    systemctl restart filebeat
    echo "Filebeat restarted successfully."
else
    echo "Filebeat config test failed. Fix issues in: $FILEBEAT_CONFIG"
    exit 1
fi
```

> **Remarque :** si votre `filebeat.yml` définit déjà `filebeat.inputs:`, intégrez l’extrait dans cette liste plutôt que d’ajouter une deuxième clé de premier niveau.

### 11.4 `clamav-elk.sh` : résultats des scans antivirus

Planifie un **scan ClamAV quotidien**, transforme le résumé du scan en une ligne CSV structurée (date, fichiers analysés, fichiers infectés, détails) et configure Filebeat pour l’envoyer.

```bash
#!/bin/bash

# --- Configuration ---
CLAMAV_LOG="/var/log/clamav/clamscan.log"
TRANSFORMED_LOG="/var/log/clamav/transformed_clamscan.log"
SCRIPT_PATH="/usr/local/bin/clamav_transform.sh"
FILEBEAT_CONFIG="/etc/filebeat/filebeat.yml"
SCAN_DIR="/home"   # directory to scan

CRON_JOB_SCAN="0 6 * * * /usr/bin/clamscan -r $SCAN_DIR --log=$CLAMAV_LOG --infected --exclude-dir='^/sys' --quiet"
CRON_JOB_TRANSFORM="0 8 * * * $SCRIPT_PATH"

# Ensure necessary files exist
mkdir -p /var/log/clamav
touch "$TRANSFORMED_LOG"
chmod 644 "$TRANSFORMED_LOG"

# --- Create the transformation script ---
cat > "$SCRIPT_PATH" << 'EOF'
#!/bin/bash
INPUT_LOG="/var/log/clamav/clamscan.log"
OUTPUT_LOG="/var/log/clamav/transformed_clamscan.log"

> "$OUTPUT_LOG"

awk -v OUTPUT_LOG="$OUTPUT_LOG" '
BEGIN {
    start_date = ""
    scanned_files = 0
    infected_files = 0
    infected_details = ""
}
/Start Date:/     { start_date = $3 " " $4 }
/Scanned files:/  { scanned_files = $3 }
/Infected files:/ { infected_files = $3 }
/: .* FOUND/ {
    match($0, /(.*): (.*) FOUND/, arr)
    if (infected_details == "") {
        infected_details = arr[1] ": " arr[2]
    } else {
        infected_details = infected_details "," arr[1] ": " arr[2]
    }
}
/End Date:/ {
    log_line = start_date "," scanned_files "," infected_files
    if (infected_details != "") {
        log_line = log_line "," infected_details
    }
    print log_line >> OUTPUT_LOG
    start_date = ""; scanned_files = 0; infected_files = 0; infected_details = ""
}
' "$INPUT_LOG"
EOF

chmod +x "$SCRIPT_PATH"

# --- Setup cron jobs ---
(crontab -l 2>/dev/null | grep -Fv "$CRON_JOB_SCAN"; echo "$CRON_JOB_SCAN") | crontab -
(crontab -l 2>/dev/null | grep -Fv "$CRON_JOB_TRANSFORM"; echo "$CRON_JOB_TRANSFORM") | crontab -
echo "Cron jobs set for ClamAV scan and transformation."

# --- Filebeat input ---
echo -e "\nConfiguring Filebeat to monitor: $TRANSFORMED_LOG"
cat << EOF >> "$FILEBEAT_CONFIG"
  - type: log
    enabled: true
    paths:
      - /var/log/clamav/transformed_clamscan.log
    fields:
      log_type: clamav
    fields_under_root: true
    pipeline: clamav_log_pipeline
EOF

# --- Test and restart Filebeat ---
echo "Testing Filebeat config..."
if filebeat test config -c "$FILEBEAT_CONFIG"; then
    echo "Filebeat config OK. Restarting..."
    systemctl restart filebeat
    echo "Filebeat restarted successfully."
else
    echo "Filebeat config test failed. Fix issues in: $FILEBEAT_CONFIG"
    exit 1
fi
```

> La forme `match(..., arr)` d’`awk` nécessite **gawk** (`sudo apt install gawk`).

### 11.5 `letsencrypt-elk.sh` : surveillance de l’expiration des certificats

Déploie une vérification qui lit la date d’expiration de chaque certificat Let’s Encrypt et écrit une **ligne JSON** par certificat (chemin, date d’expiration, jours restants, hôte) dans `/var/log/letsencrypt_cert_expiry.log`. Filebeat l’envoie, et cron lance la vérification **chaque lundi à 6 h**.

```bash
#!/bin/bash
SCRIPT_PATH="/usr/local/bin/check_cert_expiry.sh"
LOG_FILE="/var/log/letsencrypt_cert_expiry.log"
LIVE_DIR="/etc/letsencrypt/live"
FILEBEAT_CONFIG="/etc/filebeat/filebeat.yml"
PIPELINE_NAME="cert_expiry_pipeline"

if [ ! -d "$LIVE_DIR" ]; then
    echo "[!] Directory $LIVE_DIR does not exist. No certs to monitor. Exiting."
    exit 0
fi

# --- Create the monitoring script ---
cat << 'EOF' > "$SCRIPT_PATH"
#!/bin/bash
LOG_FILE="/var/log/letsencrypt_cert_expiry.log"
BASE_DIR="/etc/letsencrypt/live"

[ ! -d "$BASE_DIR" ] && exit 0

# Truncate the log
> "$LOG_FILE"

for DIR in "$BASE_DIR"/*/; do
    DIR="${DIR%/}"
    CERT_PATH="$DIR/cert.pem"

    if [ -f "$CERT_PATH" ]; then
        EXPIRY_DATE_RAW=$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)
        EXPIRY_DATE_ISO=$(date -d "$EXPIRY_DATE_RAW" --iso-8601=seconds)
        DAYS_REMAINING=$(( ($(date -d "$EXPIRY_DATE_RAW" +%s) - $(date +%s)) / 86400 ))
        CURRENT_LOG_TIME=$(date --iso-8601=seconds)

        echo "{\"certificate_path\": \"$CERT_PATH\", \"log_generation_time\": \"$CURRENT_LOG_TIME\", \"expiry_date\": \"$EXPIRY_DATE_ISO\", \"days_remaining\": $DAYS_REMAINING, \"host\": \"$(hostname)\"}" >> "$LOG_FILE"
    fi
done
EOF

chmod +x "$SCRIPT_PATH"
echo "[+] Created script: $SCRIPT_PATH"

# --- Add Filebeat input if missing ---
if ! grep -q "$LOG_FILE" "$FILEBEAT_CONFIG"; then
    echo "[+] Adding Filebeat input for cert expiry logs..."
    cat << EOF >> "$FILEBEAT_CONFIG"
# CERTIFICATE EXPIRY MONITORING
  - type: log
    enabled: true
    paths:
      - $LOG_FILE
    fields:
      log_type: cert_expiry
    fields_under_root: true
    pipeline: $PIPELINE_NAME
EOF
else
    echo "[i] Filebeat input for $LOG_FILE already exists."
fi

echo "[+] Restarting Filebeat..."
systemctl restart filebeat

# --- Add cron job ---
CRON_JOB="0 6 * * 1 $SCRIPT_PATH"
if ! crontab -l 2>/dev/null | grep -Fq "$SCRIPT_PATH"; then
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "[+] Cron job added to crontab: $CRON_JOB"
else
    echo "[i] Cron job already exists for $SCRIPT_PATH"
fi

echo "[✔] Cert expiry monitoring deployed."
```

---

## 12. Automatisation avec Ansible

Pour déployer à grande échelle, j’ai écrit trois rôles Ansible :

- `filebeat`
- `metricbeat`
- `elastic_kibana`

### 12.1 Rôle : `filebeat`

Installe et configure Filebeat pour collecter les logs (y compris ceux des scripts personnalisés ci-dessus) et les envoyer de façon sécurisée à Elasticsearch.

**Fonctionnalités**

- Installer et configurer Filebeat.
- Gérer le keystore de Filebeat.
- Déployer et exécuter les scripts de transformation de logs personnalisés.
- Configurer les entrées de logs standard et personnalisées.
- Sécuriser la connexion à Elasticsearch (TLS + authentification).

**Prérequis**

- **Nœud de contrôle :** Ansible 2.10+, Python 3, `python3-apt`, `elasticsearch_password` dans Ansible Vault, `ca.crt` et les scripts (`login-ssh.sh`, `clamav-elk.sh`, `letsencrypt-elk.sh`) dans `roles/filebeat/files/`.
- **Cible :** Debian/Ubuntu, avec un accès réseau à Elasticsearch sur le port 9200.

**Variables** (toutes surchargeables)

| Variable | Description | Valeur par défaut |
|---|---|---|
| `elasticsearch_hosts` | Nom d’hôte ou IP d’Elasticsearch | `kibana.example.com` |
| `elasticsearch_password` | Mot de passe Elasticsearch | *(dans le Vault)* |
| `filebeat_log_paths` | Chemins des logs à surveiller | inclut `/var/log/login_data.log`, `/var/log/clamav/transformed_clamscan.log` |
| `filebeat_version` | Version de Filebeat | `8.13.4` |

Les scripts sont déployés dans `/opt/elk_custom_scripts/`.

> **Attention :** ces scripts modifient directement `filebeat.yml`, et le `filebeat.yml` généré par le template Ansible peut donc écraser leurs modifications. Vérifiez que chaque chemin de log figure bien dans le template.

**Utilisation**

```bash
ansible-playbook deploy_filebeat.yml -i inventory.ini --ask-vault-pass
```

### 12.2 Rôle : `metricbeat`

Installe et configure Metricbeat pour collecter les métriques système et applicatives (CPU, mémoire, réseau, processus) et les envoyer de façon sécurisée à Elasticsearch.

**Fonctionnalités**

- Installer et configurer Metricbeat.
- Gérer le keystore de Metricbeat.
- Activer des modules spécifiques (`system`, `elasticsearch`, `kibana`…).
- Sécuriser la connexion à Elasticsearch (TLS + authentification).

**Prérequis**

- **Nœud de contrôle :** Ansible 2.10+, Python 3, `python3-apt`, `elasticsearch_password` dans le Vault, `roles/metricbeat/files/ca.crt`.
- **Cible :** Debian/Ubuntu, avec un accès réseau à Elasticsearch (9200) et à Kibana (5601).

**Variables**

| Variable | Description | Valeur par défaut |
|---|---|---|
| `elasticsearch_hosts` | Nom d’hôte ou IP d’Elasticsearch | `kibana.example.com` |
| `kibana_host` | Nom d’hôte ou IP de Kibana | |
| `elasticsearch_password` | Mot de passe Elasticsearch | *(dans le Vault)* |
| `metricbeat_version` | Version de Metricbeat | `8.13.4` |

Le module `system` est activé par défaut. Pour ajouter des modules, modifiez `roles/metricbeat/tasks/_modules.yml` et/ou ajoutez des templates.

**Utilisation**

```bash
ansible-playbook deploy_metricbeat.yml -i inventory.ini --ask-vault-pass
```

### 12.3 Rôle : `elastic_kibana` *(non testé)*

Automatise le déploiement d’un **Elasticsearch mono-nœud** avec la sécurité X-Pack, de **Kibana**, de **Nginx** en reverse proxy et du HTTPS **Let’s Encrypt**. Il est pensé pour des serveurs neufs, par exemple lors d’une migration vers un nouveau fournisseur cloud.

**Ce qu’il met en place**

- **Elasticsearch (mono-nœud) :** sécurité X-Pack (TLS sur HTTP, mot de passe `elastic`, jeton d’enrôlement Kibana).
- **Kibana :** connexion sécurisée à Elasticsearch.
- **Nginx :** reverse proxy pour Kibana.
- **Certbot :** émission et renouvellement automatiques des certificats.
- **Prérequis système :** Java, limites noyau et système (`vm.max_map_count`, `nofile`, `nproc`), règles iptables.

**Points clés**

- Idempotent.
- HTTPS à l’intérieur de la stack (Elasticsearch et Kibana).
- **Réutilise une autorité de certification existante** pour signer le certificat du nouveau nœud : les Beats déjà en place font confiance au nouvel Elasticsearch sans aucun changement de leur côté.
- Version de Java, ports et domaine configurables.

**Prérequis**

- **Nœud de contrôle :** Ansible 2.10+, Python 3 + `python3-apt` (installé automatiquement s’il manque), `ELASTIC_PASSWORD` dans le Vault, les fichiers `ca.crt` et `ca.key` existants dans `roles/elastic_kibana/files/certs/ca/`.

  > **Attention :** `ca.key` est une clé privée sensible. Ne la commitez jamais ; ajoutez-la localement juste avant l’exécution.

- **VM cible :** Debian/Ubuntu ; un enregistrement DNS A public pour `kibana_fqdn` ; un pare-feu cloud autorisant en entrée les ports TCP 80 (Certbot), 443 (Kibana) et 9200 (Elasticsearch).

**Variables**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `java_version` | `11` | Version d’OpenJDK |
| `elastic_version` | `8.13.4` | Version d’Elasticsearch |
| `elasticsearch_http_port` | `9200` | Port d’Elasticsearch |
| `kibana_http_port` | `5601` | Port interne de Kibana (derrière Nginx) |
| `kibana_fqdn` | `kibana.example.com` | FQDN public de Kibana |
| `elastic_cert_name` | `elkstack-certs` | Nom de base des certificats générés pour le nœud |
| `certbot_email` | `admin@example.com` | E-mail de contact Let’s Encrypt |
| `elasticsearch_heap_size` | `8g` | Heap JVM, environ la moitié de la RAM de la VM |
| `certs_dir` | `/etc/elasticsearch/certs` | Répertoire des certificats sur la cible |
| `ca_control_path` | `{{ role_path }}/files/certs/ca` | Emplacement de l’autorité de certification sur le nœud de contrôle |
| `ELASTIC_PASSWORD` | *(dans le Vault)* | Mot de passe du superutilisateur `elastic` |

**Utilisation**

1. Définissez `kibana_fqdn` et `certbot_email` dans `group_vars/all/vars.yml` (ou `host_vars/`).
2. Définissez `ELASTIC_PASSWORD` dans `group_vars/all/vault.yml`.
3. Copiez `ca.crt` et `ca.key` dans `roles/elastic_kibana/files/certs/ca/`.
4. Lancez :

```bash
ansible-playbook deploy_elastic_kibana.yml -i inventory.ini --ask-vault-pass --ask-become-pass
```

**Remarques**

- **DNS :** `kibana_fqdn` doit pointer publiquement vers le serveur, sinon Certbot échoue.
- **Pare-feu :** iptables est configuré sur la VM, mais le pare-feu cloud doit aussi autoriser les ports 22, 80, 443, 9200 et 5601 selon les besoins.
- **Migration des données :** le rôle ne migre **pas** les données historiques. Utilisez les API Snapshot/Restore ou Reindex.
- **Objets enregistrés Kibana :** les tableaux de bord, visualisations, data views et politiques ILM doivent être importés manuellement (*Stack Management > Saved Objects* et Dev Tools).

---

## 13. Alertes

La version gratuite n’inclut pas de connecteur e-mail, j’ai donc utilisé un contournement. Chaque règle utilise une action **Server log** qui écrit une ligne structurée dans `kibana.log`. Un petit démon lit ce log en continu, analyse ces lignes et envoie les e-mails en SMTP.

### 13.1 Règles

L’action de chaque règle écrit un message de même forme, pour qu’un seul parseur les traite toutes :

```text
Server log: - AlertName: ...;- MonitorName: ...;- Reason: ...;- LastErrorMessage: ...;---
```

#### 13.1.1 Utilisation du CPU

Se déclenche lorsque l’utilisation CPU d’un serveur dépasse **80 %**. Vérifiée toutes les minutes.

![Règle d’utilisation du CPU](/images/elk/alert-cpu-rule.png)

![Action d’utilisation du CPU](/images/elk/alert-cpu-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: CPU {{context.metric}} value {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.2 Utilisation de la RAM

Se déclenche lorsque l’utilisation mémoire d’un serveur dépasse **70 %**. Vérifiée toutes les minutes.

![Règle d’utilisation de la RAM](/images/elk/alert-ram-rule.png)

![Action d’utilisation de la RAM](/images/elk/alert-ram-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: RAM metric {{context.metric}} observed {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.3 Utilisation du disque

Se déclenche lorsqu’un point de montage dépasse **80 %** d’utilisation. Vérifiée toutes les minutes.

![Règle d’utilisation du disque](/images/elk/alert-disk-rule.png)

![Action d’utilisation du disque](/images/elk/alert-disk-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: Disk metric {{context.metric}} observed {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.4 Domaine hors production indisponible

Se déclenche lorsqu’un point d’accès hors production (moniteur Heartbeat `All non-prod Endpoints`) est signalé **DOWN** au cours des 5 dernières minutes. Vérifiée toutes les minutes.

![Règle d’indisponibilité hors production](/images/elk/alert-nonprod-down-rule.png)

![Action d’indisponibilité hors production](/images/elk/alert-nonprod-down-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.monitorName}};- Reason: {{context.statusMessage}} ({{context.monitorUrl}} from {{context.observerLocation}});- LastErrorMessage: {{context.latestErrorMessage}} checked at {{context.checkedAt}};---
```

#### 13.1.5 Domaine de production indisponible

Se déclenche lorsqu’un site de production (moniteur `Production Websites`) est signalé **DOWN au moins 3 fois en 5 minutes**. Exiger plusieurs échecs réduit les faux positifs dus à des coupures passagères. Vérifiée toutes les minutes.

![Règle d’indisponibilité en production](/images/elk/alert-prod-down-rule.png)

![Action d’indisponibilité en production](/images/elk/alert-prod-down-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.monitorName}};- Reason: {{context.statusMessage}} ({{context.monitorUrl}} from {{context.observerLocation}});- LastErrorMessage: {{context.latestErrorMessage}} checked at {{context.checkedAt}};---
```

#### 13.1.6 Modification de fichiers sensibles

Se déclenche à chaque **création, modification ou suppression** de fichiers critiques :
`/etc/passwd`, `/etc/shadow`, `/etc/ssh/sshd_config`, `/etc/sudoers`, `/etc/cron.d/*`, `/etc/group`. Vérifiée toutes les 10 secondes.

![Règle de modification de fichiers sensibles](/images/elk/alert-sensitive-file-rule.png)

Requête KQL :

```text
file.path : (
  "/etc/passwd" or
  "/etc/shadow" or
  "/etc/ssh/sshd_config" or
  "/etc/sudoers" or
  "/etc/cron.d/*" or
  "/etc/group"
) AND
event.type : ("creation" or "deletion" or "change")
```

![Action de modification de fichiers sensibles](/images/elk/alert-sensitive-file-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.value.host.name}};- Reason: Suspicious file change detected;- LastErrorMessage: File change met {{context.conditions}} at {{context.date}};---
```

#### 13.1.7 Brute force SSH

Se déclenche lorsque **plus de 10 connexions SSH échouées** se produisent sur un hôte en 5 minutes.

![Règle de brute force SSH](/images/elk/alert-ssh-bruteforce-rule.png)

![Action de brute force SSH](/images/elk/alert-ssh-bruteforce-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: SSH brute force suspected;- LastErrorMessage: {{context.matchingDocuments}} log entries matched conditions {{context.conditions}};---
```

### 13.2 Service de notification par e-mail

#### Le script d’envoi : `/etc/kibana/kibana_mailer.sh`

Il lit le log de Kibana en temps réel. Lorsqu’il repère une ligne d’alerte, il en extrait le nom de l’alerte, l’hôte, la raison et le message d’erreur, nettoie le format pour certains types d’alertes (CPU, SSH), puis envoie un e-mail en SMTP avec `swaks`.

```bash
#!/bin/bash
LOG="/var/log/kibana/kibana.log"

# SMTP settings (better: load these from a root-only env file)
SMTP_SERVER="<SMTP_SERVER>"          # e.g. smtp.office365.com
SMTP_PORT="587"
SMTP_USER="<SMTP_USER>"              # e.g. noreply@example.com
SMTP_PASSWORD="<SMTP_PASSWORD>"
MAIL_FROM="noreply@example.com"
MAIL_TO="alerts@example.com"

tail -F "$LOG" | \
grep --line-buffered "Server log:" | \
while read -r line; do
    ALERT=$(echo "$line"  | sed -n 's/.*AlertName: \(.*\);- MonitorName:.*/\1/p')
    HOST=$(echo "$line"   | sed -n 's/.*MonitorName: \(.*\);- Reason:.*/\1/p')
    REASON=$(echo "$line" | sed -n 's/.*Reason: \(.*\);- LastErrorMessage:.*/\1/p')
    ERR=$(echo "$line"    | sed -n 's/.*LastErrorMessage: \(.*\);---.*/\1/p')

    # Clean up the CPU condition JSON
    if echo "$ALERT" | grep -qi "cpu"; then
        ERR=$(echo "$ERR" | \
            sed 's/{\\"condition0\\":\\"//g' | \
            sed 's/\\"}//g' | \
            sed 's/\\"/"/g')
    fi

    # Human-friendly SSH brute force message
    if echo "$ALERT" | grep -qi "ssh"; then
        COUNT=$(echo "$ERR" | grep -oE "[0-9]+ log entries" | grep -oE "[0-9]+")
        if [ -n "$COUNT" ]; then
            ERR="$COUNT failed SSH authentication attempts detected on $HOST"
        else
            ERR="Multiple failed SSH authentication attempts detected on $HOST"
        fi
    fi

    /usr/bin/swaks \
        --to "$MAIL_TO" \
        --from "$MAIL_FROM" \
        --server "$SMTP_SERVER" \
        --port "$SMTP_PORT" \
        --auth LOGIN \
        --auth-user "$SMTP_USER" \
        --auth-password "$SMTP_PASSWORD" \
        --tls \
        --header "Subject: [ELK-Alert] $ALERT - $HOST" \
        --body "Host : $HOST\n\nReason : $REASON\n\nDetails: $ERR"
done
```

Restreignez les permissions, puisque le fichier contient des identifiants SMTP :

```bash
sudo chmod 700 /etc/kibana/kibana_mailer.sh
```

#### Service systemd : `/etc/systemd/system/kibana-mailer.service`

```ini
[Unit]
Description=Kibana alert mailer
After=kibana.service

[Service]
ExecStart=/etc/kibana/kibana_mailer.sh
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kibana-mailer
```

---

## 14. Journal de dépannage

Les vrais problèmes rencontrés pendant le déploiement, et comment je les ai résolus.

### 14.1 Elasticsearch tué par l’OOM killer

**Symptôme**

```text
elasticsearch.service: A process of this unit has been killed by the OOM killer.
exit code 137 / 'oom-kill'
```

L’**OOM killer** de Linux intervient quand la RAM est épuisée et que le swap ne suffit pas. Il tue un processus (SIGKILL) pour sauver le système. Elasticsearch est généralement la victime, car c’est le plus gros consommateur de mémoire (heap Java) et son score OOM est élevé.

**Cause**

- Heap d’ES trop grand pour la RAM disponible.
- Trop d’autres services en concurrence (Kibana, OS, agents…).
- Pas ou trop peu de swap.

Règle empirique : **heap d’ES ≤ 50 % de la RAM physique**, avec `Xms = Xmx`.

**Diagnostic**

```bash
dmesg | grep -i "killed process"
journalctl -k | grep -i "out of memory"
```

Cherchez une ligne indiquant que le processus Java d’Elasticsearch a été tué.

**Correction**

1. **Réduire le heap** dans `/etc/elasticsearch/jvm.options.d/heap.options` :
   ```text
   -Xms1g
   -Xmx1g
   ```
2. **Libérer de la RAM** : déplacer Kibana ou d’autres services gourmands sur un autre hôte, arrêter les processus non essentiels.
3. **Ajouter du swap** temporairement. Cela évite les arrêts brutaux mais dégrade les performances.
4. **Surveiller la mémoire :**
   ```bash
   free -h
   top -o %MEM
   ```

**En bref** : la machine a manqué de RAM et le noyau a tué Elasticsearch. Réduisez le heap ou ajoutez de la mémoire ou du swap, puis redémarrez.

### 14.2 « Proxy Error » sur Kibana après l’activation de TLS

**Symptôme**

Après avoir défini `server.ssl.enabled: true` dans Kibana, l’accès via le reverse proxy échoue :

```text
Error: Proxy Error
    at Fetch.fetchResponse (...)
```

Kibana fonctionne très bien quand TLS est désactivé.

**Cause**

- Le proxy parle toujours en **HTTP** au back-end, alors que Kibana écoute désormais en **HTTPS**.
- Le schéma de `ProxyPass` ne correspond pas au mode TLS de Kibana.
- Certificat ou clé de Kibana absents, ou mal référencés dans `kibana.yml`.

**Diagnostic**

```bash
# Is Kibana listening?
ss -ltnp | grep 5601

# Direct TLS test (bypassing the proxy)
openssl s_client -connect kibana.example.com:5601 \
  -servername kibana.example.com \
  -CAfile /etc/ssl/certs/kibana-backend-ca.crt \
  -verify_return_error </dev/null | grep -E 'subject=|issuer=|Verify return code'
```

Côté Apache : avec Kibana en HTTPS, `SSLProxyEngine on` doit être défini et `ProxyPass` doit utiliser `https://`.

**Correction**

```yaml
# kibana.yml
server.ssl.enabled: true
server.ssl.certificate: /etc/kibana/certs/kibana-server.crt
server.ssl.key: /etc/kibana/certs/kibana-server.key
```

```apache
SSLProxyEngine on
ProxyPass        / https://kibana.example.com:5601/
ProxyPassReverse / https://kibana.example.com:5601/
```

*(Si vous gardez Kibana en HTTP, utilisez `http://` et désactivez `server.ssl.enabled`.)*

```bash
sudo systemctl restart kibana apache2
```

**En bref** : alignez le schéma utilisé par le proxy vers le back-end sur le mode TLS de Kibana.

### 14.3 Incohérence de nom d’hôte TLS avec les noms internes

**Symptôme**

Les connexions d’Apache vers Fleet Server et Elasticsearch échouaient avec des erreurs TLS de **nom d’hôte incohérent** (hostname mismatch), alors que les certificats étaient valides.

**Cause**

- Avec `SSLProxyCheckPeerName on`, Apache **vérifie le SAN du certificat du back-end**.
- Les certificats initiaux ne contenaient que `DNS:kibana.example.com, IP:<ELK_SERVER_IP>`.
- Apache appelait `fleet.int.local` / `es.int.local`, qui ne figuraient pas dans le SAN : la négociation TLS échouait.
- Appeler une IP brute (`https://<ELK_SERVER_IP>:8220`) aggrave les choses : TLS exige alors un SAN `IP:`, souvent absent quand les certificats sont générés avec un FQDN uniquement.

**Diagnostic**

```bash
openssl x509 -in /etc/fleet/certs/fleet-server.crt -noout -text | grep -A1 "Subject Alternative Name"
journalctl -u apache2 -e | grep SSL
```

**Correction**

1. Régénérer les certificats du back-end avec les bons SAN :
   ```bash
   # Elasticsearch
   /usr/share/elasticsearch/bin/elasticsearch-certutil cert --pem \
     --ca-cert /etc/elasticsearch/certs/elasticsearch.crt \
     --ca-key  /etc/elasticsearch/certs/elasticsearch.key \
     --name elasticsearch-http --dns es.int.local --ip <ELK_SERVER_IP> \
     --out /etc/elasticsearch/certs/elasticsearch-http.zip

   # Fleet Server
   /usr/share/elasticsearch/bin/elasticsearch-certutil cert --pem \
     --ca-cert /etc/elasticsearch/certs/elasticsearch.crt \
     --ca-key  /etc/elasticsearch/certs/elasticsearch.key \
     --name fleet-server --dns fleet.int.local --ip <ELK_SERVER_IP> \
     --out /etc/fleet/certs/fleet-server.zip
   ```
2. Les installer et redémarrer :
   ```bash
   unzip -o /etc/fleet/certs/fleet-server.zip -d /etc/fleet/certs/
   unzip -o /etc/elasticsearch/certs/elasticsearch-http.zip -d /etc/elasticsearch/certs/
   systemctl restart elastic-agent elasticsearch
   ```
3. Faire pointer Apache vers les **noms internes**, et non vers des IP brutes :
   ```apache
   SSLProxyEngine on
   SSLProxyVerify require
   SSLProxyCheckPeerName on

   ProxyPass        /fleet/ https://fleet.int.local:8220/
   ProxyPassReverse /fleet/ https://fleet.int.local:8220/
   ProxyPass        /es/    https://es.int.local:9200/
   ProxyPassReverse /es/    https://es.int.local:9200/
   ```

**En bref** : mettez dans le SAN du certificat chaque nom que vous utiliserez pour vous connecter, et faites pointer le proxy vers des noms, pas des IP.

### 14.4 Erreur 404 de Fleet Server (mauvais chemin d’API)

**Symptôme**

Pendant l’enrôlement d’un agent :

```text
fleet server ping returned a bad status code: 404
error loading agent config: no fleet config retrieved yet
```

- `https://kibana.example.com/fleet/api/status` renvoie **HEALTHY**
- `https://kibana.example.com/api/status` renvoie **404**

**Cause**

Le proxy n’expose Fleet Server que sous `/fleet/`, mais l’agent appelait `/api/status` à la racine. Le point de contrôle de santé officiel est `https://<fleet-server>:8220/api/status` : derrière un proxy basé sur des chemins, l’URL de l’hôte Fleet doit donc inclure le préfixe `/fleet`.

**Diagnostic**

```bash
# Fleet Server hosts configured in Kibana
curl -sk -u elastic:<ELASTIC_PASSWORD> https://kibana.example.com/api/fleet/settings | jq
# fleet_server_hosts should be ["https://kibana.example.com/fleet"]

# Which path is the agent calling?
journalctl -u elastic-agent -e --no-pager | grep "fleet"
```

**Correction**

```bash
curl -sk -u elastic:<ELASTIC_PASSWORD> -X PUT \
  https://kibana.example.com/api/fleet/settings \
  -H 'kbn-xsrf: true' \
  -H 'Content-Type: application/json' \
  -d '{ "fleet_server_hosts": ["https://kibana.example.com/fleet"] }'
```

- Dans Kibana : **Fleet > Settings / Fleet Server policy**, vérifiez que l’URL inclut `/fleet`.
- Redéployez la politique et redémarrez l’agent : `systemctl restart elastic-agent`.
- Test : `curl -sk https://kibana.example.com/fleet/api/status` doit renvoyer `HEALTHY`.

**En bref** : derrière un proxy basé sur des chemins, `fleet_server_hosts` doit inclure le préfixe du chemin.

### 14.5 Agents enrôlés mais aucune donnée (mauvaise sortie Fleet)

**Symptôme**

Les agents sont enrôlés et apparaissent **HEALTHY** dans Fleet, mais les logs et métriques sont absents, ou les logs de l’agent montrent des erreurs TLS ou de connexion vers Elasticsearch. Corriger l’URL de Fleet Server ne suffisait pas : les agents envoyaient toujours leurs données vers la **mauvaise URL Elasticsearch** (schéma, hôte, port ou autorité de certification).

**Cause**

- La **sortie Elasticsearch** de Fleet était mal configurée :
  - mauvais **hôte** (par exemple `http://localhost:9200` au lieu de `https://es.int.local:9200`),
  - **autorité de certification absente ou incorrecte**,
  - **proxy** intermédiaire non pris en compte.
- La **licence gratuite n’autorise qu’une seule sortie Elasticsearch** : tous les agents partagent donc la même destination. Des sorties par politique nécessitent une offre payante.
- Fleet Server fonctionnait, alors que la sortie était cassée.

**Diagnostic**

```bash
# Fleet Server hosts
curl -sk -u elastic:<ELASTIC_PASSWORD> https://kibana.example.com/api/fleet/settings | jq

# Outputs: check hosts, ssl.certificate_authorities / ca_trusted_fingerprint, duplicates
curl -sk -u elastic:<ELASTIC_PASSWORD> "https://kibana.example.com/api/fleet/outputs?perPage=100" | jq

# Where is the agent trying to send data?
journalctl -u elastic-agent -e --no-pager | grep -Ei "output|elasticsearch|certificate|tls|x509|handshake"

# Direct ES test with the backend CA
curl -v --resolve es.int.local:9200:<ELK_SERVER_IP> \
  https://es.int.local:9200/_cluster/health \
  --cacert /etc/ssl/certs/elasticsearch-backend-ca.crt
```

**Correction**

1. **Supprimer les sorties en trop** (une seule est autorisée avec la licence gratuite).
2. **Corriger la sortie par défaut** : *Fleet > Settings > Outputs > Default output* :
   - **Hosts** : `https://es.int.local:9200` (ou via le proxy : `https://kibana.example.com/es/`)
   - **SSL / CA** : coller l’autorité de certification du back-end Elasticsearch
3. Ou via l’API :
   ```bash
   curl -sk -u elastic:<ELASTIC_PASSWORD> -X PUT \
     https://kibana.example.com/api/fleet/outputs/<OUTPUT_ID> \
     -H 'kbn-xsrf: true' -H 'Content-Type: application/json' \
     -d '{
       "name": "default",
       "type": "elasticsearch",
       "is_default": true,
       "hosts": ["https://es.int.local:9200"],
       "ssl": {
         "certificate_authorities": ["-----BEGIN CERTIFICATE-----\n...CA...\n-----END CERTIFICATE-----\n"]
       }
     }'
   ```
4. **Redéployer toutes les politiques** pour que chaque agent récupère l’unique sortie.
5. `systemctl restart elastic-agent`

**En bref** : une seule sortie avec la licence gratuite. Configurez-la correctement (hôte + autorité de certification) et redéployez.

---

## 15. Ce qu’il faut retenir

- **TLS est la partie la plus difficile.** La plupart de mes problèmes venaient d’incohérences de SAN, de schéma (HTTP ou HTTPS) et de chemins de proxy. Planifiez vos noms d’hôte *avant* de générer les certificats.
- **Derrière un reverse proxy, chaque URL compte.** Les hôtes Fleet Server, les sorties et `publicBaseUrl` doivent tous correspondre à ce que le proxy expose réellement.
- **Connaître les limites de la version gratuite.** Une seule sortie Fleet et l’absence de connecteur e-mail ont façonné l’architecture (une sortie pour tous, et le contournement d’envoi d’e-mails basé sur les logs).
- **Dimensionner le heap avec soin** sur une installation mono-nœud partagée avec Kibana et Fleet.
- **Automatiser tôt.** Les rôles Ansible et les scripts de keystore ont permis de déployer les Beats sur de nombreux serveurs sans exposer d’identifiants dans les fichiers de configuration.
