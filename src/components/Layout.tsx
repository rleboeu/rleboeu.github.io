import { Suspense } from 'react'
import { Link, Outlet } from 'react-router'
import ToolSearch from './ToolSearch'

export default function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">
          rleboeu.github.io
        </Link>
        <ToolSearch />
      </header>
      <main className="main">
        <Suspense fallback={<p>Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
