// Pictures from YouTube and Google load through this site's own address
// (here.now proxy routes), so networks that block those hosts, like many
// school networks, still show them.
const HOSTS: [RegExp, string][] = [
  [/^https?:\/\/i\d?\.ytimg\.com\//, "/yi/"],
  [/^https?:\/\/yt3\.ggpht\.com\//, "/yg/"],
  [/^https?:\/\/yt3\.googleusercontent\.com\//, "/yu/"],
  [/^https?:\/\/www\.google\.com\//, "/gg/"],
];

export function pic(url: string | undefined): string {
  if (!url) return "";
  const u = url.startsWith("//") ? `https:${url}` : url;
  for (const [re, route] of HOSTS) if (re.test(u)) return u.replace(re, route);
  return u;
}
