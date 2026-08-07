export function shortenCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}
