'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, LayoutGrid } from 'lucide-react';

const PAGES = [['/', 'Classroom', LayoutGrid], ['/datasets', 'Datasets', Database]];

// Shared dashboard sidebar; each page adds its own details below the navigation.
export default function Sidebar({ children }) {
  const path = usePathname();
  return <aside className="sidebar">
    <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"/>Agent Classroom</Link>
    <p className="sidebar-label">Dashboard</p>
    <nav className="side-nav" aria-label="Dashboard">
      {PAGES.map(([href, label, Icon]) => <Link key={href} href={href} className={path === href ? 'on' : ''} aria-current={path === href ? 'page' : undefined}><Icon size={15}/>{label}</Link>)}
    </nav>
    {children}
  </aside>;
}
