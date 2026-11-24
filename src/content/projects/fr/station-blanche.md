---
title: Station blanche durcie pour clés USB
summary: Un poste Linux verrouillé qui analyse les clés USB contenant des données de mission critiques, puis prépare, empreinte et transfère uniquement les données saines vers un serveur SecNumCloud.
context: Alternance, Vistory · client du secteur de la défense
stack: [ubuntu 24.04, python, pyudev, clamav, systemd, polkit, scp]
order: 2
featured: true
---

Une station blanche est un poste dédié où les supports amovibles sont contrôlés avant que leurs données ne puissent approcher un réseau sensible.

### Le problème

Les équipes terrain rapportaient des données de mission sur clés USB. Ces données devaient arriver sur un serveur sécurisé qualifié SecNumCloud, sans que rien d’autre présent sur la clé ne les accompagne : pas de malware, pas de fichiers parasites, aucune possibilité d’altération pendant le transfert. Les utilisateurs de la station ne sont pas des informaticiens : il fallait donc un poste à usage unique. On branche la clé, on répond à quelques questions, on la retire.

### Le durcissement du poste

- **Deux comptes, deux rôles.** Un compte standard `user` se connecte automatiquement et ouvre directement l’application d’analyse en plein écran. Un compte `admin` distinct est le seul accès pour la maintenance, via SSH. La connexion root en SSH est désactivée, et tous les identifiants sont conservés dans KeePass.
- **Moindre privilège.** L’utilisateur du poste ne peut exécuter qu’une seule chose en root, le script d’analyse, grâce à une unique règle `sudoers` limitée à ce chemin.
- **Ports physiques identifiés par leur chemin matériel.** Un petit démon `pyudev`, lancé par systemd et redémarré instantanément s’il s’arrête, désautorise tout périphérique branché sur un port bloqué dès son apparition. Les ports sont identifiés par leur `ID_PATH` (leur emplacement physique sur le bus), et non par des noms `/dev/sdX` qui changent d’un démarrage à l’autre. Un seul port est traité, un autre sert uniquement à l’alimentation, et l’USB-C est bloqué.
- **Aucune autre issue.** La sortie HDMI est désactivée au niveau du noyau depuis GRUB, et le Bluetooth est arrêté, désactivé et masqué.
- **Juste ce qu’il faut de liberté.** Une règle polkit ciblée permet à l’utilisateur de changer de réseau Wi-Fi sans droits administrateur, et rien de plus.

### Ce qui se passe quand une clé est branchée

1. **Analyser d’abord.** Seul un port désigné est lu. La clé est analysée à la recherche de malwares, tout élément suspect est mis en quarantaine, et rien n’avance tant qu’une nouvelle analyse n’est pas saine.
2. **Décrire la mission.** L’opérateur choisit la mission et remplit un court formulaire, dont chaque champ est vérifié avant d’être accepté.
3. **Ne prendre que le nécessaire.** Seules les données attendues pour cette mission sont collectées. Tout le reste de la clé est ignoré.
4. **Sceller et envoyer.** Les données sont empaquetées avec des contrôles d’intégrité et envoyées vers le serveur sécurisé. Les copies locales sont supprimées et chaque étape est journalisée.
5. **Réinitialiser.** Une fois la clé retirée, la station est prête pour la suivante.

### À noter

- **L’intégrité est vérifiée de bout en bout.** Les fichiers comme l’archive finale sont empreintés, ce qui permet au destinataire de confirmer que rien n’a changé en chemin.
- **Une liste blanche, pas une liste noire.** Seules les données attendues quittent le poste. Le reste du contenu de la clé n’est même jamais lu.
- **Les échecs sont bloquants.** Une infection arrête tout et nécessite l’intervention d’un humain. Rien n’est envoyé « presque sain ».

J’ai également rédigé la documentation de déploiement complète, pour que la station puisse être reconstruite à partir d’une machine vierge.
