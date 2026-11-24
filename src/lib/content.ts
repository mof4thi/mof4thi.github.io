import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '../i18n/ui';

export type Article = CollectionEntry<'articles'> | CollectionEntry<'articlesFr'>;
export type Project = CollectionEntry<'projects'> | CollectionEntry<'projectsFr'>;

/** Articles for a language, newest first. Drafts only show in `npm run dev`. */
export async function getArticles(lang: Lang): Promise<Article[]> {
  const keep = ({ data }: Article) => import.meta.env.DEV || !data.draft;
  const list: Article[] =
    lang === 'fr' ? await getCollection('articlesFr', keep) : await getCollection('articles', keep);
  return list.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getProjects(lang: Lang): Promise<Project[]> {
  const list: Project[] = lang === 'fr' ? await getCollection('projectsFr') : await getCollection('projects');
  return list.sort((a, b) => a.data.order - b.data.order);
}
