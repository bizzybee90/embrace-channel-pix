import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Escape special PostgREST/SQL pattern characters in search terms */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`);
}
