---
title: Analyseur de journaux d’événements Windows
summary: Un outil PowerShell interactif avec une interface terminal à menus pour filtrer les journaux d’événements Windows et exporter un rapport.
context: Personnel
stack: [powershell, get-winevent, windows forms]
order: 5
links:
  - label: GitHub
    href: https://github.com/mof4thi/event-log-analyzer-with-PowerShell
---

Lire des fichiers `.evtx` dans l’Observateur d’événements est fastidieux quand on cherche une information précise. Ce script regroupe les filtres les plus courants derrière quelques menus.

### Fonctionnement

- **Choisir un journal :** Système, Application, Sécurité, Installation, Matériel, ou n’importe quel fichier `.evtx` via son chemin.
- **Affiner la recherche :** par plage de dates, par mot-clé (interprété comme une expression régulière sur le message), et par n’importe quelle combinaison de niveaux : critique, erreur, avertissement, information.
- **Obtenir un rapport :** les résultats sont regroupés par niveau avec un total pour chacun, puis affichés dans la console ou enregistrés dans un fichier texte via une boîte de dialogue d’enregistrement standard.

Il lit les journaux avec `Get-WinEvent` et reconnaît les niveaux de gravité en anglais comme en français, ce qui le rend utilisable sur un Windows en français.
