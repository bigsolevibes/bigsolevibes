import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const SOLE_REPORT_DIR = path.join(process.cwd(), 'content/sole-report')

export interface SoleReportFrontmatter {
  title:      string
  date:       string
  excerpt:    string
  slug:       string
  topic:      string
  tags?:      string[]
  coverImage?: string
}

export interface SoleReportPost extends SoleReportFrontmatter {
  content:  string
  readTime: string
}

function calcReadTime(content: string): string {
  const words   = content.trim().split(/\s+/).length
  const minutes = Math.max(1, Math.ceil(words / 200))
  return `${minutes} min read`
}

export function getAllSoleReportPosts(): SoleReportPost[] {
  if (!fs.existsSync(SOLE_REPORT_DIR)) return []
  const files = fs.readdirSync(SOLE_REPORT_DIR).filter((f) => f.endsWith('.mdx'))
  return files
    .map((file) => {
      const raw               = fs.readFileSync(path.join(SOLE_REPORT_DIR, file), 'utf-8')
      const { data, content } = matter(raw)
      return {
        ...(data as SoleReportFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getSoleReportPostBySlug(slug: string): SoleReportPost | null {
  if (!fs.existsSync(SOLE_REPORT_DIR)) return null
  const files = fs.readdirSync(SOLE_REPORT_DIR).filter((f) => f.endsWith('.mdx'))
  for (const file of files) {
    const raw               = fs.readFileSync(path.join(SOLE_REPORT_DIR, file), 'utf-8')
    const { data, content } = matter(raw)
    if (data.slug === slug) {
      return {
        ...(data as SoleReportFrontmatter),
        content,
        readTime: calcReadTime(content),
      }
    }
  }
  return null
}
