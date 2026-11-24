---
title: Migrating a SIEM from Splunk to the Elastic Stack
summary: Replaced Splunk Enterprise with a self-hosted Elastic Stack to cut licensing and infrastructure costs, with an estimated saving of several thousand euros a year.
context: Apprenticeship, Vistory
stack: [elasticsearch, kibana, fleet, elastic agent, heartbeat, ansible, apache, tls]
order: 1
featured: true
links:
  - label: Read the full article
    href: /articles/elk-siem-splunk-migration/
---

Splunk's licence and infrastructure costs were growing with the server fleet. I evaluated the free tier of the Elastic Stack as a replacement, then deployed it.

### What I built

- **A single-node Elastic Stack** (Elasticsearch, Kibana, Fleet Server) for a fleet of a couple hundred Linux servers.
- **TLS on every hop:** Let's Encrypt for the public endpoint, and an internal CA between the Apache reverse proxy, Kibana, Elasticsearch and Fleet.
- **Fleet-managed Elastic Agents** with policies for system logs and metrics, Osquery and ClamAV logs.
- **Uptime monitoring** of production and non-production sites with Heartbeat.
- **Custom log pipelines** for SSH logins, antivirus scans and certificate expiry.
- **Email alerting on the free tier**, which has no email connector: rules write structured lines to Kibana's log, and a small systemd service turns them into emails. Alerts cover CPU, RAM, disk, sites going down, changes to sensitive files and SSH brute force.
- **Ansible roles** to roll out Filebeat and Metricbeat, and to rebuild the whole stack on a new server.

The article walks through the full setup, including the five problems that cost me the most time and how I fixed them.
