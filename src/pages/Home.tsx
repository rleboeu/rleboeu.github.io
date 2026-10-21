import { Link } from 'react-router'
import { tools } from '../tools/registry'

export default function Home() {
  return (
    <section>
      <h1>Utilities</h1>
      <p>Browser-based tools. Everything runs on your device; nothing is uploaded.</p>
      <ul className="tool-grid">
        {tools.map((tool) => (
          <li key={tool.path}>
            <Link to={`/${tool.path}`} className="tool-card">
              <h2>{tool.name}</h2>
              <p>{tool.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
