import { BedDouble, FileUp, Flame, Heart, LayoutGrid, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  /** Short label for the tab bar / sidebar. */
  label: string;
  /** Large page title. */
  title: string;
  icon: LucideIcon;
  /** Tailwind background class for the iOS-style icon tile. */
  tile: string;
  /** Shown in the phone tab bar (iOS caps it at five). */
  tab: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Summary", title: "Summary", icon: LayoutGrid, tile: "bg-primary", tab: true },
  { href: "/heart", label: "Heart", title: "Heart & Breathing", icon: Heart, tile: "bg-heart", tab: true },
  { href: "/sleep", label: "Sleep", title: "Sleep & Recovery", icon: BedDouble, tile: "bg-sleep", tab: true },
  { href: "/activity", label: "Activity", title: "Workouts & Trends", icon: Flame, tile: "bg-activity", tab: true },
  { href: "/coach", label: "Coach", title: "AI Coach", icon: Sparkles, tile: "bg-spectrum", tab: true },
  { href: "/upload", label: "Import", title: "Import Health Data", icon: FileUp, tile: "bg-gray", tab: false },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
