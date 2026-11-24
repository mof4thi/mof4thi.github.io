---
title: Automatisation du déploiement des forwarders Splunk avec Ansible
summary: Des playbooks Ansible et des scripts Python qui installent et configurent le Splunk Universal Forwarder et ses outils associés sur tout un parc de serveurs.
context: Alternance, Vistory
stack: [ansible, python, bash, splunk, clamav, sysstat]
order: 4
links:
  - label: GitHub
    href: https://github.com/mof4thi/splunk-forwarder-deployment-configuration-with-ansible
---

Avant le passage à la Stack Elastic, chaque nouveau serveur devait être raccordé à Splunk à la main. J’ai automatisé cette étape.

### Ce que font les playbooks

- Installer et configurer le **Splunk Universal Forwarder** et le relier au serveur de déploiement, avec des tâches distinctes pour **Ubuntu** et **AlmaLinux**.
- Gérer **les deux chemins d’installation**, car les anciennes versions du forwarder s’installent à un autre emplacement.
- Installer **ClamAV**, avec une prise en charge propre à chaque OS, et **sysstat** pour les métriques système.
- Déployer des scripts personnalisés qui transforment les **connexions SSH** et les **résultats ClamAV** en logs structurés.
- Mettre en place la remontée des logs des **certificats Let’s Encrypt** vers Splunk.

Un nouveau serveur est intégré en exécutant cinq playbooks dans l’ordre, avec les valeurs propres à chaque environnement regroupées dans un seul fichier de variables par défaut et les hôtes dans un inventaire.
