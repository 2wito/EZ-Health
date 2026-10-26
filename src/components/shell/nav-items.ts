import { BedDouble, FileUp, Flame, Heart, LayoutGrid, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  /** Key into `t.nav` for the short label and the large page title. */
  key: "summary" | "heart" | "sleep" | "activity" | "coach" | "upload";
  icon: LucideIcon;
  /** Tailwind background class for the iOS-style icon tile. */
  tile: string;
  /** Shown in the phone tab bar (iOS caps it at five). */
  tab: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "summary", icon: LayoutGrid, tile: "bg-primary", tab: true },
  { href: "/heart", key: "heart", icon: Heart, tile: "bg-heart", tab: true },
  { href: "/sleep", key: "sleep", icon: BedDouble, tile: "bg-sleep", tab: true },
  { href: "/activity", key: "activity", icon: Flame, tile: "bg-activity", tab: true },
  { href: "/coach", key: "coach", icon: Sparkles, tile: "bg-spectrum", tab: true },
  { href: "/upload", key: "upload", icon: FileUp, tile: "bg-gray", tab: false },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
