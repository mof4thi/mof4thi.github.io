---
title: Windows event log analyzer
summary: An interactive PowerShell tool with a menu-driven terminal interface for filtering Windows event logs and exporting a report.
context: Personal
stack: [powershell, get-winevent, windows forms]
order: 5
links:
  - label: GitHub
    href: https://github.com/mof4thi/event-log-analyzer-with-PowerShell
---

Reading `.evtx` files in Event Viewer is slow when you're hunting for one thing. This script puts the common filters behind a few menus.

### How it works

- **Pick a log:** System, Application, Security, Setup, Hardware, or any `.evtx` file by path.
- **Narrow it down:** by date range, by keyword (matched as a regular expression against the message), and by any mix of severities: critical, error, warning, informational.
- **Get a report:** results are grouped by severity with totals for each, then printed to the console or saved to a text file through a standard save dialog.

It reads the logs with `Get-WinEvent`, and it recognizes severity names in both English and French, so it works on French Windows installs too.
