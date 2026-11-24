---
title: Home lab
summary: A self-hosted setup with virtualization, isolated attack and target networks, zero exposed ports, and an AI agent that drives real pentest tooling.
context: Personal · ongoing
stack: [proxmox, lxc, tailscale, wireguard, adguard home, kali, mcp]
order: 3
featured: true
links:
  - label: Article on the AI recon agent
    href: /articles/local-llm-pentest-agent/
---

### Hardware

| Machine | Specs | Role |
| --- | --- | --- |
| Proxmox VE node | Pentium Gold G6405, 16 GB DDR4, 480 GB SSD | Hosts the VMs and LXC containers |
| HP laptop | Core i7-1165G7, 16 GB, 512 GB SSD + 1 TB HDD | Compute, and the HDD shared as network storage |
| Raspberry Pi 5 | 8 GB, 256 GB | Always-on gateway and monitoring node |
| ThinkPad | | Workstation for remote management and lab access |

### Architecture

Proxmox runs a mix of full VMs and lightweight LXC containers. The network is split into two isolated segments:

- **Infrastructure:** day-to-day services.
- **Attack and target lab:** with no route back to the infrastructure segment or the home network.

### Remote access

Everything is reached over a WireGuard-based mesh VPN (Tailscale). The Raspberry Pi is the subnet router, the DNS filter (AdGuard Home) and the uptime monitor. **No inbound port is open to the internet.**

### Offensive toolkit

A Kali Linux VM runs an MCP server that exposes recon and Active Directory attack tools as callable functions. That lets an AI agent drive full attack workflows against intentionally vulnerable targets inside the isolated lab: AD domain controllers, misconfigured services and vulnerable hosts.

Findings are written up in a self-hosted pentest reporting tool, following a professional, HTB-style report structure.
