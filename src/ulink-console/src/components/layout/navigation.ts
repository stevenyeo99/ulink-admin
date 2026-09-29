import { ClipboardCheck, FolderOpen, LayoutDashboard, SlidersHorizontal, Stamp, Workflow, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shows the Review Queue count next to the item. */
  showReviewCount?: boolean;
}

// The dashboard's page list (docs/imp/demo/API DAY1/PREV_FEEDBACK/CONSOLE_DASHBOARD_DESIGN.md), grouped
// by how people work — not by pipeline step (steps are the orchestrator's view; see the design doc).
// Only pages that exist are listed.
export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Dashboard', items: [{ to: '/overview', label: 'Overview', icon: LayoutDashboard }] },
  {
    title: 'Work',
    items: [
      { to: '/review', label: 'Review queue', icon: ClipboardCheck, showReviewCount: true },
      { to: '/approvals', label: 'Approvals', icon: Stamp },
      { to: '/cases', label: 'Cases', icon: FolderOpen },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/pipeline', label: 'Pipeline', icon: Workflow },
      { to: '/stp-settings', label: 'STP settings', icon: SlidersHorizontal },
    ],
  },
];
