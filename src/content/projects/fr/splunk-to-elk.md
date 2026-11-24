---
title: Migration d’un SIEM de Splunk vers la Stack Elastic
summary: Remplacement de Splunk Enterprise par une Stack Elastic auto-hébergée pour réduire les coûts de licence et d’infrastructure, avec une économie estimée à plusieurs milliers d’euros par an.
context: Alternance, Vistory
stack: [elasticsearch, kibana, fleet, elastic agent, heartbeat, ansible, apache, tls]
order: 1
featured: true
links:
  - label: Lire l’article complet
    href: /fr/articles/elk-siem-splunk-migration/
---

Les coûts de licence et d’infrastructure de Splunk augmentaient avec le parc de serveurs. J’ai évalué la version gratuite de la Stack Elastic comme solution de remplacement, puis je l’ai déployée.

### Ce que j’ai mis en place

- **Une Stack Elastic mono-nœud** (Elasticsearch, Kibana, Fleet Server) pour superviser un parc de plusieurs centaines de serveurs Linux.
- **Du TLS sur chaque saut :** Let’s Encrypt pour le point d’accès public, et une autorité de certification interne entre le reverse proxy Apache, Kibana, Elasticsearch et Fleet.
- **Des Elastic Agents gérés par Fleet**, avec des politiques pour les logs et métriques système, Osquery et les logs ClamAV.
- **La supervision de disponibilité** des sites de production et hors production avec Heartbeat.
- **Des pipelines de logs personnalisés** pour les connexions SSH, les scans antivirus et l’expiration des certificats.
- **Des alertes par e-mail avec la licence gratuite**, qui n’inclut pas de connecteur e-mail : les règles écrivent des lignes structurées dans le log de Kibana, et un petit service systemd les transforme en e-mails. Les alertes couvrent le CPU, la RAM, le disque, l’indisponibilité des sites, la modification de fichiers sensibles et le brute force SSH.
- **Des rôles Ansible** pour déployer Filebeat et Metricbeat, et pour reconstruire toute la stack sur un nouveau serveur.

L’article détaille toute l’installation, y compris les cinq problèmes qui m’ont coûté le plus de temps et la façon dont je les ai résolus.
