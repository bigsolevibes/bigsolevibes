import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const LOUNGE_DIR = path.join(process.cwd(), 'content/lounge')

export interface LoungeFrontmatter {
  title:   string
  date:    string
  excerpt: string
  slug:    string
  chapter: number
  type:    'hub' | 'spoke'
  tags?:   string[]
}

export interface LoungePost extends LoungeFrontmatter {
  content:  string
  readTime: string
}

function calcReadTime(content: string): string {
  const words   = content.trim().split(/\s+/).length
  const minutes = Math.max(1, Math.ceil(words / 200))
  return `${minutes} min read`
}

export function getAllLoungePosts(): LoungePost[] {
  if (!fs.existsSync(LOUNGE_DIR)) return []
  const files = fs.readdirSync(LOUNGE_DIR).filter((f) => f.endsWith('.mdx'))
  return files
    .map((file) => {
      const raw            = fs.readFileSync(path.join(LOUNGE_DIR, file), 'utf-8')
      const { data, content } = matter(raw)
      return {
        ...(data as LoungeFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getLoungePostBySlug(slug: string): LoungePost | null {
  if (!fs.existsSync(LOUNGE_DIR)) return null
  const files = fs.readdirSync(LOUNGE_DIR).filter((f) => f.endsWith('.mdx'))
  for (const file of files) {
    const raw            = fs.readFileSync(path.join(LOUNGE_DIR, file), 'utf-8')
    const { data, content } = matter(raw)
    if (data.slug === slug) {
      return {
        ...(data as LoungeFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    }
  }
  return null
}

export interface LoungeChapter {
  chapter: number
  hub:     LoungePost | null
  spokes:  LoungePost[]
}

export function getLoungeChapters(): LoungeChapter[] {
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const all   = getAllLoungePosts().filter((p) => new Date(p.date) <= today)

  const chapMap = new Map<number, { hub: LoungePost | null; spokes: LoungePost[] }>()

  for (const post of all) {
    if (!chapMap.has(post.chapter)) {
      chapMap.set(post.chapter, { hub: null, spokes: [] })
    }
    const entry = chapMap.get(post.chapter)!
    if (post.type === 'hub') {
      entry.hub = post
    } else {
      entry.spokes.push(post)
    }
  }

  return Array.from(chapMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([chapter, data]) => ({ chapter, ...data }))
}
