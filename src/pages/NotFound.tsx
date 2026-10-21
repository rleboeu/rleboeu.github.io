import { Link } from 'react-router'

export default function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p>
        That page doesn't exist. <Link to="/">Back to home</Link>
      </p>
    </section>
  )
}
