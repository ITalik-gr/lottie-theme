import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class merger: conditional classes in, one conflict-free class string out. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
