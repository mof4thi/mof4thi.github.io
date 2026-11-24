---
title: Home lab
summary: Une infrastructure auto-hébergée avec virtualisation, réseaux d’attaque et de cibles isolés, aucun port exposé, et un agent IA qui pilote de vrais outils de pentest.
context: Personnel · en cours
stack: [proxmox, lxc, tailscale, wireguard, adguard home, kali, mcp]
order: 3
featured: true
links:
  - label: Article sur l’agent IA de reconnaissance
    href: /fr/articles/local-llm-pentest-agent/
---

### Matériel

| Machine | Caractéristiques | Rôle |
| --- | --- | --- |
| Nœud Proxmox VE | Pentium Gold G6405, 16 Go DDR4, SSD 480 Go | Héberge les VM et les conteneurs LXC |
| Portable HP | Core i7-1165G7, 16 Go, SSD 512 Go + HDD 1 To | Calcul, et le HDD partagé en stockage réseau |
| Raspberry Pi 5 | 8 Go, 256 Go | Passerelle et nœud de supervision, toujours allumé |
| ThinkPad | | Poste de travail pour l’administration à distance et l’accès au lab |

### Architecture

Proxmox héberge à la fois des VM complètes et des conteneurs LXC légers. Le réseau est divisé en deux segments isolés :

- **Infrastructure :** les services du quotidien.
- **Lab d’attaque et de cibles :** sans aucune route vers le segment infrastructure ni vers le réseau domestique.

### Accès à distance

Tout passe par un VPN maillé basé sur WireGuard (Tailscale). Le Raspberry Pi sert de routeur de sous-réseau, de filtre DNS (AdGuard Home) et de moniteur de disponibilité. **Aucun port entrant n’est ouvert sur Internet.**

### Outils offensifs

Une VM Kali Linux fait tourner un serveur MCP qui expose des outils de reconnaissance et d’attaque Active Directory sous forme de fonctions appelables. Un agent IA peut ainsi dérouler des scénarios d’attaque complets contre des cibles volontairement vulnérables à l’intérieur du lab isolé : contrôleurs de domaine AD, services mal configurés et hôtes vulnérables.

Les résultats sont rédigés dans un outil de reporting de pentest auto-hébergé, en suivant une structure de rapport professionnelle, dans le style HTB.
