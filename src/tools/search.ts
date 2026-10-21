import { tools, type Tool } from './registry'

/** Filler words people type in queries like "pdf to word" that shouldn't have to match anything. */
const stopWords = new Set(['a', 'an', 'and', 'the', 'to', 'from', 'into', 'in', 'of', 'for', 'my', 'or'])

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function scoreTerm(tool: Tool, term: string): number {
  const nameWords = normalize(tool.name).split(' ')
  const tags = tool.tags.map(normalize)
  let score = 0
  if (nameWords.some((word) => word.startsWith(term))) score = Math.max(score, 10)
  else if (normalize(tool.name).includes(term)) score = Math.max(score, 6)
  if (tags.includes(term)) score = Math.max(score, 8)
  else if (tags.some((tag) => tag.split(' ').some((word) => word.startsWith(term)))) score = Math.max(score, 5)
  else if (tags.some((tag) => tag.includes(term))) score = Math.max(score, 3)
  if (score === 0 && normalize(tool.description).includes(term)) score = 1
  return score
}

/**
 * Returns the tools matching `query`, best match first, by name, hidden tags and description.
 * Every meaningful word of the query must match something on the tool. An empty query returns every tool.
 */
export function searchTools(query: string): Tool[] {
  const phrase = normalize(query)
  if (!phrase) return tools
  const words = phrase.split(' ')
  const terms = words.filter((word) => !stopWords.has(word))
  if (terms.length === 0) terms.push(...words)

  return tools
    .map((tool, index) => {
      let score = 0
      for (const term of terms) {
        const termScore = scoreTerm(tool, term)
        if (termScore === 0) return null
        score += termScore
      }
      // Reward a whole-phrase hit, e.g. "pdf to word" against that exact tag.
      if (terms.length > 1 && tool.tags.some((tag) => normalize(tag) === phrase)) score += 20
      return { tool, score, index }
    })
    .filter((match) => match !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((match) => match.tool)
}
