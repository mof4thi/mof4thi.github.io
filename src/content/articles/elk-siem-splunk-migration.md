---
title: 'Building a self-hosted SIEM with the Elastic Stack (ELK + Fleet)'
date: 2026-11-24
summary: How I replaced Splunk with a single-node Elastic Stack during my apprenticeship, covering TLS end to end, Fleet-managed agents, uptime monitoring, email alerting on the free tier, Ansible roles, and every problem I hit along the way.
category: blue-team
tags: [elk, siem, fleet, kibana, ansible, tls]
---

> A hands-on guide to deploying a single-node Elastic Stack as an open-source alternative to Splunk for centralized logging, metrics, uptime monitoring and security alerting, all secured with TLS end to end.

## Placeholders used in this guide

Replace these with your own values before running anything:

| Placeholder | Meaning |
|---|---|
| `<ELK_SERVER_IP>` | Private IP of the ELK server (Elasticsearch + Kibana + Fleet Server) |
| `<PROXY_PRIVATE_IP>` | Private IP of the Apache reverse proxy |
| `kibana.example.com` | Public FQDN used to reach Kibana (and Fleet, via the proxy) |
| `es.int.local` / `fleet.int.local` | Internal hostnames for Elasticsearch and Fleet Server (must be in the cert SANs) |
| `<ELASTIC_PASSWORD>` | Password of the built-in `elastic` superuser |
| `<FLEET_SERVICE_TOKEN>` | Service token generated for Fleet Server |
| `<ENROLLMENT_TOKEN>` | Fleet enrollment token for client agents |
| `<SMTP_*>` / `alerts@example.com` | SMTP settings and recipient for alert emails |

---

## 1. Introduction

### 1.1 Goals

The goal of this project was to evaluate the **ELK stack (Elasticsearch, Logstash, Kibana)** as an open-source alternative to **Splunk** for the **centralization**, **analysis** and **visualization** of system logs and metrics.

More specifically:

- Explore the features of the free Elastic stack versus the paid tiers (Platinum / Enterprise).
- Evaluate a centralized deployment of ELK on a **single server**.
- Deploy log and metric forwarders (**Filebeat**, **Metricbeat**, then **Elastic Agent** managed by **Fleet**).
- Visualize the data in **Kibana**: CPU, RAM, SSH logins, ClamAV scans, SSL certificate expiry, and more.
- Assess the stack's performance and visualization capabilities.

### 1.2 Context

Infrastructure monitoring relies more and more on **centralized log collection** and **real-time event analysis**. Tools like Splunk are popular, but their **high cost** and **proprietary licensing** push many teams to look for open-source alternatives.

The Elastic Stack is a strong candidate. It is free in its basic tier, widely adopted, and lets you:

- Centralize logs from many servers.
- Analyze and correlate system, network and security data.
- Build dynamic dashboards for monitoring and alerting.

This guide covers a deployment designed to monitor a fleet of a couple hundred Linux servers for **monitoring, traceability and security**.

---

## 2. Architecture

![Architecture overview](/images/elk/architecture.png)

*Agents ship data straight to Elasticsearch, while Fleet Server only manages them (enrollment, policies, check-in). Analysts reach Kibana through the Apache reverse proxy, and alerts go out by email through the mailer service.*

### 2.1 Components

| Component | Role |
|---|---|
| **Elastic Agent** | Unified agent that **collects logs, metrics, traces and events** (observability and security). It applies a **policy** defined in **Fleet** and ships data **directly to Elasticsearch**. It can also provide **endpoint protection** (Elastic Security). |
| **Fleet Server** | **Centralized management** of Elastic Agents. It distributes **policies**, handles agent **enrollment** and coordinates upgrades. It reads and writes its state in the **Fleet indices** stored in Elasticsearch. |
| **Elasticsearch** | Distributed **storage, indexing and search engine**. It stores incoming data (from Elastic Agent or Logstash), indexes it and enables **real-time search and analytics**. |
| **Kibana** | **Web UI** for visualization and management: **dashboards**, **Fleet policies**, cluster health, alerting, and security/observability apps. |

### 2.2 How Fleet Server works

1. When a new policy is created, the Fleet UI stores it in a Fleet index in Elasticsearch.
2. To enroll in a policy, Elastic Agents send a request to Fleet Server, authenticating with an **enrollment key**.
3. Fleet Server watches the Fleet indices, picks up the new agent policy from Elasticsearch and sends it to every agent enrolled in it.
   - *Fleet Server can also write updated policies back to the Fleet index to coordinate agents.*
4. Elastic Agent uses the configuration in the policy to collect data and ship it to Elasticsearch.
5. Elastic Agent checks in with Fleet Server for updates, keeping a long-lived connection open.
6. When a policy is updated, Fleet Server fetches the new version and pushes it to connected agents.
7. Fleet Server writes agent status and policy rollout updates back to the Fleet indices.

### 2.3 Data flows at a glance

- **Elastic Agent**: collects and ships data to **Elasticsearch**.
- **Fleet Server**: controls and supervises Elastic Agents.
- **Elasticsearch**: stores and indexes everything.
- **Kibana**: explores and visualizes the data, and manages the stack.

---

## 3. Prerequisites

This guide walks through a standard, secured installation of an Elastic Stack (Elasticsearch, Kibana, Fleet) behind an **Apache reverse proxy**, with **Let's Encrypt** certificates for the public endpoint and an internal CA for the backend.

- An **Ubuntu/Debian** dedicated server or VM hosting:
  - Elasticsearch
  - Fleet Server
  - Kibana
- A **public DNS record** for the reverse proxy and Let's Encrypt.
- Open network ports:
  - **9200**: Elasticsearch REST API
  - **5601**: Kibana
  - **8220**: Fleet Server (Elastic Agent communication)
- Dedicated storage for **snapshots**.
- A user with **sudo** privileges.

Install the system dependencies:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install openjdk-11-jdk -y   # optional: Elasticsearch 8.x ships its own JDK
java -version
sudo apt install certbot unzip jq -y
```

---

## 4. Installing Elasticsearch & Kibana

### 4.1 Add the official Elastic repository

```bash
curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | sudo gpg --dearmor -o /usr/share/keyrings/elastic.gpg
echo "deb [signed-by=/usr/share/keyrings/elastic.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/elastic-8.x.list
sudo apt update
```

### 4.2 Install Elasticsearch and Kibana

```bash
sudo apt install elasticsearch kibana -y
```

### 4.3 Enable and start the services

```bash
sudo systemctl enable --now elasticsearch
sudo systemctl enable --now kibana
```

### 4.4 Check the services

```bash
sudo systemctl status elasticsearch
sudo systemctl status kibana
```

---

## 5. Securing Elasticsearch & Managing Users

### 5.1 Mandatory passwords and tokens (8.x+)

> **Warning:** The passwords and tokens generated here **cannot be retrieved later**. Store them immediately in a password manager (KeePass, Bitwarden, Vault…).

```bash
# Reset / set the password of the built-in 'elastic' superuser
sudo /usr/share/elasticsearch/bin/elasticsearch-reset-password -u elastic

# Create an enrollment token for Kibana
sudo /usr/share/elasticsearch/bin/elasticsearch-create-enrollment-token -s kibana

# Get the Kibana verification code (asked during first Kibana setup)
sudo /usr/share/kibana/bin/kibana-verification-code
```

### 5.2 Network access

Kibana (port 5601) should **not** be exposed directly. Only the reverse proxy is allowed to reach it. In my case the server ran on Azure, so this was an NSG rule allowing **TCP 5601** from the proxy's private IP to the ELK server only:

![Firewall rule: allow proxy to Kibana on 5601](/images/elk/nsg-rule-kibana-5601.png)

Any cloud security group or host firewall works the same way. With `ufw`:

```bash
sudo ufw allow from <PROXY_PRIVATE_IP> to any port 5601 proto tcp
```

### 5.3 Creating users

Avoid using `elastic` day-to-day. Create named users instead:

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

I also wrote a small interactive Bash helper (`create_user_elk.sh`) that wraps this API call. Example session:

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

**Or from the Kibana UI:** *Management > Stack Management > Security > Users > Create user*.

---

## 6. TLS Everywhere: Certificates & Reverse Proxy

The stack has **three TLS hops**, each handled separately:

```
Browser ──(Let's Encrypt)──▶ Apache proxy ──(internal CA)──▶ Kibana ──(internal CA)──▶ Elasticsearch
```

### 6.1 Elasticsearch HTTP layer (internal CA)

#### 6.1.1 Create an HTTP CA in PEM format

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

> In the rest of this guide, `elasticsearch.crt` / `elasticsearch.key` are the **CA** cert and key.

#### 6.1.2 Generate the Elasticsearch HTTPS certificate

The SAN **must** include every name and IP clients will use (see [Troubleshooting 14.3](#143-tls-hostname-mismatch-with-internal-names)).

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

#### 6.1.3 Configure Elasticsearch: `/etc/elasticsearch/elasticsearch.yml`

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

#### 6.1.4 Configure Kibana to trust Elasticsearch: `/etc/kibana/kibana.yml`

```yaml
elasticsearch.hosts: ["https://<ELK_SERVER_IP>:9200"]
elasticsearch.ssl.certificateAuthorities: ["/etc/kibana/certs/elasticsearch-ca.crt"]
```

```bash
sudo systemctl restart kibana
```

#### 6.1.5 Verify (TLS + auth)

```bash
curl --cacert /etc/kibana/certs/elasticsearch-ca.crt -u elastic https://<ELK_SERVER_IP>:9200/
```

### 6.2 Kibana and Apache (internal reverse proxy hop)

#### 6.2.1 Generate the Kibana server certificate (on the ELK server)

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

#### 6.2.2 Enable HTTPS on Kibana: `/etc/kibana/kibana.yml`

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

#### 6.2.3 On the Apache proxy: trust the Kibana CA

Copy the CA (`/etc/elasticsearch/certs/elasticsearch.crt`) from the ELK server to the proxy as `/etc/ssl/certs/kibana-backend-ca.crt`, then:

```bash
sudo chmod 644 /etc/ssl/certs/kibana-backend-ca.crt
# Resolve the public name to the backend's private IP from the proxy
echo "<ELK_SERVER_IP> kibana.example.com" | sudo tee -a /etc/hosts
```

#### 6.2.4 Strict TLS proxying in the 443 vhost

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

#### 6.2.5 Verify

From the proxy, check Kibana's certificate and name:

```bash
openssl s_client -connect kibana.example.com:5601 \
  -servername kibana.example.com \
  -verify_hostname kibana.example.com \
  -CAfile /etc/ssl/certs/kibana-backend-ca.crt -verify_return_error </dev/null \
  | grep -E 'subject=|issuer=|Verify return code'
```

Through Apache's local vhost:

```bash
curl -I --resolve kibana.example.com:443:127.0.0.1 https://kibana.example.com
```

*Expected: `200` or `302`. `--resolve` tests the local vhost without depending on public DNS.*
*A `502` means a TLS problem between Apache and Kibana (invalid cert or SAN mismatch).*

### 6.3 Apache and the browser (public certificate)

> **Warning:** **Before** requesting Let's Encrypt certificates, create the DNS record at your DNS provider:
> `kibana.example.com` pointing to the public IP of the Apache proxy.
> Without it, Let's Encrypt validation fails and browsers can't resolve the name.

```bash
dig +short kibana.example.com
nc -vz kibana.example.com 443
```

#### 6.3.1 HTTP > HTTPS redirect

`/etc/apache2/sites-available/kibana.example.com.conf`:

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

#### 6.3.2 Let's Encrypt certificate + HTTPS vhost

```bash
sudo certbot --apache -d kibana.example.com
```

`--apache` **obtains** and **installs** the certificate in Apache (`/etc/letsencrypt/live/kibana.example.com/{fullchain.pem,privkey.pem}`) and schedules auto-renewal.

`/etc/apache2/sites-available/kibana.example.com-le-ssl.conf`:

```apache
SSLCertificateFile    /etc/letsencrypt/live/kibana.example.com/fullchain.pem
SSLCertificateKeyFile /etc/letsencrypt/live/kibana.example.com/privkey.pem
```

```bash
sudo a2ensite kibana.example.com-le-ssl.conf
sudo apachectl -t && sudo systemctl reload apache2
```

#### 6.3.3 Verify the redirect

```bash
curl -I http://kibana.example.com
# HTTP/1.1 301 Moved Permanently → https://kibana.example.com/
```

---

## 7. Fleet Server

### 7.1 Install Elastic Agent

```bash
sudo apt install elastic-agent -y
which elastic-agent
elastic-agent version
```

### 7.2 Configure Fleet Server

**Generate a TLS certificate for Fleet Server**, signed by the same internal CA:

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

**Check the Fleet outputs** (the default output should point to `https://<ELK_SERVER_IP>:9200` or `https://es.int.local:9200` with the right CA):

```bash
curl -u elastic:"$PASS" https://kibana.example.com/api/fleet/outputs | jq .
```

**Create a service token** for the `elastic/fleet-server` service account:

```bash
curl -u elastic:"$PASS" --cacert /etc/elasticsearch/certs/elasticsearch.crt -X POST \
  https://<ELK_SERVER_IP>:9200/_security/service/elastic/fleet-server/credential/token
```

**Enroll Fleet Server:**

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

Then add the CA to the system trust store so the agent trusts it:

```bash
sudo cp /etc/elasticsearch/certs/elasticsearch.crt /usr/local/share/ca-certificates/es-ca.crt
sudo update-ca-certificates
```

### 7.3 Verify

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

## 8. Enrolling Elastic Agents on Client Machines

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

> The enrollment token is found in Kibana under **Fleet > Enrollment tokens**, one per policy.

---

## 9. Fleet Policies & Integrations

### 9.1 What a policy is

A Fleet **policy** is a centralized configuration applied to a group of Elastic Agents. It bundles one or more **integrations** (ready-made modules) and defines what agents collect and where they send it.

- **Policy** = the container.
- **Integration** = what to collect (logs, metrics, security events…).
- **Agent** = runs the policy locally.

### 9.2 Why it's useful

- **Centralization**: configure once in Kibana and every agent applies it.
- **Flexibility**: each group of agents gets its own policy (clients, servers, Fleet…).
- **Scalability**: adding an integration deploys it automatically to every agent in the policy.
- **Consistency**: same dashboards and ingest pipelines everywhere.

### 9.3 Other integrations worth knowing

- **NGINX / Apache HTTPD**: web server and reverse proxy logs and metrics.
- **MySQL / PostgreSQL**: database logs and metrics.
- **Kubernetes**: pods, nodes and container logs.
- **Elastic Defend (Endpoint Security)**: native EDR.
- **AWS / GCP / Azure**: cloud logs and metrics.

Add any of them via **Fleet > Agent policies > Add integration**, and they roll out to the agents automatically.

### 9.4 Fleet Server policy

Dedicated to the Fleet Server host:

- **fleet_server**: enables the Fleet Server role (agent management and orchestration).
- **System**: logs and metrics of the Fleet host itself.

So the Fleet Server **monitors itself** while managing the other agents.

### 9.5 Clients policy

Applied to the monitored servers (~50 agents in this deployment):

- **System**: syslog and `auth.log` plus CPU, memory and disk metrics.
- **Osquery Manager**: SQL-style queries against hosts (inventory, security, forensics).
- **ClamAV logs**: antivirus logs collected via a Filestream input.

This policy covers **antivirus, system health and advanced Osquery queries** on all client hosts.

> *Next step: ship the custom logs from section 11 through native Fleet integrations instead of scripts.*

---

## 10. Uptime Monitoring with Heartbeat

Heartbeat checks the **availability of websites, services and applications**. Here it runs periodic HTTP/HTTPS checks against all web endpoints, measures response times and detects outages. Results go to Elasticsearch and show up in Kibana's Uptime / Synthetics app, which also drives alerting (see [13.1.4](#1314-non-prod-domain-down)).

**Install:**

```bash
sudo apt-get install heartbeat-elastic
```

**Configure** `/etc/heartbeat/heartbeat.yml`:

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

**Notes:**

- Splitting **prod** and **non-prod** into separate monitors makes it possible to alert on them with different sensitivity.
- `schedule` sets the check interval (every minute here).
- `401`/`403` count as "up". The service is answering, it's just behind authentication.

**Verify:**

```bash
sudo heartbeat test config      # fix YAML syntax if this fails
sudo systemctl enable --now heartbeat-elastic
sudo heartbeat test output
journalctl -u heartbeat-elastic -f
```

---

## 11. Custom Log Collection Scripts

Before (and alongside) Fleet, I wrote a few scripts to turn raw logs into structured data Filebeat can ship to dedicated ingest pipelines.

### 11.1 `system.yml` (Filebeat system module)

```yaml
- module: system
  syslog:
    enabled: true
  auth:
    enabled: true
```

### 11.2 `keystore-create.sh`: secure the `elastic` password in every Beat

Stores the Elasticsearch password in each Beat's keystore so it never appears in plain text in the YAML configs.

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

### 11.3 `login-ssh.sh`: structured SSH login events

This script:

1. Creates a transformation script that extracts SSH login attempts (success, failure, invalid user) from `auth.log` (or `secure` on RHEL), formats them as CSV and appends them to `/var/log/login_data.log`. A **checkpoint file** makes sure only new lines are processed.
2. Adds a **cron job** to run it every minute.
3. Adds a Filebeat input for the new log file and restarts Filebeat.

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

> **Note:** If your `filebeat.yml` already defines `filebeat.inputs:`, merge the snippet into that list rather than adding a second top-level key.

### 11.4 `clamav-elk.sh`: antivirus scan results

Schedules a **daily ClamAV scan**, transforms the scan summary into a structured CSV line (date, scanned files, infected files, details) and configures Filebeat to ship it.

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

> The `awk` `match(..., arr)` form requires **gawk** (`sudo apt install gawk`).

### 11.5 `letsencrypt-elk.sh`: certificate expiry monitoring

Deploys a check that reads the expiry date of every Let's Encrypt certificate and writes a **JSON line** per cert (path, expiry date, days remaining, host) to `/var/log/letsencrypt_cert_expiry.log`. Filebeat ships it, and cron runs the check **every Monday at 06:00**.

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

## 12. Automating with Ansible

To deploy at scale, I wrote three Ansible roles:

- `filebeat`
- `metricbeat`
- `elastic_kibana`

### 12.1 Role: `filebeat`

Installs and configures Filebeat to collect logs (including the custom scripts above) and ship them securely to Elasticsearch.

**Features**

- Install and configure Filebeat.
- Manage the Filebeat keystore.
- Deploy and run the custom log transformation scripts.
- Configure standard and custom log inputs.
- Secure connection to Elasticsearch (TLS + authentication).

**Requirements**

- **Control node:** Ansible 2.10+, Python 3, `python3-apt`, `elasticsearch_password` in Ansible Vault, `ca.crt` and the scripts (`login-ssh.sh`, `clamav-elk.sh`, `letsencrypt-elk.sh`) in `roles/filebeat/files/`.
- **Target:** Debian/Ubuntu, network access to Elasticsearch on port 9200.

**Variables** (all overridable)

| Variable | Description | Default |
|---|---|---|
| `elasticsearch_hosts` | Elasticsearch hostname or IP | `kibana.example.com` |
| `elasticsearch_password` | Elasticsearch password | *(vaulted)* |
| `filebeat_log_paths` | Log paths to watch | includes `/var/log/login_data.log`, `/var/log/clamav/transformed_clamscan.log` |
| `filebeat_version` | Filebeat version | `8.13.4` |

The scripts are deployed to `/opt/elk_custom_scripts/`.

> **Warning:** These scripts edit `filebeat.yml` directly, so Ansible's templated `filebeat.yml` can overwrite their changes. Make sure every log path is included in the template.

**Usage**

```bash
ansible-playbook deploy_filebeat.yml -i inventory.ini --ask-vault-pass
```

### 12.2 Role: `metricbeat`

Installs and configures Metricbeat to collect system and service metrics (CPU, memory, network, processes) and ship them securely to Elasticsearch.

**Features**

- Install and configure Metricbeat.
- Manage the Metricbeat keystore.
- Enable specific modules (`system`, `elasticsearch`, `kibana`…).
- Secure connection to Elasticsearch (TLS + authentication).

**Requirements**

- **Control node:** Ansible 2.10+, Python 3, `python3-apt`, `elasticsearch_password` in Vault, `roles/metricbeat/files/ca.crt`.
- **Target:** Debian/Ubuntu, network access to Elasticsearch (9200) and Kibana (5601).

**Variables**

| Variable | Description | Default |
|---|---|---|
| `elasticsearch_hosts` | Elasticsearch hostname or IP | `kibana.example.com` |
| `kibana_host` | Kibana hostname or IP | |
| `elasticsearch_password` | Elasticsearch password | *(vaulted)* |
| `metricbeat_version` | Metricbeat version | `8.13.4` |

The `system` module is enabled by default. To add modules, edit `roles/metricbeat/tasks/_modules.yml` and/or add templates.

**Usage**

```bash
ansible-playbook deploy_metricbeat.yml -i inventory.ini --ask-vault-pass
```

### 12.3 Role: `elastic_kibana` *(untested)*

Automates a **single-node Elasticsearch** with X-Pack security, **Kibana**, **Nginx** as reverse proxy and **Let's Encrypt** HTTPS. It's meant for fresh servers, for example when migrating to a new cloud provider.

**What it sets up**

- **Elasticsearch (single node):** X-Pack security (TLS on HTTP, `elastic` password, Kibana enrollment token).
- **Kibana:** secure connection to Elasticsearch.
- **Nginx:** reverse proxy for Kibana.
- **Certbot:** automatic certificate issuance and renewal.
- **System prerequisites:** Java, kernel/system limits (`vm.max_map_count`, `nofile`, `nproc`), iptables rules.

**Key features**

- Idempotent.
- HTTPS inside the stack (Elasticsearch and Kibana).
- **Reuses an existing CA** to sign the new node certificate, so existing Beats trust the new Elasticsearch without any CA change on their side.
- Configurable Java version, ports and domain.

**Requirements**

- **Control node:** Ansible 2.10+, Python 3 + `python3-apt` (bootstrapped if missing), `ELASTIC_PASSWORD` in Vault, existing `ca.crt` and `ca.key` in `roles/elastic_kibana/files/certs/ca/`.

  > **Warning:** `ca.key` is a sensitive private key. Never commit it; add it locally just before running.

- **Target VM:** Debian/Ubuntu; a public DNS A record for `kibana_fqdn`; cloud firewall allowing inbound TCP 80 (Certbot), 443 (Kibana) and 9200 (Elasticsearch).

**Variables**

| Variable | Default | Description |
|---|---|---|
| `java_version` | `11` | OpenJDK version |
| `elastic_version` | `8.13.4` | Elasticsearch version |
| `elasticsearch_http_port` | `9200` | Elasticsearch port |
| `kibana_http_port` | `5601` | Internal Kibana port (proxied by Nginx) |
| `kibana_fqdn` | `kibana.example.com` | Public FQDN for Kibana |
| `elastic_cert_name` | `elkstack-certs` | Base name of generated node certs |
| `certbot_email` | `admin@example.com` | Let's Encrypt contact email |
| `elasticsearch_heap_size` | `8g` | JVM heap, about half the VM's RAM |
| `certs_dir` | `/etc/elasticsearch/certs` | Cert directory on the target |
| `ca_control_path` | `{{ role_path }}/files/certs/ca` | CA location on the control node |
| `ELASTIC_PASSWORD` | *(vaulted)* | `elastic` superuser password |

**Usage**

1. Set `kibana_fqdn` and `certbot_email` in `group_vars/all/vars.yml` (or `host_vars/`).
2. Set `ELASTIC_PASSWORD` in `group_vars/all/vault.yml`.
3. Copy `ca.crt` and `ca.key` into `roles/elastic_kibana/files/certs/ca/`.
4. Run:

```bash
ansible-playbook deploy_elastic_kibana.yml -i inventory.ini --ask-vault-pass --ask-become-pass
```

**Notes**

- **DNS:** `kibana_fqdn` must resolve publicly to the server, or Certbot fails.
- **Firewall:** iptables is configured on the VM, but the cloud firewall must also allow 22, 80, 443, 9200 and 5601 as needed.
- **Data migration:** the role does **not** migrate historical data. Use the Snapshot/Restore or Reindex APIs.
- **Kibana saved objects:** dashboards, visualizations, data views and ILM policies must be imported manually (*Stack Management > Saved Objects* and Dev Tools).

---

## 13. Alerting

The free tier doesn't include email connectors, so I used a workaround. Every rule uses a **Server log** action that writes a structured line to `kibana.log`. A small daemon tails the log, parses those lines and sends emails over SMTP.

### 13.1 Rules

Each rule's action writes a message with the same shape so one parser handles all of them:

```text
Server log: - AlertName: ...;- MonitorName: ...;- Reason: ...;- LastErrorMessage: ...;---
```

#### 13.1.1 CPU usage

Fires when a server's CPU usage goes **above 80%**. Checked every minute.

![CPU usage rule](/images/elk/alert-cpu-rule.png)

![CPU usage action](/images/elk/alert-cpu-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: CPU {{context.metric}} value {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.2 RAM usage

Fires when a server's memory usage goes **above 70%**. Checked every minute.

![RAM usage rule](/images/elk/alert-ram-rule.png)

![RAM usage action](/images/elk/alert-ram-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: RAM metric {{context.metric}} observed {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.3 Disk usage

Fires when a mount point goes **above 80%** usage. Checked every minute.

![Disk usage rule](/images/elk/alert-disk-rule.png)

![Disk usage action](/images/elk/alert-disk-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: {{context.reason}};- LastErrorMessage: Disk metric {{context.metric}} observed {{context.value}} exceeded threshold {{context.threshold}};---
```

#### 13.1.4 Non-prod domain down

Fires when a non-prod endpoint (Heartbeat monitor `All non-prod Endpoints`) is flagged **DOWN** within the last 5 minutes. Checked every minute.

![Non-prod down rule](/images/elk/alert-nonprod-down-rule.png)

![Non-prod down action](/images/elk/alert-nonprod-down-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.monitorName}};- Reason: {{context.statusMessage}} ({{context.monitorUrl}} from {{context.observerLocation}});- LastErrorMessage: {{context.latestErrorMessage}} checked at {{context.checkedAt}};---
```

#### 13.1.5 Prod domain down

Fires when a production site (monitor `Production Websites`) is flagged **DOWN at least 3 times in 5 minutes**. Requiring several failures cuts false positives from transient blips. Checked every minute.

![Prod down rule](/images/elk/alert-prod-down-rule.png)

![Prod down action](/images/elk/alert-prod-down-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.monitorName}};- Reason: {{context.statusMessage}} ({{context.monitorUrl}} from {{context.observerLocation}});- LastErrorMessage: {{context.latestErrorMessage}} checked at {{context.checkedAt}};---
```

#### 13.1.6 Sensitive file modification

Fires on any **creation, change or deletion** of critical files:
`/etc/passwd`, `/etc/shadow`, `/etc/ssh/sshd_config`, `/etc/sudoers`, `/etc/cron.d/*`, `/etc/group`. Checked every 10 seconds.

![Sensitive file rule](/images/elk/alert-sensitive-file-rule.png)

KQL query:

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

![Sensitive file action](/images/elk/alert-sensitive-file-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.value.host.name}};- Reason: Suspicious file change detected;- LastErrorMessage: File change met {{context.conditions}} at {{context.date}};---
```

#### 13.1.7 SSH brute force

Fires when **more than 10 failed SSH logins** happen on a host within 5 minutes.

![SSH brute force rule](/images/elk/alert-ssh-bruteforce-rule.png)

![SSH brute force action](/images/elk/alert-ssh-bruteforce-action.png)

```text
Server log: - AlertName: {{rule.name}};- MonitorName: {{context.group}};- Reason: SSH brute force suspected;- LastErrorMessage: {{context.matchingDocuments}} log entries matched conditions {{context.conditions}};---
```

### 13.2 Email notification service

#### The mailer: `/etc/kibana/kibana_mailer.sh`

Tails the Kibana log in real time. When it sees an alert line, it extracts the alert name, host, reason and error message, cleans up the format for some alert types (CPU, SSH), then sends an email over SMTP with `swaks`.

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

Restrict permissions, since the file contains SMTP credentials:

```bash
sudo chmod 700 /etc/kibana/kibana_mailer.sh
```

#### systemd service: `/etc/systemd/system/kibana-mailer.service`

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

## 14. Troubleshooting Log

Real problems I hit during the deployment, and how I fixed them.

### 14.1 Elasticsearch killed by the OOM killer

**Symptom**

```text
elasticsearch.service: A process of this unit has been killed by the OOM killer.
exit code 137 / 'oom-kill'
```

The Linux **OOM killer** steps in when RAM is exhausted and swap is insufficient. It kills a process (SIGKILL) to save the system. Elasticsearch is usually the victim because it's the biggest memory consumer (Java heap) and has a high OOM score.

**Root cause**

- ES heap too large for the available RAM.
- Too many other services competing (Kibana, OS, agents…).
- No or too little swap.

Rule of thumb: **ES heap ≤ 50% of physical RAM**, with `Xms = Xmx`.

**Diagnose**

```bash
dmesg | grep -i "killed process"
journalctl -k | grep -i "out of memory"
```

Look for a line showing the Elasticsearch Java process was killed.

**Fix**

1. **Reduce the heap** in `/etc/elasticsearch/jvm.options.d/heap.options`:
   ```text
   -Xms1g
   -Xmx1g
   ```
2. **Free RAM**: move Kibana or other heavy services to another host, stop non-essential processes.
3. **Add swap** temporarily. This avoids hard kills but hurts performance.
4. **Monitor memory:**
   ```bash
   free -h
   top -o %MEM
   ```

**TL;DR**: the box ran out of RAM and the kernel killed Elasticsearch. Shrink the heap or add memory/swap, then restart.

### 14.2 Kibana "Proxy Error" after enabling TLS

**Symptom**

After setting `server.ssl.enabled: true` in Kibana, access through the reverse proxy fails:

```text
Error: Proxy Error
    at Fetch.fetchResponse (...)
```

Kibana works fine when TLS is disabled.

**Root cause**

- The proxy still speaks **HTTP** to the backend while Kibana now listens on **HTTPS**.
- `ProxyPass` scheme doesn't match Kibana's TLS mode.
- Kibana cert/key missing or wrongly referenced in `kibana.yml`.

**Diagnose**

```bash
# Is Kibana listening?
ss -ltnp | grep 5601

# Direct TLS test (bypassing the proxy)
openssl s_client -connect kibana.example.com:5601 \
  -servername kibana.example.com \
  -CAfile /etc/ssl/certs/kibana-backend-ca.crt \
  -verify_return_error </dev/null | grep -E 'subject=|issuer=|Verify return code'
```

In Apache: with Kibana on HTTPS, `SSLProxyEngine on` must be set and `ProxyPass` must use `https://`.

**Fix**

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

*(If you keep Kibana on HTTP, use `http://` and disable `server.ssl.enabled`.)*

```bash
sudo systemctl restart kibana apache2
```

**TL;DR**: align the proxy's backend scheme with Kibana's TLS mode.

### 14.3 TLS hostname mismatch with internal names

**Symptom**

Apache > Fleet Server / Elasticsearch connections failed with TLS **hostname mismatch** errors, even though the certificates were valid.

**Root cause**

- With `SSLProxyCheckPeerName on`, Apache **checks the backend certificate's SAN**.
- The initial certs only contained `DNS:kibana.example.com, IP:<ELK_SERVER_IP>`.
- Apache was calling `fleet.int.local` / `es.int.local`, which weren't in the SAN, so the handshake failed.
- Calling a raw IP (`https://<ELK_SERVER_IP>:8220`) makes it worse: TLS then needs an `IP:` SAN, which is often missing when certs are generated with an FQDN only.

**Diagnose**

```bash
openssl x509 -in /etc/fleet/certs/fleet-server.crt -noout -text | grep -A1 "Subject Alternative Name"
journalctl -u apache2 -e | grep SSL
```

**Fix**

1. Regenerate the backend certs with the correct SANs:
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
2. Install them and restart:
   ```bash
   unzip -o /etc/fleet/certs/fleet-server.zip -d /etc/fleet/certs/
   unzip -o /etc/elasticsearch/certs/elasticsearch-http.zip -d /etc/elasticsearch/certs/
   systemctl restart elastic-agent elasticsearch
   ```
3. Point Apache at the **internal names**, not raw IPs:
   ```apache
   SSLProxyEngine on
   SSLProxyVerify require
   SSLProxyCheckPeerName on

   ProxyPass        /fleet/ https://fleet.int.local:8220/
   ProxyPassReverse /fleet/ https://fleet.int.local:8220/
   ProxyPass        /es/    https://es.int.local:9200/
   ProxyPassReverse /es/    https://es.int.local:9200/
   ```

**TL;DR**: put every name you'll connect with in the cert SAN, and proxy to names, not IPs.

### 14.4 Fleet Server 404 (wrong API path)

**Symptom**

During agent enrollment:

```text
fleet server ping returned a bad status code: 404
error loading agent config: no fleet config retrieved yet
```

- `https://kibana.example.com/fleet/api/status` returns **HEALTHY**
- `https://kibana.example.com/api/status` returns **404**

**Root cause**

The proxy only exposes Fleet Server under `/fleet/`, but the agent was calling `/api/status` at the root. The official health endpoint is `https://<fleet-server>:8220/api/status`, so behind a path-based proxy the Fleet host URL must include the `/fleet` prefix.

**Diagnose**

```bash
# Fleet Server hosts configured in Kibana
curl -sk -u elastic:<ELASTIC_PASSWORD> https://kibana.example.com/api/fleet/settings | jq
# fleet_server_hosts should be ["https://kibana.example.com/fleet"]

# Which path is the agent calling?
journalctl -u elastic-agent -e --no-pager | grep "fleet"
```

**Fix**

```bash
curl -sk -u elastic:<ELASTIC_PASSWORD> -X PUT \
  https://kibana.example.com/api/fleet/settings \
  -H 'kbn-xsrf: true' \
  -H 'Content-Type: application/json' \
  -d '{ "fleet_server_hosts": ["https://kibana.example.com/fleet"] }'
```

- In Kibana: **Fleet > Settings / Fleet Server policy**, make sure the URL includes `/fleet`.
- Redeploy the policy and restart the agent: `systemctl restart elastic-agent`.
- Test: `curl -sk https://kibana.example.com/fleet/api/status` should return `HEALTHY`.

**TL;DR**: behind a path-based proxy, `fleet_server_hosts` must include the path prefix.

### 14.5 Agents enrolled but no data (wrong Fleet output)

**Symptom**

Agents are enrolled and show **HEALTHY** in Fleet, but logs and metrics are missing, or the agent logs show TLS/connection errors to Elasticsearch. Fixing the Fleet Server URL alone wasn't enough: the agents were still pushing to the **wrong Elasticsearch URL** (scheme, host, port or CA).

**Root cause**

- The **Elasticsearch output** in Fleet was misconfigured:
  - wrong **host** (e.g. `http://localhost:9200` instead of `https://es.int.local:9200`),
  - **missing or wrong CA**,
  - intermediate **proxy** not accounted for.
- The **free license allows only one Elasticsearch output**, so all agents share the same destination. Per-policy outputs need a paid tier.
- Fleet Server was OK while the output was broken.

**Diagnose**

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

**Fix**

1. **Delete any extra outputs** (only one is allowed on the free license).
2. **Fix the default output**: *Fleet > Settings > Outputs > Default output*:
   - **Hosts**: `https://es.int.local:9200` (or via the proxy: `https://kibana.example.com/es/`)
   - **SSL / CA**: paste the Elasticsearch backend CA
3. Or via the API:
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
4. **Redeploy all policies** so every agent picks up the single output.
5. `systemctl restart elastic-agent`

**TL;DR**: one output on the free tier. Make it correct (host + CA) and redeploy.

---

## 15. Key Takeaways

- **TLS is the hardest part.** Most of my issues came from SAN mismatches, scheme mismatches (HTTP vs HTTPS) and proxy paths. Plan your hostnames *before* generating certificates.
- **Behind a reverse proxy, every URL matters.** Fleet Server hosts, outputs and `publicBaseUrl` all have to match what the proxy actually exposes.
- **Know the free-tier limits.** A single Fleet output and no email connector shaped the design (one output for everyone, and the log-based mailer workaround).
- **Size the heap carefully** on a single-node setup shared with Kibana and Fleet.
- **Automate early.** Ansible roles and keystore scripts made it possible to roll Beats out to many servers without leaking credentials into config files.
