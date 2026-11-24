---
title: Automating Splunk forwarder deployment with Ansible
summary: Ansible playbooks and Python scripts that install and configure the Splunk Universal Forwarder and its companion tools across a server fleet.
context: Apprenticeship, Vistory
stack: [ansible, python, bash, splunk, clamav, sysstat]
order: 4
links:
  - label: GitHub
    href: https://github.com/mof4thi/splunk-forwarder-deployment-configuration-with-ansible
---

Before the move to the Elastic Stack, every new server had to be connected to Splunk by hand. I automated it.

### What the playbooks do

- Install and configure the **Splunk Universal Forwarder** and connect it to the deployment server, with separate tasks for **Ubuntu** and **AlmaLinux**.
- Handle **both install paths**, since older forwarder versions install to a different location.
- Install **ClamAV**, with per-OS handling, and **sysstat** for system metrics.
- Deploy custom scripts that turn **SSH logins** and **ClamAV results** into structured logs.
- Set up **Let's Encrypt certificate** logging for Splunk.

A new server is onboarded by running five playbooks in order, with per-environment values kept in one defaults file and the hosts in an inventory.
