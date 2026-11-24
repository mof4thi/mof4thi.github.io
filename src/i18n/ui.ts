// Site-wide UI strings in English and French, plus helpers for localized URLs.
// English lives at the root (/about/), French under /fr/ (/fr/about/).

export const languages = { en: 'English', fr: 'Français' } as const;
export type Lang = keyof typeof languages;

export function getLang(url: URL): Lang {
  return url.pathname === '/fr' || url.pathname.startsWith('/fr/') ? 'fr' : 'en';
}

/** Prefix a root-relative path for the given language. */
export function localize(lang: Lang, path: string): string {
  return lang === 'fr' ? `/fr${path}` : path;
}

/** The same page in the other language. */
export function switchLang(url: URL): { lang: Lang; href: string } {
  const path = url.pathname;
  if (getLang(url) === 'fr') return { lang: 'en', href: path.replace(/^\/fr/, '') || '/' };
  return { lang: 'fr', href: `/fr${path}` };
}

export const ui = {
  en: {
    'site.tagline': 'Cybersecurity',
    'site.description': 'Cybersecurity notes, articles and projects by Mohammed Fathi.',
    'nav.articles': 'articles',
    'nav.projects': 'projects',
    'nav.about': 'about',
    'nav.contact': 'contact',
    'nav.main': 'Main',
    'lang.group': 'Language',
    'og.alt': 'Mohammed Fathi, cybersecurity, Paris. MSc Cybersecurity and AI, EFREI.',

    'home.lead.1': 'Cybersecurity professional based in Paris, with an',
    'home.lead.degree': 'MSc in Cybersecurity and AI',
    'home.lead.2': 'from EFREI. I write up what I learn here: labs, investigations, and the occasional mistake.',
    'home.start': 'Start here',
    'home.cta.articles': 'read the articles',
    'home.cta.about': 'about me',
    'home.cta.projects': 'see the projects',
    'home.latest': 'Latest articles',
    'home.all': 'all articles',

    'term.label': 'Quick summary',
    'term.whoami': 'mohammed fathi, cybersecurity, paris',
    'term.msc': 'cybersecurity & ai, efrei',
    'term.soc': 'apprenticeship, 1y 9m',
    'term.cpts': 'hack the box',
    'term.done': 'done',
    'term.wip': 'in progress',

    'articles.title': 'Articles',
    'articles.description': 'Articles, lab experiments and investigations on cybersecurity.',
    'articles.intro': 'Deep dives, lab experiments, and things I learned along the way.',
    'article.back': 'all articles',
    'article.minutes': 'min read',
    'article.tags': 'tags',
    'article.draft': 'draft',
    'article.toc': 'Contents',
    'code.copy': 'copy',
    'code.copied': 'copied',
    'code.failed': 'failed',

    'projects.title': 'Projects',
    'projects.description': 'Security, infrastructure and development projects by Mohammed Fathi.',
    'projects.intro': "Things I've built at work and on my own. Open a block for the details.",
    'projects.more': '[+] details',
    'projects.less': '[-] close',

    'about.title': 'About',
    'about.description': 'About Mohammed Fathi: cybersecurity, SOC experience, and HTB CPTS preparation.',

    'contact.title': 'Contact',
    'contact.description': 'Get in touch with Mohammed Fathi.',
    'contact.intro':
      "You can reach me by email or on LinkedIn. I'm happy to talk about security, my articles and projects, or opportunities.",
    'contact.email': 'Email',
  },
  fr: {
    'site.tagline': 'Cybersécurité',
    'site.description': 'Articles, notes et projets en cybersécurité par Mohammed Fathi.',
    'nav.articles': 'articles',
    'nav.projects': 'projets',
    'nav.about': 'à propos',
    'nav.contact': 'contact',
    'nav.main': 'Navigation principale',
    'lang.group': 'Langue',
    'og.alt': 'Mohammed Fathi, cybersécurité, Paris. MSc Cybersécurité et IA, EFREI.',

    'home.lead.1': 'Professionnel de la cybersécurité basé à Paris, titulaire d’un',
    'home.lead.degree': 'MSc Cybersécurité et IA',
    'home.lead.2': 'de l’EFREI. Ici, je documente ce que j’apprends : labs, investigations, et parfois mes erreurs.',
    'home.start': 'Pour commencer',
    'home.cta.articles': 'lire les articles',
    'home.cta.about': 'à propos',
    'home.cta.projects': 'voir les projets',
    'home.latest': 'Derniers articles',
    'home.all': 'tous les articles',

    'term.label': 'Résumé',
    'term.whoami': 'mohammed fathi, cybersécurité, paris',
    'term.msc': 'cybersécurité & ia, efrei',
    'term.soc': 'alternance, 1 an 9 mois',
    'term.cpts': 'hack the box',
    'term.done': 'validé',
    'term.wip': 'en cours',

    'articles.title': 'Articles',
    'articles.description': 'Articles, expérimentations en lab et investigations en cybersécurité.',
    'articles.intro': 'Analyses approfondies, expérimentations en lab, et ce que j’en retiens.',
    'article.back': 'tous les articles',
    'article.minutes': 'min de lecture',
    'article.tags': 'tags',
    'article.draft': 'brouillon',
    'article.toc': 'Sommaire',
    'code.copy': 'copier',
    'code.copied': 'copié',
    'code.failed': 'échec',

    'projects.title': 'Projets',
    'projects.description': 'Projets en sécurité, infrastructure et développement par Mohammed Fathi.',
    'projects.intro': 'Ce que j’ai réalisé en entreprise et de mon côté. Ouvrez un bloc pour voir le détail.',
    'projects.more': '[+] détails',
    'projects.less': '[-] fermer',

    'about.title': 'À propos',
    'about.description':
      'À propos de Mohammed Fathi : cybersécurité, expérience SOC et préparation à la certification HTB CPTS.',

    'contact.title': 'Contact',
    'contact.description': 'Contacter Mohammed Fathi.',
    'contact.intro':
      'Vous pouvez me joindre par e-mail ou sur LinkedIn. Je suis toujours partant pour parler sécurité, de mes articles et projets, ou d’opportunités.',
    'contact.email': 'E-mail',
  },
} as const;

export type UIKey = keyof (typeof ui)['en'];

export function useTranslations(lang: Lang) {
  return (key: UIKey): string => ui[lang][key] ?? ui.en[key];
}
