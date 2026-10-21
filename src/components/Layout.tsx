import { Suspense } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { tools } from '../tools/registry'

export default function Layout() {
  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">
          rleboeu.github.io
        </Link>
        <nav className="nav">
          {tools.map((tool) => (
            <NavLink key={tool.path} to={`/${tool.path}`}>
              {tool.name}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="main">
        <Suspense fallback={<p>Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
