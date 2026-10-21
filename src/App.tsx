import { HashRouter, Route, Routes } from 'react-router'
import Layout from './components/Layout'
import Home from './pages/Home'
import NotFound from './pages/NotFound'
import { tools } from './tools/registry'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          {tools.map(({ path, component: Tool }) => (
            <Route key={path} path={path} element={<Tool />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
