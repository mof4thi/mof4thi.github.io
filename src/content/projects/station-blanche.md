---
title: Hardened USB inspection station
summary: A locked-down Linux kiosk that scans USB keys carrying critical mission data, then packages, hashes and ships only the clean data to a SecNumCloud server.
context: Apprenticeship, Vistory · defense-sector client
stack: [ubuntu 24.04, python, pyudev, clamav, systemd, polkit, scp]
order: 2
featured: true
---

In French this is called a *station blanche*: a dedicated machine where removable media gets checked before its data is allowed anywhere near a sensitive network.

### The problem

Field teams brought back mission data on USB keys. That data had to end up on a secure, SecNumCloud-qualified server, and nothing else on the key could be allowed to come along with it: no malware, no stray files, no way to tamper with the data in transit. The people using the station are not IT staff, so it had to be a single-purpose appliance: plug in the key, answer a few questions, unplug.

### How the machine is locked down

- **Two accounts, two jobs.** A standard `user` account logs in automatically and lands straight in the scanning app, full screen. A separate `admin` account is the only way in for maintenance, over SSH. Root login over SSH is disabled, and every credential lives in KeePass.
- **Least privilege.** The kiosk user can run exactly one thing as root, the scanner script, through a single `sudoers` rule pinned to that path.
- **Physical ports, pinned by hardware path.** A small `pyudev` daemon, run by systemd and restarted instantly if it dies, de-authorizes any device plugged into a blocked port the moment it appears. Ports are identified by their `ID_PATH` (the physical location on the bus), not by `/dev/sdX` names that change between boots. One port is processed, one only supplies power, and USB-C is blocked.
- **No other ways out.** HDMI output is disabled at the kernel level from GRUB, and Bluetooth is stopped, disabled and masked.
- **Just enough freedom.** A narrow polkit rule lets the kiosk user switch Wi-Fi networks without admin rights, and nothing more.

### What happens when a key is plugged in

1. **Scan first.** Only one designated port is ever read. The key is scanned for malware, anything suspicious goes to quarantine, and nothing moves forward until a fresh scan comes back clean.
2. **Describe the mission.** The operator picks the mission and fills in a short form, with every field checked before it's accepted.
3. **Take only what's needed.** Only the expected data from that mission is collected. Everything else on the key is ignored.
4. **Seal and send.** The data is packaged with integrity checks and sent to the secure server. Local copies are cleaned up and every step is logged.
5. **Reset.** Once the key is unplugged, the station is ready for the next one.

### Side notes

- **Integrity is checked end to end.** Both the individual files and the final package are fingerprinted, so the receiving side can confirm nothing changed on the way.
- **An allow-list, not a block-list.** Only the expected data ever leaves the machine. Anything else on the key is never even read.
- **Failure is loud.** An infection stops everything and needs a human to act. Nothing gets sent "mostly clean".

I also wrote the full deployment documentation, so the station can be rebuilt from a blank machine.
