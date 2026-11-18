---
title: 'TEMPLATE: Machine name writeup'
date: 2026-11-18
summary: One sentence on the machine, the key idea, and what you learned.
category: htb
tags: [htb, linux, template]
draft: true
---

> This is a template. It has `draft: true`, so it shows up in `npm run dev` but is never published.
> Copy this file, give it a new name (the file name becomes the URL), and remove `draft: true`
> when the post is ready. Only publish writeups for retired machines.

## Summary

What the machine is, the difficulty, and the main idea in two or three sentences.

## Recon

```bash
nmap -sC -sV -oN scan.txt TARGET_IP
```

What the scan showed and what you decided to look at first, and why.

## Foothold

How you got in. Include the reasoning, not only the commands.

## Privilege escalation

What you found, why it was exploitable, and how you confirmed it.

## Lessons learned

- What you would do faster next time
- What detection or defense would have stopped this
