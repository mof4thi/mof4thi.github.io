---
title: Library management system in C
summary: A console library manager whose entire database is built from hand-written linked lists, with manual memory management.
context: Studies
stack: [c, linked lists]
order: 8
links:
  - label: GitHub
    href: https://github.com/mof4thi/Linked_List_Based_Library_System
---

I built this as a challenge to really understand linked lists and memory in C, not because linked lists are the best way to store a library.

- **Linked lists as the database:** every record is a node, allocated and freed by hand.
- **Bilingual:** the interface is available in English and French.
- **Documented:** the repository includes a flowchart of the program's structure.

Data lives in memory only for now. Saving the database to disk is the next step.
