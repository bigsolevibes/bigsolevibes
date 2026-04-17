import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const POSTS_DIR = path.join(process.cwd(), 'content/posts')

export interface PostFrontmatter {
  title: string
  date: string
  excerpt: string
  slug: string
  coverImage?: string
  tags?: string[]
}

export interface Post extends PostFrontmatter {
  content: string
  readTime: string
}

function calcReadTime(content: string): string {
  const words = content.trim().split(/\s+/).length
  const minutes = Math.max(1, Math.ceil(words / 200))
  return `${minutes} min read`
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(POSTS_DIR)) return []
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'))
  return files
    .map((file) => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8')
      const { data, content } = matter(raw)
      return {
        ...(data as PostFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getPostBySlug(slug: string): Post | null {
  if (!fs.existsSync(POSTS_DIR)) return null
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.mdx'))
  for (const file of files) {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8')
    const { data, content } = matter(raw)
    if (data.slug === slug) {
      return {
        ...(data as PostFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    }
  }
  return null
}
