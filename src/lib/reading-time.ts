// Rough reading time for a Markdown body. Code blocks count at a third of the
// prose rate, since nobody reads every line of a config file.
export function readingTime(markdown = ''): number {
  const code = (markdown.match(/```[\s\S]*?```/g) ?? []).join(' ');
  const prose = markdown.replace(/```[\s\S]*?```/g, ' ');
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words(prose) / 220 + words(code) / 660));
}
